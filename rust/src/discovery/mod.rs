mod browser_css;
mod parser;
mod static_css;

use anyhow::{Context, Result};

use crate::{
    domain::{FontCandidate, ScanReport, ScanRequest},
    support::{emit_log, Logger},
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
            format!("Escalating to browser discovery via {}", request.webdriver_url),
        );
        let browser_result = browser_css::discover(
            &request.page_url,
            &request.webdriver_url,
            logger.clone(),
        )
        .await
        .context("Browser discovery failed")?;
        fonts = parser::merge_fonts(fonts, browser_result.fonts);
        warnings.extend(browser_result.warnings);
        used_browser = true;
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
