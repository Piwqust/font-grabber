use anyhow::{ensure, Context, Result};
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, USER_AGENT},
    redirect::Policy,
    Client,
};
use std::{
    net::SocketAddr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
};
static HOSTED: AtomicBool = AtomicBool::new(false);
pub fn hosted() -> bool {
    HOSTED.load(Ordering::Relaxed)
}
pub fn restrict_network() {
    HOSTED.store(true, Ordering::Relaxed);
}

#[derive(Debug)]
struct PublicDns;
impl reqwest::dns::Resolve for PublicDns {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        Box::pin(async move {
            let resolved: Vec<SocketAddr> =
                tokio::net::lookup_host((name.as_str(), 0)).await?.collect();
            if resolved.is_empty()
                || resolved
                    .iter()
                    .any(|addr| super::ssrf::is_blocked_ip(addr.ip()))
            {
                return Err(std::io::Error::other("Private network addresses are blocked").into());
            }
            Ok(Box::new(resolved.into_iter()) as reqwest::dns::Addrs)
        })
    }
}

pub const MAX_FONT_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_DOCUMENT_BYTES: usize = 8 * 1024 * 1024;

/// Enforce the limit on decoded chunks, before allocating the whole response.
/// Content-Length alone cannot protect chunked or compressed downloads.
pub async fn read_limited(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    ensure!(
        response
            .content_length()
            .is_none_or(|size| size <= limit as u64),
        "Response exceeds the {} MiB limit",
        limit / (1024 * 1024)
    );
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .context("Failed to read response body")?
    {
        ensure!(
            chunk.len() <= limit.saturating_sub(bytes.len()),
            "Response exceeds the {} MiB limit",
            limit / (1024 * 1024)
        );
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

pub fn build_http_client() -> Result<Client> {
    // Client clones share the connection pool. Rebuilding per preview opens a
    // new TCP/TLS connection for every face and trips foundry connection limits.
    // Keep the network policies in separate pools so hosted requests can never
    // reuse an unrestricted client created earlier in this process.
    static PUBLIC: OnceLock<Client> = OnceLock::new();
    static LOCAL: OnceLock<Client> = OnceLock::new();
    let restricted = hosted();
    let pool = if restricted { &PUBLIC } else { &LOCAL };
    if let Some(client) = pool.get() {
        return Ok(client.clone());
    }
    let client = client_with_policy(restricted)?;
    let _ = pool.set(client);
    Ok(pool.get().expect("HTTP client was initialized").clone())
}

fn client_with_policy(restricted: bool) -> Result<Client> {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        ),
    );
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));

    let mut builder = Client::builder()
        .default_headers(headers)
        .pool_max_idle_per_host(2)
        .pool_idle_timeout(std::time::Duration::from_secs(60))
        .timeout(std::time::Duration::from_secs(30));
    if restricted {
        builder = builder
            .no_proxy()
            .dns_resolver(Arc::new(PublicDns))
            .redirect(Policy::custom(|attempt| {
                if attempt.previous().len() >= 10
                    || super::ssrf::validate_url_shape(attempt.url()).is_err()
                {
                    attempt.error("Redirect target is blocked")
                } else {
                    attempt.follow()
                }
            }));
    } else {
        builder = builder.redirect(Policy::limited(10));
    }
    builder.build().map_err(Into::into)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::{Body, Bytes},
        routing::get,
        Router,
    };

    #[tokio::test]
    async fn preview_clients_reuse_connections_across_requests() {
        use axum::extract::ConnectInfo;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new().route(
            "/",
            get(|ConnectInfo(peer): ConnectInfo<SocketAddr>| async move { peer.to_string() }),
        );
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            .unwrap();
        });
        let mut peers = std::collections::HashSet::new();
        for _ in 0..8 {
            let response = build_http_client()
                .unwrap()
                .get(format!("http://{address}/"))
                .send()
                .await
                .unwrap();
            peers.insert(response.text().await.unwrap());
        }
        assert_eq!(
            peers.len(),
            1,
            "Repeated client creation must share the pool"
        );
        server.abort();
    }

    #[tokio::test]
    async fn restricted_client_rejects_private_redirects_and_dns() {
        use reqwest::dns::Resolve;
        assert!(PublicDns
            .resolve("localhost".parse().unwrap())
            .await
            .is_err());
        let app = Router::new().route(
            "/redirect",
            get(|| async { axum::response::Redirect::temporary("http://127.0.0.1/private") }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        // Initial literal loopback is a controlled fixture; production callers validate it first.
        let response = client_with_policy(true)
            .unwrap()
            .get(format!("http://{address}/redirect"))
            .send()
            .await;
        assert!(response.is_err());
        server.abort();
    }

    #[tokio::test]
    async fn limits_known_and_chunked_bodies_and_accepts_exact_limit() {
        let app = Router::new()
            .route("/known", get(|| async { "12345678" }))
            .route(
                "/chunks",
                get(|| async {
                    Body::from_stream(futures::stream::iter([
                        Ok::<_, std::convert::Infallible>(Bytes::from_static(b"1234")),
                        Ok(Bytes::from_static(b"5678")),
                    ]))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let client = build_http_client().unwrap();
        for route in ["known", "chunks"] {
            let url = format!("http://{address}/{route}");
            let response = client.get(&url).send().await.unwrap();
            assert!(read_limited(response, 7).await.is_err());
            let response = client.get(&url).send().await.unwrap();
            assert_eq!(read_limited(response, 8).await.unwrap(), b"12345678");
        }
        server.abort();
    }
}
