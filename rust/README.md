# Font Grabber RS

Rust-first rewrite of Font Grabber.

## Stack

- `clap` for CLI entry points
- `tokio` async runtime
- `ratatui` + `crossterm` terminal UI
- `reqwest` for static HTML/CSS and HTTP downloads
- `thirtyfour` + WebDriver for JS-rendered discovery / browser-context downloads
- `wuff` + `ttf-parser` for font conversion and variable-axis inspection

## Modes

- `auto` — static scan first, escalate to browser only when needed
- `static` — HTML/CSS discovery only
- `render` — force browser-backed CSSOM discovery

## Run

```bash
cargo run -- grab
```

With an initial URL:

```bash
cargo run -- grab --url https://example.com
```

Non-interactive batch mode:

```bash
cargo run -- grab --url https://example.com --all --no-ui
```

Check WebDriver availability:

```bash
cargo run -- doctor
```

Run tests:

```bash
cargo test
```

## Render mode requirement

Render mode expects a running WebDriver endpoint, for example `chromedriver` or Selenium at:

```text
http://localhost:4444
```

You can override it with `--webdriver-url`.
