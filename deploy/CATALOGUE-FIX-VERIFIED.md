# Catalogue family grouping — 2026-10-11

The GT Mechanik page declares all 42 faces as different CSS families, with
`font-weight:400` and `font-style:normal` even for Bold and Oblique. The catalogue
previously rendered 42 family rows and mislabelled several faces.

The catalogue now resolves style aliases from the complete scan before filtering.
GT Mechanik becomes three real subfamilies (Mono, Semi, Poly), each containing
14 faces. Width and optical subfamilies stay distinct. Compound weights and
camel-case aliases are supported, and the other styles in the scan disambiguate
“Mechanik Semi Bold” from a Semi Bold weight. Original IDs, CSS declarations and
source URLs remain intact for preview, selection, metadata editing and export.

The fix also corrects style labels and ordering, searches across the readable
family and style together, restores grouping in saved scans, and keeps unrelated
anonymous files separate. Positioning the checkbox's native input and hidden
label relative to their own control prevents collapsed faces from creating a
large empty scroll area below the footer (3910px became 1185px in the desktop
reproduction).

Verified locally:

- `node scripts/check-families.mjs`: passed with Mechanik, compound weights,
  width/optical variants, camel-case aliases, filtering, preserved identities,
  restored sessions, Unicode and anonymous candidates.
- `npm run build:ui`: passed for the site and extension.
- `node scripts/check-catalogue.cjs http://127.0.0.1:8797 --source-ui`: 13 passed,
  using a real Grilli Type scan and Fount's real export API. This includes a
  14-face family selection, two-face filtered selection, a family export despite
  the active filter, reload and mobile layout.
- The same 13 checks passed without `--source-ui` against the final binary,
  launched with Debian's glibc 2.36. The embedded JS and CSS match the checked
  build byte for byte. The final ELF requires at most GLIBC 2.34, matching the
  existing release's baseline.
- A separate render-mode fixture launched real Chromium, captured a dynamically
  created FontFace and inspected font coverage under Debian's glibc 2.36.
- The resulting ZIP passes its CRC check. fontTools parses all 14 exported
  files with family `GT Mechanik Semi`, 14 distinct styles and weights
  100, 300, 400, 500, 700, 800, 900.
- Desktop and mobile screenshots inspected in `output/catalogue/`.

The working copy is `/home/deploy/fount`. The fix is installed at
https://fount.angleford.co/ as `fount:2026-10-11-1`, image `fe2791fa83de`.
The user provided sudo access after the earlier installation attempt required a
password. The new app container is healthy, running, has restart count 0 and
OOMKilled=false. Production HTTPS `/app.js` and `/style.css` match the checked
build byte for byte; Cloudflare reports DYNAMIC for both. HTTPS `/healthz`
returns `ok`. The backup is
`/opt/fount/deploy/catalogue-backups/20261010T225516Z`.

The full Cargo rebuild exceeded this VPS's memory while compiling
`headless_chrome` (SIGKILL). For this UI-only change,
`python3 scripts/rebuild-cached-ui.py` rebuilds the application against the
23 exact cached dependency artifacts from the deployed version. It refuses to
run if the Rust sources, manifests, lockfile, discovery JavaScript or compiler
version changed. The engine and dependency code remain identical.
Linking uses a private Bookworm libc sysroot obtained from checksum-verified
official Debian packages, so the host's newer glibc does not change the runtime
requirement. System libraries were not modified.

After that build, `python3 scripts/package-catalogue-fix.py` creates
`output/catalogue-release/`, containing the binary, a small Dockerfile, the exact
UI files and checksums. Install with:

```sh
sudo bash /home/deploy/fount/deploy/apply-catalogue-fix.sh
```

The installer validates the package and checks for source changes, adds the
tested binary to the existing runtime image, verifies ABI compatibility before
switching, saves the current environment and changed sources, and changes only
Fount's app container. It restores the previous release if the health check
fails. Backups are under `/opt/fount/deploy/catalogue-backups/`.
