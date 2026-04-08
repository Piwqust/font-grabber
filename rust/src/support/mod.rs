pub mod http;
pub mod ui;
pub mod webdriver;

use std::{path::{Path, PathBuf}, sync::Arc};

use anyhow::{anyhow, Result};
use url::Url;

pub type Logger = Arc<dyn Fn(String) + Send + Sync + 'static>;

pub fn emit_log(logger: Option<&Logger>, message: impl Into<String>) {
    if let Some(logger) = logger {
        logger(message.into());
    }
}

pub fn normalize_url(input: &str) -> Result<String> {
    let trimmed = input.trim();
    let candidate = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let parsed = Url::parse(&candidate).map_err(|_| anyhow!("Invalid URL: {input}"))?;
    if matches!(parsed.scheme(), "http" | "https") {
        Ok(parsed.to_string())
    } else {
        Err(anyhow!("Only http:// and https:// URLs are supported"))
    }
}

pub fn extract_domain(url: &str) -> String {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.trim_start_matches("www.").to_string()))
        .filter(|host| !host.is_empty())
        .unwrap_or_else(|| "unknown".to_string())
}

pub fn default_output_dir(url: &str) -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("fonts")
        .join(extract_domain(url))
}

pub fn sanitize_family_dir(value: &str) -> String {
    let mut cleaned = String::with_capacity(value.len());
    let mut last_was_sep = false;

    for ch in value.chars() {
        let mapped = match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_whitespace() => '_',
            c => c,
        };

        if mapped == '_' {
            if !last_was_sep {
                cleaned.push('_');
            }
            last_was_sep = true;
        } else {
            cleaned.push(mapped);
            last_was_sep = false;
        }
    }

    cleaned.trim_matches('_').to_string()
}

pub fn sanitize_file_stem(value: &str) -> String {
    let base = sanitize_family_dir(value).replace('_', "-");
    if base.is_empty() {
        "font".to_string()
    } else {
        base
    }
}

pub fn weight_label(weight: &str) -> String {
    match weight {
        "100" => "100 Thin".to_string(),
        "200" => "200 ExtraLight".to_string(),
        "300" => "300 Light".to_string(),
        "400" => "400 Regular".to_string(),
        "500" => "500 Medium".to_string(),
        "600" => "600 SemiBold".to_string(),
        "700" => "700 Bold".to_string(),
        "800" => "800 ExtraBold".to_string(),
        "900" => "900 Black".to_string(),
        other => other.to_string(),
    }
}

pub fn variant_label(weight: &str, style: &str, stretch: Option<&str>, variable: bool) -> String {
    let base = match style.to_ascii_lowercase().as_str() {
        "normal" | "regular" => weight_label(weight),
        other => format!("{} {}", weight_label(weight), other),
    };
    let stretched = match stretch.filter(|value| !value.is_empty()) {
        Some(stretch) => format!("{} / {}", base, stretch),
        None => base,
    };

    if variable {
        format!("{} / Variable", stretched)
    } else {
        stretched
    }
}

pub fn next_available_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("font")
        .to_string();
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!(".{value}"))
        .unwrap_or_default();
    let parent = path.parent().unwrap_or_else(|| Path::new("."));

    for index in 1..10_000usize {
        let candidate = parent.join(format!("{stem}-{index}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }

    parent.join(format!("{stem}-overflow{ext}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_url_adds_https_and_preserves_valid_urls() {
        assert_eq!(normalize_url("example.com").unwrap(), "https://example.com/");
        assert_eq!(normalize_url("https://example.com/path").unwrap(), "https://example.com/path");
    }

    #[test]
    fn sanitizers_collapse_separators() {
        assert_eq!(sanitize_family_dir(" ACME / Fonts  "), "ACME_Fonts");
        assert_eq!(sanitize_file_stem(" ACME / Fonts  "), "ACME-Fonts");
        assert_eq!(sanitize_file_stem("***"), "font");
    }

    #[test]
    fn labels_are_human_readable() {
        assert_eq!(weight_label("400"), "400 Regular");
        assert_eq!(variant_label("700", "italic", None, false), "700 Bold italic");
        assert_eq!(variant_label("400", "regular", None, false), "400 Regular");
        assert_eq!(variant_label("400", "regular", Some("75% 125%"), true), "400 Regular / 75% 125% / Variable");
    }
}
