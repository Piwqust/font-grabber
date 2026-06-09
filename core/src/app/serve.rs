use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::PathBuf,
    sync::Arc,
};

use anyhow::{Context, Result};
use axum::{
    extract::{Query, State},
    http::{header, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tempfile::tempdir;
use tokio::sync::Mutex;

use crate::{
    cli::ServeArgs,
    convert, discovery, fetch, output,
    domain::{DiscoveryMode, FontCandidate, ScanReport, ScanRequest},
    support::{default_output_dir, normalize_url, http::build_http_client},
};

/// Shared server state. Scan results are cached per (mode, url) so a follow-up grab
/// reuses the discovered candidates instead of re-scanning the page.
#[derive(Clone)]
struct AppState {
    webdriver_url: String,
    concurrency: usize,
    scans: Arc<Mutex<HashMap<String, ScanReport>>>,
}

pub async fn run(args: ServeArgs) -> Result<()> {
    let state = AppState {
        webdriver_url: args.webdriver_url.clone(),
        concurrency: args.concurrency,
        scans: Arc::new(Mutex::new(HashMap::new())),
    };

    let app = Router::new()
        .route("/", get(index))
        .route("/style.css", get(style))
        .route("/app.js", get(script))
        .route("/api/scan", post(scan))
        .route("/api/grab", post(grab))
        .route("/api/font", get(font_proxy))
        .with_state(state);

    let addr = format!("{}:{}", args.host, args.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("Failed to bind {addr}"))?;

    let url = format!("http://{}:{}", display_host(&args.host), args.port);
    println!("Font Grabber is running at {url}");
    println!("Press Ctrl+C to stop.");

    if !args.no_open {
        open_browser(&url);
    }

    axum::serve(listener, app)
        .await
        .context("Web server error")?;
    Ok(())
}

fn display_host(host: &str) -> String {
    if host == "0.0.0.0" {
        "localhost".to_string()
    } else {
        host.to_string()
    }
}

// ---------------------------------------------------------------------------
// Static assets (embedded so the binary is self-contained)
// ---------------------------------------------------------------------------

async fn index() -> Html<&'static str> {
    Html(include_str!("../web/index.html"))
}

async fn style() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("../web/style.css"),
    )
}

async fn script() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/javascript; charset=utf-8")],
        include_str!("../web/app.js"),
    )
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ScanBody {
    url: String,
    #[serde(default)]
    mode: Option<String>,
}

async fn scan(State(state): State<AppState>, Json(body): Json<ScanBody>) -> Response {
    let mode = parse_mode(body.mode.as_deref());
    let page_url = match normalize_url(&body.url) {
        Ok(url) => url,
        Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    };

    let request = ScanRequest {
        page_url,
        mode,
        webdriver_url: state.webdriver_url.clone(),
        // Keep the interactive scan fast; the live preview shows real glyphs anyway.
        enrich_scripts: false,
    };

    match discovery::scan(&request, None).await {
        Ok(report) => {
            state
                .scans
                .lock()
                .await
                .insert(cache_key(mode, &request.page_url), report.clone());
            Json(report).into_response()
        }
        Err(error) => error_response(StatusCode::BAD_GATEWAY, &format!("{error:#}")),
    }
}

#[derive(Deserialize)]
struct GrabBody {
    url: String,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    ids: Vec<String>,
    /// "zip" (default) streams an archive; "folder" writes files to disk.
    #[serde(default)]
    delivery: Option<String>,
    #[serde(default)]
    output_dir: Option<String>,
}

#[derive(Serialize)]
struct FolderResult {
    output_dir: String,
    saved_count: usize,
    saved: Vec<SavedSummary>,
    warnings: Vec<String>,
    download_failures: Vec<String>,
    conversion_failures: Vec<String>,
}

#[derive(Serialize)]
struct SavedSummary {
    family: String,
    file: String,
    format: String,
}

async fn grab(State(state): State<AppState>, Json(body): Json<GrabBody>) -> Response {
    let mode = parse_mode(body.mode.as_deref());
    let page_url = match normalize_url(&body.url) {
        Ok(url) => url,
        Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    };

    if body.ids.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "No fonts were selected");
    }

    // Reuse the cached scan when available, otherwise scan again.
    let report = {
        let cached = state.scans.lock().await.get(&cache_key(mode, &page_url)).cloned();
        match cached {
            Some(report) => report,
            None => {
                let request = ScanRequest {
                    page_url: page_url.clone(),
                    mode,
                    webdriver_url: state.webdriver_url.clone(),
                    enrich_scripts: false,
                };
                match discovery::scan(&request, None).await {
                    Ok(report) => report,
                    Err(error) => {
                        return error_response(StatusCode::BAD_GATEWAY, &format!("{error:#}"))
                    }
                }
            }
        }
    };

    let wanted: HashSet<&str> = body.ids.iter().map(String::as_str).collect();
    let selected: Vec<FontCandidate> = report
        .fonts
        .iter()
        .filter(|font| wanted.contains(font.id.as_str()))
        .cloned()
        .collect();

    if selected.is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "None of the selected fonts are still available; rescan and try again",
        );
    }

    let cache_dir = match tempdir() {
        Ok(dir) => dir,
        Err(error) => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
    };
    let allow_browser_fallback = !matches!(mode, DiscoveryMode::Static);
    let downloads = match fetch::download_fonts(
        &selected,
        &page_url,
        cache_dir.path(),
        state.concurrency,
        allow_browser_fallback,
        &state.webdriver_url,
        None,
    )
    .await
    {
        Ok(batch) => batch,
        Err(error) => return error_response(StatusCode::BAD_GATEWAY, &format!("{error:#}")),
    };

    let conversion = match convert::convert_fonts(&downloads.cached, None) {
        Ok(batch) => batch,
        Err(error) => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("{error:#}"))
        }
    };

    if conversion.converted.is_empty() {
        let mut detail = String::from("No fonts could be converted.");
        for failure in downloads.failures.iter().chain(conversion.failures.iter()) {
            detail.push_str("\n• ");
            detail.push_str(failure);
        }
        return error_response(StatusCode::UNPROCESSABLE_ENTITY, &detail);
    }

    if body.delivery.as_deref() == Some("folder") {
        let output_dir = body
            .output_dir
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(|| default_output_dir(&page_url));

        match output::save_converted_fonts(&conversion.converted, &output_dir, None) {
            Ok(saved) => {
                let result = FolderResult {
                    output_dir: output_dir.display().to_string(),
                    saved_count: saved.len(),
                    saved: saved
                        .iter()
                        .map(|font| SavedSummary {
                            family: font.family.clone(),
                            file: font
                                .output_path
                                .file_name()
                                .map(|name| name.to_string_lossy().to_string())
                                .unwrap_or_default(),
                            format: font.output_format.extension().to_string(),
                        })
                        .collect(),
                    warnings: report.warnings.clone(),
                    download_failures: downloads.failures,
                    conversion_failures: conversion.failures,
                };
                Json(result).into_response()
            }
            Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &format!("{error:#}")),
        }
    } else {
        match build_zip(&conversion.converted) {
            Ok(bytes) => {
                let filename = zip_filename(&page_url);
                (
                    StatusCode::OK,
                    [
                        (header::CONTENT_TYPE, "application/zip".to_string()),
                        (
                            header::CONTENT_DISPOSITION,
                            format!("attachment; filename=\"{filename}\""),
                        ),
                    ],
                    bytes,
                )
                    .into_response()
            }
            Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
        }
    }
}

#[derive(Deserialize)]
struct FontQuery {
    url: String,
}

/// Proxy a remote font file so the browser can load it same-origin for previews
/// (cross-origin `@font-face` is blocked by CORS on many font hosts).
async fn font_proxy(Query(query): Query<FontQuery>) -> Response {
    let parsed = match url::Url::parse(&query.url) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => url,
        _ => return error_response(StatusCode::BAD_REQUEST, "Invalid font URL"),
    };

    let client = match build_http_client() {
        Ok(client) => client,
        Err(error) => {
            return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
    };

    let response = match client.get(parsed.clone()).send().await {
        Ok(response) => response,
        Err(error) => return error_response(StatusCode::BAD_GATEWAY, &error.to_string()),
    };
    if !response.status().is_success() {
        return error_response(
            StatusCode::BAD_GATEWAY,
            &format!("Font host returned {}", response.status()),
        );
    }
    let bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(error) => return error_response(StatusCode::BAD_GATEWAY, &error.to_string()),
    };

    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, content_type_for(parsed.as_str())),
            (header::CACHE_CONTROL, "public, max-age=3600".to_string()),
        ],
        bytes.to_vec(),
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn parse_mode(value: Option<&str>) -> DiscoveryMode {
    match value.map(str::to_ascii_lowercase).as_deref() {
        Some("static") => DiscoveryMode::Static,
        Some("render") => DiscoveryMode::Render,
        _ => DiscoveryMode::Auto,
    }
}

fn cache_key(mode: DiscoveryMode, url: &str) -> String {
    format!("{}|{}", mode.label(), url)
}

fn content_type_for(url: &str) -> String {
    let lower = url.to_ascii_lowercase();
    let ty = if lower.contains(".woff2") {
        "font/woff2"
    } else if lower.contains(".woff") {
        "font/woff"
    } else if lower.contains(".otf") {
        "font/otf"
    } else if lower.contains(".ttf") {
        "font/ttf"
    } else {
        "application/octet-stream"
    };
    ty.to_string()
}

fn build_zip(fonts: &[crate::domain::ConvertedFont]) -> Result<Vec<u8>> {
    let mut buffer = std::io::Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut buffer);
        let options: zip::write::FileOptions<'_, ()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        let mut used = HashSet::new();
        for font in fonts {
            let name = unique_name(output::build_output_filename(font), &mut used);
            writer.start_file(name, options)?;
            writer.write_all(&font.data)?;
        }
        writer.finish()?;
    }
    Ok(buffer.into_inner())
}

fn unique_name(name: String, used: &mut HashSet<String>) -> String {
    if used.insert(name.clone()) {
        return name;
    }
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name.as_str(), ""));
    for index in 2.. {
        let candidate = if ext.is_empty() {
            format!("{stem}-{index}")
        } else {
            format!("{stem}-{index}.{ext}")
        };
        if used.insert(candidate.clone()) {
            return candidate;
        }
    }
    unreachable!()
}

fn zip_filename(page_url: &str) -> String {
    let domain = crate::support::extract_domain(page_url);
    let stem: String = domain
        .chars()
        .map(|character| if character.is_alphanumeric() { character } else { '-' })
        .collect();
    let stem = stem.trim_matches('-');
    if stem.is_empty() {
        "fonts.zip".to_string()
    } else {
        format!("{stem}-fonts.zip")
    }
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (status, Json(ErrorBody { error: message.to_string() })).into_response()
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
}

fn open_browser(url: &str) {
    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args(["/C", "start", "", url])
        .spawn();
    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let result = std::process::Command::new("xdg-open").arg(url).spawn();

    if let Err(error) = result {
        eprintln!("Could not open browser automatically ({error}); open {url} manually.");
    }
}
