mod browser;
mod http;

use std::path::Path;

use anyhow::Result;
use futures::{stream, StreamExt};

use crate::{
    domain::{CachedFont, FontCandidate},
    support::{emit_log, http::build_http_client, Logger},
};

pub struct DownloadBatch {
    pub cached: Vec<CachedFont>,
    pub failures: Vec<String>,
}

pub async fn download_fonts(
    fonts: &[FontCandidate],
    page_url: &str,
    cache_dir: &Path,
    concurrency: usize,
    allow_browser_fallback: bool,
    webdriver_url: &str,
    logger: Option<Logger>,
) -> Result<DownloadBatch> {
    let client = build_http_client()?;
    emit_log(
        logger.as_ref(),
        format!("Downloading {} font variant(s)", fonts.len()),
    );

    let mut results = stream::iter(fonts.iter().cloned().enumerate().map(|(index, font)| {
        let client = client.clone();
        let page_url = page_url.to_string();
        let cache_dir = cache_dir.to_path_buf();
        async move {
            let result = http::download_font(client, font.clone(), page_url, cache_dir)
                .await
                .map_err(|error| error.to_string());
            (index, font, result)
        }
    }))
    .buffer_unordered(concurrency.max(1))
    .collect::<Vec<_>>()
    .await;

    results.sort_by_key(|(index, _, _)| *index);

    let mut cached = Vec::new();
    let mut failures = Vec::new();
    let mut browser_retry = Vec::new();

    for (_, font, result) in results {
        match result {
            Ok(cached_font) => cached.push(cached_font),
            Err(http_error) if allow_browser_fallback => browser_retry.push((font, http_error)),
            Err(http_error) => failures.push(failure_line(&font, http_error)),
        }
    }

    if allow_browser_fallback && !browser_retry.is_empty() {
        emit_log(
            logger.as_ref(),
            format!(
                "Retrying {} download(s) in browser context",
                browser_retry.len()
            ),
        );
        match browser::BrowserFetcher::connect(webdriver_url, page_url, logger.clone()).await {
            Ok(mut session) => {
                for (font, http_error) in browser_retry {
                    match session.fetch_font(&font, cache_dir).await {
                        Ok(cached_font) => cached.push(cached_font),
                        Err(browser_error) => failures.push(failure_line(
                            &font,
                            format!("http: {http_error}; browser: {browser_error}"),
                        )),
                    }
                }
                let _ = session.shutdown().await;
            }
            Err(browser_error) => {
                for (font, http_error) in browser_retry {
                    failures.push(failure_line(
                        &font,
                        format!("http: {http_error}; browser session: {browser_error}"),
                    ));
                }
            }
        }
    }

    cached.sort_by(|left, right| {
        left.info
            .family
            .to_ascii_lowercase()
            .cmp(&right.info.family.to_ascii_lowercase())
            .then_with(|| left.info.weight.cmp(&right.info.weight))
            .then_with(|| left.info.style.cmp(&right.info.style))
    });

    Ok(DownloadBatch { cached, failures })
}

fn failure_line(font: &FontCandidate, detail: impl Into<String>) -> String {
    format!(
        "{} ({} {}): {}",
        font.family,
        font.weight,
        font.style,
        detail.into()
    )
}
