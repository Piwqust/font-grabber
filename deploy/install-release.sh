#!/usr/bin/env bash
# Installs a release prepared by scripts/build-linux-release.cjs on the shared VPS
# (existing system Caddy). Only Fount's app container changes; on any failure the
# previous image, .env and sources come back.
#   sudo bash install-release.sh            run from the unpacked release folder
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  printf '%s\n' 'Run with sudo.' >&2
  exit 1
fi

release_dir=$(cd "$(dirname "$0")" && pwd)
project_dir=/opt/fount
env_file=$project_dir/deploy/.env
compose=(docker compose --env-file "$env_file" -f "$project_dir/deploy/compose.existing-caddy.yaml")

cd "$release_dir"
sha256sum --check --quiet SHA256SUMS
version=$(cat VERSION)
[[ "$version" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$ ]] || { printf 'Bad version: %s\n' "$version" >&2; exit 1; }
domain=$(sed -n 's/^FOUNT_DOMAIN=//p' "$env_file")
[[ -n "$domain" ]] || { printf '%s\n' 'FOUNT_DOMAIN is missing from .env' >&2; exit 1; }

previous_image=$("${compose[@]}" config --images)
[[ "$previous_image" == fount:* && "$previous_image" != *$'\n'* ]]
[[ "$previous_image" != "fount:$version" ]] || { printf 'fount:%s is already installed.\n' "$version"; exit 0; }

# Fresh Debian packages, so Chromium security fixes ship with every release.
docker build --pull --memory 900m --memory-swap 1100m -t "fount:$version" "$release_dir"
docker run --rm --network none "fount:$version" --version
docker run --rm --network none --entrypoint /usr/bin/chromium "fount:$version" --version

backup_dir=$project_dir/deploy/release-backups/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
cp -p "$env_file" "$backup_dir/.env"
printf '%s\n' "$previous_image" > "$backup_dir/previous-image.txt"
tar -czf "$backup_dir/sources.tar.gz" -C "$project_dir" \
  --exclude='./deploy/.env*' --exclude='./deploy/*-backups' --exclude='./core/target' .

rollback() {
  trap - ERR
  cp -p "$backup_dir/.env" "$env_file"
  "${compose[@]}" up -d --no-build app || :
  printf 'Rolled back to %s. Backup: %s\n' "$previous_image" "$backup_dir" >&2
}
trap rollback ERR

sed -i "s/^FOUNT_VERSION=.*/FOUNT_VERSION=$version/" "$env_file"
"${compose[@]}" up -d --no-build app

healthy=false
for _ in $(seq 1 24); do
  container=$("${compose[@]}" ps -q app)
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo starting)
  if [[ "$status" == healthy ]]; then healthy=true; break; fi
  if [[ "$status" == unhealthy ]]; then break; fi
  sleep 5
done
[[ "$healthy" == true ]] || { printf '%s\n' 'The new container did not become healthy.' >&2; false; }

# The public bundle must be the one this release was built with.
expected=$(cat APPJS_SHA256)
served=$(curl -fsS --max-time 20 "https://$domain/app.js" | sha256sum | cut -d' ' -f1)
[[ "$served" == "$expected" ]] || { printf 'Served app.js %s, expected %s\n' "$served" "$expected" >&2; false; }
curl -fsS --max-time 20 "https://$domain/healthz" > /dev/null

trap - ERR
tar --no-same-owner -xzf fount-source.tar.gz -C "$project_dir"
printf 'Installed fount:%s (was %s). Backup: %s\n' "$version" "$previous_image" "$backup_dir"
