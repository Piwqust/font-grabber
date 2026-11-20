use anyhow::{bail, Context, Result};

use crate::{
    cli::DoctorArgs,
    domain::DoctorReport,
    support::{chrome, ui},
};

/// Checks the one external piece Fount relies on: a Chrome, Chromium or Edge
/// it can start headless for dynamic discovery. Without one, scans still work
/// from the page source alone.
pub async fn run(args: DoctorArgs) -> Result<()> {
    let browser_path = chrome::browser_path();
    let check = tokio::task::spawn_blocking(|| chrome::with_browser(probe))
        .await
        .context("Browser check panicked")?;

    let report = match check {
        Ok(version) => DoctorReport {
            version: env!("CARGO_PKG_VERSION"),
            browser_path,
            browser_version: Some(version),
            browser_ok: true,
            error: None,
            discovery: "auto",
        },
        Err(error) => DoctorReport {
            version: env!("CARGO_PKG_VERSION"),
            browser_path,
            browser_version: None,
            browser_ok: false,
            error: Some(format!("{error:#}")),
            discovery: "static",
        },
    };

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        ui::print_doctor_report(&report);
    }

    if !report.browser_ok {
        bail!("No usable browser: scans will read the page source only")
    }
    Ok(())
}

/// Starts the browser, runs a script in a page and returns the browser version.
fn probe(browser: &headless_chrome::Browser) -> Result<String> {
    let version = browser
        .get_version()
        .context("The browser started but did not report its version")?
        .product;
    let tab = browser.new_tab().context("Could not open a browser tab")?;
    tab.navigate_to("data:text/html,<title>fount</title><p>ok</p>")
        .context("Could not open a test page")?;
    let _ = tab.wait_until_navigated();
    let value = tab
        .evaluate("document.title + ':' + (typeof FontFace)", false)
        .context("Could not run a script in the test page")?
        .value
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default();
    if value != "fount:function" {
        bail!("The test page answered {value:?} instead of \"fount:function\"");
    }
    Ok(version)
}
