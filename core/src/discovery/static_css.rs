use std::collections::{HashSet, VecDeque};

use anyhow::{Context, Result};
use scraper::{Html, Selector};

use crate::{
    discovery::{parser, CollectorResult},
    domain::{FontCandidate, ScanSource},
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

    // Parse the page and extract everything we need from the DOM up front. The
    // `scraper::Html` document is not `Send`, so it must be fully consumed and
    // dropped before the async stylesheet-fetch loop below; otherwise the whole
    // discovery future becomes non-`Send` and cannot run on a multi-threaded server.
    let mut warnings = Vec::new();
    let (mut fonts, mut queue, mut queued) = {
        let document = Html::parse_document(&html_text);
        let style_selector = Selector::parse("style").expect("valid style selector");
        let link_selector = Selector::parse("link[rel][href]").expect("valid link selector");
        let data_style_selector =
            Selector::parse("[data-style]").expect("valid data-style selector");

        // Honor `<base href>` so relative URLs resolve like a browser would. Many SPAs
        // serve a single root-level stylesheet via `<base href="/">`; without this the
        // relative link resolves against the page path and hits the SPA fallback instead.
        let base_url = resolve_base_url(&document, &resolved_page_url);
        let base_url_str = base_url.as_str();

        let mut fonts = Vec::new();
        let mut queue = VecDeque::new();
        let mut queued = HashSet::new();

        for style in document.select(&style_selector) {
            let css = style.text().collect::<String>();
            let parsed = parser::parse_stylesheet(&css, base_url_str, ScanSource::StaticCss)?;
            fonts.extend(parsed.fonts);
            for import in parsed.imports {
                if queued.insert(import.clone()) {
                    queue.push_back(import);
                }
            }
        }

        for element in document.select(&data_style_selector) {
            let Some(data_style) = element.value().attr("data-style") else {
                continue;
            };
            let css = decode_html_entities(data_style);
            if !css.to_ascii_lowercase().contains("@font-face") {
                continue;
            }

            let mut parsed = parser::parse_stylesheet(&css, base_url_str, ScanSource::StaticCss)?;
            apply_source_family_names(&mut parsed.fonts);
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
            let Ok(stylesheet_url) = base_url.join(href) else {
                continue;
            };
            let stylesheet_url = stylesheet_url.to_string();
            if queued.insert(stylesheet_url.clone()) {
                queue.push_back(stylesheet_url);
            }
        }

        (fonts, queue, queued)
    };

    let mut processed = HashSet::new();
    while let Some(stylesheet_url) = queue.pop_front() {
        if processed.len() >= MAX_STYLESHEETS {
            let warning = format!(
                "Stopped after {MAX_STYLESHEETS} linked stylesheets to keep discovery predictable"
            );
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
                warnings.push(format!(
                    "Failed fetching stylesheet {stylesheet_url}: {error}"
                ));
                continue;
            }
        };
        let response = match response.error_for_status() {
            Ok(response) => response,
            Err(error) => {
                warnings.push(format!(
                    "Stylesheet returned an error {stylesheet_url}: {error}"
                ));
                continue;
            }
        };
        let css = match response.text().await {
            Ok(css) => css,
            Err(error) => {
                warnings.push(format!(
                    "Failed reading stylesheet body {stylesheet_url}: {error}"
                ));
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

    Ok(CollectorResult {
        fonts: parser::merge_fonts(Vec::new(), fonts),
        warnings,
    })
}

/// Resolve the effective base URL for relative references, honoring a `<base href>`
/// element when present (resolved against the page URL, as browsers do).
fn resolve_base_url(document: &Html, page_url: &url::Url) -> url::Url {
    let base_selector = Selector::parse("base[href]").expect("valid base selector");
    document
        .select(&base_selector)
        .next()
        .and_then(|element| element.value().attr("href"))
        .map(str::trim)
        .filter(|href| !href.is_empty())
        .and_then(|href| page_url.join(href).ok())
        .unwrap_or_else(|| page_url.clone())
}

fn apply_source_family_names(fonts: &mut [FontCandidate]) {
    for font in fonts {
        let Some(display_name) = font
            .sources
            .iter()
            .filter_map(|source| display_name_from_font_url(&source.url))
            .find(|name| looks_like_source_display_name(name, &font.family))
        else {
            continue;
        };

        font.family = display_name;
        refresh_font_id(font);
    }
}

fn display_name_from_font_url(source_url: &str) -> Option<String> {
    let parsed = url::Url::parse(source_url).ok()?;
    let file_name = parsed.path_segments()?.next_back()?;
    let stem = file_name
        .rsplit_once('.')
        .map_or(file_name, |(stem, _)| stem);
    let tokens = stem
        .split(['-', '_', ' '])
        .map(clean_font_file_token)
        .filter(|token| !token.is_empty())
        .map(display_font_file_token)
        .collect::<Vec<_>>();

    if tokens.len() < 2 {
        return None;
    }

    Some(tokens.join(" "))
}

fn clean_font_file_token(token: &str) -> String {
    let mut token = token
        .trim_matches(|character: char| !character.is_alphanumeric())
        .to_string();
    while token.ends_with(|character: char| character.is_ascii_digit()) {
        token.pop();
    }
    token
}

fn display_font_file_token(token: String) -> String {
    if token
        .chars()
        .all(|character| !character.is_alphabetic() || character.is_uppercase())
    {
        return token;
    }

    let mut chars = token.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

fn looks_like_source_display_name(display_name: &str, current_family: &str) -> bool {
    let compact_display = compact_name(display_name);
    let compact_current = compact_name(current_family);

    !compact_display.is_empty()
        && display_name.len() <= 96
        && display_name.chars().any(char::is_alphabetic)
        && (compact_current.is_empty()
            || compact_display.contains(&compact_current)
            || compact_current.contains(&compact_display))
}

fn compact_name(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn refresh_font_id(font: &mut FontCandidate) {
    let key = parser::font_identity_key(
        &font.family,
        &font.weight,
        &font.style,
        font.stretch.as_deref(),
        font.unicode_range.as_deref(),
    );
    let first_source = font
        .sources
        .first()
        .map(|source| source.url.as_str())
        .unwrap_or_default();
    font.id = format!("{key}|{first_source}");
}

fn decode_html_entities(value: &str) -> String {
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_href_overrides_page_path_for_relative_links() {
        let html = r#"<head><base href="/"><link rel="stylesheet" href="styles.abc123.css"></head>"#;
        let document = Html::parse_document(html);
        let page_url = url::Url::parse("https://example.com/typeface/gt-eesti").unwrap();

        let base_url = resolve_base_url(&document, &page_url);
        let resolved = base_url.join("styles.abc123.css").unwrap();

        assert_eq!(resolved.as_str(), "https://example.com/styles.abc123.css");
    }

    #[test]
    fn missing_base_href_falls_back_to_page_url() {
        let html = r#"<head><link rel="stylesheet" href="styles.css"></head>"#;
        let document = Html::parse_document(html);
        let page_url = url::Url::parse("https://example.com/sub/page").unwrap();

        let base_url = resolve_base_url(&document, &page_url);

        assert_eq!(base_url.as_str(), page_url.as_str());
    }

    #[test]
    fn data_style_fonts_can_use_source_file_name_as_family_name() {
        let html = r#"
            <h1 class="tttrailersregular_text">TT Trailers</h1>
            <span data-style="&lt;style&gt;@font-face{font-family:&quot;&#039;tttrailersregular&#039;, sans-serif&quot;;font-display:swap;src:url(/wp-content/uploads/TT_Trailers2_Regular.woff2) format(&quot;woff2&quot;);}.tttrailersregular_text{font-family:&quot;&#039;tttrailersregular&#039;, sans-serif&quot;;}&lt;/style&gt;"></span>
        "#;
        let document = Html::parse_document(html);
        let selector = Selector::parse("[data-style]").unwrap();
        let css = decode_html_entities(
            document
                .select(&selector)
                .next()
                .unwrap()
                .value()
                .attr("data-style")
                .unwrap(),
        );
        let mut parsed = parser::parse_stylesheet(
            &css,
            "https://typetype.org/fonts/tt-trailers/",
            ScanSource::StaticCss,
        )
        .unwrap();

        apply_source_family_names(&mut parsed.fonts);

        assert_eq!(parsed.fonts.len(), 1);
        assert_eq!(parsed.fonts[0].family, "TT Trailers Regular");
        assert_eq!(
            parsed.fonts[0].sources[0].url,
            "https://typetype.org/wp-content/uploads/TT_Trailers2_Regular.woff2"
        );
    }
}
