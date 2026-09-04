FROM rust:1-bookworm AS builder

WORKDIR /build

# The browser discovery module embeds the shared extension scripts at compile time.
COPY core/Cargo.toml core/Cargo.lock core/
COPY core/src core/src
COPY extension/capture.js extension/discover.js extension/

RUN cargo build --release --locked --manifest-path core/Cargo.toml

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        ca-certificates \
        fonts-liberation \
        fonts-noto-core \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin fount

WORKDIR /app
COPY --from=builder /build/core/target/release/font-grabber /usr/local/bin/font-grabber

ENV CHROME=/usr/bin/chromium
ENV HOME=/home/fount

USER fount
EXPOSE 8787

ENTRYPOINT ["/usr/local/bin/font-grabber"]
CMD ["serve", "--host", "0.0.0.0", "--port", "8787", "--no-open", "--hosted"]
