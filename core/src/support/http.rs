use anyhow::{ensure, Context, Result};
use reqwest::{
    header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_LANGUAGE, USER_AGENT},
    redirect::Policy,
    Client,
};

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
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        HeaderValue::from_static(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
        ),
    );
    headers.insert(ACCEPT, HeaderValue::from_static("*/*"));
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));

    Client::builder()
        .default_headers(headers)
        .redirect(Policy::limited(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(Into::into)
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
