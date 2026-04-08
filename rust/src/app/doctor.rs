use anyhow::{bail, Context, Result};
use serde_json::Value;

use crate::{
    cli::DoctorArgs,
    domain::DoctorReport,
    support::{http::build_http_client, ui, webdriver},
};

pub async fn run(args: DoctorArgs) -> Result<()> {
    let status_url = format!("{}/status", args.webdriver_url.trim_end_matches('/'));
    let client = build_http_client()?;

    client
        .get(&status_url)
        .send()
        .await
        .with_context(|| format!("Could not reach WebDriver at {status_url}"))?
        .error_for_status()
        .with_context(|| format!("WebDriver returned an error at {status_url}"))?;

    let driver = webdriver::connect(&args.webdriver_url).await?;
    let script_ok = async {
        driver
            .goto("data:text/html,<title>font-grabber</title><script>window.__font_grabber='ok'</script>")
            .await
            .context("Could not open a test page in WebDriver")?;
        webdriver::wait_for_page_ready(&driver).await?;

        let marker: String = driver
            .execute("return window.__font_grabber", Vec::<Value>::new())
            .await
            .context("Could not execute a test script in WebDriver")?
            .convert()
            .context("Could not parse WebDriver script response")?;

        Ok::<bool, anyhow::Error>(marker == "ok")
    }
    .await;
    let _ = driver.quit().await;
    let script_ok = script_ok?;

    if !script_ok {
        bail!("WebDriver session started but the script check failed")
    }

    let report = DoctorReport {
        webdriver_url: args.webdriver_url,
        status_url,
        status_ok: true,
        session_ok: true,
        script_ok,
    };

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        ui::print_doctor_report(&report);
    }

    Ok(())
}
