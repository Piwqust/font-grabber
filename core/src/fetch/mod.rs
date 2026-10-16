mod browser;
mod http;

use std::path::Path;

use anyhow::Result;
use futures::{stream, StreamExt};

use crate::{
    domain::{CachedFont, CachedPart, FontCandidate},
    support::{emit_log, http::build_http_client, Logger},
};

pub struct DownloadBatch {
    pub cached: Vec<CachedFont>,
    pub failures: Vec<String>,
    pub failure_details: Vec<(String, String)>,
}

pub async fn download_fonts(
    fonts: &[FontCandidate],
    page_url: &str,
    cache_dir: &Path,
    concurrency: usize,
    allow_browser_fallback: bool,
    restrict_private: bool,
    logger: Option<Logger>,
) -> Result<DownloadBatch> {
    anyhow::ensure!(
        !restrict_private || fonts.len() <= 80,
        "Choose at most 80 fonts per request"
    );
    let client = build_http_client()?;
    emit_log(
        logger.as_ref(),
        format!("Downloading {} font variant(s)", fonts.len()),
    );

    let budget = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let http_downloads = stream::iter(fonts.iter().cloned().enumerate().map(|(index, font)| {
        let budget = budget.clone();
        let client = client.clone();
        let page_url = page_url.to_string();
        let cache_dir = cache_dir.to_path_buf();
        async move {
            if restrict_private
                && budget.load(std::sync::atomic::Ordering::Relaxed) >= 128 * 1024 * 1024
            {
                return (
                    index,
                    font,
                    Err("Download batch exceeds 128 MiB. Choose fewer files.".into()),
                );
            }
            let mut result = http::download_font(
                client.clone(),
                font.clone(),
                page_url.clone(),
                cache_dir.clone(),
                restrict_private,
            )
            .await
            .map_err(|error| error.to_string());
            if let Ok(cached) = result {
                result = attach_parts(&client, cached, &page_url, &cache_dir, restrict_private).await;
            }
            if restrict_private {
                if let Ok(cached) = &result {
                    let size = std::iter::once(&cached.cached_path)
                        .chain(cached.parts.iter().map(|part| &part.path))
                        .filter_map(|path| std::fs::metadata(path).ok())
                        .map(|m| m.len())
                        .sum::<u64>();
                    if budget.fetch_add(size, std::sync::atomic::Ordering::Relaxed) + size
                        > 128 * 1024 * 1024
                    {
                        let _ = std::fs::remove_file(&cached.cached_path);
                        result = Err("Download batch exceeds 128 MiB. Choose fewer files.".into());
                    }
                }
            }
            (index, font, result)
        }
    }))
    .buffer_unordered(if restrict_private {
        1
    } else {
        concurrency.max(1)
    })
    .collect::<Vec<_>>();
    let mut results = if restrict_private {
        tokio::time::timeout(std::time::Duration::from_secs(75), http_downloads)
            .await
            .map_err(|_| anyhow::anyhow!("Downloads took too long. Choose fewer files."))?
    } else {
        http_downloads.await
    };

    results.sort_by_key(|(index, _, _)| *index);

    let mut cached = Vec::new();
    let mut failures = Vec::new();
    let mut failure_details = Vec::new();
    let mut browser_retry = Vec::new();

    for (_, font, result) in results {
        match result {
            Ok(cached_font) => cached.push(cached_font),
            Err(http_error) if allow_browser_fallback => browser_retry.push((font, http_error)),
            Err(http_error) => {
                failure_details.push((font.id.clone(), http_error.clone()));
                failures.push(failure_line(&font, http_error));
            }
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
        let retry_fonts: Vec<FontCandidate> =
            browser_retry.iter().map(|(font, _)| font.clone()).collect();
        let http_errors: Vec<String> = browser_retry
            .iter()
            .map(|(_, error)| error.clone())
            .collect();
        let page = page_url.to_string();
        let dir = cache_dir.to_path_buf();
        let log = logger.clone();
        let fetched = match tokio::task::spawn_blocking(move || {
            browser::fetch_failed_fonts(&retry_fonts, &page, &dir, log)
        })
        .await
        {
            Ok(results) => results,
            Err(error) => browser_retry
                .iter()
                .map(|(font, _)| (font.clone(), Err(format!("browser task panicked: {error}"))))
                .collect(),
        };

        for (index, (font, result)) in fetched.into_iter().enumerate() {
            let http_error = http_errors.get(index).cloned().unwrap_or_default();
            let result = match result {
                Ok(cached_font) => {
                    attach_parts(&client, cached_font, page_url, cache_dir, restrict_private)
                        .await
                        .map_err(|error| format!("browser: {error}"))
                }
                Err(error) => Err(error),
            };
            match result {
                Ok(cached_font) => cached.push(cached_font),
                Err(browser_error) => {
                    let detail = format!("http: {http_error}; browser: {browser_error}");
                    failure_details.push((font.id.clone(), detail.clone()));
                    failures.push(failure_line(&font, detail));
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

    Ok(DownloadBatch {
        cached,
        failures,
        failure_details,
    })
}

/// Downloads the other pieces of a face the site serves split. A missing piece
/// fails the face: a font without its extended characters would look complete
/// and not be.
async fn attach_parts(
    client: &reqwest::Client,
    mut cached: CachedFont,
    page_url: &str,
    cache_dir: &Path,
    restrict_private: bool,
) -> std::result::Result<CachedFont, String> {
    let total = cached.info.parts.len() + 1;
    for (index, part) in cached.info.parts.clone().into_iter().enumerate() {
        let mut piece = cached.info.clone();
        piece.id = format!("{}#part{}", piece.id, index + 2);
        piece.sources = part.sources;
        piece.parts = Vec::new();
        let downloaded = http::download_font(
            client.clone(),
            piece,
            page_url.to_string(),
            cache_dir.to_path_buf(),
            restrict_private,
        )
        .await
        .map_err(|error| {
            format!("piece {} of {total} could not be downloaded: {error}", index + 2)
        })?;
        cached.parts.push(CachedPart {
            path: downloaded.cached_path,
            format: downloaded.downloaded_format,
        });
    }
    Ok(cached)
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
