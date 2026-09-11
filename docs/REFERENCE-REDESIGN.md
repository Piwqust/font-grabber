# Fount reference redesign

Source: all three PNG files in `C:\Users\you\Downloads\Fount_references`, inspected on 2026-09-09. The supplied images override the older monochrome-sheet direction in `.impeccable.md` for this work.

## Image analysis

### MainPage.png — 1505 × 1045

White canvas, approximately 65–85 px outer gutters. A quiet header, centered two-part navigation and a black action. The main composition starts around y=180: a two-line high-contrast serif headline with an italic phrase; gray sans-serif supporting copy. Search is the central functional anchor, approximately 675 × 64 px, followed by a three-part scan selector and example website pills. Four independently rotated paper objects balance the margins: browser/type specimen, cream serif specimen, lilac discovery count, pale blue CSS fragment. Thin borders, restrained shadows, 10–14 px corners, no saturated panels. Three explanatory columns sit below the search, then a hairline footer. Distinct roles: serif for editorial headings, sans for actions/body, mono for code. Side objects must remain secondary to typing a URL.

### FindFontPage.png — 1505 × 1045

Same header and white canvas. The headline moves upward and left, names the scanned host in italic, and reports actual family/style counts. Search remains available. Decorations are reduced to the margins. A horizontal toolbar contains collection count, font search, preview text/size, and all/selected controls. Below it, approximately 70/30 columns: expandable family groups and a sticky selection/export panel. Selected face rows use a very light lavender fill and black checkboxes. Expanded rows show style, actual font specimen, format and secondary actions. Closed families remain readable with a specimen. The export panel shows removable selected files, primary download action, settings and a short font-licence note. Never fabricate family descriptions, byte sizes, scan counts or font names from the mockup.

### Logotype.png — 1254 × 1254

A high-contrast serif F, broad vertical stem, bracketed bottom serif, curved upper bowl transitioning to a blue folded corner. A separate black pointer sits to the right. The word Fount underneath is bold sans-serif, unlike the editorial header wordmark in the two page references. Reconstruct the symbol with a shared coordinate system, aligned horizontal/vertical segments, tangent-continuous cubic curves and a closed cursor contour. Supply color, monochrome and wordmark lockup SVGs, with outlined text and no embedded raster. Raster antialiasing and source texture are not geometry: exact original Bézier control points cannot be recovered uniquely from a PNG. This is a clean reconstruction, not a claim of unknowable pixel-perfect source recovery.

## Implementation plan

1. Preserve the current edited sources in `output/reference-redesign/before`.
2. Add vector brand assets and translate the supplied home layout with bundled Newsreader, Geist and Plex Mono.
3. Translate the results layout while preserving APIs, discovery, family selection, grid mode, character checks, history, retry and export.
4. Add bounded drag/tilt interactions, an accessible click alternative, one entrance sequence, reduced-motion handling and immediate utility feedback.
5. Build bundled UI and Rust binary, then verify real scan/export, responsive layouts, keyboard use, reduced motion, accessibility and browser errors.

## Scope decisions

- The current checkout has no metadata editor. Keep its navigation position as an explicitly unavailable item; do not invent an editor.
- Reference login/privacy/social placeholders are not backed by this product. Use existing documentation and repository links, and make Open app focus the working scan input.
- Decorative specimen content is labelled as examples. Example-site buttons fill the actual scan input. The local-page demo remains available.
- Keep Motion 13.2.0 and Web Awesome 3.12.0 already installed and bundled. No new runtime dependency or CDN. Native pointer capture provides bounded dragging; Motion provides return/entrance transitions.
- Documentation checked: https://motion.dev/docs/animate, https://motion.dev/docs/hover, https://motion.dev/docs/spring, https://interactjs.io/docs/draggable/ and https://interactjs.io/docs/modifiers/.
- Existing user edits are preserved. No commit, push, deployment or production change is part of this task.

## Verification — completed 2026-09-10

- `npm run build:ui` and `cargo build --manifest-path core/Cargo.toml --offline`: passed. Server restarted from the newly built executable at http://127.0.0.1:8787.
- `cargo test --manifest-path core/Cargo.toml --offline`: 32 passed. Existing dead-code warnings for `TransferMethod::label` and `ScanRequest::webdriver_url` remain.
- `node scripts/check-family-workflow.cjs`: 54 passed, including real scan/stream/export, converted downloads, folder delivery, partial failure and retry, coverage, pagination, selection recovery, storage restrictions and accessibility.
- `node scripts/check-reference-redesign.cjs`: 73 passed. Covers new navigation, scan segments, example input, actual selection panel, removal/focus, reload, vector asset serving, bounded drag, keyboard alternative, reduced motion, touch scroll and seven widths (320/390/640/768/1024/1280/1505).
- Axe WCAG A/AA checks on home and results, desktop and mobile: zero violations. Browser JavaScript errors: zero in both workflows.
- Source syntax checks, Prettier formatting checks and `git diff --check`: passed.
- `rustfmt --check --edition 2021 core/src/app/serve.rs`: passed. Whole-project `cargo fmt --manifest-path core/Cargo.toml -- --check` reports an existing line-wrap difference at `core/src/discovery/static_css.rs:285`. That file is unchanged by this redesign; the unrelated formatting difference was left intact.
- The downloaded two-font ZIP passed integrity checks, and both contained OTF files were parsed successfully (683 glyphs each). All brand SVG paths are closed and have finite bounds; the vector delivery ZIP passed integrity checks.
- Rendered home, results, mobile and tablet screenshots reviewed. Fixed tablet object collisions and mobile copy spacing found during visual review. `output/reference-redesign/checks.json` and the screenshot files record the acceptance evidence.

The metadata placeholder remains unavailable. Export and discovery services retain their existing contracts. Validation used local Fount and local font fixtures, plus browser viewport/touch emulation. External example-site scanning, installed Chrome extension, physical devices, Safari and production deployment were not exercised in this task.

## Recovery

The pre-change versions of `index.html`, `style.css`, `app.js`, `ui.js`, `favicon.svg` and `serve.rs` are in `output/reference-redesign/before`. Restore only those intended sources, rebuild with `npm run build:ui` and `cargo build --manifest-path core/Cargo.toml --offline`, then restart the local server. Other pre-existing user changes have not been reverted.
