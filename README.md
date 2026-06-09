# Font Grabber

Scrape the fonts a website uses and save them as clean **TTF/OTF** files — through
a **CLI**, a **local web app**, or a **Chrome extension**. WOFF2/WOFF are
decompressed to sfnt and the name table is repaired, with variable-font axes
preserved.

The conversion core is written once in Rust and reused everywhere — the extension
runs the *same code* compiled to WebAssembly, so its output is byte-identical to
the CLI.

## Repository layout

```text
.
├── core/        Rust crate — CLI + local web server (the engine)
│   └── src/
│       ├── app/        command flows (grab / scan / doctor / serve)
│       ├── cli/        clap definitions
│       ├── convert/    sfnt conversion + name repair
│       ├── discovery/  static + browser font discovery
│       ├── domain/     shared models and reports
│       ├── fetch/      HTTP + browser-backed downloads
│       ├── output/     filenames and writing
│       ├── support/    HTTP, WebDriver, terminal helpers
│       └── web/        embedded web UI (index.html, style.css, app.js)
├── wasm/        Rust → WebAssembly conversion crate (used by the extension)
├── extension/   Chrome MV3 extension (popup UI + WASM converter)
└── scripts/     Windows helper scripts (.cmd)
```

## 1. Local web app (recommended)

A single Rust binary serves an editorial type-foundry UI on `127.0.0.1`: scan a
URL, preview every discovered font with editable sample text, select what you
want, then download a **ZIP** or save to a folder. No Node, no build step.

```bash
scripts\font-grabber-web.cmd        # builds (release) and opens the browser
# or, directly:
cd core
cargo run -- serve                  # http://127.0.0.1:8787
cargo run -- serve --port 9000 --no-open
```

## 2. Chrome extension

A Manifest V3 extension in [`extension/`](extension/) detects the fonts on the
current tab, previews them, and downloads clean TTF/OTF entirely in the browser —
no server, no WebDriver. It also captures **dynamically-injected / variable fonts**
from type-tester sites (e.g. Displaay) that load fonts from extensionless endpoints
inside Web Workers.

```bash
scripts\build-extension.cmd         # builds wasm/ -> extension/convert.wasm
```

Then `chrome://extensions` → **Developer mode** → **Load unpacked** → select
`extension/`. See [extension/README.md](extension/README.md).

## 3. CLI

```bash
cd core
cargo run -- grab https://example.com          # discover, select, convert, save
cargo run -- grab https://example.com --all    # save everything, no prompts
cargo run -- grab https://displaay.net/typeface/perfektta --all -o ./out
cargo run -- scan https://example.com --json   # discovery only
```

### Discovery modes

- `auto` *(default)* — static HTML/CSS scan **plus** embedded-browser discovery, merged.
  Catches dynamic / extensionless / catalog fonts (e.g. Displaay testers). Falls back
  to the static result if Chrome isn't available.
- `static` — HTML/CSS discovery only (no browser; fastest).
- `render` — embedded-browser discovery only.

### One discovery engine, everywhere

The CLI, the local web app, and the Chrome extension all run the **same** discovery
JavaScript ([`extension/discover.js`](extension/discover.js) + `capture.js`). The
Rust apps drive it through an **embedded headless Chrome** (no separate WebDriver to
install); the extension runs it in the page directly. So all three find the same
fonts — including JS-injected and whole-family catalog fonts.

## Stack

- **Rust** + **Tokio**, **clap** (CLI), **axum** (local web server, embedded UI)
- **reqwest** + **scraper** for static discovery; **headless_chrome** (CDP) for
  embedded-browser discovery — runs the shared `discover.js`
- **wuff** + **ttf-parser** for font decompression and inspection
- **wasm32-unknown-unknown** (no `wasm-bindgen`) for the in-browser converter

## Requirements

- Rust toolchain (`rustup`), plus the `wasm32-unknown-unknown` target for the extension
- **Chrome / Chromium installed** — used by `auto`/`render` discovery in the CLI and
  web app (auto-detected; `static` mode needs no browser)

More detail on the engine lives in [core/README.md](core/README.md).

## License

[ISC](LICENSE)
