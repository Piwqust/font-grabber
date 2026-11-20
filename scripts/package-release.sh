#!/usr/bin/env bash
# Packs one release asset into <out dir>.
#
#   scripts/package-release.sh <binary> <asset> <out dir>
#     font-grabber-windows-x64.zip           font-grabber/ with the .exe and launchers
#     font-grabber-<os>-<arch>.tar.gz        font-grabber/ with the binary
#   scripts/package-release.sh extension fount-chrome-extension.zip <out dir>
#
# The asset names are the ones skills/grab-fonts/scripts/fount.{sh,ps1} download.
# Used by .github/workflows/release.yml; also works from Git Bash on Windows.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
source_path=$1
asset=$2
mkdir -p "$3"
out=$(cd "$3" && pwd)
version=$(sed -n 's/^version = "\(.*\)"$/\1/p' "$root/core/Cargo.toml" | head -n 1)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

# Zips the contents of a folder, so its entries sit at the archive root.
zip_contents() { # folder zipfile
	rm -f "$2"
	if command -v zip >/dev/null 2>&1; then
		(cd "$1" && zip -qrX "$2" .)
	elif command -v 7z >/dev/null 2>&1; then
		(cd "$1" && 7z a -tzip -bd -bso0 "$2" . >/dev/null)
	elif [ -x /c/Windows/System32/tar.exe ]; then
		# Windows' bsdtar writes standard zips (forward slashes), unlike
		# Compress-Archive in Windows PowerShell 5.1.
		local entries=()
		mapfile -t entries < <(ls -A "$1")
		/c/Windows/System32/tar.exe -a -cf "$(cygpath -w "$2")" -C "$(cygpath -w "$1")" "${entries[@]}"
	else
		echo "No zip tool found (zip, 7z or Windows tar.exe)" >&2
		exit 1
	fi
}

case "$asset" in
fount-chrome-extension.zip)
	# Tracked files only: no local fonts or scratch.
	git -C "$root" ls-files extension | while IFS= read -r file; do
		mkdir -p "$stage/$(dirname "$file")"
		cp "$root/$file" "$stage/$file"
	done
	zip_contents "$stage/extension" "$out/$asset"
	;;
*windows*.zip)
	package="$stage/pack/font-grabber"
	mkdir -p "$package"
	cp "$source_path" "$package/font-grabber.exe"
	printf '@echo off\r\ncd /d "%%~dp0"\r\nfont-grabber.exe serve %%*\r\n' >"$package/Fount Web.cmd"
	printf '@echo off\r\ncd /d "%%~dp0"\r\necho Fount CLI. Try: font-grabber grab https://example.com --all\r\ncmd /k\r\n' >"$package/Fount CLI.cmd"
	sed 's/$/\r/' "$root/LICENSE" >"$package/LICENSE.txt"
	sed 's/$/\r/' >"$package/README.txt" <<EOF
Fount $version for Windows x64

Fount Web.cmd   start the local web app (opens http://127.0.0.1:8787)
Fount CLI.cmd   open a terminal here to run font-grabber commands

  font-grabber grab https://example.com --all     save every font from a page
  font-grabber scan https://example.com --json    list fonts without saving
  font-grabber doctor                             check the browser used for dynamic discovery

Dynamic discovery uses an installed Chrome, Chromium or Edge.
Set CHROME=C:\\path\\to\\chrome.exe to choose one.

Docs: https://github.com/Piwqust/font-grabber
EOF
	zip_contents "$stage/pack" "$out/$asset"
	;;
*.tar.gz)
	package="$stage/pack/font-grabber"
	mkdir -p "$package"
	cp "$source_path" "$package/font-grabber"
	chmod 755 "$package/font-grabber"
	cp "$root/LICENSE" "$package/LICENSE"
	platform=${asset#font-grabber-}
	platform=${platform%.tar.gz}
	cat >"$package/README.txt" <<EOF
Fount $version for $platform

  ./font-grabber serve                          local web app at http://127.0.0.1:8787
  ./font-grabber grab https://example.com --all save every font from a page
  ./font-grabber scan https://example.com --json list fonts without saving
  ./font-grabber doctor                         check the browser used for dynamic discovery

Dynamic discovery uses an installed Chrome, Chromium or Edge.
Set CHROME=/path/to/chrome to choose one.

Docs: https://github.com/Piwqust/font-grabber
EOF
	tar -czf "$out/$asset" -C "$stage/pack" font-grabber
	;;
*)
	echo "Unknown asset: $asset" >&2
	exit 1
	;;
esac

echo "Packed $out/$asset"
