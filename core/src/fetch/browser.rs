use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use headless_chrome::Browser;

use crate::{
    domain::{CachedFont, FontCandidate, FontFormat, TransferMethod},
    support::{chrome, emit_log, next_available_path, sanitize_file_stem, Logger},
};

pub fn fetch_failed_fonts(
    fonts: &[FontCandidate],
    page_url: &str,
    cache_dir: &Path,
    logger: Option<Logger>,
) -> Vec<(FontCandidate, Result<CachedFont, String>)> {
    match chrome::with_browser(|browser| {
        fetch_with_browser(browser, fonts, page_url, cache_dir, logger.clone())
    }) {
        Ok(results) => results,
        Err(error) => fonts
            .iter()
            .cloned()
            .map(|font| (font, Err(format!("browser session: {error:#}"))))
            .collect(),
    }
}

fn fetch_with_browser(
    browser: &Browser,
    fonts: &[FontCandidate],
    page_url: &str,
    cache_dir: &Path,
    logger: Option<Logger>,
) -> Result<Vec<(FontCandidate, Result<CachedFont, String>)>> {
    emit_log(logger.as_ref(), "Starting browser-backed download session");
    let tab = browser.new_tab().context("Could not open a browser tab")?;
    tab.navigate_to(page_url)
        .with_context(|| format!("Could not open {page_url}"))?;
    let _ = tab.wait_until_navigated();

    let mut results = Vec::with_capacity(fonts.len());
    for font in fonts {
        results.push((
            font.clone(),
            fetch_one(&tab, font, cache_dir).map_err(|error| error.to_string()),
        ));
    }
    Ok(results)
}

fn fetch_one(
    tab: &headless_chrome::Tab,
    font: &FontCandidate,
    cache_dir: &Path,
) -> Result<CachedFont> {
    let mut last_error = None;

    for source in &font.sources {
        let url_js = serde_json::to_string(&source.url)?;
        let script = format!(
            r#"
            fetch({url_js}, {{ credentials: 'include' }})
              .then(async (response) => {{
                if (!response.ok) throw new Error('HTTP ' + response.status);
                const bytes = new Uint8Array(await response.arrayBuffer());
                let binary = '';
                const chunk = 8192;
                for (let i = 0; i < bytes.length; i += chunk) {{
                  binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                }}
                return btoa(binary);
              }})
            "#
        );

        match tab.evaluate(&script, true) {
            Ok(result) => {
                let Some(encoded) = result.value.as_ref().and_then(|value| value.as_str()) else {
                    last_error = Some(anyhow!("browser fetch returned no data"));
                    continue;
                };
                if encoded.is_empty() {
                    last_error = Some(anyhow!("browser fetch returned no data"));
                    continue;
                }
                let bytes = STANDARD
                    .decode(encoded.as_bytes())
                    .context("Could not decode browser-fetched font")?;
                if bytes.len() < 100 {
                    last_error = Some(anyhow!("browser download too small ({})", bytes.len()));
                    continue;
                }

                let detected_format = match FontFormat::sniff(&bytes) {
                    FontFormat::Unknown => source.format,
                    detected => detected,
                };
                let path = write_cache_file(cache_dir, font, detected_format, &bytes)?;
                return Ok(CachedFont {
                    info: font.clone(),
                    cached_path: path,
                    downloaded_format: detected_format,
                    source_url: source.url.clone(),
                    transfer_method: TransferMethod::Browser,
                });
            }
            Err(error) => last_error = Some(error.into()),
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow!("Browser fetch did not produce a valid response")))
}

fn write_cache_file(
    cache_dir: &Path,
    font: &FontCandidate,
    format: FontFormat,
    bytes: &[u8],
) -> Result<PathBuf> {
    let family = sanitize_file_stem(&font.family);
    let weight = sanitize_file_stem(&font.weight).to_ascii_lowercase();
    let style = sanitize_file_stem(&font.style).to_ascii_lowercase();
    let filename = format!("{}-{}-{}.{}", family, weight, style, format.extension());
    let path = next_available_path(&cache_dir.join(filename));
    fs::write(&path, bytes)
        .with_context(|| format!("Failed to write cache file {}", path.display()))?;
    Ok(path)
}
