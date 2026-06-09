use std::{fmt, path::PathBuf};

use clap::ValueEnum;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ValueEnum)]
#[serde(rename_all = "snake_case")]
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

    pub fn should_collect_browser(self, static_found: bool) -> bool {
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

#[derive(Debug, Clone)]
pub struct ScanRequest {
    pub page_url: String,
    pub mode: DiscoveryMode,
    pub webdriver_url: String,
    /// Inspect each font's glyph coverage to label supported scripts. Accurate but
    /// downloads every candidate, so the web UI disables it for a responsive scan.
    pub enrich_scripts: bool,
}

#[derive(Debug, Clone)]
pub struct GrabRequest {
    pub scan: ScanRequest,
    pub output_dir: PathBuf,
    pub concurrency: usize,
}
