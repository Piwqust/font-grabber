mod browser_css;
mod parser;
mod static_css;

use std::collections::HashMap;

use anyhow::{Context, Result};

use crate::{
    convert,
    domain::{FontCandidate, FontScript, FontSource, ScanReport, ScanRequest},
    support::{emit_log, http::build_http_client, Logger},
};

#[derive(Debug, Default)]
pub struct CollectorResult {
    pub fonts: Vec<FontCandidate>,
    pub warnings: Vec<String>,
}

pub async fn scan(request: &ScanRequest, logger: Option<Logger>) -> Result<ScanReport> {
    emit_log(logger.as_ref(), format!("Scanning {}", request.page_url));

    let mut warnings = Vec::new();
    let static_result = match static_css::discover(&request.page_url, logger.clone()).await {
        Ok(result) => result,
        Err(error) if !matches!(request.mode, crate::domain::DiscoveryMode::Static) => {
            warnings.push(format!("Static scan failed: {error}"));
            CollectorResult::default()
        }
        Err(error) => return Err(error),
    };

    warnings.extend(static_result.warnings);
    let mut used_browser = false;
    let mut fonts = static_result.fonts;

    if request.mode.should_collect_browser(!fonts.is_empty()) {
        emit_log(
            logger.as_ref(),
            format!(
                "Escalating to browser discovery via {}",
                request.webdriver_url
            ),
        );
        let browser_result =
            browser_css::discover(&request.page_url, &request.webdriver_url, logger.clone())
                .await
                .context("Browser discovery failed")?;
        fonts = parser::merge_fonts(fonts, browser_result.fonts);
        warnings.extend(browser_result.warnings);
        used_browser = true;
    }

    if request.enrich_scripts {
        warnings.extend(enrich_font_scripts(&mut fonts, logger.clone()).await);
    } else {
        for font in &mut fonts {
            merge_scripts(&mut font.scripts, infer_scripts_from_name(&font.family));
        }
    }

    fonts.sort_by(|left, right| {
        left.family
            .to_ascii_lowercase()
            .cmp(&right.family.to_ascii_lowercase())
            .then_with(|| left.weight.cmp(&right.weight))
            .then_with(|| left.style.cmp(&right.style))
    });

    Ok(ScanReport {
        page_url: request.page_url.clone(),
        mode: request.mode,
        used_browser,
        warnings,
        fonts,
    })
}

async fn enrich_font_scripts(fonts: &mut [FontCandidate], logger: Option<Logger>) -> Vec<String> {
    if fonts.is_empty() {
        return Vec::new();
    }

    let client = match build_http_client() {
        Ok(client) => client,
        Err(error) => return vec![format!("Script detection unavailable: {error}")],
    };
    let mut warnings = Vec::new();
    let mut cache = HashMap::<String, Vec<FontScript>>::new();

    for font in fonts {
        merge_scripts(&mut font.scripts, infer_scripts_from_name(&font.family));
        if !font.scripts.is_empty() || font.unicode_range.is_some() {
            continue;
        }

        let Some(source) = font.sources.first() else {
            continue;
        };

        if let Some(cached) = cache.get(&source.url) {
            merge_scripts(&mut font.scripts, cached.iter().copied());
            continue;
        }

        emit_log(
            logger.as_ref(),
            format!("Inspecting script coverage for {}", font.family),
        );
        match inspect_font_scripts(&client, source).await {
            Ok(scripts) => {
                cache.insert(source.url.clone(), scripts.clone());
                merge_scripts(&mut font.scripts, scripts);
            }
            Err(error) => {
                cache.insert(source.url.clone(), Vec::new());
                warnings.push(format!(
                    "Could not inspect {} script support: {error}",
                    font.family
                ));
            }
        }
    }

    warnings
}

async fn inspect_font_scripts(
    client: &reqwest::Client,
    source: &FontSource,
) -> Result<Vec<FontScript>> {
    let response = client
        .get(&source.url)
        .send()
        .await
        .with_context(|| format!("Failed to fetch {}", source.url))?
        .error_for_status()
        .with_context(|| format!("Font returned an error response: {}", source.url))?;
    let bytes = response
        .bytes()
        .await
        .with_context(|| format!("Failed to read font bytes from {}", source.url))?;
    let sfnt = convert::decompress_to_sfnt(bytes.as_ref(), source.format)?;
    convert::detect_supported_scripts(&sfnt)
}

fn infer_scripts_from_name(name: &str) -> Vec<FontScript> {
    let lower = name.to_ascii_lowercase();
    let mut scripts = Vec::new();

    if lower.contains("latin") {
        scripts.push(FontScript::Latin);
    }
    if lower.contains("cyril") {
        scripts.push(FontScript::Cyrillic);
    }
    if lower.contains("greek") {
        scripts.push(FontScript::Greek);
    }
    if lower.contains("vietnam") {
        scripts.push(FontScript::Vietnamese);
    }
    if lower.contains("arabic") {
        scripts.push(FontScript::Arabic);
    }
    if lower.contains("hebrew") {
        scripts.push(FontScript::Hebrew);
    }
    if lower.contains("devanagari") {
        scripts.push(FontScript::Devanagari);
    }
    if lower.contains("korean") {
        scripts.push(FontScript::Korean);
    }
    if lower.contains("thai") {
        scripts.push(FontScript::Thai);
    }
    if lower.contains("japanese") {
        scripts.push(FontScript::Japanese);
    }
    if lower.contains("tradchinese") || lower.contains("traditional chinese") {
        scripts.push(FontScript::TraditionalChinese);
    }
    if lower.contains("simpchinese") || lower.contains("simplified chinese") {
        scripts.push(FontScript::SimplifiedChinese);
    }

    merge_scripts(&mut scripts, []);
    scripts
}

fn merge_scripts(scripts: &mut Vec<FontScript>, incoming: impl IntoIterator<Item = FontScript>) {
    scripts.extend(incoming);
    scripts.sort();
    scripts.dedup();
}
