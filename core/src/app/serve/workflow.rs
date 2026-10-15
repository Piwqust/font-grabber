use super::*;
use axum::body::{Body, Bytes};
use futures::stream;
use std::{
    convert::Infallible,
    time::{Duration, Instant},
};
use tempfile::NamedTempFile;
use tokio::io::AsyncReadExt;

pub(super) struct Archive {
    file: NamedTempFile,
    filename: String,
    created: Instant,
}

const ARCHIVE_TTL: Duration = Duration::from_secs(15 * 60);

pub(super) fn start_cleanup(exports: Arc<Mutex<HashMap<String, Archive>>>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            exports
                .lock()
                .await
                .retain(|_, archive| archive.created.elapsed() < ARCHIVE_TTL);
        }
    });
}

pub(super) fn scan_stream(state: AppState, request: ScanRequest) -> Response {
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
    tokio::spawn(async move {
        let events = tx.clone();
        let progress: discovery::Progress = Arc::new(move |stage| {
            let _ = events.send(serde_json::json!({"type":"stage", "stage":stage}));
        });
        match discovery::scan_with_progress(&request, None, Some(progress)).await {
            Ok(report) => {
                remember_scan(
                    &state,
                    cache_key(request.mode, &request.page_url),
                    report.clone(),
                )
                .await;
                let _ = tx.send(serde_json::json!({"type":"result", "report":report}));
            }
            Err(error) => {
                let _ = tx.send(serde_json::json!({"type":"error", "error":format!("{error:#}")}));
            }
        }
    });
    let body = stream::unfold(rx, |mut rx| async move {
        rx.recv()
            .await
            .map(|value| (Ok::<_, Infallible>(Bytes::from(format!("{value}\n"))), rx))
    });
    (
        [
            (header::CONTENT_TYPE, "application/x-ndjson"),
            (header::CACHE_CONTROL, "no-store"),
            (
                axum::http::HeaderName::from_static("x-accel-buffering"),
                "no",
            ),
        ],
        Body::from_stream(body),
    )
        .into_response()
}

pub(super) async fn report_for(
    state: &AppState,
    url: &str,
    mode: DiscoveryMode,
) -> Result<ScanReport> {
    let url = normalize_url(url)?;
    if state.hosted {
        validate_public_url(&url).await?;
    }
    let key = cache_key(mode, &url);
    if let Some(report) = state
        .scans
        .lock()
        .await
        .get(&key)
        .filter(|scan| scan.created.elapsed() < SCAN_TTL)
        .map(|scan| scan.report.clone())
    {
        return Ok(report);
    }
    let request = ScanRequest {
        page_url: url,
        mode,
        webdriver_url: state.webdriver_url.clone(),
        enrich_scripts: false,
    };
    let report = discovery::scan(&request, None).await?;
    remember_scan(state, key, report.clone()).await;
    Ok(report)
}

#[derive(Serialize)]
pub(super) struct FileResult {
    pub(super) id: String,
    pub(super) family: String,
    pub(super) status: &'static str,
    pub(super) stage: &'static str,
    pub(super) file: Option<String>,
    pub(super) error: Option<String>,
}

impl FileResult {
    pub(super) fn failed(id: String, family: String, stage: &'static str, error: String) -> Self {
        Self {
            id,
            family,
            status: "error",
            stage,
            file: None,
            error: Some(error),
        }
    }
}

pub(super) async fn export(State(state): State<AppState>, Json(body): Json<GrabBody>) -> Response {
    match prepare_export(&state, body).await {
        Ok(value) => ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response(),
        Err(error) => error_response(StatusCode::BAD_REQUEST, &format!("{error:#}")),
    }
}

async fn prepare_export(state: &AppState, body: GrabBody) -> Result<serde_json::Value> {
    let ids = unique_ids(&body.ids, state.hosted)?;
    let delivery = body.delivery.as_deref().unwrap_or("zip");
    anyhow::ensure!(
        matches!(delivery, "zip" | "folder"),
        "Unknown delivery method"
    );
    anyhow::ensure!(
        !(state.hosted && delivery == "folder"),
        "Folder delivery is disabled in hosted mode"
    );
    let mode = parse_mode(body.mode.as_deref());
    let report = report_for(state, &body.url, mode).await?;
    let wanted: HashSet<_> = ids.iter().cloned().collect();
    let selected: Vec<_> = report
        .fonts
        .iter()
        .filter(|f| wanted.contains(&f.id))
        .cloned()
        .collect();
    let found: HashSet<&str> = selected.iter().map(|f| f.id.as_str()).collect();
    let mut results = Vec::new();
    for id in &ids {
        if !found.contains(id.as_str()) {
            results.push(FileResult::failed(
                id.clone(),
                "Unavailable font".into(),
                "download",
                "This file is no longer in the collection. Scan again.".into(),
            ));
        }
    }
    let cache = tempdir()?;
    let downloads = fetch::download_fonts(
        &selected,
        &report.page_url,
        cache.path(),
        state.concurrency,
        !matches!(mode, DiscoveryMode::Static),
        state.hosted,
        None,
    )
    .await?;
    let family_for = |id: &str| {
        selected
            .iter()
            .find(|f| f.id == id)
            .map(|f| f.family.clone())
            .unwrap_or_default()
    };
    for (id, detail) in downloads.failure_details {
        results.push(FileResult::failed(
            id.clone(),
            family_for(&id),
            "download",
            detail,
        ));
    }
    let conversion = convert::convert_fonts(
        &downloads.cached,
        name_drafts_from_overrides(&body.names).as_ref(),
        None,
    )?;
    for (id, detail) in conversion.failure_details {
        results.push(FileResult::failed(
            id.clone(),
            family_for(&id),
            "conversion",
            detail,
        ));
    }
    let output_dir = body
        .output_dir
        .as_deref()
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_output_dir(&report.page_url));
    let filename = zip_filename(&report.page_url);
    deliver(
        state,
        &ids,
        &conversion.converted,
        results,
        delivery,
        output_dir,
        filename,
        report.warnings,
    )
    .await
}

pub(super) async fn deliver(
    state: &AppState,
    ids: &[String],
    converted: &[crate::domain::ConvertedFont],
    mut results: Vec<FileResult>,
    delivery: &str,
    output_dir: PathBuf,
    filename: String,
    warnings: Vec<String>,
) -> Result<serde_json::Value> {
    let mut download_url: Option<String> = None;
    if delivery == "folder" {
        for font in converted {
            match output::save_converted_fonts(std::slice::from_ref(font), &output_dir, None) {
                Ok(saved) => results.push(FileResult {
                    id: font.info.id.clone(),
                    family: font.info.family.clone(),
                    status: "saved",
                    stage: "write",
                    file: Some(saved[0].output_path.display().to_string()),
                    error: None,
                }),
                Err(error) => results.push(FileResult::failed(
                    font.info.id.clone(),
                    font.info.family.clone(),
                    "write",
                    format!("{error:#}"),
                )),
            }
        }
    } else if !converted.is_empty() {
        let output_bytes: usize = converted.iter().map(|font| font.data.len()).sum();
        anyhow::ensure!(
            !state.hosted || output_bytes <= 128 * 1024 * 1024,
            "Choose fewer files: expanded fonts exceed 128 MiB"
        );
        // ZIP goes directly to a temporary file, never a second in-memory archive.
        let mut file = tempfile::Builder::new()
            .prefix("fount-")
            .rand_bytes(24)
            .tempfile()?;
        let mut writer = zip::ZipWriter::new(file.as_file_mut());
        let options: zip::write::FileOptions<'_, ()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let mut used = HashSet::new();
        for font in converted {
            let name = unique_name(output::build_output_filename(font), &mut used);
            writer.start_file(&name, options)?;
            writer.write_all(&font.data)?;
            results.push(FileResult {
                id: font.info.id.clone(),
                family: font.info.family.clone(),
                status: "ready",
                stage: "archive",
                file: Some(name),
                error: None,
            });
        }
        writer.finish()?;
        let id = file
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let mut exports = state.exports.lock().await;
        exports.retain(|_, archive| archive.created.elapsed() < ARCHIVE_TTL);
        let retained_bytes: u64 = exports
            .values()
            .filter_map(|a| a.file.as_file().metadata().ok())
            .map(|m| m.len())
            .sum();
        anyhow::ensure!(
            !state.hosted || retained_bytes + file.as_file().metadata()?.len() <= 128 * 1024 * 1024,
            "Temporary archive space is full. Wait for earlier downloads to expire."
        );
        anyhow::ensure!(
            exports.len() < 32,
            "Too many prepared archives. Wait for an earlier archive to expire and retry."
        );
        exports.insert(
            id.clone(),
            Archive {
                file,
                filename: filename.clone(),
                created: Instant::now(),
            },
        );
        download_url = Some(format!("/api/export/{id}"));
    }
    // First occurrence wins; a lookup table keeps the sort linear in the id count.
    let order: HashMap<&str, usize> = ids
        .iter()
        .enumerate()
        .rev()
        .map(|(index, id)| (id.as_str(), index))
        .collect();
    results.sort_by_key(|r| order.get(r.id.as_str()).copied().unwrap_or(usize::MAX));
    let saved_count = results.iter().filter(|r| r.status != "error").count();
    Ok(
        serde_json::json!({"results":results,"saved_count":saved_count,"requested_count":ids.iter().collect::<HashSet<_>>().len(),
        "download_url":download_url,"filename":filename,"expires_in":900,
        "output_dir":if delivery == "folder" {Some(output_dir.display().to_string())} else {None},"warnings":warnings}),
    )
}

pub(super) async fn archive(State(state): State<AppState>, Path(id): Path<String>) -> Response {
    let exports = state.exports.lock().await;
    let Some(archive) = exports
        .get(&id)
        .filter(|a| a.created.elapsed() < ARCHIVE_TTL)
    else {
        return error_response(
            StatusCode::GONE,
            "This archive has expired. Prepare the download again.",
        );
    };
    let file = match tokio::fs::File::open(archive.file.path()).await {
        Ok(file) => file,
        Err(error) => return error_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    };
    let disposition = format!("attachment; filename=\"{}\"", archive.filename);
    drop(exports);
    let body = stream::try_unfold(file, |mut file| async move {
        let mut buffer = vec![0u8; 64 * 1024];
        let count = file.read(&mut buffer).await?;
        buffer.truncate(count);
        Ok::<_, std::io::Error>(if count == 0 {
            None
        } else {
            Some((buffer, file))
        })
    });
    (
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        Body::from_stream(body),
    )
        .into_response()
}

#[derive(Deserialize)]
pub(super) struct CoverageBody {
    url: String,
    mode: Option<String>,
    #[serde(deserialize_with = "bounded_ids")]
    ids: Vec<String>,
    text: String,
}

fn missing_characters(data: &[u8], text: &str) -> Result<Vec<char>> {
    let face = ttf_parser::Face::parse(data, 0)
        .map_err(|_| anyhow::anyhow!("Could not read this font"))?;
    let mut missing = Vec::new();
    for ch in text.chars().filter(|c| !c.is_control()) {
        if face.glyph_index(ch).is_none() && !missing.contains(&ch) {
            missing.push(ch);
        }
    }
    Ok(missing)
}

pub(super) async fn coverage(
    State(state): State<AppState>,
    Json(body): Json<CoverageBody>,
) -> Response {
    match inspect_coverage(&state, body).await {
        Ok(value) => ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response(),
        Err(error) => error_response(StatusCode::BAD_REQUEST, &format!("{error:#}")),
    }
}

async fn inspect_coverage(state: &AppState, body: CoverageBody) -> Result<serde_json::Value> {
    anyhow::ensure!(
        !body.text.trim().is_empty() && body.text.chars().count() <= 240,
        "Enter between 1 and 240 characters"
    );
    anyhow::ensure!(
        !body.ids.is_empty() && body.ids.len() <= 80,
        "Select between 1 and 80 files to check"
    );
    let mode = parse_mode(body.mode.as_deref());
    let report = report_for(state, &body.url, mode).await?;
    let wanted: HashSet<_> = body.ids.iter().cloned().collect();
    let fonts: Vec<_> = report
        .fonts
        .iter()
        .filter(|f| wanted.contains(&f.id))
        .cloned()
        .collect();
    let cache = tempdir()?;
    let downloads = fetch::download_fonts(
        &fonts,
        &report.page_url,
        cache.path(),
        state.concurrency,
        !matches!(mode, DiscoveryMode::Static),
        state.hosted,
        None,
    )
    .await?;
    let mut results = Vec::new();
    for id in &wanted {
        let font = downloads.cached.iter().find(|f| &f.info.id == id);
        let result = (|| -> Result<Vec<char>> {
            let font = font
                .ok_or_else(|| anyhow::anyhow!("Could not fetch this font. Try scanning again."))?;
            let bytes = std::fs::read(&font.cached_path)?;
            let sfnt = convert::decompress_to_sfnt(&bytes, font.downloaded_format)?;
            missing_characters(&sfnt, &body.text)
        })();
        match result {
            Ok(missing) => {
                results.push(serde_json::json!({"id":id,"missing":missing,"error":null}))
            }
            Err(error) => {
                results.push(serde_json::json!({"id":id,"missing":null,"error":error.to_string()}))
            }
        }
    }
    Ok(serde_json::json!({"text":body.text,"results":results}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn test_state() -> AppState {
        AppState {
            auth: None,
            jobs: jobs::semaphore(),
            webdriver_url: String::new(),
            concurrency: 1,
            hosted: false,
            scans: Arc::new(Mutex::new(HashMap::new())),
            exports: Arc::new(Mutex::new(HashMap::new())),
            uploads: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[tokio::test]
    async fn expired_archive_is_not_served_and_temp_file_is_removed() {
        let state = test_state();
        let file = NamedTempFile::new().unwrap();
        let path = file.path().to_path_buf();
        state.exports.lock().await.insert(
            "expired".into(),
            Archive {
                file,
                filename: "fonts.zip".into(),
                created: Instant::now() - ARCHIVE_TTL,
            },
        );
        assert_eq!(
            archive(State(state.clone()), Path("expired".into()))
                .await
                .status(),
            StatusCode::GONE
        );
        state
            .exports
            .lock()
            .await
            .retain(|_, a| a.created.elapsed() < ARCHIVE_TTL);
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn hosted_export_rejects_folder_and_local_sources() {
        let mut state = test_state();
        state.hosted = true;
        let body: GrabBody = serde_json::from_value(
            serde_json::json!({"url":"http://127.0.0.1/", "ids":["test"],"delivery":"folder"}),
        )
        .unwrap();
        assert!(prepare_export(&state, body)
            .await
            .unwrap_err()
            .to_string()
            .contains("disabled"));
        assert!(
            report_for(&state, "http://127.0.0.1/", DiscoveryMode::Static)
                .await
                .is_err()
        );
    }
    #[test]
    fn coverage_checks_actual_glyphs_and_rejects_corruption() {
        let raw = include_bytes!("../../web/assets/plex-mono-400.woff2");
        let sfnt = convert::decompress_to_sfnt(raw, crate::domain::FontFormat::Woff2).unwrap();
        assert!(missing_characters(&sfnt, "Hello\n").unwrap().is_empty());
        assert_eq!(missing_characters(&sfnt, "ЖяЖ").unwrap(), vec!['Ж', 'я']);
        assert_eq!(missing_characters(&sfnt, "漢漢").unwrap(), vec!['漢']);
        assert!(missing_characters(b"broken", "A").is_err());
        let international = convert::tests::script_fixture(&[&['H', 'e', 'l', 'o', ' ', 'Ж', 'я']]);
        assert!(missing_characters(&international, "Hello Жя")
            .unwrap()
            .is_empty());
    }
}
