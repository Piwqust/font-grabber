mod cli;
mod converter;
mod discovery;
mod downloader;
mod models;
mod output;
mod pipeline;
mod tui;
mod util;

use std::sync::Arc;

use anyhow::{bail, Context, Result};
use clap::Parser;

use crate::{
    cli::{Cli, Commands, DoctorArgs, GrabArgs},
    models::{DiscoverRequest, Logger, ProcessRequest},
    pipeline::{discover, process_selection},
    util::{default_output_dir, emit_log, normalize_url},
};

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command.unwrap_or(Commands::Grab(GrabArgs::default())) {
        Commands::Grab(args) if args.no_ui => run_non_interactive(args).await,
        Commands::Grab(args) => tui::run(args).await,
        Commands::Doctor(args) => run_doctor(args).await,
    }
}

async fn run_non_interactive(args: GrabArgs) -> Result<()> {
    let url = args
        .url
        .as_deref()
        .context("`--url` is required when `--no-ui` is used")?;

    if !args.all {
        bail!("`--no-ui` currently requires `--all`");
    }

    let normalized_url = normalize_url(url)?;
    let logger: Logger = Arc::new(|message| println!("{message}"));

    emit_log(Some(&logger), format!("Scanning {normalized_url}"));
    let report = discover(
        &DiscoverRequest {
            page_url: normalized_url.clone(),
            mode: args.mode,
            webdriver_url: args.webdriver_url.clone(),
        },
        Some(logger.clone()),
    )
    .await?;

    if report.fonts.is_empty() {
        println!("No downloadable fonts found.");
        return Ok(());
    }

    let output_dir = args
        .output
        .unwrap_or_else(|| default_output_dir(&normalized_url));
    let prefer_browser_fetch =
        report.used_browser || matches!(args.mode, crate::models::DiscoveryMode::Render);
    let summary = process_selection(
        &ProcessRequest {
            page_url: normalized_url,
            fonts: report.fonts,
            output_dir: output_dir.clone(),
            prefer_browser_fetch,
            webdriver_url: args.webdriver_url,
        },
        Some(logger.clone()),
    )
    .await?;

    println!(
        "\nSaved {} font(s) to {}",
        summary.saved.len(),
        output_dir.display()
    );

    if !summary.download_failures.is_empty() {
        println!("\nDownload warnings:");
        for failure in &summary.download_failures {
            println!("  - {failure}");
        }
    }

    if !summary.conversion_failures.is_empty() {
        println!("\nConversion warnings:");
        for failure in &summary.conversion_failures {
            println!("  - {failure}");
        }
    }

    Ok(())
}

async fn run_doctor(args: DoctorArgs) -> Result<()> {
    let client = util::build_http_client()?;
    let status_url = format!("{}/status", args.webdriver_url.trim_end_matches('/'));

    println!("Checking WebDriver at {status_url} ...");

    let response = client.get(&status_url).send().await;
    match response {
        Ok(response) if response.status().is_success() => {
            println!("WebDriver responded successfully.");
            println!(
                "Render mode should be available if Chrome/Chromedriver are configured correctly."
            );
        }
        Ok(response) => {
            bail!(
                "WebDriver returned HTTP {}. Check the driver service and endpoint.",
                response.status()
            );
        }
        Err(error) => {
            bail!(
                "Could not reach WebDriver: {error}. Start Chromedriver or Selenium before using render mode."
            );
        }
    }

    Ok(())
}
