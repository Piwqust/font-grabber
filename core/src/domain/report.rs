use std::path::PathBuf;

use serde::Serialize;

use crate::domain::{DiscoveryMode, FontCandidate, SavedFont};

#[derive(Debug, Clone, Serialize)]
pub struct ScanReport {
    pub page_url: String,
    pub mode: DiscoveryMode,
    pub used_browser: bool,
    pub warnings: Vec<String>,
    pub fonts: Vec<FontCandidate>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GrabReport {
    pub page_url: String,
    pub output_dir: PathBuf,
    pub used_browser: bool,
    /// Faces discovered before `--only` was applied.
    pub found_count: usize,
    /// Every family discovered, before `--only` was applied.
    pub families: Vec<String>,
    pub selected_count: usize,
    pub saved_count: usize,
    pub warnings: Vec<String>,
    pub download_failures: Vec<String>,
    pub conversion_failures: Vec<String>,
    pub saved: Vec<SavedFont>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DoctorReport {
    /// Fount's own version.
    pub version: &'static str,
    /// The browser Fount starts for dynamic discovery, if one was found.
    pub browser_path: Option<PathBuf>,
    pub browser_version: Option<String>,
    /// The browser started headless and ran a script in a page.
    pub browser_ok: bool,
    pub error: Option<String>,
    /// What `--mode auto` will do here: `auto` (page source + browser) or
    /// `static` (page source only).
    pub discovery: &'static str,
}
