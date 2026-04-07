# Font Grabber RS

Rust terminal app for discovering website fonts and converting them to usable **TTF/OTF** files.

## Stack

- **Rust** for the engine/runtime
- **ratatui + crossterm** for the terminal UI
- **reqwest** for static HTML/CSS fetching and HTTP downloads
- **thirtyfour + WebDriver** for JS-rendered discovery and browser-context downloads
- **wuff + ttf-parser** for WOFF/WOFF2 decoding and font inspection

## Features

- Static CSS discovery from inline and linked stylesheets
- Browser-backed discovery for JS-rendered pages
- Browser-context downloads when direct HTTP fetches are not enough
- Converts **WOFF2**, **WOFF**, **TTF**, and **OTF** into clean sfnt output
- Preserves variable-font axis metadata during inspection
- Interactive terminal workflow for discovery, selection, and saving

## Requirements

- Rust toolchain
- A WebDriver endpoint for `render` mode, such as `chromedriver` or Selenium

Default WebDriver URL:

```text
http://localhost:4444
```

## Quick Start

Interactive mode:

```bash
cd rust
cargo run -- grab
```

Start with a URL:

```bash
cd rust
cargo run -- grab --url https://example.com
```

Batch mode:

```bash
cd rust
cargo run -- grab --url https://example.com --all --no-ui
```

Check WebDriver availability:

```bash
cd rust
cargo run -- doctor
```

Run tests:

```bash
cd rust
cargo test
```

## Discovery Modes

- `auto` — static scan first, escalate to browser discovery when needed
- `static` — HTML/CSS discovery only
- `render` — force browser-backed CSSOM discovery

## Project Structure

```text
rust/
  src/
    main.rs        CLI entrypoint
    tui.rs         ratatui terminal interface
    discovery.rs   font discovery pipeline
    downloader.rs  HTTP + browser-context download pipeline
    converter.rs   WOFF/WOFF2/sfnt conversion helpers
    output.rs      output directory writing
    pipeline.rs    orchestration layer
    util.rs        shared formatting/path helpers
    models.rs      shared application models
```

More implementation details live in `rust/README.md`.

## License

ISC
