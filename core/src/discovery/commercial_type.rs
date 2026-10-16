//! Catalog specimens can be SVGs: their webfont list lives in the public catalog.
use anyhow::{Context, Result};
use serde_json::Value;
use url::Url;

use crate::{
    domain::{FontCandidate, FontFormat, FontSource, ScanSource},
    support::http::{build_http_client, read_limited, MAX_DOCUMENT_BYTES},
};

fn supported(page: &Url) -> bool {
    page.host_str()
        .is_some_and(|host| host == "commercialtype.com" || host.ends_with(".commercialtype.com"))
        && page.path().starts_with("/catalog/")
}

pub async fn discover(page_url: &str) -> Result<Vec<FontCandidate>> {
    let page = Url::parse(page_url)?;
    if !supported(&page) {
        return Ok(Vec::new());
    }
    let response = build_http_client()?
        .get(page.join("/json/catalog.js")?)
        .header(reqwest::header::REFERER, page_url)
        .send()
        .await?
        .error_for_status()?;
    let bytes = read_limited(response, MAX_DOCUMENT_BYTES).await?;
    parse(&page, &serde_json::from_slice(&bytes)?)
}

fn rows<'a>(data: &'a Value, key: &str) -> Result<&'a Vec<Value>> {
    data[key]
        .as_array()
        .with_context(|| format!("Catalog has no {key} array"))
}
fn slug(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_")
        .to_lowercase()
}
fn compact(value: &str) -> String {
    value.split_whitespace().collect()
}

fn parse(page: &Url, data: &Value) -> Result<Vec<FontCandidate>> {
    if !supported(page) {
        return Ok(Vec::new());
    }
    let parts: Vec<_> = page
        .path()
        .split('/')
        .filter(|part| !part.is_empty())
        .collect();
    let Some(target) = parts.get(1) else {
        return Ok(Vec::new());
    };
    let collection = rows(data, "collections")?
        .iter()
        .find(|row| row[2].as_str().is_some_and(|name| slug(name) == *target));
    let mut fonts = Vec::new();
    for family in rows(data, "families")? {
        let Some(name) = family[4].as_str() else {
            continue;
        };
        let family_slug = slug(name);
        let selected = if let Some(target_family) = parts.get(2) {
            family_slug == *target_family
        } else if let Some(collection) = collection {
            family[2] == collection[0]
        } else {
            family_slug == *target
        };
        if !selected || family[0].as_u64().is_none() {
            continue;
        }
        let mut options: Vec<_> = data["style_options"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|option| {
                family[8].as_array().is_some_and(|ids| {
                    ids.iter().any(|id| {
                        id == &option[0]
                            || id.as_str().and_then(|s| s.parse::<u64>().ok()) == option[0].as_u64()
                    })
                })
            })
            .collect();
        options.sort_by_key(|option| option[3].as_u64().unwrap_or(0));
        let suffix: String = options
            .iter()
            .filter_map(|option| option[2].as_str())
            .map(|s| format!("-{s}"))
            .collect();
        for style in rows(data, "styles")? {
            if style[2] != family[0] {
                continue;
            }
            let Some(style_index) = style[3].as_u64() else {
                continue;
            };
            let Some(style_name) = data["names"][style_index as usize].as_str() else {
                continue;
            };
            let weight_value = style[5].as_u64().map(|i| &data["weights"][i as usize]);
            let weight = weight_value
                .and_then(Value::as_u64)
                .unwrap_or(400)
                .to_string();
            let font_style = if style[7].as_u64().unwrap_or(0) > 0 {
                "italic"
            } else {
                "normal"
            }
            .to_string();
            let family_name = format!("{name}{}", style[14].as_str().unwrap_or(""))
                .split_whitespace()
                .collect::<Vec<_>>()
                .join("-");
            let stem = format!("{}-{}{suffix}-Web", compact(name), compact(style_name));
            let mut sources = Vec::new();
            for format in [FontFormat::Woff2, FontFormat::Woff] {
                let mut source = page.clone();
                source.set_path(&format!(
                    "/webfonts/{family_slug}/{stem}.{}",
                    format.extension()
                ));
                source.set_query(None);
                source.set_fragment(None);
                sources.push(FontSource {
                    url: source.into(),
                    format,
                });
            }
            let identity =
                super::parser::font_identity_key(&family_name, &weight, &font_style, None, None);
            fonts.push(FontCandidate {
                id: format!("{identity}|{}", sources[0].url),
                family: family_name,
                weight,
                style: font_style,
                sources,
                stretch: None,
                unicode_range: None,
                scripts: Vec::new(),
                variable: false,
                scan_source: ScanSource::StaticCss,
                parts: Vec::new(),
                css_family: None,
            });
        }
    }
    Ok(super::parser::merge_fonts(Vec::new(), fonts))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_uses_family_ids_and_orders_options() {
        let data = serde_json::json!({"collections":[[9,0,"Graphik"]], "families":[[42,0,9,0,"Graphik",0,0,0,[2,1]],[84,0,9,0,"Graphik Wide"]],
            "styles":[[1,0,42,0,0,0,0,0],[2,0,84,1,0,1,0,1]], "names":["Regular","Bold Italic"], "weights":[400,700], "style_options":[[1,"","A",1],[2,"","B",2]]});
        let page = Url::parse("https://commercialtype.com/catalog/graphik").unwrap();
        let fonts = parse(&page, &data).unwrap();
        assert_eq!(fonts.len(), 2);
        let regular = fonts.iter().find(|f| f.family == "Graphik").unwrap();
        assert!(regular.sources[0]
            .url
            .ends_with("/graphik/Graphik-Regular-A-B-Web.woff2"));
        let selected = parse(
            &page
                .join("/catalog/graphik/graphik_wide/bold_italic")
                .unwrap(),
            &data,
        )
        .unwrap();
        assert_eq!(selected.len(), 1);
        assert_eq!(selected[0].style, "italic");
        assert_eq!(selected[0].weight, "700");
        assert!(parse(
            &Url::parse("https://commercialtype.com.evil.test/catalog/graphik").unwrap(),
            &data
        )
        .unwrap()
        .is_empty());
        assert!(parse(&page, &serde_json::json!({})).is_err());
    }
}
