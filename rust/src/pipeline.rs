use anyhow::{anyhow, Result};

use crate::{
    converter, discovery, downloader,
    models::{DiscoverRequest, DiscoveryReport, Logger, ProcessRequest, ProcessSummary},
    output,
    util::emit_log,
};

pub async fn discover(
    request: &DiscoverRequest,
    logger: Option<Logger>,
) -> Result<DiscoveryReport> {
    discovery::discover_fonts(request, logger).await
}

pub async fn process_selection(
    request: &ProcessRequest,
    logger: Option<Logger>,
) -> Result<ProcessSummary> {
    if request.fonts.is_empty() {
        return Err(anyhow!("No fonts were selected"));
    }

    let cache_dir = tempfile::tempdir()?;
    emit_log(
        logger.as_ref(),
        format!("Using cache directory {}", cache_dir.path().display()),
    );

    let download_batch = downloader::download_fonts_to_cache(
        &request.fonts,
        &request.page_url,
        cache_dir.path(),
        request.prefer_browser_fetch,
        &request.webdriver_url,
        logger.clone(),
    )
    .await?;

    if download_batch.cached.is_empty() {
        return Err(anyhow!("All downloads failed"));
    }

    let conversion_batch = converter::convert_cached_fonts(&download_batch.cached, logger.clone())?;
    if conversion_batch.converted.is_empty() {
        return Err(anyhow!("All conversions failed"));
    }

    let saved = output::save_converted_fonts(
        &conversion_batch.converted,
        &request.output_dir,
        logger.clone(),
    )?;

    Ok(ProcessSummary {
        saved,
        download_failures: download_batch.failures,
        conversion_failures: conversion_batch.failures,
    })
}
