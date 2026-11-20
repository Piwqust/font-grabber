# font-grabber (core)

The Rust crate behind Fount: the CLI, the local web app and the discovery and
conversion engine. The [repository README](../README.md) covers downloads and the
other surfaces; this page is for working on the crate.

## Commands

```bash
cargo run -- grab https://example.com                  # discover, pick, convert, save
cargo run -- grab https://example.com --all -o ./out   # every face, no prompts
cargo run -- grab https://example.com --all --only "GT America"
cargo run -- scan https://example.com --json           # discovery only
cargo run -- doctor                                    # which browser, does it start
cargo run -- serve                                     # web app on http://127.0.0.1:8787
cargo run -- password-hash                             # Argon2id hash for serve --hosted
```

### `grab`

| Flag | Meaning |
| --- | --- |
| `-o, --output <dir>` | Output folder. Default: `./fonts/<domain>` |
| `-a, --all` | Save every face without the picker. Implied without a terminal |
| `--only <family>` | Keep families whose name contains this text. Repeatable; case, spaces, `-` and `_` are ignored |
| `--mode <auto\|static\|render>` | Discovery strategy (below) |
| `--family <name>`, `--subfamily <name>` | Rewrite the OpenType names of every saved face |
| `--concurrency <n>` | Parallel downloads, 1–32 (default 6) |
| `--json` | Machine-readable report (needs `--all`): `found_count`, `families`, `saved[]`, warnings and failures |

`scan` takes `--mode`, `--only` and `--json`. `doctor --json` reports the browser
path, its version, whether it starts headless and the discovery that results.

## Discovery modes

| Mode | What runs |
| --- | --- |
| `auto` (default) | Page source **and** headless Chrome, merged. Without a browser it keeps the page-source results and says so |
| `static` | HTML and linked CSS only; never starts a browser |
| `render` | Headless Chrome first; a browser that cannot start falls back to the page source with a warning |

The browser is found in this order: `CHROME` or `CHROMIUM`, then Google Chrome,
Chromium and Microsoft Edge in their usual install locations, then the first one
on `PATH`. It is driven over CDP by [`headless_chrome`](https://crates.io/crates/headless_chrome);
there is no WebDriver to install. `--webdriver-url` is still accepted and ignored,
so older scripts keep working.

## Layout

```text
src/
  app/         command flows: grab, scan, doctor, serve (+ hosted auth, jobs, metadata)
  cli/         clap definitions
  convert/     WOFF/WOFF2 → sfnt, split-face merging, name-table repair
  discovery/   page source + CSS, foundry catalogues, headless Chrome, family assembly
  domain/      shared types and serialisable reports
  fetch/       HTTP downloads with browser fallback
  output/      file names and saving
  support/     URLs, HTTP client, SSRF guard, Chrome launch, terminal output
  web/         the web app: Preact sources, built bundle and assets (embedded)
```

The discovery scripts that run inside the page are shared with the extension:
`../extension/discover.js` and `../extension/capture.js` are compiled into the
binary with `include_str!`.

## Tests

```bash
cargo test
```

Some tests start local HTTP servers on `127.0.0.1`. If `HTTP_PROXY` is set in your
environment, add `NO_PROXY=127.0.0.1,localhost` so those requests are not sent to
the proxy.
