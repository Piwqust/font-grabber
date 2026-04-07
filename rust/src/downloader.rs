use std::{
    fs,
    path::{Path, PathBuf},
};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::header::REFERER;
use serde_json::Value;
use thirtyfour::prelude::*;
use tokio::time::{sleep, Duration};

use crate::{
    models::{CachedFont, DiscoveredFont, FontFormat, Logger, TransferMethod},
    util::{build_http_client, emit_log, next_available_path, sanitize_file_stem},
};

pub struct DownloadBatch {
    pub cached: Vec<CachedFont>,
    pub failures: Vec<String>,
}

pub async fn download_fonts_to_cache(
    fonts: &[DiscoveredFont],
    page_url: &str,
    cache_dir: &Path,
    prefer_browser_fetch: bool,
    webdriver_url: &str,
    logger: Option<Logger>,
) -> Result<DownloadBatch> {
    let client = build_http_client()?;

    let mut browser = if prefer_browser_fetch {
        match BrowserDownloader::connect(webdriver_url, page_url, logger.clone()).await {
            Ok(session) => Some(session),
            Err(error) => {
                emit_log(
                    logger.as_ref(),
                    format!("Browser fetch disabled, falling back to HTTP downloads: {error}"),
                );
                None
            }
        }
    } else {
        None
    };

    let mut cached = Vec::new();
    let mut failures = Vec::new();

    for (index, font) in fonts.iter().enumerate() {
        emit_log(
            logger.as_ref(),
            format!("Downloading {}/{}: {}", index + 1, fonts.len(), font.family),
        );

        let mut browser_error = None;
        if let Some(session) = browser.as_mut() {
            match session.fetch_font_to_cache(font, cache_dir).await {
                Ok(result) => {
                    cached.push(result);
                    continue;
                }
                Err(error) => {
                    browser_error = Some(error.to_string());
                }
            }
        }

        match download_font_http(&client, font, page_url, cache_dir).await {
            Ok(result) => cached.push(result),
            Err(error) => {
                let detail = match browser_error {
                    Some(browser_error) => format!("browser: {browser_error}; http: {error}"),
                    None => error.to_string(),
                };
                failures.push(format!(
                    "{} ({} {}): {detail}",
                    font.family, font.weight, font.style
                ));
            }
        }
    }

    if let Some(session) = browser {
        let _ = session.shutdown().await;
    }

    Ok(DownloadBatch { cached, failures })
}

async fn download_font_http(
    client: &reqwest::Client,
    font: &DiscoveredFont,
    page_url: &str,
    cache_dir: &Path,
) -> Result<CachedFont> {
    let mut last_error = None;

    for source in &font.sources {
        let response = client
            .get(&source.url)
            .header(REFERER, page_url)
            .send()
            .await;
        match response {
            Ok(response) => match response.error_for_status() {
                Ok(response) => {
                    let bytes = response
                        .bytes()
                        .await
                        .context("Failed to read download body")?;
                    if bytes.len() < 100 {
                        last_error = Some(anyhow!("downloaded file too small ({})", bytes.len()));
                        continue;
                    }

                    let path = write_cache_file(cache_dir, font, source.format, &bytes)?;
                    return Ok(CachedFont {
                        info: font.clone(),
                        cached_path: path,
                        downloaded_format: source.format,
                        source_url: source.url.clone(),
                        transfer_method: TransferMethod::HttpFetch,
                    });
                }
                Err(error) => last_error = Some(error.into()),
            },
            Err(error) => last_error = Some(error.into()),
        }
    }

    Err(last_error.unwrap_or_else(|| anyhow!("No usable download source found")))
}

fn write_cache_file(
    cache_dir: &Path,
    font: &DiscoveredFont,
    format: FontFormat,
    bytes: &[u8],
) -> Result<PathBuf> {
    let family = sanitize_file_stem(&font.family);
    let filename = format!(
        "{}-{}-{}.{}",
        family,
        font.weight,
        font.style,
        format.extension()
    );
    let path = next_available_path(&cache_dir.join(filename));
    fs::write(&path, bytes)
        .with_context(|| format!("Failed to write cache file {}", path.display()))?;
    Ok(path)
}

struct BrowserDownloader {
    driver: WebDriver,
}

impl BrowserDownloader {
    async fn connect(webdriver_url: &str, page_url: &str, logger: Option<Logger>) -> Result<Self> {
        let mut caps = DesiredCapabilities::chrome();
        caps.add_arg("--headless=new")?;
        caps.add_arg("--disable-gpu")?;
        caps.add_arg("--no-sandbox")?;

        let driver = WebDriver::new(webdriver_url, caps)
            .await
            .with_context(|| format!("Could not connect to WebDriver at {webdriver_url}"))?;

        emit_log(
            logger.as_ref(),
            "Starting browser-backed download session...",
        );
        driver
            .goto(page_url)
            .await
            .with_context(|| format!("Could not open {page_url}"))?;
        sleep(Duration::from_millis(1500)).await;

        Ok(Self { driver })
    }

    async fn fetch_font_to_cache(
        &mut self,
        font: &DiscoveredFont,
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

                    let path = write_cache_file(cache_dir, font, source.format, &bytes)?;
                    return Ok(CachedFont {
                        info: font.clone(),
                        cached_path: path,
                        downloaded_format: source.format,
                        source_url: source.url.clone(),
                        transfer_method: TransferMethod::BrowserFetch,
                    });
                }
                Err(error) => {
                    last_error = Some(error.into());
                }
            }
        }

        Err(last_error
            .unwrap_or_else(|| anyhow!("Browser fetch did not produce a valid font response")))
    }

    async fn shutdown(self) -> Result<()> {
        self.driver.quit().await.map_err(Into::into)
    }
}

const BROWSER_FETCH_SCRIPT: &str = r#"
const url = arguments[0];
return fetch(url)
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
