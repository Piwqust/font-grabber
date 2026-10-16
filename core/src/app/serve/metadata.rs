use super::*;
use crate::domain::{CachedFont, FontFormat, ScanSource, TransferMethod};
use axum::extract::DefaultBodyLimit;
use base64::{engine::general_purpose::STANDARD, Engine};
use workflow::FileResult;

const MAX_FILES: usize = 16;
const MAX_FILE_BYTES: usize = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024;
const UPLOAD_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_SESSIONS: usize = 32;
/// Base64 inflates uploads by 4/3; the rest is JSON framing and file names.
pub(super) const INSPECT_BODY_LIMIT: usize = MAX_TOTAL_BYTES * 4 / 3 + 1024 * 1024;

#[derive(Clone)]
pub(super) struct Upload {
    // Keep the directory alive through concurrent applies and TTL cleanup.
    directory: Arc<tempfile::TempDir>,
    fonts: Vec<CachedFont>,
    filenames: HashMap<String, String>,
    created: Instant,
}

pub(super) fn start_cleanup(uploads: Arc<Mutex<HashMap<String, Upload>>>) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            uploads
                .lock()
                .await
                .retain(|_, u| u.created.elapsed() < UPLOAD_TTL);
        }
    });
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route(
            "/api/metadata/inspect",
            post(inspect).layer(DefaultBodyLimit::max(INSPECT_BODY_LIMIT)),
        )
        .route("/api/metadata/apply", post(apply))
}

#[derive(Deserialize)]
struct UploadFile {
    name: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum InspectSource {
    Scan {
        url: String,
        mode: Option<String>,
        #[serde(deserialize_with = "bounded_ids")]
        ids: Vec<String>,
    },
    Upload {
        // Generous enough that validate_uploads still reports the friendly limit.
        #[serde(deserialize_with = "bounded_files")]
        files: Vec<UploadFile>,
    },
}

fn bounded_files<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Vec<UploadFile>, D::Error> {
    bounded_vec(deserializer, MAX_FILES * 4)
}

#[derive(Deserialize)]
struct InspectBody {
    source: InspectSource,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ApplySource {
    Scan { url: String, mode: Option<String> },
    Upload { upload_id: String },
}

#[derive(Deserialize)]
struct Edit {
    id: String,
    names: convert::NameSet,
    filename: Option<String>,
}

#[derive(Deserialize)]
struct ApplyBody {
    source: ApplySource,
    delivery: Option<String>,
    output_dir: Option<String>,
    #[serde(deserialize_with = "bounded_edits")]
    fonts: Vec<Edit>,
}

fn bounded_edits<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Vec<Edit>, D::Error> {
    bounded_vec(deserializer, MAX_IDS)
}

fn response(result: Result<serde_json::Value>) -> Response {
    match result {
        Ok(value) => ([(header::CACHE_CONTROL, "no-store")], Json(value)).into_response(),
        Err(error) => error_response(StatusCode::BAD_REQUEST, &format!("{error:#}")),
    }
}

async fn inspect(State(state): State<AppState>, Json(body): Json<InspectBody>) -> Response {
    response(inspect_request(&state, body).await)
}

fn validate_uploads(files: &[UploadFile]) -> Result<Vec<Vec<u8>>> {
    anyhow::ensure!(
        !files.is_empty() && files.len() <= MAX_FILES,
        "Upload between 1 and 16 files"
    );
    let mut total = 0usize;
    let mut decoded = Vec::with_capacity(files.len());
    for file in files {
        anyhow::ensure!(file.name.len() <= 1024, "File name is too long");
        anyhow::ensure!(
            file.data.len() <= MAX_FILE_BYTES.div_ceil(3) * 4,
            "Each file must be at most 20 MB"
        );
        let bytes = STANDARD
            .decode(&file.data)
            .context("Invalid base64 font data")?;
        total += bytes.len();
        validate_sizes(bytes.len(), total)?;
        anyhow::ensure!(
            FontFormat::sniff(&bytes) != FontFormat::Unknown,
            "Only TTF, OTF, WOFF and WOFF2 files are supported"
        );
        decoded.push(bytes);
    }
    Ok(decoded)
}

fn validate_sizes(file: usize, total: usize) -> Result<()> {
    anyhow::ensure!(file <= MAX_FILE_BYTES, "Each file must be at most 20 MB");
    anyhow::ensure!(total <= MAX_TOTAL_BYTES, "Uploads must total at most 64 MB");
    Ok(())
}

async fn scan_fonts(
    state: &AppState,
    url: &str,
    mode: Option<&str>,
    ids: &[String],
) -> Result<(Upload, Vec<serde_json::Value>, Vec<String>)> {
    let ids = unique_ids(ids, state.hosted)?;
    let wanted: HashSet<&str> = ids.iter().map(String::as_str).collect();
    let mode = parse_mode(mode);
    let report = workflow::report_for(state, url, mode).await?;
    let selected: Vec<_> = report
        .fonts
        .iter()
        .filter(|f| wanted.contains(f.id.as_str()))
        .cloned()
        .collect();
    let found: HashSet<&str> = selected.iter().map(|f| f.id.as_str()).collect();
    let directory = Arc::new(tempdir()?);
    let downloads = fetch::download_fonts(
        &selected,
        &report.page_url,
        directory.path(),
        state.concurrency,
        !matches!(mode, DiscoveryMode::Static),
        state.hosted,
        None,
    )
    .await?;
    let mut failures: Vec<_> = downloads
        .failure_details
        .into_iter()
        .map(|(id, error)| serde_json::json!({"id":id,"error":error}))
        .collect();
    for id in &ids {
        if !found.contains(id.as_str()) {
            failures.push(serde_json::json!({"id":id,"error":"This file is no longer in the collection. Scan again."}));
        }
    }
    let filenames = downloads
        .cached
        .iter()
        .map(|f| {
            let name = url::Url::parse(&f.source_url)
                .ok()
                .and_then(|url| url.path_segments()?.next_back().map(str::to_owned))
                .filter(|v| !v.is_empty())
                .unwrap_or_else(|| {
                    format!("{}.{}", f.info.family, f.downloaded_format.extension())
                });
            (f.info.id.clone(), name)
        })
        .collect();
    Ok((
        Upload {
            directory,
            fonts: downloads.cached,
            filenames,
            created: Instant::now(),
        },
        failures,
        report.warnings,
    ))
}

async fn inspect_request(state: &AppState, body: InspectBody) -> Result<serde_json::Value> {
    let (mut upload, mut failures, is_upload) = match body.source {
        InspectSource::Scan { url, mode, ids } => {
            let (upload, failures, _) = scan_fonts(state, &url, mode.as_deref(), &ids).await?;
            (upload, failures, false)
        }
        InspectSource::Upload { files } => {
            let bytes = validate_uploads(&files)?;
            let directory = Arc::new(
                tempfile::Builder::new()
                    .prefix("fount-upload-")
                    .rand_bytes(24)
                    .tempdir()?,
            );
            let mut fonts = Vec::new();
            let mut filenames = HashMap::new();
            for (index, (file, bytes)) in files.into_iter().zip(bytes).enumerate() {
                let id = format!("upload:{index}");
                let cached_path = directory.path().join(index.to_string());
                std::fs::write(&cached_path, &bytes)?;
                filenames.insert(id.clone(), file.name.clone());
                fonts.push(CachedFont {
                    info: FontCandidate {
                        id,
                        family: file.name,
                        style: "normal".into(),
                        weight: "400".into(),
                        stretch: None,
                        sources: vec![],
                        unicode_range: None,
                        scripts: vec![],
                        variable: false,
                        scan_source: ScanSource::StaticCss,
                        parts: Vec::new(),
                        css_family: None,
                    },
                    cached_path,
                    downloaded_format: FontFormat::sniff(&bytes),
                    source_url: String::new(),
                    transfer_method: TransferMethod::Http,
                    parts: Vec::new(),
                });
            }
            (
                Upload {
                    directory,
                    fonts,
                    filenames,
                    created: Instant::now(),
                },
                vec![],
                true,
            )
        }
    };
    let mut fonts = Vec::new();
    let mut valid = Vec::new();
    for font in &upload.fonts {
        let inspected = (|| -> Result<serde_json::Value> {
            let bytes = std::fs::read(&font.cached_path)?;
            let mut names = convert::inspect_names(&bytes)?;
            // A scanned file with its names scrubbed is named by the scan,
            // which read the name off the file's address.
            if !is_upload {
                if names.family.is_none() {
                    names.family = Some(font.info.family.clone());
                }
                if names.subfamily.is_none() {
                    names.subfamily = Some(convert::subfamily_from_weight_style(
                        &font.info.weight,
                        &font.info.style,
                    ));
                }
            }
            let sfnt = convert::decompress_to_sfnt(&bytes, font.downloaded_format)?;
            let face = ttf_parser::Face::parse(&sfnt, 0).context("Could not parse font")?;
            let axes: Vec<_> = face.variation_axes().into_iter().map(|axis| serde_json::json!({
                "tag":axis.tag.to_string(), "name":axis.tag.to_string(), "min":axis.min_value,"default":axis.def_value,"max":axis.max_value
            })).collect();
            Ok(
                serde_json::json!({"id":font.info.id,"file":upload.filenames[&font.info.id],
                "format":font.downloaded_format.extension(),"variable":face.is_variable(),"axes":axes,"names":names}),
            )
        })();
        match inspected {
            Ok(value) => {
                fonts.push(value);
                valid.push(font.clone());
            }
            Err(error) => {
                if is_upload {
                    // Unreadable uploads would otherwise sit in tmpfs, uncounted, until the TTL.
                    let _ = std::fs::remove_file(&font.cached_path);
                }
                failures.push(serde_json::json!({"id":font.info.id,"error":format!("{error:#}")}))
            }
        }
    }
    let mut result = serde_json::json!({"fonts":fonts,"failures":failures});
    if is_upload && !valid.is_empty() {
        upload.fonts = valid;
        let id = upload
            .directory
            .path()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let mut uploads = state.uploads.lock().await;
        uploads.retain(|_, u| u.created.elapsed() < UPLOAD_TTL);
        let bytes = |u: &Upload| -> u64 {
            u.fonts
                .iter()
                .filter_map(|f| std::fs::metadata(&f.cached_path).ok())
                .map(|m| m.len())
                .sum()
        };
        let retained_bytes: u64 = uploads.values().map(bytes).sum();
        anyhow::ensure!(
            !state.hosted || retained_bytes + bytes(&upload) <= 128 * 1024 * 1024,
            "Temporary upload space is full. Wait for earlier uploads to expire."
        );
        anyhow::ensure!(
            uploads.len() < MAX_SESSIONS,
            "Too many upload sessions. Wait for an earlier session to expire."
        );
        uploads.insert(id.clone(), upload);
        result["upload_id"] = id.into();
    }
    Ok(result)
}

async fn apply(State(state): State<AppState>, Json(body): Json<ApplyBody>) -> Response {
    response(apply_request(&state, body).await)
}

fn validate_names(names: &convert::NameSet) -> Result<()> {
    for value in names.changes().values() {
        anyhow::ensure!(
            value.len() <= 16 * 1024 && !value.contains('\0'),
            "Metadata field is too long or contains a NUL character"
        );
    }
    for value in [&names.vendor_url, &names.designer_url, &names.license_url]
        .into_iter()
        .flatten()
        .filter(|v| !v.is_empty())
    {
        let url = url::Url::parse(value).context("Enter a valid HTTP or HTTPS URL")?;
        anyhow::ensure!(
            matches!(url.scheme(), "http" | "https") && url.host_str().is_some(),
            "Enter a valid HTTP or HTTPS URL"
        );
    }
    if let Some(value) = names.version.as_deref().filter(|v| !v.is_empty()) {
        convert::normalize_version(value)?;
    }
    if let Some(value) = &names.postscript {
        anyhow::ensure!(value.len() <= 63 && value.bytes().all(|b| (33..=126).contains(&b) && !b"[](){}<>/%".contains(&b)),
            "PostScript name must be at most 63 printable ASCII characters without spaces or delimiters");
    }
    Ok(())
}

async fn apply_request(state: &AppState, body: ApplyBody) -> Result<serde_json::Value> {
    anyhow::ensure!(!body.fonts.is_empty(), "No fonts were selected");
    let delivery = body.delivery.as_deref().unwrap_or("zip");
    anyhow::ensure!(
        matches!(delivery, "zip" | "folder"),
        "Unknown delivery method"
    );
    anyhow::ensure!(
        !(state.hosted && delivery == "folder"),
        "Folder delivery is disabled in hosted mode"
    );
    let ids: Vec<_> = body.fonts.iter().map(|f| f.id.clone()).collect();
    anyhow::ensure!(
        ids.iter().collect::<HashSet<_>>().len() == ids.len(),
        "Duplicate font IDs"
    );
    unique_ids(&ids, state.hosted)?;
    for edit in &body.fonts {
        validate_names(&edit.names)?;
    }
    let (upload, failures, warnings, source_url) = match body.source {
        ApplySource::Scan { url, mode } => {
            let (upload, failures, warnings) =
                scan_fonts(state, &url, mode.as_deref(), &ids).await?;
            (upload, failures, warnings, url)
        }
        ApplySource::Upload { upload_id } => {
            let upload = state
                .uploads
                .lock()
                .await
                .get(&upload_id)
                .filter(|u| u.created.elapsed() < UPLOAD_TTL)
                .cloned()
                .ok_or_else(|| {
                    anyhow::anyhow!("This upload has expired. Upload the files again.")
                })?;
            (upload, vec![], vec![], "https://metadata.local/".into())
        }
    };
    let mut results: Vec<_> = failures
        .into_iter()
        .map(|f| {
            FileResult::failed(
                f["id"].as_str().unwrap_or_default().into(),
                String::new(),
                "download",
                f["error"].as_str().unwrap_or_default().into(),
            )
        })
        .collect();
    let mut drafts = HashMap::new();
    let mut selected = Vec::new();
    for edit in body.fonts {
        let Some(font) = upload.fonts.iter().find(|f| f.info.id == edit.id) else {
            if !results.iter().any(|r| r.id == edit.id) {
                results.push(FileResult::failed(
                    edit.id,
                    String::new(),
                    "download",
                    "This file is not in the upload session".into(),
                ));
            }
            continue;
        };
        let original = match std::fs::read(&font.cached_path)
            .map_err(anyhow::Error::from)
            .and_then(|bytes| convert::inspect_names(&bytes))
        {
            Ok(names) => names,
            Err(error) => {
                results.push(FileResult::failed(
                    edit.id,
                    font.info.family.clone(),
                    "conversion",
                    format!("{error:#}"),
                ));
                continue;
            }
        };
        drafts.insert(
            edit.id,
            NameDraft {
                family: edit
                    .names
                    .family
                    .clone()
                    .or(original.family)
                    .unwrap_or_else(|| "Font".into()),
                subfamily: edit
                    .names
                    .subfamily
                    .clone()
                    .or(original.subfamily)
                    .unwrap_or_else(|| "Regular".into()),
                filename: edit.filename,
                name_changes: Some(edit.names.changes()),
                ..NameDraft::default()
            },
        );
        selected.push(font.clone());
    }
    let conversion = convert::convert_fonts(&selected, Some(&drafts), None)?;
    for (id, error) in conversion.failure_details {
        results.push(FileResult::failed(id, String::new(), "conversion", error));
    }
    let output_dir = body
        .output_dir
        .filter(|v| !v.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_output_dir(&source_url));
    workflow::deliver(
        state,
        &ids,
        &conversion.converted,
        results,
        delivery,
        output_dir,
        "fount-metadata.zip".into(),
        warnings,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> AppState {
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

    fn upload_body() -> serde_json::Value {
        serde_json::json!({"source":{"kind":"upload","files":[{"name":"geist-400.woff2",
            "data":STANDARD.encode(include_bytes!("../../web/assets/geist-400.woff2"))}]}})
    }

    #[test]
    fn upload_byte_limits_and_magic_are_enforced() {
        assert!(validate_sizes(MAX_FILE_BYTES, MAX_TOTAL_BYTES).is_ok());
        assert!(validate_sizes(MAX_FILE_BYTES + 1, MAX_FILE_BYTES + 1).is_err());
        assert!(validate_sizes(1, MAX_TOTAL_BYTES + 1).is_err());
        assert!(validate_uploads(&[]).is_err());
        assert!(validate_uploads(&[UploadFile {
            name: "fake.ttf".into(),
            data: STANDARD.encode(b"not a font")
        }])
        .is_err());
        assert!(validate_uploads(&[UploadFile {
            name: "font.ttf".into(),
            data: "!".into()
        }])
        .is_err());
        let oversized = UploadFile {
            name: "large.ttf".into(),
            data: "A".repeat(MAX_FILE_BYTES.div_ceil(3) * 4 + 1),
        };
        assert!(validate_uploads(&[oversized])
            .unwrap_err()
            .to_string()
            .contains("20 MB"));
    }

    #[tokio::test]
    async fn axum_rejects_upload_count_and_round_trips_metadata_zip() {
        let state = state();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = routes()
            .route("/api/scan", post(scan))
            .route("/fixture", get(|| async { Html("<style>@font-face{font-family:Geist;src:url('/fixture.woff2') format('woff2');font-weight:400}</style>") }))
            .route("/fixture.woff2", get(|| async { ([(header::CONTENT_TYPE, "font/woff2")], include_bytes!("../../web/assets/geist-400.woff2").as_slice()) }))
            .route("/api/export/:id", get(workflow::archive))
            .with_state(state.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        struct Stop(tokio::task::JoinHandle<()>);
        impl Drop for Stop {
            fn drop(&mut self) {
                self.0.abort();
            }
        }
        let _stop = Stop(server);
        let client = reqwest::Client::new();
        let url = format!("http://{address}");
        let too_many = serde_json::json!({"source":{"kind":"upload","files":vec![serde_json::json!({"name":"a.ttf","data":""});17]}});
        let rejected = client
            .post(format!("{url}/api/metadata/inspect"))
            .json(&too_many)
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), StatusCode::BAD_REQUEST);
        assert!(rejected.text().await.unwrap().contains("16 files"));
        let inspected: serde_json::Value = client
            .post(format!("{url}/api/metadata/inspect"))
            .json(&upload_body())
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(inspected["fonts"][0]["format"], "woff2");
        assert_eq!(inspected["failures"].as_array().unwrap().len(), 0);
        let request = serde_json::json!({"source":{"kind":"upload","upload_id":inspected["upload_id"]},"delivery":"zip",
            "fonts":[{"id":"upload:0","names":{"family":"Fount Geist","full_name":"Fount Geist Regular","postscript":"FountGeist-Regular",
                "manufacturer":"Fount Studio","version":"2.5","license":""},"filename":"FountGeist-Regular"}]});
        let applied: serde_json::Value = client
            .post(format!("{url}/api/metadata/apply"))
            .json(&request)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(applied["saved_count"], 1);
        for key in [
            "results",
            "requested_count",
            "download_url",
            "filename",
            "expires_in",
            "output_dir",
            "warnings",
        ] {
            assert!(applied.get(key).is_some(), "{key}");
        }
        let bytes = client
            .get(format!(
                "{url}{}",
                applied["download_url"].as_str().unwrap()
            ))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let actual_file = applied["results"][0]["file"].as_str().unwrap();
        assert!(
            actual_file == "FountGeist-Regular.ttf" || actual_file == "FountGeist-Regular.otf",
            "Unexpected file: {actual_file}"
        );
        let mut font = archive.by_name(actual_file).unwrap();
        let mut data = Vec::new();
        std::io::Read::read_to_end(&mut font, &mut data).unwrap();
        let names = convert::inspect_names(&data).unwrap();
        assert_eq!(names.family.as_deref(), Some("Fount Geist"));
        assert_eq!(names.manufacturer.as_deref(), Some("Fount Studio"));
        assert_eq!(names.version.as_deref(), Some("Version 2.500"));
        assert_eq!(names.license, None);

        let scan_url = format!("{url}/fixture");
        let scan_report: serde_json::Value = client
            .post(format!("{url}/api/scan"))
            .json(&serde_json::json!({"url":scan_url,"mode":"static"}))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        let id = scan_report["fonts"][0]["id"]
            .as_str()
            .expect("Scan must discover the fixture");
        let inspected: serde_json::Value = client.post(format!("{url}/api/metadata/inspect"))
            .json(&serde_json::json!({"source":{"kind":"scan","url":scan_url,"mode":"static","ids":[id]}}))
            .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
        assert_eq!(inspected["fonts"][0]["names"]["family"], "Geist");
        assert!(inspected.get("upload_id").is_none());
        let applied: serde_json::Value = client.post(format!("{url}/api/metadata/apply"))
            .json(&serde_json::json!({"source":{"kind":"scan","url":scan_url,"mode":"static"},"delivery":"zip",
                "fonts":[{"id":id,"names":{"manufacturer":"Scan Studio"}},{"id":"missing","names":{}}]}))
            .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
        assert_eq!(applied["saved_count"], 1);
        assert_eq!(applied["requested_count"], 2);
        assert_eq!(applied["results"][1]["status"], "error");
    }

    #[tokio::test]
    async fn hosted_checks_and_expired_sessions() {
        let mut state = state();
        state.hosted = true;
        let inspect: InspectBody = serde_json::from_value(upload_body()).unwrap();
        let value = inspect_request(&state, inspect).await.unwrap();
        let id = value["upload_id"].as_str().unwrap();
        let request = |source, delivery| {
            serde_json::from_value(serde_json::json!({"source":source,"delivery":delivery,"fonts":[{"id":"upload:0","names":{}}]})).unwrap()
        };
        let source = serde_json::json!({"kind":"upload","upload_id":id});
        assert!(apply_request(&state, request(source.clone(), "folder"))
            .await
            .unwrap_err()
            .to_string()
            .contains("disabled"));
        assert!(apply_request(
            &state,
            request(
                serde_json::json!({"kind":"scan","url":"http://127.0.0.1/","mode":"static"}),
                "zip"
            )
        )
        .await
        .is_err());
        state.uploads.lock().await.get_mut(id).unwrap().created = Instant::now() - UPLOAD_TTL;
        assert!(apply_request(&state, request(source, "zip"))
            .await
            .unwrap_err()
            .to_string()
            .contains("expired"));
    }
}
