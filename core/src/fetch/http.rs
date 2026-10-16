use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use reqwest::{header::REFERER, Client};

use crate::{
    domain::{CachedFont, FontCandidate, FontFormat, TransferMethod},
    support::{
        http::{read_limited, MAX_FONT_BYTES},
        sanitize_file_stem, validate_public_url, write_unique_file,
    },
};

pub async fn download_font(
    client: Client,
    font: FontCandidate,
    page_url: String,
    cache_dir: PathBuf,
    restrict_private: bool,
) -> Result<CachedFont> {
    let mut last_error = None;

    for source in font.sources.clone() {
        if restrict_private {
            if let Err(error) = validate_public_url(&source.url).await {
                last_error = Some(error);
                continue;
            }
        }
        let response = client
            .get(&source.url)
            .header(REFERER, &page_url)
            .send()
            .await;
        match response {
            Ok(response) => match response.error_for_status() {
                Ok(response) => {
                    let bytes = match read_limited(response, MAX_FONT_BYTES).await {
                        Ok(bytes) => bytes,
                        Err(error) => {
                            last_error = Some(error);
                            continue;
                        }
                    };
                    if bytes.len() < 100 {
                        last_error = Some(anyhow!("downloaded file too small ({})", bytes.len()));
                        continue;
                    }

                    let detected_format = match FontFormat::sniff(&bytes) {
                        FontFormat::Unknown => source.format,
                        detected => detected,
                    };
                    let path = write_cache_file(&cache_dir, &font, detected_format, &bytes)?;
                    return Ok(CachedFont {
                        info: font,
                        cached_path: path,
                        downloaded_format: detected_format,
                        source_url: source.url.clone(),
                        transfer_method: TransferMethod::Http,
                        parts: Vec::new(),
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
    font: &FontCandidate,
    format: FontFormat,
    bytes: &[u8],
) -> Result<PathBuf> {
    let family = sanitize_file_stem(&font.family);
    let weight = sanitize_file_stem(&font.weight).to_ascii_lowercase();
    let style = sanitize_file_stem(&font.style).to_ascii_lowercase();
    let filename = format!("{}-{}-{}.{}", family, weight, style, format.extension());
    write_unique_file(&cache_dir.join(filename), bytes).context("Failed to write font cache file")
}
