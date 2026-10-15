use std::{path::PathBuf, sync::Mutex, time::Duration};

use anyhow::{anyhow, Context, Result};
use headless_chrome::{Browser, LaunchOptions};

static CHROME_LOCK: Mutex<()> = Mutex::new(());

pub fn with_browser<T>(work: impl FnOnce(&Browser) -> Result<T>) -> Result<T> {
    let _guard = CHROME_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let browser = launch()?;
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

pub fn launch() -> Result<Browser> {
    let path = std::env::var_os("CHROME")
        .or_else(|| std::env::var_os("CHROMIUM"))
        .map(PathBuf::from);
    let options = LaunchOptions::default_builder()
        .headless(true)
        .sandbox(false)
        .idle_browser_timeout(Duration::from_secs(90))
        .path(path)
        .build()
        .map_err(|error| anyhow!("Could not build Chrome launch options: {error}"))?;
    Browser::new(options)
        .context("Could not launch headless Chrome (is Chrome/Chromium installed?)")
}
