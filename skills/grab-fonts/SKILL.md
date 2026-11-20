---
name: grab-fonts
description: Download the fonts a website uses and save them as installable TTF/OTF files, with nothing to install. Use when the user gives a site and wants its fonts or typeface ("grab the fonts from…", "download the font this site uses", "what fonts does … use", "скачай шрифты с сайта…", "какой шрифт на сайте…"), or wants one family from a site.
argument-hint: <site URL> [family] [output folder]
license: ISC
---

# Grab fonts from a website

Fount finds every font behind a page (`@font-face` in CSS, fonts loaded at
runtime, type-tester catalogues, Web Workers) and converts `WOFF2` / `WOFF` back
to installable `TTF` / `OTF` with repaired names and variable axes kept.

The launchers in `scripts/` next to this file (`${CLAUDE_SKILL_DIR}/scripts`)
download Fount's portable binary from
[GitHub Releases](https://github.com/Piwqust/font-grabber/releases) on first use,
check it against the release's `SHA256SUMS.txt`, cache it per user and run it.
No admin rights, no PATH changes, no package manager. Chrome, Chromium or Edge
already on the machine is used for dynamic discovery; without one, Fount reads
the page source only.

Request: $ARGUMENTS

## 1. Run Fount

Read the site URL from the request (add `https://` if missing). Run **one**
command in the foreground with a long timeout (10 minutes: the first run
downloads ~10 MB, a browser scan takes 20–90 s). Use the launcher for your shell:

- Windows (PowerShell or cmd):
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_SKILL_DIR}/scripts/fount.ps1" grab <URL> --all
  ```
- macOS, Linux, WSL, Git Bash:
  ```
  sh "${CLAUDE_SKILL_DIR}/scripts/fount.sh" grab <URL> --all
  ```

If `${CLAUDE_SKILL_DIR}` is not filled in by your agent, use the absolute path of
the `scripts` folder beside this `SKILL.md`.

Add options only when the request calls for them:

| Option | When |
| --- | --- |
| `--only "<family>"` | The user wants one family. Repeatable; case and spaces are ignored. |
| `-o "<folder>"` | The user named a folder. Default: `fonts/<domain>` under the current directory. |
| `--family "<name>"` | The user wants the saved fonts renamed. |
| `--mode static` | The user wants it fast, or no browser is wanted. Misses fonts loaded by scripts. |
| `--json` | You need machine-readable output. It can be long for big families. |

Keep `--all`: it saves every face found without an interactive picker. To only
list fonts without saving anything, use `scan <URL>` instead of `grab <URL> --all`.

Do not download font files yourself with curl or a fetch tool: Fount handles
discovery, referrers, browser-only downloads and conversion.

## 2. Read the result

The output lists every face found, then every file saved with its path, then
warnings. Exit code 3 means the launcher could not get the binary; any other
non-zero code is an error from Fount, explained in the output.

- **"No family matches …"**: the warning lists the families that were found.
  Offer those, or rerun with the right `--only`.
- **"Browser discovery unavailable"**: only the page source was read. Fonts
  loaded by JavaScript may be missing. Tell the user that Chrome, Chromium or
  Edge (or `CHROME=<path>`) would find them; don't install a browser yourself.
- **No fonts found**: the site may load fonts only after interaction, or block
  automated visitors. Say so; try the specific page that shows the font (a
  typeface page rather than the home page) if the user gave a foundry site.
- **Download or conversion issues**: report them briefly; the other files are
  still saved.

## 3. Report to the user

Answer in the user's language:

- the absolute path of the output folder;
- the families saved, with their styles or weights, and which ones are variable
  (with axes) — group by family, don't paste the full log;
- anything that went wrong, in one or two lines.

Add one short line: fonts are licensed software, so check the foundry's licence
before using the files in a project.

## Diagnostics

- `doctor` (same launcher) shows which browser Fount found and whether it starts headless.
- `FOUNT_BIN=<path>` runs an existing `font-grabber` binary instead of downloading one.
- `FOUNT_VERSION=v3.2.0` pins a release; `FOUNT_CACHE=<folder>` moves the cache
  (default `%LOCALAPPDATA%\fount`, `~/.cache/fount`, `~/Library/Caches/fount`).
- Prebuilt binaries: Windows x64, Linux x64/arm64, macOS arm64/x64. Elsewhere the
  shell launcher builds Fount once with `cargo` if Rust is present.
