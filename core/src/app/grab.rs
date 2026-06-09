use anyhow::{bail, Result};
use tempfile::tempdir;

use crate::{
    cli::GrabArgs,
    convert, discovery,
    domain::{DiscoveryMode, GrabReport, GrabRequest, ScanRequest},
    fetch, output,
    support::{default_output_dir, normalize_url, ui},
};

pub async fn run(args: GrabArgs) -> Result<()> {
    if args.json && !args.all {
        bail!("--json requires --all to avoid interactive prompts");
    }

    let interactive = ui::is_interactive_terminal();
    let raw_url = match args.url {
        Some(url) => url,
        None if !args.json && interactive => ui::prompt_for_url()?,
        None => bail!("A URL is required"),
    };

    let page_url = normalize_url(&raw_url)?;
    let request = GrabRequest {
        scan: ScanRequest {
            page_url: page_url.clone(),
            mode: args.mode,
            webdriver_url: args.webdriver_url,
            enrich_scripts: true,
        },
        output_dir: args.output.unwrap_or_else(|| default_output_dir(&page_url)),
        concurrency: args.concurrency,
    };

    let logger = if args.json {
        None
    } else {
        Some(ui::human_logger())
    };
    let scan_report = discovery::scan(&request.scan, logger.clone()).await?;

    if !args.json {
        ui::print_scan_report(&scan_report);
    }

    let selected = if scan_report.fonts.is_empty() {
        Vec::new()
    } else if args.all || !interactive || scan_report.fonts.len() == 1 {
        scan_report.fonts.clone()
    } else {
        ui::prompt_for_fonts(&scan_report.fonts)?
    };

    if selected.is_empty() {
        let report = GrabReport {
            page_url: request.scan.page_url,
            output_dir: request.output_dir,
            used_browser: scan_report.used_browser,
            selected_count: 0,
            saved_count: 0,
            warnings: scan_report.warnings,
            download_failures: Vec::new(),
            conversion_failures: Vec::new(),
            saved: Vec::new(),
        };

        if args.json {
            println!("{}", serde_json::to_string_pretty(&report)?);
        } else {
            ui::print_grab_report(&report);
        }

        return Ok(());
    }

    let cache_dir = tempdir()?;
    let allow_browser_fallback = !matches!(request.scan.mode, DiscoveryMode::Static);
    let downloads = fetch::download_fonts(
        &selected,
        &request.scan.page_url,
        cache_dir.path(),
        request.concurrency,
        allow_browser_fallback,
        &request.scan.webdriver_url,
        logger.clone(),
    )
    .await?;
    let conversion = convert::convert_fonts(&downloads.cached, logger.clone())?;
    let saved = output::save_converted_fonts(&conversion.converted, &request.output_dir, logger)?;

    let report = GrabReport {
        page_url: request.scan.page_url,
        output_dir: request.output_dir,
        used_browser: scan_report.used_browser,
        selected_count: selected.len(),
        saved_count: saved.len(),
        warnings: scan_report.warnings,
        download_failures: downloads.failures,
        conversion_failures: conversion.failures,
        saved,
    };

    if args.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        ui::print_grab_report(&report);
    }

    if report.saved_count == 0
        && (!report.download_failures.is_empty() || !report.conversion_failures.is_empty())
    {
        bail!("No fonts were saved")
    }

    Ok(())
}
