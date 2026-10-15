FROM node:22-bookworm-slim AS ui
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY scripts/build-ui.cjs scripts/
COPY core/src/web core/src/web
COPY extension extension
RUN npm run build:ui

FROM rust:1.94-bookworm AS builder
WORKDIR /build
COPY core/Cargo.toml core/Cargo.lock core/
COPY core/src core/src
COPY extension/capture.js extension/discover.js extension/
COPY --from=ui /build/core/src/web/assets core/src/web/assets
COPY --from=ui /build/core/src/web/style.css core/src/web/style.css
RUN cargo build --release --locked -j 1 --manifest-path core/Cargo.toml

FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium ca-certificates fonts-liberation fonts-noto-core curl procps \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin fount
WORKDIR /app
COPY --from=builder /build/core/target/release/font-grabber /usr/local/bin/font-grabber
ENV CHROME=/usr/bin/chromium HOME=/tmp TMPDIR=/tmp XDG_CACHE_HOME=/tmp/cache XDG_CONFIG_HOME=/tmp/config
USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/font-grabber"]
CMD ["serve", "--host", "0.0.0.0", "--port", "8787", "--no-open", "--hosted", "--concurrency", "1"]
