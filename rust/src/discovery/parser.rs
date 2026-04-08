use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result};
use regex::Regex;
use url::Url;

use crate::domain::{FontCandidate, FontFormat, FontSource, ScanSource};

pub struct ParsedStylesheet {
    pub fonts: Vec<FontCandidate>,
    pub imports: Vec<String>,
}

pub fn parse_stylesheet(css: &str, base_url: &str, scan_source: ScanSource) -> Result<ParsedStylesheet> {
    let block_re = Regex::new(r"(?is)@font-face\s*\{(.*?)\}")?;
    let mut fonts = Vec::new();

    for captures in block_re.captures_iter(css) {
        let Some(block_match) = captures.get(1) else {
            continue;
        };
        let block = block_match.as_str();
        let family = capture_css_property(block, "font-family").unwrap_or_default();
        let src = capture_css_property(block, "src").unwrap_or_default();
        let style = capture_css_property(block, "font-style").unwrap_or_else(|| "normal".to_string());
        let weight = capture_css_property(block, "font-weight").unwrap_or_else(|| "400".to_string());
        let stretch = capture_css_property(block, "font-stretch");
        let unicode_range = capture_css_property(block, "unicode-range");

        fonts.extend(parse_font_face_rule(
            &family,
            &style,
            &weight,
            stretch.as_deref(),
            &src,
            unicode_range.as_deref(),
            base_url,
            scan_source,
        )?);
    }

    Ok(ParsedStylesheet {
        fonts,
        imports: extract_imports(css, base_url)?,
    })
}

pub fn parse_font_face_rule(
    family: &str,
    style: &str,
    weight: &str,
    stretch: Option<&str>,
    src: &str,
    unicode_range: Option<&str>,
    base_url: &str,
    scan_source: ScanSource,
) -> Result<Vec<FontCandidate>> {
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

    let weight_clean = normalize_weight(weight);
    let style_clean = normalize_style(style);
    let stretch_clean = normalize_stretch(stretch);
    let unicode_clean = unicode_range
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let variable = is_variable_descriptor(&weight_clean)
        || is_variable_descriptor(&style_clean)
        || stretch_clean.as_deref().is_some_and(is_variable_descriptor)
        || src.to_ascii_lowercase().contains("variations");
    let identity = font_identity_key(
        family,
        &weight_clean,
        &style_clean,
        stretch_clean.as_deref(),
        unicode_clean.as_deref(),
    );
    let first_source = sources.first().map(|source| source.url.clone()).unwrap_or_default();

    Ok(vec![FontCandidate {
        id: format!("{identity}|{first_source}"),
        family: family.to_string(),
        style: style_clean,
        weight: weight_clean,
        stretch: stretch_clean,
        sources,
        unicode_range: unicode_clean,
        variable,
        scan_source,
    }])
}

pub fn merge_fonts(existing: Vec<FontCandidate>, incoming: Vec<FontCandidate>) -> Vec<FontCandidate> {
    let mut map: HashMap<String, FontCandidate> = HashMap::new();

    for font in existing.into_iter().chain(incoming) {
        let key = font_identity_key(
            &font.family,
            &font.weight,
            &font.style,
            font.stretch.as_deref(),
            font.unicode_range.as_deref(),
        );
        let variable = font.variable;
        let scan_source = font.scan_source;
        let incoming_sources = font.sources.clone();
        let stretch = font.stretch.clone();

        match map.get_mut(&key) {
            Some(current) => {
                for source in incoming_sources {
                    if !current.sources.iter().any(|candidate| candidate.url == source.url) {
                        current.sources.push(source);
                    }
                }
                current.sources.sort_by_key(|source| source.format.priority());
                current.sources.dedup_by(|left, right| left.url == right.url);
                current.variable |= variable;
                if current.stretch.is_none() {
                    current.stretch = stretch;
                }
                if matches!(scan_source, ScanSource::BrowserCss | ScanSource::BrowserNetwork) {
                    current.scan_source = scan_source;
                }
                current.id = format!(
                    "{}|{}",
                    key,
                    current.sources.first().map(|source| source.url.as_str()).unwrap_or_default()
                );
            }
            None => {
                map.insert(key, font);
            }
        }
    }

    map.into_values().collect()
}

fn capture_css_property(block: &str, property: &str) -> Option<String> {
    let pattern = format!(r"(?is){}\s*:\s*([^;]+)(?:;|$)", regex::escape(property));
    let re = Regex::new(&pattern).ok()?;
    re.captures(block)
        .and_then(|captures| captures.get(1).map(|capture| capture.as_str().trim().to_string()))
}

fn parse_src_value(src: &str, base_url: &str) -> Result<Vec<FontSource>> {
    let base = Url::parse(base_url).with_context(|| format!("Invalid base URL: {base_url}"))?;
    let url_re = Regex::new(
        r#"url\(\s*(?:\"([^\"]+)\"|'([^']+)'|([^\)\s]+))\s*\)\s*(?:format\(\s*['\"]?([^'\")\s]+)['\"]?\s*\))?"#,
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

        sources.push(FontSource { url: resolved_url, format });
    }

    Ok(sources)
}

fn extract_imports(css: &str, base_url: &str) -> Result<Vec<String>> {
    let base = Url::parse(base_url).with_context(|| format!("Invalid base URL: {base_url}"))?;
    let import_re = Regex::new(
        r#"(?is)@import\s+(?:url\(\s*)?(?:\"([^\"]+)\"|'([^']+)'|([^\)\s;]+))(?:\s*\))?[^;]*;"#,
    )?;
    let mut seen = HashSet::new();
    let mut imports = Vec::new();

    for captures in import_re.captures_iter(css) {
        let Some(raw_url) = captures
            .get(1)
            .or_else(|| captures.get(2))
            .or_else(|| captures.get(3))
            .map(|value| value.as_str())
        else {
            continue;
        };

        let Ok(url) = base.join(raw_url) else {
            continue;
        };
        let url = url.to_string();
        if seen.insert(url.clone()) {
            imports.push(url);
        }
    }

    Ok(imports)
}

fn font_identity_key(
    family: &str,
    weight: &str,
    style: &str,
    stretch: Option<&str>,
    unicode_range: Option<&str>,
) -> String {
    format!(
        "{}|{}|{}|{}|{}",
        family.trim().to_ascii_lowercase(),
        weight.trim().to_ascii_lowercase(),
        style.trim().to_ascii_lowercase(),
        stretch.unwrap_or_default().trim().to_ascii_lowercase(),
        unicode_range.unwrap_or_default().trim().to_ascii_lowercase(),
    )
}

fn normalize_style(value: &str) -> String {
    let lower = value.trim().to_ascii_lowercase();
    match lower.as_str() {
        "" | "regular" | "normal" => "normal".to_string(),
        "italic" => "italic".to_string(),
        "oblique" => "oblique".to_string(),
        _ => lower,
    }
}

fn normalize_weight(value: &str) -> String {
    value
        .split_whitespace()
        .map(normalize_weight_token)
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_weight_token(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "thin" | "hairline" => "100".to_string(),
        "extralight" | "ultralight" => "200".to_string(),
        "light" => "300".to_string(),
        "regular" | "normal" | "book" => "400".to_string(),
        "medium" => "500".to_string(),
        "semibold" | "demibold" => "600".to_string(),
        "bold" => "700".to_string(),
        "extrabold" | "ultrabold" => "800".to_string(),
        "black" | "heavy" => "900".to_string(),
        "extrablack" | "ultrablack" => "950".to_string(),
        other => other.to_string(),
    }
}

fn normalize_stretch(value: Option<&str>) -> Option<String> {
    let lower = value?.trim().to_ascii_lowercase();
    if lower.is_empty() || lower == "normal" || lower == "100%" {
        None
    } else {
        Some(lower.split_whitespace().collect::<Vec<_>>().join(" "))
    }
}

fn is_variable_descriptor(value: &str) -> bool {
    value.split_whitespace().count() > 1
}

#[cfg(test)]
mod tests {
    use super::*;

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

        let parsed = parse_stylesheet(css, "https://example.com/page", ScanSource::StaticCss).unwrap();
        assert_eq!(parsed.fonts.len(), 1);
        let font = &parsed.fonts[0];
        assert_eq!(font.family, "Acme");
        assert_eq!(font.style, "italic");
        assert_eq!(font.weight, "700");
        assert_eq!(font.sources[0].url, "https://example.com/fonts/acme.woff2");
        assert_eq!(font.sources[0].format, FontFormat::Woff2);
    }

    #[test]
    fn parse_stylesheet_extracts_imports() {
        let css = r#"@import url('../fonts.css');"#;
        let parsed = parse_stylesheet(css, "https://example.com/css/site.css", ScanSource::StaticCss).unwrap();
        assert_eq!(parsed.imports, vec!["https://example.com/fonts.css"]);
    }

    #[test]
    fn parse_font_face_rule_accepts_urls_with_spaces() {
        let fonts = parse_font_face_rule(
            "Open Sans",
            "normal",
            "400",
            None,
            r#"url("../fonts/Open Sans.woff2") format("woff2")"#,
            None,
            "https://example.com/css/site.css",
            ScanSource::StaticCss,
        )
        .unwrap();

        assert_eq!(fonts[0].sources[0].url, "https://example.com/fonts/Open%20Sans.woff2");
    }

    #[test]
    fn parse_font_face_rule_normalizes_weight_keywords() {
        let fonts = parse_font_face_rule(
            "Acme Sans",
            "Regular",
            "bold",
            None,
            r#"url("/fonts/acme.woff2") format("woff2")"#,
            None,
            "https://example.com/page",
            ScanSource::StaticCss,
        )
        .unwrap();

        assert_eq!(fonts[0].weight, "700");
        assert_eq!(fonts[0].style, "normal");
    }

    #[test]
    fn parse_font_face_rule_marks_variations_and_stretch_ranges_as_variable() {
        let fonts = parse_font_face_rule(
            "GT America",
            "normal",
            "normal",
            Some("1% 500%"),
            r#"url("/fonts/gt-america-vf.woff2") format("woff2-variations")"#,
            None,
            "https://example.com/page",
            ScanSource::StaticCss,
        )
        .unwrap();

        assert!(fonts[0].variable);
        assert_eq!(fonts[0].weight, "400");
        assert_eq!(fonts[0].stretch.as_deref(), Some("1% 500%"));
    }

    #[test]
    fn merge_fonts_combines_duplicates_and_prefers_browser_source() {
        let static_font = FontCandidate {
            id: "static".into(),
            family: "Acme".into(),
            style: "normal".into(),
            weight: "400".into(),
            stretch: None,
            sources: vec![FontSource { url: "https://example.com/a.woff2".into(), format: FontFormat::Woff2 }],
            unicode_range: None,
            variable: false,
            scan_source: ScanSource::StaticCss,
        };
        let browser_font = FontCandidate {
            id: "browser".into(),
            family: "Acme".into(),
            style: "normal".into(),
            weight: "400".into(),
            stretch: None,
            sources: vec![
                FontSource { url: "https://example.com/a.woff2".into(), format: FontFormat::Woff2 },
                FontSource { url: "https://example.com/a.ttf".into(), format: FontFormat::TrueType },
            ],
            unicode_range: None,
            variable: true,
            scan_source: ScanSource::BrowserCss,
        };

        let merged = merge_fonts(vec![static_font], vec![browser_font]);
        assert_eq!(merged.len(), 1);
        let font = &merged[0];
        assert!(font.variable);
        assert_eq!(font.scan_source, ScanSource::BrowserCss);
        assert_eq!(font.sources.len(), 2);
    }
}
