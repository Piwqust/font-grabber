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
    pub selected_count: usize,
    pub saved_count: usize,
    pub warnings: Vec<String>,
    pub download_failures: Vec<String>,
    pub conversion_failures: Vec<String>,
    pub saved: Vec<SavedFont>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DoctorReport {
    pub webdriver_url: String,
    pub status_url: String,
    pub status_ok: bool,
    pub session_ok: bool,
    pub script_ok: bool,
}
