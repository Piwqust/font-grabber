use std::{path::PathBuf, sync::Mutex, time::Duration};

use anyhow::{anyhow, Context, Result};
use headless_chrome::{Browser, LaunchOptions};

static CHROME_LOCK: Mutex<()> = Mutex::new(());

pub fn with_browser<T>(work: impl FnOnce(&Browser) -> Result<T>) -> Result<T> {
    let _guard = CHROME_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let browser = launch()?;
    work(&browser)
}

pub fn launch() -> Result<Browser> {
    let path = std::env::var_os("CHROME")
        .or_else(|| std::env::var_os("CHROMIUM"))
        .map(PathBuf::from);
    let options = LaunchOptions::default_builder()
        .headless(true)
        .sandbox(false)
        .idle_browser_timeout(Duration::from_secs(90))
        .path(path)
        .build()
        .map_err(|error| anyhow!("Could not build Chrome launch options: {error}"))?;
    Browser::new(options)
        .context("Could not launch headless Chrome (is Chrome/Chromium installed?)")
}
