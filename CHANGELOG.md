# Changelog

Notable changes to Fount. Versions follow [semantic versioning](https://semver.org);
the Chrome extension has its own version in `extension/manifest.json`.

## [3.2.0] - 2026-11-20

### Added

- **Agent skill.** [`skills/grab-fonts`](https://github.com/Piwqust/font-grabber/tree/master/skills/grab-fonts) lets an AI agent (Claude Code,
  Codex, Cursor and others that read `SKILL.md`) download a site's fonts from one request:
  `/grab-fonts https://example.com`. Its launchers fetch the portable binary from GitHub
  Releases on first use, check it against `SHA256SUMS.txt` and cache it per user, so nothing
  needs installing. The repository is also a Claude Code plugin marketplace
  (`/plugin install fount --marketplace Piwqust/font-grabber`).
- `--only <family>` for `grab` and `scan`: keep the families whose name contains the text,
  ignoring case, spaces, `-` and `_`. A miss lists the families that were found.
- `grab --json` reports `found_count` and `families` (everything discovered, before `--only`).
- Prebuilt binaries for macOS (Apple Silicon and Intel) and Linux arm64, built by a release
  workflow on GitHub Actions; CI runs the tests on Linux, Windows and macOS.

### Changed

- `doctor` checks what Fount really uses: which Chrome, Chromium or Edge it found, its version,
  and whether it starts headless. `doctor --json` gives the same as data.
- The browser is started by its install location (Chrome, then Chromium, then Edge) on a fixed
  port with its own profile, and a launch that does not finish in 20 seconds counts as "no
  browser": the scan keeps the page-source results instead of hanging.
- Faces split by `unicode-range` (Geist Mono on vercel.com) join into one face once; the browser
  now reports `unicode-range` and weight ranges, and joined pieces merge in a fixed order.
- Fonts that share a typographic family but are separate designs keep their own names
  (`Geist-Pixel-Circle-400.ttf`, not `Geist-Pixel-400-1.ttf`).
- Dependencies: axum 0.8, zip 9, scraper 0.29, console 0.16, dialoguer 0.12, base64 0.23,
  Preact 10.29, Motion 13.5, Floating UI 1.8, plus compatible updates. The extension's WASM
  converter is rebuilt and produces the same files.
- The Windows release README shows `CHROME=C:\path\to\chrome.exe` correctly.

### Removed

- The WebDriver client (`thirtyfour`). `--webdriver-url` is still accepted and ignored.

## [3.1.0] - 2026-10-17

New Preact interface with light and dark themes, the metadata editor ("Customize font"),
families joined from split faces, and a hardened server for private hosting. See the
[release notes](https://github.com/Piwqust/font-grabber/releases/tag/v3.1.0).

## [3.0.0] - 2026-07-06

Rust rewrite with the local web app, the CLI and the Chrome extension sharing one discovery
engine. See the [release notes](https://github.com/Piwqust/font-grabber/releases/tag/v3.0.0).

[3.2.0]: https://github.com/Piwqust/font-grabber/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/Piwqust/font-grabber/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/Piwqust/font-grabber/releases/tag/v3.0.0
