use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};

use anyhow::{anyhow, Result};
use headless_chrome::{Browser, LaunchOptions};

static CHROME_LOCK: Mutex<()> = Mutex::new(());

/// A cold start takes a few seconds even on a small VPS. Past this the browser
/// is not coming: the library's own wait blocks on Chrome's stderr and, without
/// a fixed port, relaunches up to eleven times, thirty seconds each.
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(20);

/// The browser could not be started at all, as opposed to failing on a page.
/// Discovery treats this as "no browser here" and keeps the static results.
#[derive(Debug)]
pub struct BrowserUnavailable(String);

impl std::fmt::Display for BrowserUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for BrowserUnavailable {}

pub fn with_browser<T>(work: impl FnOnce(&Browser) -> Result<T>) -> Result<T> {
    let _guard = CHROME_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Session { browser, profile } = launch()?;
    // Stop only the child launched for this operation. Cancelling an async
    // future cannot stop the synchronous CDP library or its Chromium process.
    let (done, wait) = std::sync::mpsc::channel::<()>();
    let pid = browser.get_process_id();
    let watchdog = std::thread::spawn(move || {
        if wait.recv_timeout(Duration::from_secs(90)).is_err() {
            if let Some(pid) = pid {
                #[cfg(target_os = "linux")]
                let _ = std::process::Command::new("kill")
                    .args(["-KILL", &pid.to_string()])
                    .status();
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    let _ = std::process::Command::new("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .creation_flags(0x08000000)
                        .status();
                }
            }
        }
    });
    let result = work(&browser);
    let _ = done.send(());
    let _ = watchdog.join();
    drop(browser);
    drop(profile);
    result
}

pub fn protect_tab(tab: &headless_chrome::Tab) -> Result<()> {
    if !super::http::hosted() {
        return Ok(());
    }
    use headless_chrome::{
        browser::tab::RequestPausedDecision,
        protocol::cdp::{
            Fetch::{events::RequestPausedEvent, FailRequest},
            Network::ErrorReason,
        },
    };
    use std::net::ToSocketAddrs;
    tab.enable_request_interception(std::sync::Arc::new(|_, _, event: RequestPausedEvent| {
        let raw = &event.params.request.url;
        let allowed = raw.starts_with("data:")
            || raw.starts_with("blob:")
            || raw == "about:blank"
            || url::Url::parse(raw).ok().is_some_and(|url| {
                super::ssrf::validate_url_shape(&url).is_ok()
                    && (
                        url.host_str().unwrap_or_default(),
                        url.port_or_known_default().unwrap_or(443),
                    )
                        .to_socket_addrs()
                        .is_ok_and(|mut addresses| {
                            let values: Vec<_> = addresses.by_ref().collect();
                            !values.is_empty()
                                && values
                                    .iter()
                                    .all(|addr| !super::ssrf::is_blocked_ip(addr.ip()))
                        })
            });
        if allowed {
            RequestPausedDecision::Continue(None)
        } else {
            RequestPausedDecision::Fail(FailRequest {
                request_id: event.params.request_id,
                error_reason: ErrorReason::BlockedByClient,
            })
        }
    }))?;
    tab.enable_fetch(None, Some(false))?;
    Ok(())
}

struct Session {
    browser: Browser,
    /// Our own profile folder, so a browser that relaunched itself away from
    /// us can still be found by its command line and stopped.
    profile: tempfile::TempDir,
}

/// The browser Fount would start: `CHROME` or `CHROMIUM` when set, otherwise
/// the first Chrome, Chromium or Edge found on this machine.
pub fn browser_path() -> Option<PathBuf> {
    std::env::var_os("CHROME")
        .or_else(|| std::env::var_os("CHROMIUM"))
        .map(PathBuf::from)
        .or_else(find_browser)
}

fn launch() -> Result<Session> {
    let path = browser_path().ok_or_else(|| {
        BrowserUnavailable(
            "No Chrome or Chromium found. Install Chrome or set CHROME to its path.".into(),
        )
    })?;
    let profile = tempfile::Builder::new()
        .prefix("fount-chrome-")
        .tempdir()
        .map_err(|error| {
            BrowserUnavailable(format!("Could not create a Chrome profile: {error}"))
        })?;
    // A fixed port makes the library try once instead of relaunching on failure.
    let port = std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| BrowserUnavailable(format!("No free port for Chrome: {error}")))?;
    let options = LaunchOptions::default_builder()
        .headless(true)
        .sandbox(false)
        .idle_browser_timeout(Duration::from_secs(90))
        .path(Some(path.clone()))
        .port(Some(port))
        .user_data_dir(Some(profile.path().to_path_buf()))
        .build()
        .map_err(|error| anyhow!("Could not build Chrome launch options: {error}"))?;

    // Browser::new can block forever reading Chrome's output, so it runs on a
    // thread that is abandoned, not awaited, when the deadline passes.
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = sender.send(Browser::new(options));
    });
    let browser_name = path.display().to_string();
    match receiver.recv_timeout(LAUNCH_TIMEOUT) {
        Ok(Ok(browser)) => Ok(Session { browser, profile }),
        Ok(Err(error)) => {
            stop_profile_processes(profile.path());
            Err(BrowserUnavailable(format!("Could not start {browser_name}: {error}")).into())
        }
        Err(_) => {
            // Stopping the browser also closes the pipe the thread is reading,
            // which lets it finish.
            stop_profile_processes(profile.path());
            Err(BrowserUnavailable(format!(
                "{browser_name} did not start within {} seconds. Set CHROME to another Chrome or Chromium.",
                LAUNCH_TIMEOUT.as_secs()
            ))
            .into())
        }
    }
}

/// Google Chrome first, by its install location. The library's own search
/// takes the first browser on PATH, and on Windows that can be an Edge Canary
/// whose launcher hands off to a relaunched process and exits, so the DevTools
/// address never reaches us.
fn find_browser() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates = Vec::new();
        for (variable, suffix) in [
            ("ProgramFiles", r"Google\Chrome\Application\chrome.exe"),
            ("ProgramFiles(x86)", r"Google\Chrome\Application\chrome.exe"),
            ("LOCALAPPDATA", r"Google\Chrome\Application\chrome.exe"),
            ("LOCALAPPDATA", r"Chromium\Application\chrome.exe"),
            (
                "ProgramFiles(x86)",
                r"Microsoft\Edge\Application\msedge.exe",
            ),
            ("ProgramFiles", r"Microsoft\Edge\Application\msedge.exe"),
        ] {
            if let Some(root) = std::env::var_os(variable) {
                candidates.push(PathBuf::from(root).join(suffix));
            }
        }
        if let Some(found) = candidates.into_iter().find(|path| path.is_file()) {
            return Some(found);
        }
    }
    headless_chrome::browser::default_executable().ok()
}

/// Stops every process started with this profile, including ones that
/// relaunched themselves and are no longer our children.
fn stop_profile_processes(profile: &Path) {
    let profile = profile.display().to_string();
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let script = format!(
            "Get-CimInstance Win32_Process | Where-Object {{ $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains('{}') }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }}",
            profile.replace('\'', "''")
        );
        let _ = std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x08000000)
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-KILL", "-f", &profile])
            .status();
    }
}
