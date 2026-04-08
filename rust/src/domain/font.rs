use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FontFormat {
    Woff2,
    Woff,
    TrueType,
    OpenType,
    EmbeddedOpenType,
    Svg,
    Unknown,
}

impl FontFormat {
    pub fn normalize(value: &str) -> Self {
        let lower = value
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .to_ascii_lowercase();
        if lower.contains("woff2") {
            Self::Woff2
        } else if lower.contains("woff") {
            Self::Woff
        } else if lower.contains("truetype") || lower == "ttf" {
            Self::TrueType
        } else if lower.contains("opentype") || lower == "otf" {
            Self::OpenType
        } else if lower.contains("embedded-opentype") || lower == "eot" {
            Self::EmbeddedOpenType
        } else if lower.contains("svg") {
            Self::Svg
        } else {
            Self::Unknown
        }
    }

    pub fn guess_from_url(value: &str) -> Self {
        let lower = value.to_ascii_lowercase();
        if lower.contains(".woff2") {
            Self::Woff2
        } else if lower.contains(".woff") {
            Self::Woff
        } else if lower.contains(".ttf") {
            Self::TrueType
        } else if lower.contains(".otf") {
            Self::OpenType
        } else if lower.contains(".eot") {
            Self::EmbeddedOpenType
        } else if lower.contains(".svg") {
            Self::Svg
        } else {
            Self::Unknown
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Woff2 => "woff2",
            Self::Woff => "woff",
            Self::TrueType => "ttf",
            Self::OpenType => "otf",
            Self::EmbeddedOpenType => "eot",
            Self::Svg => "svg",
            Self::Unknown => "bin",
        }
    }

    pub fn sniff(bytes: &[u8]) -> Self {
        if bytes.len() < 4 {
            return Self::Unknown;
        }

        match [bytes[0], bytes[1], bytes[2], bytes[3]] {
            [0x77, 0x4F, 0x46, 0x32] => Self::Woff2,
            [0x77, 0x4F, 0x46, 0x46] => Self::Woff,
            [0x00, 0x01, 0x00, 0x00] | [0x74, 0x72, 0x75, 0x65] => Self::TrueType,
            [0x4F, 0x54, 0x54, 0x4F] => Self::OpenType,
            _ => Self::Unknown,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Woff2 => "woff2",
            Self::Woff => "woff",
            Self::TrueType => "ttf",
            Self::OpenType => "otf",
            Self::EmbeddedOpenType => "eot",
            Self::Svg => "svg",
            Self::Unknown => "unknown",
        }
    }

    pub fn priority(self) -> usize {
        match self {
            Self::Woff2 => 1,
            Self::Woff => 2,
            Self::TrueType => 3,
            Self::OpenType => 4,
            Self::EmbeddedOpenType => 5,
            Self::Svg => 6,
            Self::Unknown => 99,
        }
    }

    pub fn can_convert(self) -> bool {
        !matches!(self, Self::Svg | Self::EmbeddedOpenType)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ScanSource {
    StaticCss,
    BrowserCss,
    BrowserNetwork,
}

impl ScanSource {
    pub fn label(self) -> &'static str {
        match self {
            Self::StaticCss => "static css",
            Self::BrowserCss => "browser css",
            Self::BrowserNetwork => "browser network",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferMethod {
    Http,
    Browser,
}

impl TransferMethod {
    pub fn label(self) -> &'static str {
        match self {
            Self::Http => "http",
            Self::Browser => "browser",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct FontSource {
    pub url: String,
    pub format: FontFormat,
}

#[derive(Debug, Clone, Serialize)]
pub struct FontCandidate {
    pub id: String,
    pub family: String,
    pub style: String,
    pub weight: String,
    pub sources: Vec<FontSource>,
    pub unicode_range: Option<String>,
    pub variable: bool,
    pub scan_source: ScanSource,
}

#[derive(Debug, Clone)]
pub struct CachedFont {
    pub info: FontCandidate,
    pub cached_path: PathBuf,
    pub downloaded_format: FontFormat,
    pub source_url: String,
    pub transfer_method: TransferMethod,
}

#[derive(Debug, Clone, Serialize)]
pub struct VariableAxis {
    pub tag: String,
    pub name: String,
    pub min: f32,
    pub default: f32,
    pub max: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OutputFormat {
    Ttf,
    Otf,
}

impl OutputFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Ttf => "ttf",
            Self::Otf => "otf",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConvertedFont {
    pub info: FontCandidate,
    pub data: Vec<u8>,
    pub output_format: OutputFormat,
    pub variable_axes_preserved: bool,
    pub axes: Vec<VariableAxis>,
    pub source_url: String,
    pub transfer_method: TransferMethod,
}

#[derive(Debug, Clone, Serialize)]
pub struct SavedFont {
    pub family: String,
    pub style: String,
    pub weight: String,
    pub unicode_range: Option<String>,
    pub output_path: PathBuf,
    pub output_format: OutputFormat,
    pub variable_axes_preserved: bool,
    pub axes: Vec<VariableAxis>,
    pub scan_source: ScanSource,
    pub transfer_method: TransferMethod,
    pub source_url: String,
}
