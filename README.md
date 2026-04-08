# Font Grabber

Clean Rust CLI for scraping website fonts and saving usable **TTF/OTF** files.

## What it does

- Discovers fonts from inline CSS, linked stylesheets, and browser-rendered CSSOM
- Falls back to browser-context downloads when direct HTTP fetches are blocked
- Converts **WOFF2**, **WOFF**, **TTF**, and **OTF** into clean sfnt output
- Preserves variable-font axis metadata during inspection
- Supports interactive selection and JSON output for automation

## Stack

- **Rust** + **Tokio**
- **clap** for command parsing
- **dialoguer** + **console** for the CLI experience
- **reqwest** + **scraper** for static HTML/CSS discovery
- **thirtyfour** + WebDriver for render-mode discovery and browser-backed downloads
- **wuff** + **ttf-parser** for font decompression and inspection

## Commands

```bash
cd rust
cargo run -- grab <url>
cargo run -- scan <url>
cargo run -- doctor
```

### `grab`

Discover fonts, let the user review/select them, then download, convert, and save.

```bash
cargo run -- grab https://example.com
cargo run -- grab https://example.com --all
cargo run -- grab https://example.com --mode render -o ./fonts
```

### `scan`

Discovery only.

```bash
cargo run -- scan https://example.com
cargo run -- scan https://example.com --json
```

### `doctor`

Checks the WebDriver status endpoint, creates a real browser session, and runs a script.

```bash
cargo run -- doctor
cargo run -- doctor --webdriver-url http://localhost:4444
```

## Discovery modes

- `auto` — static scan first, browser-backed downloads still available during `grab`
- `static` — HTML/CSS discovery only
- `render` — force browser-backed CSSOM discovery

## Requirements

- Rust toolchain
- A WebDriver endpoint for render mode and browser-context fallback downloads

Default WebDriver URL:

```text
http://localhost:4444
```

## Project layout

```text
rust/
  src/
    app/         command flows
    cli/         clap definitions
    convert/     sfnt conversion + name repair
    discovery/   static + browser discovery
    domain/      shared models and reports
    fetch/       HTTP + browser-backed downloads
    output/      filenames and writing
    support/     HTTP, WebDriver, terminal helpers
```

More detail lives in `rust/README.md`.

## License

ISC
