#!/bin/sh
# Runs Fount's font-grabber and fetches its portable binary on first use.
#
# Nothing is installed. The release build for this machine is downloaded once
# from GitHub Releases into a per-user cache, checked against the release's
# SHA256SUMS.txt and run from there: no root, no PATH changes, no package
# manager. A newer release is picked up at most once a day.
#
# Every argument is passed to font-grabber unchanged:
#   sh fount.sh grab https://example.com
#
# Environment:
#   FOUNT_BIN      run this font-grabber binary instead of downloading one
#   FOUNT_VERSION  a release tag such as v3.2.0 instead of the latest release
#   FOUNT_CACHE    cache folder (default: ~/.cache/fount, ~/Library/Caches/fount)
#   CHROME         the Chrome, Chromium or Edge used for dynamic discovery
set -eu

REPO="Piwqust/font-grabber"
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)

note() { printf 'fount: %s\n' "$*" >&2; }
die() {
	note "$*"
	exit 3
}

case "$(uname -s)" in
MINGW* | MSYS* | CYGWIN*)
	# Git Bash or Cygwin on Windows: the PowerShell launcher handles the .zip build.
	ps1="$here/fount.ps1"
	if command -v cygpath >/dev/null 2>&1; then ps1=$(cygpath -w "$ps1"); fi
	exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps1" "$@"
	;;
esac

if [ -n "${FOUNT_BIN:-}" ]; then
	[ -x "$FOUNT_BIN" ] || die "FOUNT_BIN is not an executable file: $FOUNT_BIN"
	exec "$FOUNT_BIN" "$@"
fi

os=$(uname -s)
arch=$(uname -m)
case "$os/$arch" in
Linux/x86_64 | Linux/amd64) asset=font-grabber-linux-x64.tar.gz ;;
Linux/aarch64 | Linux/arm64) asset=font-grabber-linux-arm64.tar.gz ;;
Darwin/arm64) asset=font-grabber-macos-arm64.tar.gz ;;
Darwin/x86_64) asset=font-grabber-macos-x64.tar.gz ;;
*) asset="font-grabber-$os-$arch.tar.gz" ;;
esac

if [ -n "${FOUNT_CACHE:-}" ]; then
	cache=$FOUNT_CACHE
elif [ "$os" = Darwin ]; then
	cache="$HOME/Library/Caches/fount"
else
	cache="${XDG_CACHE_HOME:-$HOME/.cache}/fount"
fi
mkdir -p "$cache"

fetch() { # url file
	if command -v curl >/dev/null 2>&1; then
		curl -fsSL -S --retry 2 --connect-timeout 20 -A fount-skill -o "$2" "$1"
	elif command -v wget >/dev/null 2>&1; then
		wget -q -T 60 -U fount-skill -O "$2" "$1"
	else
		die "neither curl nor wget is available to download Fount"
	fi
}

sha256() { # file
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d' ' -f1
	elif command -v shasum >/dev/null 2>&1; then
		shasum -a 256 "$1" | cut -d' ' -f1
	else
		openssl dgst -sha256 "$1" | sed 's/^.*= *//'
	fi
}

find_binary() { # folder
	[ -d "$1" ] || return 1
	found=$(find "$1" -type f -name font-grabber 2>/dev/null | head -n 1)
	[ -n "$found" ] && printf '%s\n' "$found"
}

newest_cached() {
	# shellcheck disable=SC2012 # names are our own hash folders
	for dir in $(ls -1t "$cache" 2>/dev/null); do
		case "$dir" in .download-* | src-build) continue ;; esac
		if binary=$(find_binary "$cache/$dir"); then
			printf '%s\n' "$binary"
			return 0
		fi
	done
	[ -x "$cache/src-build/bin/font-grabber" ] && printf '%s\n' "$cache/src-build/bin/font-grabber"
}

# A one-time build for platforms without a prebuilt release. Needs Rust.
build_from_source() {
	command -v cargo >/dev/null 2>&1 || return 1
	note "no prebuilt Fount for $os/$arch; building it once with cargo (a few minutes) ..."
	cargo install --quiet --locked --git "https://github.com/$REPO" font-grabber --root "$cache/src-build" >&2 || return 1
	printf '%s\n' "$cache/src-build/bin/font-grabber"
}

install_release() { # base-url
	work="$cache/.download-$$"
	rm -rf "$work"
	mkdir -p "$work"
	trap 'rm -rf "$work"' EXIT INT TERM
	fetch "$1/SHA256SUMS.txt" "$work/SHA256SUMS.txt" || return 1
	expected=$(sed -n "s/^\([0-9a-fA-F]\{64\}\)[ *]*$asset[[:space:]]*\$/\1/p" "$work/SHA256SUMS.txt" | head -n 1 | tr 'A-F' 'a-f')
	if [ -z "$expected" ]; then
		build_from_source && return 0
		die "the release has no $asset. Install Rust (https://rustup.rs) for a one-time build, or set FOUNT_BIN."
	fi
	target="$cache/$(printf '%s' "$expected" | cut -c1-16)"
	if binary=$(find_binary "$target"); then
		printf '%s\n' "$binary"
		return 0
	fi
	note "downloading Fount ($asset) from github.com/$REPO ..."
	fetch "$1/$asset" "$work/$asset" || return 1
	actual=$(sha256 "$work/$asset")
	[ "$actual" = "$expected" ] || die "checksum mismatch for $asset (expected $expected, got $actual). Nothing was run."
	mkdir -p "$work/unpacked"
	tar -xzf "$work/$asset" -C "$work/unpacked"
	find_binary "$work/unpacked" >/dev/null || die "$asset does not contain font-grabber"
	# Another run may have finished first; keep whichever copy landed.
	mv "$work/unpacked" "$target" 2>/dev/null || true
	binary=$(find_binary "$target") || die "could not unpack $asset into $target"
	chmod +x "$binary"
	note "cached in $target"
	printf '%s\n' "$binary"
}

resolve_binary() {
	if [ -n "${FOUNT_VERSION:-}" ]; then
		case "$FOUNT_VERSION" in v*) tag=$FOUNT_VERSION ;; *) tag="v$FOUNT_VERSION" ;; esac
		install_release "https://github.com/$REPO/releases/download/$tag"
		return
	fi
	stamp="$cache/latest.txt"
	# Use the cached latest build for a day before asking GitHub again.
	if [ -f "$stamp" ] && [ -z "$(find "$stamp" -mmin +1440 2>/dev/null)" ]; then
		remembered=$(head -n 1 "$stamp")
		if [ -n "$remembered" ] && [ -x "$remembered" ]; then
			printf '%s\n' "$remembered"
			return
		fi
	fi
	if binary=$(install_release "https://github.com/$REPO/releases/latest/download"); then
		printf '%s\n' "$binary" >"$stamp"
		printf '%s\n' "$binary"
		return
	fi
	if binary=$(newest_cached) && [ -n "$binary" ]; then
		note "could not check for a newer release; using $binary"
		printf '%s\n' "$binary"
		return
	fi
	return 1
}

binary=$(resolve_binary) || die "could not get the font-grabber binary (see above). Set FOUNT_BIN to use one you already have."
exec "$binary" "$@"
