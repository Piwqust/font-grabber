use std::collections::HashSet;

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;
use tokio::time::{sleep, Duration};

use crate::{
    discovery::{parser, CollectorResult},
    domain::{FontCandidate, FontFormat, FontSource, ScanSource},
    support::{emit_log, webdriver, Logger},
};

#[derive(Debug, Deserialize)]
struct BrowserFontFaceRule {
    family: String,
    style: String,
    weight: String,
    stretch: Option<String>,
    src: String,
    #[serde(rename = "baseUrl")]
    base_url: Option<String>,
    #[serde(rename = "unicodeRange")]
    unicode_range: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BrowserDiscoveryPayload {
    rules: Vec<BrowserFontFaceRule>,
    resources: Vec<String>,
}

pub async fn discover(
    page_url: &str,
    webdriver_url: &str,
    logger: Option<Logger>,
) -> Result<CollectorResult> {
    let driver = webdriver::connect(webdriver_url).await?;

    let result = async {
        emit_log(logger.as_ref(), "Opening page in browser engine");
        driver
            .goto(page_url)
            .await
            .with_context(|| format!("Could not open {page_url}"))?;
        webdriver::wait_for_page_ready(&driver).await?;
        let _ = driver.execute(BROWSER_WARMUP_SCRIPT, Vec::<Value>::new()).await;
        sleep(Duration::from_millis(1200)).await;
        let _ = webdriver::wait_for_page_ready(&driver).await;

        emit_log(logger.as_ref(), "Extracting browser CSSOM and resource data");
        let payload: BrowserDiscoveryPayload = driver
            .execute(BROWSER_DISCOVERY_SCRIPT, Vec::<Value>::new())
            .await
            .context("Browser script execution failed")?
            .convert()
            .context("Could not parse browser discovery data")?;

        let mut fonts = Vec::new();
        for rule in payload.rules {
            fonts.extend(parser::parse_font_face_rule(
                &rule.family,
                &rule.style,
                &rule.weight,
                rule.stretch.as_deref(),
                &rule.src,
                rule.unicode_range.as_deref(),
                rule.base_url.as_deref().unwrap_or(page_url),
                ScanSource::BrowserCss,
            )?);
        }

        let tracked_urls = fonts
            .iter()
            .flat_map(|font| font.sources.iter().map(|source| source.url.clone()))
            .collect::<HashSet<_>>();
        for resource in payload.resources {
            if tracked_urls.contains(&resource) {
                continue;
            }

            let format = FontFormat::guess_from_url(&resource);
            if matches!(format, FontFormat::Unknown) || !format.can_convert() {
                continue;
            }

            fonts.push(FontCandidate {
                id: format!("network|{}|{resource}", guess_family_from_resource_url(&resource)),
                family: guess_family_from_resource_url(&resource),
                style: "normal".to_string(),
                weight: "400".to_string(),
                stretch: None,
                sources: vec![FontSource { url: resource, format }],
                unicode_range: None,
                variable: false,
                scan_source: ScanSource::BrowserNetwork,
            });
        }

        Ok(CollectorResult { fonts: parser::merge_fonts(Vec::new(), fonts), warnings: Vec::new() })
    }
    .await;

    let _ = driver.quit().await;
    result
}

const BROWSER_DISCOVERY_SCRIPT: &str = r#"
return (() => {
  const rules = [];
  const resources = [];

  const pushFontFaceRule = (rule, fallbackBaseUrl) => {
    const style = rule.style;
    rules.push({
      family: (style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim(),
      style: style.getPropertyValue('font-style') || 'normal',
      weight: style.getPropertyValue('font-weight') || '400',
      stretch: style.getPropertyValue('font-stretch') || '',
      src: style.getPropertyValue('src') || '',
      baseUrl: (rule.parentStyleSheet && rule.parentStyleSheet.href) || fallbackBaseUrl || document.location.href,
      unicodeRange: style.getPropertyValue('unicode-range') || ''
    });
  };

  const walkRules = (cssRules, fallbackBaseUrl) => {
    if (!cssRules) return;
    for (const rule of Array.from(cssRules)) {
      if (rule instanceof CSSFontFaceRule) {
        pushFontFaceRule(rule, fallbackBaseUrl);
        continue;
      }

      if (rule instanceof CSSImportRule && rule.styleSheet) {
        try {
          walkRules(rule.styleSheet.cssRules || rule.styleSheet.rules || [], rule.styleSheet.href || fallbackBaseUrl);
        } catch (_) {}
        continue;
      }

      if (rule.cssRules || rule.rules) {
        try {
          walkRules(rule.cssRules || rule.rules || [], fallbackBaseUrl);
        } catch (_) {}
      }
    }
  };

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walkRules(sheet.cssRules || sheet.rules || [], sheet.href || document.location.href);
    } catch (_) {
      continue;
    }
  }

  for (const entry of performance.getEntriesByType('resource')) {
    const name = entry && entry.name ? String(entry.name) : '';
    if (/\.(woff2?|ttf|otf)(\?|$)/i.test(name)) {
      resources.push(name);
    }
  }

  return { rules, resources: Array.from(new Set(resources)) };
})();
"#;

const BROWSER_WARMUP_SCRIPT: &str = r#"
return (() => {
  try {
    const toggle = document.querySelector('[data-component="tt-toggle"]');
    if (toggle) {
      toggle.click();
    }
    window.scrollTo(0, document.body.scrollHeight || 0);
    window.scrollTo(0, 0);
    return true;
  } catch (_) {
    return false;
  }
})();
"#;

fn guess_family_from_resource_url(resource: &str) -> String {
    let stem = url::Url::parse(resource)
        .ok()
        .and_then(|url| {
            url.path_segments()
                .and_then(|segments| segments.last().map(str::to_string))
        })
        .and_then(|segment| segment.split('.').next().map(str::to_string))
        .unwrap_or_default();

    let cleaned = stem
        .split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    if cleaned.is_empty() {
        "(Unknown - from network)".to_string()
    } else {
        cleaned
    }
}
