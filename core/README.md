# Font Grabber

Rust rewrite focused on a cleaner CLI, a simpler architecture, and more reliable browser fallbacks.

## Commands

### Grab

Discover fonts, optionally review the list interactively, then download, convert, and save.

```bash
cargo run -- grab https://example.com
cargo run -- grab https://example.com --all
cargo run -- grab https://example.com --mode render --concurrency 8
```

Flags:

- `-o, --output <dir>` — output directory
- `-a, --all` — skip selection and save every discovered font
- `--mode <auto|static|render>` — discovery strategy
- `--webdriver-url <url>` — WebDriver endpoint
- `--concurrency <n>` — max concurrent HTTP downloads
- `--json` — machine-readable output (requires `--all`)

### Scan

Discovery only.

```bash
cargo run -- scan https://example.com
cargo run -- scan https://example.com --mode render
cargo run -- scan https://example.com --json
```

### Doctor

Probes WebDriver `/status`, creates a real browser session, loads a page, and runs a script.

```bash
cargo run -- doctor
```

## Discovery modes

- `auto` — static scan first, with browser-backed download fallback still available during `grab`
- `static` — HTML/CSS discovery only
- `render` — force browser CSSOM discovery

## Architecture

```text
src/
  app/         command flows (`grab`, `scan`, `doctor`)
  cli/         clap parsing
  convert/     WOFF/WOFF2 -> sfnt, inspection, conservative name repair
  discovery/   static CSS parsing + browser CSSOM discovery
  domain/      shared types and serializable reports
  fetch/       HTTP download + browser-context retry
  output/      output naming and file writing
  support/     URL helpers, HTTP client, WebDriver helpers, terminal UI helpers
```

## Render mode requirement

Browser-assisted discovery and browser-context downloads expect a WebDriver endpoint, such as Chromedriver or Selenium:

```text
http://localhost:4444
```

Override it with `--webdriver-url`.
