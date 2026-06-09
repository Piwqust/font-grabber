use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::Value;
use thirtyfour::prelude::*;

use crate::{
    domain::{CachedFont, FontCandidate, FontFormat, TransferMethod},
    support::{emit_log, next_available_path, sanitize_file_stem, webdriver, Logger},
};

pub struct BrowserFetcher {
    driver: WebDriver,
}

impl BrowserFetcher {
    pub async fn connect(
        webdriver_url: &str,
        page_url: &str,
        logger: Option<Logger>,
    ) -> Result<Self> {
        let driver = webdriver::connect(webdriver_url).await?;

        emit_log(logger.as_ref(), "Starting browser-backed download session");
        driver
            .goto(page_url)
            .await
            .with_context(|| format!("Could not open {page_url}"))?;
        webdriver::wait_for_page_ready(&driver).await?;

        Ok(Self { driver })
    }

    pub async fn fetch_font(
        &mut self,
        font: &FontCandidate,
        cache_dir: &Path,
    ) -> Result<CachedFont> {
        let mut last_error = None;

        for source in &font.sources {
            let result = self
                .driver
                .execute(
                    BROWSER_FETCH_SCRIPT,
                    vec![Value::String(source.url.clone())],
                )
                .await;

            match result {
                Ok(result) => {
                    let encoded: String = result
                        .convert()
                        .context("Could not read browser fetch result")?;
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
                Err(error) => {
                    last_error = Some(error.into());
                }
            }
        }

        Err(last_error.unwrap_or_else(|| anyhow!("Browser fetch did not produce a valid response")))
    }

    pub async fn shutdown(self) -> Result<()> {
        self.driver.quit().await.map_err(Into::into)
    }
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

const BROWSER_FETCH_SCRIPT: &str = r#"
const url = arguments[0];
return fetch(url, { credentials: 'include' })
  .then(async response => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunk));
    }
    return btoa(binary);
  });
"#;
