//! A permit belongs to the actual worker, not to the HTTP client. Disconnects
//! and response deadlines must never allow another expensive worker to overlap.
use super::*;
use axum::{
    body::{Body, Bytes},
    extract::Request,
    middleware::Next,
};
use futures::StreamExt;
use tokio::sync::{mpsc, oneshot, Semaphore};

pub(super) async fn limit(State(state): State<AppState>, request: Request, next: Next) -> Response {
    if !state.hosted {
        return next.run(request).await;
    }
    let Ok(permit) = state.jobs.clone().try_acquire_owned() else {
        let mut response = error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "Fount is working on another request. Try again when it finishes.",
        );
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, "5".parse().unwrap());
        return response;
    };
    let runtime = tokio::runtime::Handle::current();
    let (parts, body) = request.into_parts();
    // Read uploads under a deadline before handing synchronous work to a worker.
    let body_limit = if parts.uri.path() == "/api/metadata/inspect" {
        metadata::INSPECT_BODY_LIMIT
    } else {
        2 * 1024 * 1024
    };
    let bytes = match tokio::time::timeout(
        Duration::from_secs(30),
        axum::body::to_bytes(body, body_limit),
    )
    .await
    {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(_)) => {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "The upload is too large. Choose fewer files.",
            )
        }
        Err(_) => {
            return error_response(
                StatusCode::REQUEST_TIMEOUT,
                "The upload took too long. Try fewer files.",
            )
        }
    };
    let request = Request::from_parts(parts, Body::from(bytes));
    let (reply, receive) = oneshot::channel();
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(4);
    // Conversion and ZIP writing are synchronous. Keep them off Tokio workers.
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        runtime.block_on(async move {
            let (parts, body) = next.run(request).await.into_parts();
            let _ = reply.send(parts);
            let mut stream = body.into_data_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(std::io::Error::other);
                // Bounded buffering, and continue draining the worker on disconnect.
                let _ = tokio::time::timeout(Duration::from_secs(30), tx.send(chunk)).await;
            }
        });
    });
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
    let parts =
        match tokio::time::timeout_at(deadline, receive).await {
            Ok(Ok(parts)) => parts,
            Ok(Err(_)) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Could not finish this request. Try again.",
                )
            }
            Err(_) => return error_response(
                StatusCode::GATEWAY_TIMEOUT,
                "The request took too long. Wait a moment, then try fewer files or a simpler page.",
            ),
        };
    let body = futures::stream::unfold((rx, false), move |(mut rx, ended)| async move {
        if ended {
            return None;
        }
        match tokio::time::timeout_at(deadline, rx.recv()).await {
            Ok(Some(chunk)) => Some((chunk, (rx, false))),
            Ok(None) => None,
            Err(_) => Some((
                Err(std::io::Error::new(
                    std::io::ErrorKind::TimedOut,
                    "Request timed out",
                )),
                (rx, true),
            )),
        }
    });
    Response::from_parts(parts, Body::from_stream(body))
}

pub(super) fn semaphore() -> Arc<Semaphore> {
    Arc::new(Semaphore::new(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tower::ServiceExt;

    #[tokio::test]
    async fn dropped_response_keeps_the_worker_permit_until_the_stream_finishes() {
        let state = AppState {
            auth: None,
            jobs: semaphore(),
            hosted: true,
            concurrency: 1,
            webdriver_url: String::new(),
            scans: Arc::new(Mutex::new(HashMap::new())),
            exports: Arc::new(Mutex::new(HashMap::new())),
            uploads: Arc::new(Mutex::new(HashMap::new())),
        };
        let done = Arc::new(tokio::sync::Notify::new());
        let notify = done.clone();
        let app = Router::new()
            .route(
                "/work",
                get(move || {
                    let notify = notify.clone();
                    async move {
                        Body::from_stream(futures::stream::once(async move {
                            notify.notified().await;
                            Ok::<_, std::io::Error>(Bytes::from_static(b"done"))
                        }))
                    }
                }),
            )
            .route_layer(axum::middleware::from_fn_with_state(state.clone(), limit));
        let response = app
            .clone()
            .oneshot(Request::builder().uri("/work").body(Body::empty()).unwrap())
            .await
            .unwrap();
        drop(response);
        let busy = app
            .clone()
            .oneshot(Request::builder().uri("/work").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(busy.status(), StatusCode::TOO_MANY_REQUESTS);
        done.notify_one();
        let permit = tokio::time::timeout(Duration::from_secs(2), state.jobs.acquire())
            .await
            .unwrap()
            .unwrap();
        drop(permit);
    }
}
