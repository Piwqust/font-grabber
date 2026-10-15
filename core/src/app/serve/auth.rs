use super::*;
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Request},
    http::{HeaderMap, Method},
    middleware::Next,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use std::net::{IpAddr, SocketAddr};
use tokio::sync::Semaphore;

const COOKIE: &str = "__Host-fount_session";
const SESSION_TTL: Duration = Duration::from_secs(12 * 60 * 60);
const ATTEMPT_WINDOW: Duration = Duration::from_secs(15 * 60);
const MAX_CLIENTS: usize = 2048;
const MAX_SESSIONS: usize = 32;

pub(super) struct Auth {
    hash: String,
    origin: String,
    proxy: IpAddr,
    sessions: Mutex<HashMap<[u8; 32], Instant>>,
    attempts: Mutex<HashMap<IpAddr, (Instant, u8)>>,
    verifier: Arc<Semaphore>,
}

impl Auth {
    pub(super) fn load(args: &ServeArgs) -> Result<Option<Arc<Self>>> {
        if !args.hosted {
            return Ok(None);
        }
        let origin = args
            .public_origin
            .as_deref()
            .context("--public-origin is required in hosted mode")?;
        let parsed = url::Url::parse(origin).context("Invalid public origin")?;
        anyhow::ensure!(
            parsed.scheme() == "https"
                && parsed.host_str().is_some()
                && parsed.username().is_empty()
                && parsed.password().is_none()
                && parsed.path() == "/"
                && parsed.query().is_none()
                && parsed.fragment().is_none(),
            "Public origin must be an HTTPS origin without a path or credentials"
        );
        let proxy = args
            .trusted_proxy
            .context("--trusted-proxy is required in hosted mode")?;
        let metadata = std::fs::metadata(&args.password_hash_file)
            .context("Cannot read password hash file")?;
        anyhow::ensure!(
            metadata.is_file() && metadata.len() <= 1024,
            "Invalid password hash file"
        );
        let hash = std::fs::read_to_string(&args.password_hash_file)
            .context("Cannot read password hash file")?;
        Self::from_hash(hash.trim(), parsed.origin().ascii_serialization(), proxy)
            .map(|auth| Some(Arc::new(auth)))
    }

    fn from_hash(hash: &str, origin: String, proxy: IpAddr) -> Result<Self> {
        // Bound verifier memory/time even if an operator accidentally supplies an unsuitable PHC string.
        let parsed = PasswordHash::new(hash)
            .map_err(|_| anyhow::anyhow!("Invalid Argon2id password hash"))?;
        anyhow::ensure!(
            parsed.algorithm.as_str() == "argon2id"
                && parsed.version == Some(19)
                && parsed.salt.is_some_and(|salt| salt.as_str().len() >= 16)
                && parsed.hash.is_some_and(|hash| hash.len() == 32),
            "Invalid Argon2id password hash"
        );
        let m = parsed.params.get_decimal("m").unwrap_or_default();
        let t = parsed.params.get_decimal("t").unwrap_or_default();
        let p = parsed.params.get_decimal("p").unwrap_or_default();
        anyhow::ensure!(
            (19456..=65536).contains(&m) && (2..=4).contains(&t) && p == 1,
            "Use password-hash to generate a hash suitable for this server"
        );
        Ok(Self {
            hash: hash.into(),
            origin,
            proxy,
            sessions: Mutex::new(HashMap::new()),
            attempts: Mutex::new(HashMap::new()),
            verifier: Arc::new(Semaphore::new(1)),
        })
    }

    fn secure_client(&self, headers: &HeaderMap, peer: SocketAddr) -> Option<IpAddr> {
        if peer.ip() != self.proxy || headers.get("x-forwarded-proto")?.to_str().ok()? != "https" {
            return None;
        }
        // Caddy overwrites this header. Never consume arbitrary X-Forwarded-For chains.
        headers
            .get("x-fount-client-ip")?
            .to_str()
            .ok()?
            .parse()
            .ok()
    }

    fn same_origin(&self, headers: &HeaderMap) -> bool {
        headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) == Some(self.origin.as_str())
    }

    async fn valid(&self, headers: &HeaderMap) -> bool {
        self.valid_at(headers, Instant::now()).await
    }

    async fn valid_at(&self, headers: &HeaderMap, now: Instant) -> bool {
        let mut sessions = self.sessions.lock().await;
        sessions.retain(|_, created| now.saturating_duration_since(*created) < SESSION_TTL);
        session_key(headers).is_some_and(|key| sessions.contains_key(&key))
    }
}

/// One IPv6 subscriber usually owns a whole /64, so count attempts per /64.
fn attempt_key(ip: IpAddr) -> IpAddr {
    match ip {
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => IpAddr::V4(v4),
            None => {
                let mut segments = v6.segments();
                segments[4..].fill(0);
                IpAddr::V6(segments.into())
            }
        },
        v4 => v4,
    }
}

fn session_key(headers: &HeaderMap) -> Option<[u8; 32]> {
    for header in headers.get_all(header::COOKIE) {
        let Ok(header) = header.to_str() else {
            continue;
        };
        for part in header.split(';') {
            let Some((name, token)) = part.trim().split_once('=') else {
                continue;
            };
            if name == COOKIE && token.len() == 43 {
                return Some(Sha256::digest(token.as_bytes()).into());
            }
        }
    }
    None
}

fn cookie(token: &str, age: u64) -> String {
    format!("{COOKIE}={token}; Path=/; Max-Age={age}; HttpOnly; Secure; SameSite=Strict")
}

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/api/auth/status", get(status))
        .route(
            "/api/auth/login",
            post(login).layer(DefaultBodyLimit::max(4096)),
        )
        .route("/api/auth/logout", post(logout))
}

pub(super) async fn protect(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if let Some(auth) = &state.auth {
        let peer = request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|p| p.0);
        if peer
            .and_then(|p| auth.secure_client(request.headers(), p))
            .is_none()
        {
            return no_store(error_response(
                StatusCode::FORBIDDEN,
                "Use the secure Fount website.",
            ));
        }
        if !auth.valid(request.headers()).await {
            return no_store(error_response(
                StatusCode::UNAUTHORIZED,
                "Your session ended. Sign in again.",
            ));
        }
        if !matches!(*request.method(), Method::GET | Method::HEAD)
            && !auth.same_origin(request.headers())
        {
            return no_store(error_response(
                StatusCode::FORBIDDEN,
                "Open Fount and try again.",
            ));
        }
    }
    no_store(next.run(request).await)
}

async fn status(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    let authenticated = match &state.auth {
        Some(auth) => auth.secure_client(&headers, peer).is_some() && auth.valid(&headers).await,
        None => true,
    };
    no_store(
        Json(serde_json::json!({"required": state.hosted, "authenticated": authenticated}))
            .into_response(),
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Login {
    password: String,
}

fn limited() -> Response {
    let mut response = error_response(
        StatusCode::TOO_MANY_REQUESTS,
        "Too many sign-in attempts. Try again in 15 minutes.",
    );
    response
        .headers_mut()
        .insert(header::RETRY_AFTER, "900".parse().unwrap());
    no_store(response)
}

async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<Login>,
) -> Response {
    let Some(auth) = state.auth else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(ip) = auth
        .secure_client(&headers, peer)
        .filter(|_| auth.same_origin(&headers))
    else {
        return no_store(error_response(
            StatusCode::FORBIDDEN,
            "Use the secure Fount website.",
        ));
    };
    let key = attempt_key(ip);
    {
        let mut attempts = auth.attempts.lock().await;
        attempts.retain(|_, (created, _)| created.elapsed() < ATTEMPT_WINDOW);
        // Refusing new clients when full would let a flood lock the owner out;
        // forget the oldest client instead. Argon2 and the password length carry the rest.
        if attempts.len() >= MAX_CLIENTS && !attempts.contains_key(&key) {
            if let Some(oldest) = attempts
                .iter()
                .min_by_key(|(_, (created, _))| *created)
                .map(|(ip, _)| *ip)
            {
                attempts.remove(&oldest);
            }
        }
        let attempt = attempts.entry(key).or_insert((Instant::now(), 0));
        if attempt.1 >= 5 {
            return limited();
        }
        // Reserve the attempt before awaiting Argon2, preventing concurrent bypass.
        attempt.1 += 1;
    }
    let Ok(permit) = auth.verifier.clone().try_acquire_owned() else {
        // Nothing was checked, so a double-click must not cost an attempt.
        if let Some(attempt) = auth.attempts.lock().await.get_mut(&key) {
            attempt.1 = attempt.1.saturating_sub(1);
        }
        return no_store(error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "Sign-in is busy. Try again in a moment.",
        ));
    };
    let hash = auth.hash.clone();
    let valid = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        !body.password.is_empty()
            && body.password.len() <= 1024
            && PasswordHash::new(&hash).is_ok_and(|hash| {
                Argon2::default()
                    .verify_password(body.password.as_bytes(), &hash)
                    .is_ok()
            })
    })
    .await
    .unwrap_or(false);
    if !valid {
        return no_store(error_response(
            StatusCode::UNAUTHORIZED,
            "Incorrect password. Try again.",
        ));
    }
    auth.attempts.lock().await.remove(&key);
    let mut bytes = [0u8; 32];
    if OsRng.try_fill_bytes(&mut bytes).is_err() {
        return no_store(error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Could not sign in. Try again.",
        ));
    }
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let key = Sha256::digest(token.as_bytes()).into();
    let mut sessions = auth.sessions.lock().await;
    sessions.retain(|_, created| created.elapsed() < SESSION_TTL);
    if let Some(old) = session_key(&headers) {
        sessions.remove(&old);
    }
    if sessions.len() >= MAX_SESSIONS {
        if let Some(oldest) = sessions
            .iter()
            .min_by_key(|(_, time)| *time)
            .map(|(key, _)| *key)
        {
            sessions.remove(&oldest);
        }
    }
    sessions.insert(key, Instant::now());
    no_store(
        (
            [(header::SET_COOKIE, cookie(&token, SESSION_TTL.as_secs()))],
            Json(serde_json::json!({"authenticated": true})),
        )
            .into_response(),
    )
}

async fn logout(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> Response {
    if let Some(auth) = state.auth {
        if auth.secure_client(&headers, peer).is_none() || !auth.same_origin(&headers) {
            return no_store(error_response(
                StatusCode::FORBIDDEN,
                "Open Fount and try again.",
            ));
        }
        if let Some(key) = session_key(&headers) {
            auth.sessions.lock().await.remove(&key);
        }
    }
    no_store(
        (
            [(header::SET_COOKIE, cookie("", 0))],
            StatusCode::NO_CONTENT,
        )
            .into_response(),
    )
}

pub(crate) fn password_hash() -> Result<()> {
    let password = dialoguer::Password::new()
        .with_prompt("New Fount password (at least 16 characters)")
        .with_confirmation("Repeat password", "Passwords do not match")
        .validate_with(|value: &String| -> Result<(), &str> {
            if value.chars().count() >= 16 && value.len() <= 1024 && value.trim().len() >= 16 {
                Ok(())
            } else {
                Err("Use 16 or more characters, up to 1024 bytes")
            }
        })
        .interact()?;
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|_| anyhow::anyhow!("Could not generate password hash"))?;
    println!("{hash}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::{to_bytes, Body};
    use tower::ServiceExt;
    const PASSWORD: &str = "test-only-long-password-123!";
    const ORIGIN: &str = "https://fount.example.com";

    fn hash() -> String {
        static HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        HASH.get_or_init(|| {
            Argon2::default()
                .hash_password(PASSWORD.as_bytes(), &SaltString::generate(&mut OsRng))
                .unwrap()
                .to_string()
        })
        .clone()
    }
    fn state() -> AppState {
        AppState {
            auth: Some(Arc::new(
                Auth::from_hash(&hash(), ORIGIN.into(), "127.0.0.1".parse().unwrap()).unwrap(),
            )),
            jobs: jobs::semaphore(),
            hosted: true,
            webdriver_url: String::new(),
            concurrency: 1,
            scans: Arc::new(Mutex::new(HashMap::new())),
            uploads: Arc::new(Mutex::new(HashMap::new())),
            exports: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    fn request(
        method: Method,
        path: &str,
        body: serde_json::Value,
        cookie: Option<&str>,
    ) -> Request {
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .extension(ConnectInfo(
                "127.0.0.1:12345".parse::<SocketAddr>().unwrap(),
            ))
            .header(header::ORIGIN, ORIGIN)
            .header("x-forwarded-proto", "https")
            .header("x-fount-client-ip", "203.0.113.10")
            .header(header::CONTENT_TYPE, "application/json");
        if let Some(value) = cookie {
            builder = builder.header(header::COOKIE, value);
        }
        builder.body(Body::from(body.to_string())).unwrap()
    }
    async fn sign_in(app: Router) -> String {
        let response = app
            .oneshot(request(
                Method::POST,
                "/api/auth/login",
                serde_json::json!({"password": PASSWORD}),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let cookie = response.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .to_owned();
        assert!(
            cookie.contains("HttpOnly")
                && cookie.contains("Secure")
                && cookie.contains("SameSite=Strict")
                && cookie.contains("Max-Age=43200")
                && cookie.contains("Path=/")
        );
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        cookie.split(';').next().unwrap().to_owned()
    }

    #[tokio::test]
    async fn all_apis_require_a_session_before_reading_request_bodies() {
        let app = router(state());
        for (method, path) in [
            (Method::POST, "/api/scan"),
            (Method::POST, "/api/grab"),
            (Method::POST, "/api/export"),
            (Method::POST, "/api/coverage"),
            (Method::POST, "/api/metadata/inspect"),
            (Method::POST, "/api/metadata/apply"),
            (Method::GET, "/api/export/guessed"),
            (Method::GET, "/api/font?url=https://example.com/font.woff2"),
        ] {
            let response = app
                .clone()
                .oneshot(request(method, path, serde_json::json!({}), None))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        }
        let response = app
            .oneshot(request(
                Method::GET,
                "/healthz",
                serde_json::Value::Null,
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn login_expiry_logout_restart_and_csrf() {
        let state = state();
        let app = router(state.clone());
        let cookie = sign_in(app.clone()).await;
        let response = app
            .clone()
            .oneshot(request(
                Method::GET,
                "/api/auth/status",
                serde_json::Value::Null,
                Some(&cookie),
            ))
            .await
            .unwrap();
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert_eq!(body["authenticated"], true);
        let mut foreign = request(
            Method::POST,
            "/api/auth/logout",
            serde_json::Value::Null,
            Some(&cookie),
        );
        foreign
            .headers_mut()
            .insert(header::ORIGIN, "https://attacker.example".parse().unwrap());
        assert_eq!(
            app.clone().oneshot(foreign).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        let response = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/api/scan",
                serde_json::json!({"url":"http://127.0.0.1/"}),
                Some(&cookie),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let logout = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/api/auth/logout",
                serde_json::Value::Null,
                Some(&cookie),
            ))
            .await
            .unwrap();
        assert!(logout.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("Max-Age=0"));
        assert_eq!(
            app.clone()
                .oneshot(request(
                    Method::GET,
                    "/api/export/x",
                    serde_json::Value::Null,
                    Some(&cookie)
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let cookie = sign_in(app.clone()).await;
        let mut headers = HeaderMap::new();
        headers.insert(header::COOKIE, cookie.parse().unwrap());
        assert!(
            !state
                .auth
                .as_ref()
                .unwrap()
                .valid_at(&headers, Instant::now() + SESSION_TTL)
                .await
        );
        assert_eq!(
            app.clone()
                .oneshot(request(
                    Method::GET,
                    "/api/export/x",
                    serde_json::Value::Null,
                    Some(&cookie)
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let cookie = sign_in(app.clone()).await;
        let restarted = router(self::state());
        assert_eq!(
            restarted
                .oneshot(request(
                    Method::GET,
                    "/api/export/x",
                    serde_json::Value::Null,
                    Some(&cookie)
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn attempts_are_bounded_and_forwarding_headers_cannot_bypass_them() {
        let state = state();
        let app = router(state.clone());
        for i in 0..5 {
            let mut req = request(
                Method::POST,
                "/api/auth/login",
                serde_json::json!({"password":"wrong"}),
                None,
            );
            req.headers_mut()
                .insert("x-forwarded-for", format!("1.2.3.{i}").parse().unwrap());
            assert_eq!(
                app.clone().oneshot(req).await.unwrap().status(),
                StatusCode::UNAUTHORIZED
            );
        }
        let response = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/api/auth/login",
                serde_json::json!({"password":PASSWORD}),
                None,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(response.headers()[header::RETRY_AFTER], "900");
        state.auth.as_ref().unwrap().attempts.lock().await.clear();
        let mut req = request(
            Method::POST,
            "/api/auth/login",
            serde_json::json!({"password":PASSWORD}),
            None,
        );
        req.extensions_mut()
            .insert(ConnectInfo("10.0.0.9:1234".parse::<SocketAddr>().unwrap()));
        assert_eq!(
            app.clone().oneshot(req).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
        let mut req = request(
            Method::POST,
            "/api/auth/login",
            serde_json::json!({"password":PASSWORD}),
            None,
        );
        req.headers_mut()
            .insert("x-forwarded-proto", "http".parse().unwrap());
        assert_eq!(
            app.oneshot(req).await.unwrap().status(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn missing_empty_or_invalid_secret_fails_closed() {
        use clap::Parser;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("hash");
        let cli = crate::cli::Cli::parse_from([
            "fount",
            "serve",
            "--hosted",
            "--public-origin",
            ORIGIN,
            "--trusted-proxy",
            "127.0.0.1",
            "--password-hash-file",
            path.to_str().unwrap(),
        ]);
        let crate::cli::Commands::Serve(args) = cli.command else {
            panic!()
        };
        assert!(Auth::load(&args).is_err());
        for value in ["", "password", "$argon2id$v=19$m=1,t=1,p=1$bad$bad"] {
            std::fs::write(&path, value).unwrap();
            assert!(Auth::load(&args).is_err());
        }
        std::fs::write(path, hash()).unwrap();
        assert!(Auth::load(&args).unwrap().is_some());
    }

    #[tokio::test]
    async fn authenticated_metadata_creates_a_real_archive_and_folder_stays_blocked() {
        use base64::engine::general_purpose::STANDARD;
        let app = router(state());
        let cookie = sign_in(app.clone()).await;
        let inspect = serde_json::json!({"source":{"kind":"upload","files":[{"name":"test.woff2",
            "data":STANDARD.encode(include_bytes!("../../web/assets/geist-400.woff2"))}]}});
        let response = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/api/metadata/inspect",
                inspect,
                Some(&cookie),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let data: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1_000_000).await.unwrap())
                .unwrap();
        // The body is drained before the next job starts.
        tokio::task::yield_now().await;
        let body = serde_json::json!({"source":{"kind":"upload","upload_id":data["upload_id"]},"delivery":"zip",
            "fonts":[{"id":"upload:0","names":{"family":"Hosted Test"}}]});
        let response = app
            .clone()
            .oneshot(request(
                Method::POST,
                "/api/metadata/apply",
                body.clone(),
                Some(&cookie),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let data: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1_000_000).await.unwrap())
                .unwrap();
        let url = data["download_url"].as_str().unwrap();
        let response = app
            .clone()
            .oneshot(request(
                Method::GET,
                url,
                serde_json::Value::Null,
                Some(&cookie),
            ))
            .await
            .unwrap();
        let bytes = to_bytes(response.into_body(), 1_000_000).await.unwrap();
        let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut zip.by_index(0).unwrap(), &mut bytes).unwrap();
        assert_eq!(
            convert::inspect_names(&bytes).unwrap().family.as_deref(),
            Some("Hosted Test")
        );
        let mut folder = body;
        folder["delivery"] = "folder".into();
        assert_eq!(
            app.oneshot(request(
                Method::POST,
                "/api/metadata/apply",
                folder,
                Some(&cookie)
            ))
            .await
            .unwrap()
            .status(),
            StatusCode::BAD_REQUEST
        );
    }
}
