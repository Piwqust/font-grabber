mod workflow;

use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use axum::{
    extract::{Path, Query, State},
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
    convert, discovery,
    domain::{DiscoveryMode, FontCandidate, NameDraft, ScanReport, ScanRequest},
    fetch, output,
    support::{default_output_dir, http::build_http_client, normalize_url, validate_public_url},
};

/// A cached scan and when it was taken. In hosted mode this map grows with every
/// site anyone scans, so entries have to expire rather than accumulate.
struct CachedScan {
    report: ScanReport,
    created: Instant,
}

/// How long a cached scan is worth reusing for a follow-up export.
const SCAN_TTL: Duration = Duration::from_secs(30 * 60);
/// A ceiling for the map, so a burst of scans cannot outrun the TTL sweep.
const SCAN_LIMIT: usize = 64;

type ScanCache = HashMap<String, CachedScan>;

/// Shared server state. Scan results are cached per (mode, url) so a follow-up grab
/// reuses the discovered candidates instead of re-scanning the page.
#[derive(Clone)]
struct AppState {
    webdriver_url: String,
    concurrency: usize,
    hosted: bool,
    scans: Arc<Mutex<ScanCache>>,
    exports: Arc<Mutex<HashMap<String, workflow::Archive>>>,
}

/// Drops everything past the TTL, then the oldest entries above the cap.
fn prune_scans(scans: &mut ScanCache) {
    scans.retain(|_, scan| scan.created.elapsed() < SCAN_TTL);
    while scans.len() > SCAN_LIMIT {
        let Some(oldest) = scans
            .iter()
            .min_by_key(|(_, scan)| scan.created)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        scans.remove(&oldest);
    }
}

/// Caches a scan under `key` and keeps the map within its bounds.
async fn remember_scan(state: &AppState, key: String, report: ScanReport) {
    let mut scans = state.scans.lock().await;
    scans.insert(
        key,
        CachedScan {
            report,
            created: Instant::now(),
        },
    );
    prune_scans(&mut scans);
}

/// Sweeps expired scans on a timer, the way `workflow::start_cleanup` does for
/// archives — a server that is never asked for another scan still lets go.
fn start_scan_cleanup(scans: Arc<Mutex<ScanCache>>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            prune_scans(&mut *scans.lock().await);
        }
    });
}

pub async fn run(args: ServeArgs) -> Result<()> {
    let state = AppState {
        webdriver_url: args.webdriver_url.clone(),
        concurrency: args.concurrency,
        hosted: args.hosted,
        scans: Arc::new(Mutex::new(HashMap::new())),
        exports: Arc::new(Mutex::new(HashMap::new())),
    };

    workflow::start_cleanup(state.exports.clone());
    start_scan_cleanup(state.scans.clone());
    let app = Router::new()
        .route("/", get(index))
        .route("/style.css", get(style))
        .route("/app.js", get(script))
        .route("/favicon.svg", get(favicon))
        .route("/assets/:name", get(asset))
        .route("/api/scan", post(scan))
        .route("/api/grab", post(grab))
        .route("/api/export", post(workflow::export))
        .route("/api/export/:id", get(workflow::archive))
        .route("/api/coverage", post(workflow::coverage))
        .route("/api/font", get(font_proxy))
        .with_state(state);

    let addr = format!("{}:{}", args.host, args.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .with_context(|| format!("Failed to bind {addr}"))?;

    let url = format!("http://{}:{}", display_host(&args.host), args.port);
    if args.hosted {
        println!("Fount (hosted) is running at {url}");
    } else {
        println!("Fount is running at {url}");
    }
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

async fn index(State(state): State<AppState>) -> Html<String> {
    Html(include_str!("../web/index.html").replace(
        "__FOUNT_HOSTED__",
        if state.hosted { "true" } else { "false" },
    ))
}

async fn style() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/css; charset=utf-8")],
        include_str!("../web/style.css"),
    )
}

async fn script() -> impl IntoResponse {
    (
        [(
            header::CONTENT_TYPE,
            "application/javascript; charset=utf-8",
        )],
        include_str!("../web/assets/app.js"),
    )
}

async fn favicon() -> Response {
    static_bytes(
        "image/svg+xml; charset=utf-8",
        include_bytes!("../web/favicon.svg"),
    )
}

async fn asset(Path(name): Path<String>) -> Response {
    match name.as_str() {
        "fount-mark.svg" => static_bytes(
            "image/svg+xml; charset=utf-8",
            include_bytes!("../web/assets/fount-mark.svg"),
        ),
        "fount-mark-small.svg" => static_bytes(
            "image/svg+xml; charset=utf-8",
            include_bytes!("../web/assets/fount-mark-small.svg"),
        ),
        "fount-mark-mono.svg" => static_bytes(
            "image/svg+xml; charset=utf-8",
            include_bytes!("../web/assets/fount-mark-mono.svg"),
        ),
        "fount-logo.svg" => static_bytes(
            "image/svg+xml; charset=utf-8",
            include_bytes!("../web/assets/fount-logo.svg"),
        ),
        "ui-LICENSES.txt" => static_bytes(
            "text/plain; charset=utf-8",
            include_bytes!("../web/assets/ui-LICENSES.txt"),
        ),
        "geist-400.woff2" => static_bytes(
            "font/woff2",
            include_bytes!("../web/assets/geist-400.woff2"),
        ),
        "geist-600.woff2" => static_bytes(
            "font/woff2",
            include_bytes!("../web/assets/geist-600.woff2"),
        ),
        "geist-800.woff2" => static_bytes(
            "font/woff2",
            include_bytes!("../web/assets/geist-800.woff2"),
        ),
        "newsreader-400.woff2" => static_bytes(
            "font/woff2",
            include_bytes!("../web/assets/newsreader-400.woff2"),
        ),
        "newsreader-400i.woff2" => static_bytes(
            "font/woff2",
            include_bytes!("../web/assets/newsreader-400i.woff2"),
        ),
        "newsreader-700.woff2" => static_bytes(
            "font/woff2",
            include_bytes!("../web/assets/newsreader-700.woff2"),
        ),
        "plex-mono-400.woff2" => static_bytes(
            "font/woff2",
            include_bytes!("../web/assets/plex-mono-400.woff2"),
        ),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

fn static_bytes(content_type: &'static str, body: &'static [u8]) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type.to_string()),
            (
                header::CACHE_CONTROL,
                "public, max-age=31536000, immutable".to_string(),
            ),
        ],
        body,
    )
        .into_response()
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct ScanBody {
    url: String,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    mode: Option<String>,
}

async fn scan(State(state): State<AppState>, Json(body): Json<ScanBody>) -> Response {
    let mode = parse_mode(body.mode.as_deref());
    let page_url = match normalize_url(&body.url) {
        Ok(url) => url,
        Err(error) => return error_response(StatusCode::BAD_REQUEST, &error.to_string()),
    };
    if state.hosted {
        if let Err(error) = validate_public_url(&page_url).await {
            return error_response(StatusCode::BAD_REQUEST, &error.to_string());
        }
    }

    let request = ScanRequest {
        page_url,
        mode,
        webdriver_url: state.webdriver_url.clone(),
        // Keep the interactive scan fast; the live preview shows real glyphs anyway.
        enrich_scripts: false,
    };

    if body.stream {
        return workflow::scan_stream(state, request);
    }
    match discovery::scan(&request, None).await {
        Ok(report) => {
            remember_scan(&state, cache_key(mode, &request.page_url), report.clone()).await;
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
    #[serde(default)]
    names: Vec<NameOverride>,
}

#[derive(Deserialize)]
struct NameOverride {
    id: String,
    family: String,
    #[serde(default)]
    subfamily: String,
    #[serde(default)]
    full_name: Option<String>,
    #[serde(default)]
    postscript: Option<String>,
    #[serde(default)]
    filename: Option<String>,
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
    if state.hosted {
        if let Err(error) = validate_public_url(&page_url).await {
            return error_response(StatusCode::BAD_REQUEST, &error.to_string());
        }
    }

    if body.ids.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "No fonts were selected");
    }

    let delivery = body.delivery.as_deref().unwrap_or("zip");
    if state.hosted && delivery == "folder" {
        return error_response(
            StatusCode::BAD_REQUEST,
            "Folder delivery is disabled in hosted mode; choose ZIP",
        );
    }

    // Reuse the cached scan when available, otherwise scan again.
    let report = {
        let cached = state
            .scans
            .lock()
            .await
            .get(&cache_key(mode, &page_url))
            .map(|scan| scan.report.clone());
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
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    };
    let allow_browser_fallback = !matches!(mode, DiscoveryMode::Static);
    let downloads = match fetch::download_fonts(
        &selected,
        &page_url,
        cache_dir.path(),
        state.concurrency,
        allow_browser_fallback,
        state.hosted,
        None,
    )
    .await
    {
        Ok(batch) => batch,
        Err(error) => return error_response(StatusCode::BAD_GATEWAY, &format!("{error:#}")),
    };

    let drafts = name_drafts_from_overrides(&body.names);
    let conversion = match convert::convert_fonts(&downloads.cached, drafts.as_ref(), None) {
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

    if delivery == "folder" {
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
async fn font_proxy(State(state): State<AppState>, Query(query): Query<FontQuery>) -> Response {
    let parsed = match url::Url::parse(&query.url) {
        Ok(url) if matches!(url.scheme(), "http" | "https") => url,
        _ => return error_response(StatusCode::BAD_REQUEST, "Invalid font URL"),
    };
    if state.hosted {
        if let Err(error) = validate_public_url(parsed.as_str()).await {
            return error_response(StatusCode::BAD_REQUEST, &error.to_string());
        }
        if !font_url_from_scan(&state, parsed.as_str()).await {
            return error_response(
                StatusCode::FORBIDDEN,
                "Font URL was not part of a scanned page",
            );
        }
    }

    let client = match build_http_client() {
        Ok(client) => client,
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
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
        .map(|character| {
            if character.is_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect();
    let stem = stem.trim_matches('-');
    if stem.is_empty() {
        "fonts.zip".to_string()
    } else {
        format!("{stem}-fonts.zip")
    }
}

fn name_drafts_from_overrides(overrides: &[NameOverride]) -> Option<HashMap<String, NameDraft>> {
    if overrides.is_empty() {
        return None;
    }
    Some(
        overrides
            .iter()
            .filter(|item| !item.id.is_empty() && !item.family.trim().is_empty())
            .map(|item| {
                (
                    item.id.clone(),
                    NameDraft {
                        family: item.family.clone(),
                        subfamily: item.subfamily.clone(),
                        full_name: item.full_name.clone(),
                        postscript: item.postscript.clone(),
                        filename: item.filename.clone(),
                    },
                )
            })
            .collect(),
    )
}

async fn font_url_from_scan(state: &AppState, url: &str) -> bool {
    let scans = state.scans.lock().await;
    scans.values().any(|scan| {
        scan.report
            .fonts
            .iter()
            .any(|font| font.sources.iter().any(|source| source.url == url))
    })
}

fn error_response(status: StatusCode, message: &str) -> Response {
    (
        status,
        Json(ErrorBody {
            error: message.to_string(),
        }),
    )
        .into_response()
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

#[cfg(test)]
mod tests {
    use super::*;

    fn report(url: &str) -> ScanReport {
        ScanReport {
            page_url: url.to_string(),
            mode: DiscoveryMode::Static,
            used_browser: false,
            warnings: Vec::new(),
            fonts: Vec::new(),
        }
    }

    fn cached(url: &str, age: Duration) -> CachedScan {
        CachedScan {
            report: report(url),
            created: Instant::now() - age,
        }
    }

    #[test]
    fn prune_drops_expired_scans_and_caps_the_map() {
        let mut scans = ScanCache::new();
        scans.insert("fresh".into(), cached("http://fresh/", Duration::ZERO));
        scans.insert("stale".into(), cached("http://stale/", SCAN_TTL));
        prune_scans(&mut scans);
        assert!(scans.contains_key("fresh"));
        assert!(!scans.contains_key("stale"), "expired scan was kept");

        // Well under the TTL, but past the cap: the oldest entries go first.
        let mut scans = ScanCache::new();
        for index in 0..(SCAN_LIMIT + 8) {
            scans.insert(
                format!("site-{index}"),
                // Older keys carry a larger age, so eviction order is knowable.
                cached(
                    &format!("http://site-{index}/"),
                    Duration::from_secs((SCAN_LIMIT + 8 - index) as u64),
                ),
            );
        }
        prune_scans(&mut scans);
        assert_eq!(scans.len(), SCAN_LIMIT);
        assert!(!scans.contains_key("site-0"), "oldest scan was kept");
        assert!(
            scans.contains_key(&format!("site-{}", SCAN_LIMIT + 7)),
            "newest scan was evicted"
        );
    }
}
