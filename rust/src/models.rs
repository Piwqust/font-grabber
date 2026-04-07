use std::{fmt, path::PathBuf, sync::Arc};

use clap::ValueEnum;
use serde::{Deserialize, Serialize};

pub type Logger = Arc<dyn Fn(String) + Send + Sync + 'static>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ValueEnum)]
pub enum DiscoveryMode {
    Auto,
    Static,
    Render,
}

impl DiscoveryMode {
    pub fn label(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Static => "static",
            Self::Render => "render",
        }
    }

    pub fn should_try_browser(self, static_found: bool) -> bool {
        match self {
            Self::Static => false,
            Self::Render => true,
            Self::Auto => !static_found,
        }
    }
}

impl fmt::Display for DiscoveryMode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

    pub fn label(self) -> &'static str {
        match self {
            Self::Woff2 => "woff2",
            Self::Woff => "woff",
            Self::TrueType => "truetype",
            Self::OpenType => "opentype",
            Self::EmbeddedOpenType => "embedded-opentype",
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

impl fmt::Display for FontFormat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.label())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanSource {
    StaticCss,
    BrowserCss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferMethod {
    BrowserFetch,
    HttpFetch,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JobState {
    Idle,
    Discovering,
    Reviewing,
    Processing,
    Done,
    Error,
}

impl JobState {
    pub fn label(self) -> &'static str {
        match self {
            Self::Idle => "Idle",
            Self::Discovering => "Discovering",
            Self::Reviewing => "Ready",
            Self::Processing => "Processing",
            Self::Done => "Done",
            Self::Error => "Error",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FontSourceRef {
    pub url: String,
    pub format: FontFormat,
}

#[derive(Debug, Clone)]
pub struct DiscoveredFont {
    pub id: String,
    pub family: String,
    pub style: String,
    pub weight: String,
    pub sources: Vec<FontSourceRef>,
    pub is_variable: bool,
    pub unicode_range: Option<String>,
    pub scan_source: ScanSource,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct CachedFont {
    pub info: DiscoveredFont,
    pub cached_path: PathBuf,
    pub downloaded_format: FontFormat,
    pub source_url: String,
    pub transfer_method: TransferMethod,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct VariableAxis {
    pub tag: String,
    pub name: String,
    pub min: f32,
    pub default: f32,
    pub max: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ConvertedFont {
    pub info: DiscoveredFont,
    pub data: Vec<u8>,
    pub output_format: OutputFormat,
    pub filename: String,
    pub variable_axes_preserved: bool,
    pub axes: Vec<VariableAxis>,
}

#[derive(Debug, Clone)]
pub struct SavedFont {
    pub converted: ConvertedFont,
    pub output_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct DiscoverRequest {
    pub page_url: String,
    pub mode: DiscoveryMode,
    pub webdriver_url: String,
}

#[derive(Debug, Clone)]
pub struct DiscoveryReport {
    pub fonts: Vec<DiscoveredFont>,
    pub used_browser: bool,
}

#[derive(Debug, Clone)]
pub struct ProcessRequest {
    pub page_url: String,
    pub fonts: Vec<DiscoveredFont>,
    pub output_dir: PathBuf,
    pub prefer_browser_fetch: bool,
    pub webdriver_url: String,
}

#[derive(Debug, Clone)]
pub struct ProcessSummary {
    pub saved: Vec<SavedFont>,
    pub download_failures: Vec<String>,
    pub conversion_failures: Vec<String>,
}
