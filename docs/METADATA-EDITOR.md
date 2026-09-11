# Fount metadata editor: plan and contract (2026-09-11)

This file is both the implementation plan and the shared contract between the
backend and frontend workers. Both sides build against the JSON shapes below;
neither side changes them without updating this file first.

## What the user asked for

A full metadata editing feature as its own tab on the site. Two ways in:

1. From the catalogue after a scan: select faces, press "Edit metadata", and the
   selection moves into the editor.
2. From the landing page: drop or choose local TTF/OTF/WOFF/WOFF2 files.

In the editor the user can rename a family (for example "IBM Plex Mono" ->
"Fount Plex Mono"), change author, license, copyright, version and every other
human-readable name record, and download files that install cleanly with the
new names. The interface must stay simple: one form for the family, per-face
overrides only where they differ.

## What already exists (do not rebuild)

- `core/src/convert/name_repair.rs`: `apply_name_draft` rewrites name IDs
  1/2/3/4/5/6/16/17 and rebuilds the sfnt with checksums.
  `patch_name_table` only adds Windows records for IDs 1..6; other IDs are
  rewritten only when a record already exists.
- `core/src/domain/font.rs`: `NameDraft { family, subfamily, full_name,
  postscript, filename }`.
- `core/src/app/serve.rs`: `GrabBody.names: Vec<NameOverride>` is accepted by
  `/api/export` and `/api/grab` but the web UI never sends it.
- `core/src/web/src/sections/Hero.jsx`: a "Find fonts / Edit metadata"
  segmented switch; `MetadataIntro.jsx` is a disabled placeholder.
- `core/src/web/src/store.jsx`: single store; `selected` ids, `fonts`,
  `source`, `scannedMode` are what the editor needs from a scan.
- Fixtures: `fonts/grillitype.com/*.otf`, `fonts/displaay.net/Saans-*.ttf`,
  `core/src/web/assets/geist-*.woff2`.

## Field model

OpenType name IDs the editor exposes. "Scope" says whether the value is edited
once per family or per face.

| Field         | Name ID | Scope  | Notes                                              |
| ------------- | ------- | ------ | -------------------------------------------------- |
| family        | 1, 16   | family | ID 16 always written so macOS groups faces         |
| subfamily     | 2, 17   | face   | derived from weight/style, editable                |
| full_name     | 4       | face   | default `family + " " + subfamily`                |
| postscript    | 6       | face   | default `Family-Subfamily`, ASCII, max 63, no spaces |
| unique_id     | 3       | face   | always regenerated `version;Fount;postscript`     |
| version       | 5       | family | "Version 1.000" format enforced                    |
| copyright     | 0       | family |                                                    |
| trademark     | 7       | family |                                                    |
| manufacturer  | 8       | family | "Author / foundry"                                  |
| designer      | 9       | family |                                                    |
| description   | 10      | family |                                                    |
| vendor_url    | 11      | family | URL validated                                       |
| designer_url  | 12      | family | URL validated                                       |
| license       | 13      | family | free text; presets: OFL 1.1, Apache 2.0, custom    |
| license_url   | 14      | family | URL validated                                       |

Clearing a field removes the record (all platforms) from the output. Leaving a
field untouched keeps whatever the source font had.

## API contract

### `POST /api/metadata/inspect`

Reads the current name table of fonts so the editor starts from real values.

Request (one of two sources):

```json
{ "source": { "kind": "scan", "url": "https://...", "mode": "auto", "ids": ["..."] } }
{ "source": { "kind": "upload", "files": [{ "name": "a.ttf", "data": "<base64>" }] } }
```

Response:

```json
{
  "fonts": [
    {
      "id": "<scan id or upload:<index>>",
      "file": "PlexMono-Regular.woff2",
      "format": "woff2",
      "variable": false,
      "axes": [],
      "names": {
        "family": "IBM Plex Mono", "subfamily": "Regular", "full_name": "...",
        "postscript": "...", "version": "Version 1.000", "copyright": "...",
        "trademark": null, "manufacturer": null, "designer": null,
        "description": null, "vendor_url": null, "designer_url": null,
        "license": null, "license_url": null
      }
    }
  ],
  "failures": [{ "id": "...", "error": "..." }]
}
```

Upload limits: 16 files, 20 MB each, total 64 MB; reject anything that is not
sfnt/WOFF/WOFF2 by magic bytes. Uploads are kept in a server-side session
(`state.uploads`, keyed by a random id, TTL 30 min, same pattern as
`exports`) so the apply step does not re-upload; the response carries
`"upload_id"` when the source was an upload.

### `POST /api/metadata/apply`

```json
{
  "source": { "kind": "scan", "url": "...", "mode": "auto" } | { "kind": "upload", "upload_id": "..." },
  "delivery": "zip" | "folder",
  "output_dir": null,
  "fonts": [
    {
      "id": "...",
      "names": { "family": "Fount Plex Mono", "subfamily": "Bold", "license": "", "...": "..." },
      "filename": "FountPlexMono-Bold"
    }
  ]
}
```

`names` carries only the keys the user changed. `null` means "leave as in
source", `""` means "remove the record". Response is the same shape as
`/api/export` (`results`, `saved_count`, `requested_count`,
`download_url`, `filename`, `output_dir`) so the existing download code in
the store is reused. Hosted mode: `folder` is rejected, same as export.

## Backend work (worker B)

Files owned: `core/src/convert/name_repair.rs`, `core/src/convert/mod.rs`,
`core/src/domain/font.rs`, `core/src/app/serve.rs`, new
`core/src/app/serve/metadata.rs`, `core/Cargo.toml` only if a dependency is
truly needed (prefer none; `ttf-parser` is already present for reading).

1. Extend `NameDraft` with the family-scope fields above as
   `Option<String>` where `Some("")` removes and `None` keeps.
2. Generalise `patch_name_table`: replacements for any name ID; when a record
   for an ID does not exist, add Windows (3,1,0x409) and Macintosh (1,0,0)
   records; support removal. Keep records sorted by platform/encoding/language/
   name id as the spec requires. Existing tests must keep passing.
3. `read_name_values` currently reads only 1..6,16,17: read 0..17.
4. Add `inspect_names(bytes) -> NameSet` that decodes WOFF/WOFF2 first (reuse
   the existing conversion path) and returns the field model above.
5. Implement the two routes in `serve/metadata.rs` with the upload session,
   limits, and hosted checks. Reuse `fetch::download_fonts`,
   `convert::convert_fonts`, `output::save_converted_fonts`, and the ZIP/
   archive code in `workflow.rs` (extract a shared helper rather than copy).
6. Version handling: accept "1.000" or "Version 1.000"; normalise to
   "Version X.YYY"; also update `head.fontRevision` when the version changes.
7. Tests: unit tests for add/remove/replace records, round trip through
   `inspect_names`, and an axum test for upload limits. Unit tests may only
   use committed data: synthesised name tables (see `windows_name_table` in
   the existing tests) and `core/src/web/assets/geist-*.woff2`. `fonts/` is
   gitignored and is for manual/browser checks only.
   `cargo test --manifest-path core/Cargo.toml` must pass.

## Frontend work (worker A)

Files owned: `core/src/web/src/**` and `core/src/web/styles/site.css`,
`components.css`. Do not touch Rust. Do not hand-edit generated outputs.
Build with `npm run build:ui`.

1. Store: add a `metadata` slice (`open`, `source`, `uploadId`, `fonts`,
   `familyDraft`, `faceDrafts`, `inspecting`, `applying`, `status`,
   `report`) and actions `openMetadataFromSelection()`,
   `openMetadataFromFiles(files)`, `setFamilyField`, `setFaceField`,
   `resetField`, `applyMetadata()`, `closeMetadata()`. Mirror the draft into
   `sessionStorage` like the scan session.
2. `lib/api.js`: `inspectMetadata`, `applyMetadata`; files are read with
   `FileReader` to base64.
3. Routing: `App.jsx` renders `<MetadataEditor/>` when `store.metadata.open`
   (a third top-level screen next to landing and catalogue). The header shows
   a "Back to results" or "New file" action depending on the source.
4. Entry points: `MetadataIntro.jsx` becomes a real drop zone (drag and drop,
   `<input type=file multiple accept=".ttf,.otf,.woff,.woff2">`, keyboard
   reachable). `SelectionPanel.jsx` and the mobile selection bar get an
   "Edit metadata" secondary button, enabled when `selected.length > 0`.
5. Editor layout (`src/metadata/`): left column is the face list with live
   previews (reuse `lib/previews.js` via `/api/font` for scan sources and an
   object URL for uploads) and a "which faces differ" marker; right column is
   the form. Sections: Names (family, per-face subfamily/full/PostScript with
   auto-derive and an "edit manually" toggle), Authorship (manufacturer,
   designer, URLs), Legal (copyright, trademark, license preset + text, license
   URL), Version and description. Each field shows the original value under it
   and a reset control. A live "before -> after" line per face shows the
   resulting full name and file name.
6. Rename helper: changing the family rewrites full names, PostScript names and
   file names for every face unless the face was edited manually.
7. Delivery: reuse the existing Export settings popover (ZIP / folder) and the
   `download` result handling. The apply button reads "Download N files" or
   "Save N files". Show the per-file report with the same `Reports.jsx`.
8. States: empty, inspecting, inspect failure (per file), applying, partial
   failure, success with "Edit again" keeping the draft.
9. Accessibility: every field labelled, errors announced, focus moves into the
   editor on open and back to the trigger on close, reduced motion honoured.
10. Dark theme and 390/900/1280/1440 widths must hold; no text overflow with
    long family names.

## Integration and QA (worker C, after A and B settle)

1. `npm run build:ui`, then
   `cargo build --release --manifest-path core/Cargo.toml`.
2. Start on a free port (8790+; 8787/8788 belong to the user), confirm the
   title is "Fount".
3. Write `scripts/check-metadata-editor.cjs` (Playwright, same style as
   `check-family-workflow.cjs`): upload `fonts/grillitype.com/Alp-Con-Regular-400.otf`
   and `Alp-Con-Bold-400.otf`, rename the family to "Fount Alp", set
   manufacturer/license/version, download the ZIP, unzip, parse the name table
   with a small node reader and assert IDs 1/4/6/8/13/16 and the file names.
   Repeat through the scan path with the local fixture server from
   `check-family-workflow.cjs`. Include an Axe pass on the editor.
4. Run `cargo test`, `node scripts/check-family-workflow.cjs <url>`,
   `node scripts/check-reference-redesign.cjs <url>` and confirm nothing
   regressed.
5. Install-check on Windows: open a renamed TTF in the Windows font viewer and
   confirm the family/author/license shown. Record screenshots in
   `output/metadata-editor/`.
6. Update `docs/UI-ARCHITECTURE.md` (new `metadata/` folder, store slice)
   and `README.md` (feature paragraph).

## Boundaries

- Work in this checkout on branch `design/normal-editorial`. The tree is
  dirty on purpose; never stash, reset, or revert.
- No commits; the user commits.
- Extension popup is out of scope for this pass.
- Hosted mode keeps the same restrictions as export (ZIP only, private-network
  fetches blocked).
