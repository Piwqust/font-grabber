# Family workflow

Fount now groups exact normalized family names within a scan. It preserves each
candidate ID and subset; it does not strip weight or display names to guess a
relationship. Unnamed faces remain separate.

## Interface

- List is the default; List/Grid is stored in `localStorage` (`fount-layout`).
- Families and expanded faces are rendered in batches of 40. Only visible
  previews are fetched. Selection covers matching candidates, including matches
  beyond the displayed batch. The family download action always covers the whole
  family and uses the configured ZIP/folder destination.
- Families have unchecked, partial and selected states. Variable-only selection
  changes matching faces within that family. Search and layout changes preserve
  selection; the existing clear-selection Undo remains available.
- Mobile preview settings are collapsed initially. Download settings contain the
  delivery method and optional folder; the sticky bar contains selection and the
  primary action.
- File details expose weight, style, declared character range and source. These
  declarations are not treated as proof of glyph coverage.
- Recent successful scans (including zero results) are stored separately from the
  tab's collection, capped at 20 unique URLs in `fount-history-v1`. Credentialed
  URLs are not stored. Choosing history fills the form without starting a scan.
- Check selected text explicitly checks the actual selected files in batches of
  80, using the preview text. Missing glyphs and unreadable files are separate
  results. This is a character check, not a shaping/layout guarantee. Editing the
  text or receiving a new collection invalidates pending results.

## API additions

Existing `/api/scan` JSON and `/api/grab` direct ZIP/folder contracts remain.

`POST /api/scan` accepts optional `stream: true`. The response is newline-delimited
JSON with `type: stage` (`page_source`, `browser`, `organizing`), followed by
`type: result` with `report`, or `type: error` with `error`. Events originate in
the discovery engine. Stopping the client wait preserves its collection but does
not promise to stop server discovery.

`POST /api/export` accepts the existing grab payload (`url`, `mode`, `ids`,
`delivery`, `output_dir`, optional `names`). It returns `results` keyed by candidate
`id`, each with `family`, `status`, `stage`, `file` and `error`, together with
`saved_count`, `requested_count`, `warnings`, and the destination information.
Download, conversion and per-file write failures retain their IDs. Retrying sends
only failed IDs. ZIP success means prepared, not saved by the browser.

ZIP exports are written directly to random temporary files. `download_url` points
to `GET /api/export/:id`; links expire after 900 seconds, returning HTTP 410 after
expiry. A cleanup task runs every 15 seconds. At most 32 archives are retained;
when full, preparation reports a retryable error. Downloads stream from disk.
Folder export continues after individual write failures and retains the existing
non-overwriting filename behavior.

`POST /api/coverage` accepts `url`, `mode`, `ids` (1–80) and `text` (1–240
characters). It returns `text` and `results` with `id`, `missing` and `error`.
Control characters are ignored; printable missing characters are deduplicated.
The existing decompressor and `ttf-parser` inspect actual glyph mappings.

All new source operations retain hosted URL restrictions. Folder delivery remains
disabled in hosted mode. No production service, dependency or database was added.

## Verification

Run a freshly built server because Rust embeds the web assets:

```powershell
cargo test --manifest-path core/Cargo.toml --offline
cargo build --manifest-path core/Cargo.toml --offline
core/target/debug/font-grabber.exe serve --port 8787 --no-open
```

In another terminal:

```powershell
node scripts/check-family-workflow.cjs
node --check core/src/web/app.js
npx --no-install prettier --check core/src/web/app.js core/src/web/index.html core/src/web/style.css scripts/check-family-workflow.cjs
```

The workflow check starts an ephemeral local font fixture, exercises real discovery,
ZIP and folder exports, failures/retries, browser selection and storage, and then
uses controlled UI fixtures for a 1050-face catalogue and scan failures. Its files
are confined to `output/family-workflow/`. If the existing local axe script is
available, it also runs an accessibility check and records its result.

Verified on 2026-09-07:

- 32 Rust tests passed, including actual glyph coverage, expired archive removal,
  and hosted source/folder restrictions.
- 54 API/browser checks passed, including real partial export and UI retry.
- ZIP entries passed CRC checks and contained valid TTF/OTF signatures.
- The real Browser scan emitted all stages and returned five faces with
  `used_browser: true` on the running Fount page.
- Chromium layouts checked at 320, 390, 768 and 1440 px. The 390px download bar
  is 66px high without status feedback. Stable desktop/mobile catalogue and mobile
  settings states passed the focused axe checks.
- Changed files pass syntax and formatting checks. Repository-wide
  `cargo fmt --check` still reports an existing line wrap in
  `core/src/discovery/static_css.rs:285`, which this change does not touch.

Physical Safari, Firefox, installed-extension behavior, remote foundry sites and
hosted deployment were not validated in this pass. No deployment was performed.

Pre-change files are preserved in
`output/feature-upgrade-backup-20260907-030657/`. That backup includes the user's
existing uncommitted work; do not use a blanket Git reset to undo this feature.
