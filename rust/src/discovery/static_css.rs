use std::collections::{HashSet, VecDeque};

use anyhow::{Context, Result};
use scraper::{Html, Selector};

use crate::{
    discovery::{parser, CollectorResult},
    domain::ScanSource,
    support::{emit_log, http::build_http_client, Logger},
};

const MAX_STYLESHEETS: usize = 48;

pub async fn discover(page_url: &str, logger: Option<Logger>) -> Result<CollectorResult> {
    emit_log(logger.as_ref(), "Fetching page HTML for static discovery");

    let client = build_http_client()?;
    let response = client
        .get(page_url)
        .send()
        .await
        .with_context(|| format!("Failed to fetch page HTML: {page_url}"))?
        .error_for_status()
        .with_context(|| format!("Page returned an error response: {page_url}"))?;

    let resolved_page_url = response.url().clone();
    let html_text = response.text().await.context("Failed to read page HTML")?;

    let document = Html::parse_document(&html_text);
    let style_selector = Selector::parse("style").expect("valid style selector");
    let link_selector = Selector::parse("link[rel][href]").expect("valid link selector");

    let mut fonts = Vec::new();
    let mut warnings = Vec::new();
    let mut queue = VecDeque::new();
    let mut queued = HashSet::new();

    for style in document.select(&style_selector) {
        let css = style.text().collect::<String>();
        let parsed = parser::parse_stylesheet(&css, resolved_page_url.as_str(), ScanSource::StaticCss)?;
        fonts.extend(parsed.fonts);
        for import in parsed.imports {
            if queued.insert(import.clone()) {
                queue.push_back(import);
            }
        }
    }

    for link in document.select(&link_selector) {
        let Some(rel) = link.value().attr("rel") else {
            continue;
        };
        if !rel.to_ascii_lowercase().contains("stylesheet") {
            continue;
        }

        let Some(href) = link.value().attr("href") else {
            continue;
        };
        let Ok(stylesheet_url) = resolved_page_url.join(href) else {
            continue;
        };
        let stylesheet_url = stylesheet_url.to_string();
        if queued.insert(stylesheet_url.clone()) {
            queue.push_back(stylesheet_url);
        }
    }

    let mut processed = HashSet::new();
    while let Some(stylesheet_url) = queue.pop_front() {
        if processed.len() >= MAX_STYLESHEETS {
            let warning = format!("Stopped after {MAX_STYLESHEETS} linked stylesheets to keep discovery predictable");
            emit_log(logger.as_ref(), &warning);
            warnings.push(warning);
            break;
        }
        if !processed.insert(stylesheet_url.clone()) {
            continue;
        }

        let response = match client.get(&stylesheet_url).send().await {
            Ok(response) => response,
            Err(error) => {
                warnings.push(format!("Failed fetching stylesheet {stylesheet_url}: {error}"));
                continue;
            }
        };
        let response = match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                warnings.push(format!("Stylesheet returned an error {stylesheet_url}: {error}"));
                continue;
            }
        };
        let css = match response.text().await {
            Ok(css) => css,
            Err(error) => {
                warnings.push(format!("Failed reading stylesheet body {stylesheet_url}: {error}"));
                continue;
            }
        };

        let parsed = parser::parse_stylesheet(&css, &stylesheet_url, ScanSource::StaticCss)?;
        fonts.extend(parsed.fonts);
        for import in parsed.imports {
            if !processed.contains(&import) && queued.insert(import.clone()) {
                queue.push_back(import);
            }
        }
    }

    Ok(CollectorResult { fonts: parser::merge_fonts(Vec::new(), fonts), warnings })
}
