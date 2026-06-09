# Font Grabber — Chrome Extension

A Manifest V3 Chrome extension that detects the fonts used on the current page,
previews them live, and downloads them as clean **TTF/OTF** files. The
WOFF2/WOFF → sfnt conversion runs entirely in the browser via WebAssembly
compiled from the same Rust code the CLI uses — no server, no network round-trip
to convert.

## Install (load unpacked)

1. Build the WASM module (only needed once, or after changing `../wasm/`):
   ```
   scripts\build-extension.cmd
   ```
   This compiles `../wasm` to `wasm32-unknown-unknown` and copies
   `convert.wasm` into this folder. (Plain `cargo build` works too — see the
   script for the exact command.)
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select this `extension/` folder.
5. Pin the puzzle-piece icon, open any website, and click the **Font Grabber** icon.

## How it works

- **Discovery** runs in the page via `chrome.scripting`: it reads `@font-face`
  rules from every accessible stylesheet and also lists every font file the page
  actually loaded (`performance.getEntriesByType("resource")`), so cross-origin
  CSS is still covered. No WebDriver, no scraping.
- **Dynamic / variable fonts** from type-tester sites (e.g. Displaay, where the
  font is fetched from an extensionless endpoint inside a Web Worker and injected
  with `new FontFace(uuid, bytes)`) are caught two ways: a `document_start`
  content script (`capture.js`) hooks `FontFace`/`fetch`, and a background service
  worker (`background.js`) records any response whose `Content-Type` is a font.
  The popup re-fetches those URLs and converts them — variable axes preserved.
  (Because the content script runs at page load, **reload the tab after installing**
  for tester sites to be caught.)
- **Complete families.** A tester only loads the styles you interact with, so the
  network methods above see a partial set. For known foundries the popup reads the
  page's own catalog and enumerates the **whole family up front** — every weight,
  italic, and the master variable font. Displaay is supported (`collectFontsInPage`
  reads its React Router loader data); this path needs no reload and no interaction.
- **Preview** fetches each font (host permission bypasses CORS), wraps the bytes
  in a `blob:` URL, and renders the real glyphs with editable sample text. Loads
  lazily as you scroll.
- **Conversion** happens in `convert.wasm`: WOFF2 (Brotli) and WOFF (zlib) are
  decompressed to sfnt and the name table is repaired — byte-for-byte identical
  to the CLI output.
- **Download** gives you a single **ZIP** or individual files saved into a
  `FontGrabber/` subfolder of your Downloads.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest (permissions, CSP with `wasm-unsafe-eval`) |
| `popup.html` / `popup.css` / `popup.js` | The popup UI and orchestration |
| `background.js` | Service worker: records font responses per tab via `webRequest` |
| `capture.js` | `document_start` MAIN-world hook for `FontFace`/`fetch` (shared with the CLI/web app) |
| `discover.js` | The page font collector — **shared** with the Rust CLI/web app (`core` `include_str!`s it) |
| `convert.js` | Loads `convert.wasm` and exposes `convert(bytes, …)` |
| `convert.wasm` | The Rust conversion core (built from `../wasm`) |
| `zip.js` | Minimal ZIP writer using the browser's native `deflate-raw` |
| `icons/` | Toolbar icon |

## Permissions

- `activeTab` + `scripting` — read fonts from the page you're on, on click.
- `host_permissions: <all_urls>` — fetch font files cross-origin for preview and
  conversion.
- `webRequest` + `storage` — notice font responses (incl. extensionless/worker
  ones) and remember them per tab in `storage.session`.
- `downloads` — save the results.

Nothing is sent anywhere; all work happens locally in your browser.
