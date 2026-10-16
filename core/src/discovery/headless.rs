//! Browser-engine discovery via embedded headless Chrome (CDP), no external
//! WebDriver required. Runs the *same* discovery JS as the Chrome extension
//! (`extension/discover.js` + `extension/capture.js`) so the CLI, the local web
//! app, and the extension all find fonts the same way — including dynamically
//! injected, extensionless, and site-catalog fonts (e.g. Displaay testers).

use anyhow::{anyhow, Context, Result};
use headless_chrome::protocol::cdp::Page::AddScriptToEvaluateOnNewDocument;
use serde::Deserialize;
use std::time::Duration;

use crate::{
    discovery::{parser, CollectorResult},
    domain::{FontCandidate, FontFormat, FontSource, ScanSource},
    support::{chrome, emit_log, Logger},
};

// Shared with the extension — single source of truth for discovery logic.
const CAPTURE_JS: &str = include_str!("../../../extension/capture.js");
const DISCOVER_JS: &str = include_str!("../../../extension/discover.js");

// Nudge type-tester pages to load lazily-rendered fonts before we read them.
const WARMUP_JS: &str = r#"
(() => {
  try {
    document.querySelectorAll('[data-component="tt-toggle"],[data-tester],button').forEach((el, i) => {
      if (i < 8) { try { el.click(); } catch (e) {} }
    });
    window.scrollTo(0, document.body.scrollHeight || 0);
    window.scrollTo(0, 0);
  } catch (e) {}
  return true;
})()
"#;

#[derive(Debug, Deserialize)]
struct RawCandidate {
    url: String,
    #[serde(default)]
    family: String,
    #[serde(default)]
    weight: Option<String>,
    #[serde(default)]
    style: Option<String>,
    #[serde(default)]
    format: Option<String>,
    #[serde(default)]
    variable: Option<bool>,
}

pub async fn discover(page_url: &str, logger: Option<Logger>) -> Result<CollectorResult> {
    emit_log(logger.as_ref(), "Launching headless Chrome for discovery");
    let url = page_url.to_string();
    let log = logger.clone();

    // headless_chrome is synchronous; keep it off the async runtime.
    let (raw, warnings) = tokio::task::spawn_blocking(move || run_browser(&url, log))
        .await
        .context("Headless discovery task panicked")??;

    let mut fonts = Vec::new();
    for candidate in raw {
        // Skip non-fetchable placeholders (inline-only captures have no URL here).
        if !candidate.url.starts_with("http") && !candidate.url.starts_with("data:") {
            continue;
        }
        let format = match candidate.format.as_deref() {
            Some(value) if !value.is_empty() => FontFormat::normalize(value),
            _ => FontFormat::guess_from_url(&candidate.url),
        };
        if !format.can_convert() && !matches!(format, FontFormat::Unknown) {
            continue;
        }

        let family = if candidate.family.trim().is_empty() {
            "(Unknown)".to_string()
        } else {
            candidate.family.trim().to_string()
        };
        let weight = candidate.weight.unwrap_or_else(|| "400".to_string());
        let style = candidate.style.unwrap_or_else(|| "normal".to_string());
        let key = parser::font_identity_key(&family, &weight, &style, None, None);

        fonts.push(FontCandidate {
            id: format!("{key}|{}", candidate.url),
            family,
            style,
            weight,
            stretch: None,
            sources: vec![FontSource {
                url: candidate.url,
                format,
            }],
            unicode_range: None,
            scripts: Vec::new(),
            variable: candidate.variable.unwrap_or(false),
            scan_source: ScanSource::BrowserCss,
            parts: Vec::new(),
            css_family: None,
        });
    }

    Ok(CollectorResult {
        fonts: parser::merge_fonts(Vec::new(), fonts),
        warnings,
    })
}

fn run_browser(page_url: &str, logger: Option<Logger>) -> Result<(Vec<RawCandidate>, Vec<String>)> {
    chrome::with_browser(|browser| collect_from_browser(browser, page_url, logger.clone()))
}

fn collect_from_browser(
    browser: &headless_chrome::Browser,
    page_url: &str,
    logger: Option<Logger>,
) -> Result<(Vec<RawCandidate>, Vec<String>)> {
    let tab = browser.new_tab().context("Could not open a browser tab")?;
    chrome::protect_tab(&tab)?;

    // Install the FontFace/fetch capture hooks before any page script runs.
    let _ = tab.call_method(AddScriptToEvaluateOnNewDocument {
        source: CAPTURE_JS.to_string(),
        world_name: None,
        include_command_line_api: None,
        run_immediately: None,
    });

    emit_log(logger.as_ref(), format!("Opening {page_url}"));
    tab.navigate_to(page_url)
        .with_context(|| format!("Could not open {page_url}"))?;
    // A slow image/analytics request must not discard an otherwise usable page.
    // CDP's navigation waiter requires the load event; discovery only needs DOM.
    let deadline = std::time::Instant::now() + Duration::from_secs(20);
    let mut warnings = Vec::new();
    loop {
        let ready = tab.evaluate(
            "JSON.stringify({usable:location.protocol.startsWith('http') && !!document.body && document.body.childElementCount > 0, ready:document.readyState !== 'loading'})",
            false,
        ).ok().and_then(|result| result.value)
            .and_then(|value| value.as_str().and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok()));
        let usable = ready.as_ref().is_some_and(|value| value["usable"] == true);
        if usable && ready.as_ref().is_some_and(|value| value["ready"] == true) {
            break;
        }
        if std::time::Instant::now() >= deadline {
            anyhow::ensure!(
                usable,
                "Page did not provide a usable document before the timeout"
            );
            warnings.push("The page is still loading. Fonts were collected from the available content; some may be missing.".into());
            break;
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    // Let dynamic/tester fonts load.
    let _ = tab.evaluate(WARMUP_JS, false);
    std::thread::sleep(Duration::from_millis(2500));

    emit_log(logger.as_ref(), "Collecting fonts from the rendered page");
    let script =
        format!("{DISCOVER_JS}\n;JSON.stringify(collectFontsInPage({{includeBytes:false}}))");
    let result = tab
        .evaluate(&script, false)
        .context("Font discovery script failed")?;

    let json = result
        .value
        .as_ref()
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow!("Discovery script returned no data"))?
        .to_string();

    Ok((
        serde_json::from_str(&json).context("Could not parse discovery output")?,
        warnings,
    ))
}
