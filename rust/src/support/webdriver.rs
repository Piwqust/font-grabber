use anyhow::{bail, Context, Result};
use serde_json::Value;
use thirtyfour::prelude::*;
use tokio::time::{sleep, Duration};

pub async fn connect(webdriver_url: &str) -> Result<WebDriver> {
    let mut caps = DesiredCapabilities::chrome();
    caps.add_arg("--headless=new")?;
    caps.add_arg("--disable-gpu")?;
    caps.add_arg("--no-sandbox")?;

    WebDriver::new(webdriver_url, caps)
        .await
        .with_context(|| format!("Could not connect to WebDriver at {webdriver_url}"))
}

pub async fn wait_for_page_ready(driver: &WebDriver) -> Result<()> {
    for _ in 0..60 {
        let ready_state: String = driver
            .execute("return document.readyState", Vec::<Value>::new())
            .await
            .context("Could not read document.readyState")?
            .convert()
            .context("Could not parse document.readyState")?;
        let fonts_status: String = driver
            .execute(
                "return document.fonts ? document.fonts.status : 'loaded'",
                Vec::<Value>::new(),
            )
            .await
            .context("Could not read document.fonts.status")?
            .convert()
            .context("Could not parse document.fonts.status")?;

        if ready_state == "complete" && fonts_status == "loaded" {
            return Ok(());
        }

        sleep(Duration::from_millis(250)).await;
    }

    bail!("Timed out waiting for the browser page to become ready")
}
