# Runtime image around a binary built elsewhere (scripts/build-linux-release.sh).
# The 2 GB VPS cannot compile the Chromium bindings, but it can install packages,
# and rebuilding this layer is how Chromium security updates reach production.
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
    chromium ca-certificates fonts-liberation fonts-noto-core curl procps \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin fount
WORKDIR /app
COPY font-grabber /usr/local/bin/font-grabber
# The binary is built on Windows and copied with scp, neither of which keeps
# the execute bit; set it here so a release never depends on a manual chmod.
RUN chmod 0755 /usr/local/bin/font-grabber
ENV CHROME=/usr/bin/chromium HOME=/tmp TMPDIR=/tmp XDG_CACHE_HOME=/tmp/cache XDG_CONFIG_HOME=/tmp/config
USER 10001:10001
EXPOSE 8787
ENTRYPOINT ["/usr/local/bin/font-grabber"]
CMD ["serve", "--host", "0.0.0.0", "--port", "8787", "--no-open", "--hosted", "--concurrency", "1"]
