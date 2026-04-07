use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result};
use regex::Regex;
use scraper::{Html, Selector};
use serde::Deserialize;
use serde_json::Value;
use thirtyfour::prelude::*;
use tokio::time::{sleep, Duration};
use url::Url;

use crate::{
    models::{
        DiscoverRequest, DiscoveredFont, DiscoveryReport, FontFormat, FontSourceRef, Logger,
        ScanSource,
    },
    util::{build_http_client, emit_log},
};

#[derive(Debug, Deserialize)]
struct BrowserFontFaceRule {
    family: String,
    style: String,
    weight: String,
    src: String,
    #[serde(rename = "unicodeRange")]
    unicode_range: Option<String>,
}

pub async fn discover_fonts(
    request: &DiscoverRequest,
    logger: Option<Logger>,
) -> Result<DiscoveryReport> {
    emit_log(
        logger.as_ref(),
        format!("Static scan: {}", request.page_url),
    );

    let static_fonts = match discover_from_static_css(&request.page_url, logger.clone()).await {
        Ok(fonts) => fonts,
        Err(error) if !matches!(request.mode, crate::models::DiscoveryMode::Static) => {
            emit_log(
                logger.as_ref(),
                format!("Static scan failed, falling back to browser discovery: {error}"),
            );
            Vec::new()
        }
        Err(error) => return Err(error),
    };

    let mut used_browser = false;
    let mut fonts = static_fonts.clone();

    if request.mode.should_try_browser(!static_fonts.is_empty()) {
        emit_log(
            logger.as_ref(),
            format!("Browser discovery via {}", request.webdriver_url),
        );
        let browser_fonts =
            discover_from_browser(&request.page_url, &request.webdriver_url, logger.clone())
                .await?;
        fonts = merge_fonts(static_fonts, browser_fonts);
        used_browser = true;
    }

    fonts.sort_by(|left, right| {
        left.family
            .to_ascii_lowercase()
            .cmp(&right.family.to_ascii_lowercase())
            .then_with(|| left.weight.cmp(&right.weight))
            .then_with(|| left.style.cmp(&right.style))
    });

    emit_log(
        logger.as_ref(),
        format!("Discovered {} font variant(s)", fonts.len()),
    );

    Ok(DiscoveryReport {
        fonts,
        used_browser,
    })
}

async fn discover_from_static_css(
    page_url: &str,
    logger: Option<Logger>,
) -> Result<Vec<DiscoveredFont>> {
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
    let (mut collected, stylesheet_urls) = {
        let document = Html::parse_document(&html_text);
        let style_selector = Selector::parse("style").expect("valid style selector");
        let link_selector = Selector::parse("link[rel]").expect("valid stylesheet selector");

        let mut collected = Vec::new();

        for style in document.select(&style_selector) {
            let css = style.text().collect::<String>();
            collected.extend(parse_stylesheet(
                &css,
                resolved_page_url.as_str(),
                ScanSource::StaticCss,
            )?);
        }

        let stylesheet_urls = document
            .select(&link_selector)
            .filter_map(|link| {
                let rel = link.value().attr("rel")?;
                if !rel.to_ascii_lowercase().contains("stylesheet") {
                    return None;
                }

                let href = link.value().attr("href")?;
                resolved_page_url.join(href).ok()
            })
            .take(24)
            .collect::<Vec<_>>();

        (collected, stylesheet_urls)
    };

    if stylesheet_urls.len() == 24 {
        emit_log(
            logger.as_ref(),
            "Stopped after 24 linked stylesheets to keep discovery predictable",
        );
    }

    for stylesheet_url in stylesheet_urls {
        match client.get(stylesheet_url.clone()).send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => match response.text().await {
                    Ok(css) => {
                        collected.extend(parse_stylesheet(
                            &css,
                            stylesheet_url.as_str(),
                            ScanSource::StaticCss,
                        )?);
                    }
                    Err(error) => emit_log(
                        logger.as_ref(),
                        format!("Failed reading stylesheet body {}: {error}", stylesheet_url),
                    ),
                },
                Err(error) => emit_log(
                    logger.as_ref(),
                    format!("Stylesheet returned an error {}: {error}", stylesheet_url),
                ),
            },
            Err(error) => emit_log(
                logger.as_ref(),
                format!("Failed fetching stylesheet {}: {error}", stylesheet_url),
            ),
        }
    }

    Ok(merge_fonts(Vec::new(), collected))
}

async fn discover_from_browser(
    page_url: &str,
    webdriver_url: &str,
    logger: Option<Logger>,
) -> Result<Vec<DiscoveredFont>> {
    let mut caps = DesiredCapabilities::chrome();
    caps.add_arg("--headless=new")?;
    caps.add_arg("--disable-gpu")?;
    caps.add_arg("--no-sandbox")?;

    let driver = WebDriver::new(webdriver_url, caps)
        .await
        .with_context(|| format!("Could not connect to WebDriver at {webdriver_url}"))?;

    let result = async {
        emit_log(logger.as_ref(), "Opening page in browser engine...");
        driver
            .goto(page_url)
            .await
            .with_context(|| format!("Could not open {page_url}"))?;

        sleep(Duration::from_millis(1500)).await;
        let _ = driver
            .execute("return document.readyState", Vec::<Value>::new())
            .await;
        let _ = driver
            .execute(
                "return document.fonts ? document.fonts.status : 'loaded'",
                Vec::<Value>::new(),
            )
            .await;

        emit_log(
            logger.as_ref(),
            "Extracting @font-face rules from live CSSOM...",
        );
        let raw_rules = driver
            .execute(BROWSER_DISCOVERY_SCRIPT, Vec::<Value>::new())
            .await
            .context("Browser script execution failed")?;

        let rules: Vec<BrowserFontFaceRule> = raw_rules
            .convert()
            .context("Could not parse browser discovery data")?;
        let mut fonts = Vec::new();
        for rule in rules {
            fonts.extend(parse_font_face_block(
                &rule.family,
                &rule.style,
                &rule.weight,
                &rule.src,
                rule.unicode_range.as_deref(),
                page_url,
                ScanSource::BrowserCss,
            )?);
        }

        Ok(merge_fonts(Vec::new(), fonts))
    }
    .await;

    let _ = driver.quit().await;
    result
}

fn parse_stylesheet(
    css: &str,
    base_url: &str,
    scan_source: ScanSource,
) -> Result<Vec<DiscoveredFont>> {
    let block_re = Regex::new(r"(?is)@font-face\s*\{(.*?)\}")?;
    let mut fonts = Vec::new();

    for captures in block_re.captures_iter(css) {
        let Some(block_match) = captures.get(1) else {
            continue;
        };
        let block = block_match.as_str();
        let family = capture_css_property(block, "font-family").unwrap_or_default();
        let src = capture_css_property(block, "src").unwrap_or_default();
        let style =
            capture_css_property(block, "font-style").unwrap_or_else(|| "normal".to_string());
        let weight =
            capture_css_property(block, "font-weight").unwrap_or_else(|| "400".to_string());
        let unicode_range = capture_css_property(block, "unicode-range");

        fonts.extend(parse_font_face_block(
            &family,
            &style,
            &weight,
            &src,
            unicode_range.as_deref(),
            base_url,
            scan_source,
        )?);
    }

    Ok(fonts)
}

fn parse_font_face_block(
    family: &str,
    style: &str,
    weight: &str,
    src: &str,
    unicode_range: Option<&str>,
    base_url: &str,
    scan_source: ScanSource,
) -> Result<Vec<DiscoveredFont>> {
    let family = family.trim().trim_matches('"').trim_matches('\'').trim();
    if family.is_empty() || src.trim().is_empty() {
        return Ok(Vec::new());
    }

    let mut sources = parse_src_value(src, base_url)?;
    sources.sort_by_key(|source| source.format.priority());
    sources.dedup_by(|left, right| left.url == right.url);

    if sources.is_empty() {
        return Ok(Vec::new());
    }

    let weight_clean = weight.trim().to_string();
    let style_clean = style.trim().to_string();
    let unicode_clean = unicode_range
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let is_variable =
        weight_clean.split_whitespace().count() > 1 || style_clean.split_whitespace().count() > 1;

    let identity = font_identity_key(
        family,
        &weight_clean,
        &style_clean,
        unicode_clean.as_deref(),
    );
    let first_source = sources
        .first()
        .map(|source| source.url.clone())
        .unwrap_or_default();

    Ok(vec![DiscoveredFont {
        id: format!("{identity}|{first_source}"),
        family: family.to_string(),
        style: style_clean,
        weight: weight_clean,
        sources,
        is_variable,
        unicode_range: unicode_clean,
        scan_source,
    }])
}

fn capture_css_property(block: &str, property: &str) -> Option<String> {
    let pattern = format!(r"(?is){}\s*:\s*([^;]+)(?:;|$)", regex::escape(property));
    let re = Regex::new(&pattern).ok()?;
    re.captures(block).and_then(|captures| {
        captures
            .get(1)
            .map(|capture| capture.as_str().trim().to_string())
    })
}

fn parse_src_value(src: &str, base_url: &str) -> Result<Vec<FontSourceRef>> {
    let base = Url::parse(base_url).with_context(|| format!("Invalid base URL: {base_url}"))?;
    let url_re = Regex::new(
        r#"url\(\s*(?:"([^"]+)"|'([^']+)'|([^\)\s]+))\s*\)\s*(?:format\(\s*['\"]?([^'\")\s]+)['\"]?\s*\))?"#,
    )?;
    let mut seen = HashSet::new();
    let mut sources = Vec::new();

    for captures in url_re.captures_iter(src) {
        let raw_url = captures
            .get(1)
            .or_else(|| captures.get(2))
            .or_else(|| captures.get(3))
            .map(|value| value.as_str())
            .unwrap_or_default();
        if raw_url.starts_with("data:") {
            continue;
        }

        let resolved_url = match base.join(raw_url) {
            Ok(url) => url.to_string(),
            Err(_) => continue,
        };

        if !seen.insert(resolved_url.clone()) {
            continue;
        }

        let format = captures
            .get(4)
            .map(|value| FontFormat::normalize(value.as_str()))
            .unwrap_or_else(|| FontFormat::guess_from_url(&resolved_url));

        if !format.can_convert() {
            continue;
        }

        sources.push(FontSourceRef {
            url: resolved_url,
            format,
        });
    }

    Ok(sources)
}

fn merge_fonts(
    existing: Vec<DiscoveredFont>,
    incoming: Vec<DiscoveredFont>,
) -> Vec<DiscoveredFont> {
    let mut map: HashMap<String, DiscoveredFont> = HashMap::new();

    for font in existing.into_iter().chain(incoming) {
        let key = font_identity_key(
            &font.family,
            &font.weight,
            &font.style,
            font.unicode_range.as_deref(),
        );
        let is_variable = font.is_variable;
        let scan_source = font.scan_source;
        let incoming_sources = font.sources.clone();
        match map.get_mut(&key) {
            Some(current) => {
                for source in incoming_sources {
                    if !current
                        .sources
                        .iter()
                        .any(|candidate| candidate.url == source.url)
                    {
                        current.sources.push(source);
                    }
                }
                current
                    .sources
                    .sort_by_key(|source| source.format.priority());
                current
                    .sources
                    .dedup_by(|left, right| left.url == right.url);
                current.is_variable |= is_variable;
                if matches!(scan_source, ScanSource::BrowserCss) {
                    current.scan_source = ScanSource::BrowserCss;
                }
                current.id = format!(
                    "{}|{}",
                    key,
                    current
                        .sources
                        .first()
                        .map(|source| source.url.as_str())
                        .unwrap_or_default()
                );
            }
            None => {
                map.insert(key, font);
            }
        }
    }

    map.into_values().collect()
}

fn font_identity_key(
    family: &str,
    weight: &str,
    style: &str,
    unicode_range: Option<&str>,
) -> String {
    format!(
        "{}|{}|{}|{}",
        family.trim().to_ascii_lowercase(),
        weight.trim().to_ascii_lowercase(),
        style.trim().to_ascii_lowercase(),
        unicode_range
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
    )
}

const BROWSER_DISCOVERY_SCRIPT: &str = r#"
return (() => {
  const results = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules || sheet.rules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const style = rule.style;
          results.push({
            family: (style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim(),
            style: style.getPropertyValue('font-style') || 'normal',
            weight: style.getPropertyValue('font-weight') || '400',
            src: style.getPropertyValue('src') || '',
            unicodeRange: style.getPropertyValue('unicode-range') || ''
          });
        }
      }
    } catch (_) {
      continue;
    }
  }
  return results;
})();
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_css_property_accepts_missing_trailing_semicolon() {
        let block = r#"font-family: 'Acme'; src: url(font.woff2) format('woff2'); font-weight: 700; font-style: italic"#;
        assert_eq!(
            capture_css_property(block, "font-style").as_deref(),
            Some("italic")
        );
        assert_eq!(
            capture_css_property(block, "font-weight").as_deref(),
            Some("700")
        );
    }

    #[test]
    fn parse_stylesheet_extracts_font_face_blocks() {
        let css = r#"
            @font-face {
                font-family: "Acme";
                src: url("/fonts/acme.woff2") format("woff2");
                font-style: italic;
                font-weight: 700;
            }
        "#;

        let fonts =
            parse_stylesheet(css, "https://example.com/page", ScanSource::StaticCss).unwrap();
        assert_eq!(fonts.len(), 1);
        let font = &fonts[0];
        assert_eq!(font.family, "Acme");
        assert_eq!(font.style, "italic");
        assert_eq!(font.weight, "700");
        assert_eq!(font.sources[0].url, "https://example.com/fonts/acme.woff2");
        assert_eq!(font.sources[0].format, FontFormat::Woff2);
    }

    #[test]
    fn parse_src_value_resolves_urls_and_dedups_by_url() {
        let src = r#"url('../fonts/a.woff2') format('woff2'), url('../fonts/a.woff2') format('woff'), url('b.ttf')"#;
        let sources = parse_src_value(src, "https://example.com/css/site.css").unwrap();
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].url, "https://example.com/fonts/a.woff2");
        assert_eq!(sources[0].format, FontFormat::Woff2);
        assert_eq!(sources[1].url, "https://example.com/css/b.ttf");
        assert_eq!(sources[1].format, FontFormat::TrueType);
    }

    #[test]
    fn parse_src_value_accepts_quoted_urls_with_spaces() {
        let src = r#"url("../fonts/Open Sans.woff2") format("woff2")"#;
        let sources = parse_src_value(src, "https://example.com/css/site.css").unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(
            sources[0].url,
            "https://example.com/fonts/Open%20Sans.woff2"
        );
        assert_eq!(sources[0].format, FontFormat::Woff2);
    }

    #[test]
    fn merge_fonts_combines_duplicates_and_prefers_browser_source() {
        let static_font = DiscoveredFont {
            id: "static".into(),
            family: "Acme".into(),
            style: "normal".into(),
            weight: "400".into(),
            sources: vec![FontSourceRef {
                url: "https://example.com/a.woff2".into(),
                format: FontFormat::Woff2,
            }],
            is_variable: false,
            unicode_range: None,
            scan_source: ScanSource::StaticCss,
        };
        let browser_font = DiscoveredFont {
            id: "browser".into(),
            family: "Acme".into(),
            style: "normal".into(),
            weight: "400".into(),
            sources: vec![
                FontSourceRef {
                    url: "https://example.com/a.woff2".into(),
                    format: FontFormat::Woff2,
                },
                FontSourceRef {
                    url: "https://example.com/a.ttf".into(),
                    format: FontFormat::TrueType,
                },
            ],
            is_variable: true,
            unicode_range: None,
            scan_source: ScanSource::BrowserCss,
        };

        let merged = merge_fonts(vec![static_font], vec![browser_font]);
        assert_eq!(merged.len(), 1);
        let font = &merged[0];
        assert!(font.is_variable);
        assert_eq!(font.scan_source, ScanSource::BrowserCss);
        assert_eq!(font.sources.len(), 2);
        assert_eq!(font.sources[0].format, FontFormat::Woff2);
        assert_eq!(font.sources[1].format, FontFormat::TrueType);
    }
}
