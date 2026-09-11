# Handoff: Fount website audit follow-up (2026-09-10)

Source: full audit of the Fount web UI (Rust + Preact, assets embedded in the binary).
Audited in a real browser at 1440/1280/1100/900/390 px, dark scheme, keyboard, touch.
Screenshots and probe scripts are in `output/audit/`.

## Ground rules

- Work in THIS checkout (`the repository root`, branch `design/normal-editorial`).
  The whole redesign is uncommitted; do NOT create another worktree, do NOT revert or stash anything.
- Do not commit, push, or delete files without asking the user first (see AGENTS.md).
- UI sources: `core/src/web/src/**` (Preact) and `core/src/web/styles/*.css`. Generated outputs
  (`core/src/web/assets/app.js`, `core/src/web/style.css`, `extension/popup.bundle.js`, `extension/popup.css`)
  are produced by `npm run build:ui`; never edit them by hand.
- Rust embeds the assets, so after `npm run build:ui` run
  `cargo build --release --manifest-path core/Cargo.toml` and start a fresh server to see changes.
- Ports 8787 and 8788 are already taken by running Fount instances (user's). Start yours on a free port:
  `core/target/release/font-grabber.exe serve --port 8790 --no-open` and confirm the page title is
  "Fount" before judging anything.
- Verify with Playwright (already in node_modules; see `output/audit/audit1.cjs`..`audit5.cjs` for
  ready-made probes). Run `cargo test --manifest-path core/Cargo.toml` and `node scripts/check-family-workflow.cjs`
  before reporting.
- Keep edits scoped; follow the existing component/token patterns. ASCII only in source files.

## Part A: bugs (do first, each is small)

A1. Scattered stage overlaps hero copy at 1081-1200 px.
    `SpecimenStage.jsx:17` switches to `is-scattered` at `(min-width: 1080px)` and `site.css:1404`
    uses `(min-width: 1081px)`, but the hero is designed for a 1184 px measure. Measured at 1100 px:
    all four cards intersect `.hero-copy`, two overlap the H1, one overlaps the address form, and the
    left card starts at x = -9 px. Raise both thresholds to ~1280 px (keep the strip below that) and
    re-measure at 1100, 1280, 1440.

A2. Mobile strip is not swipeable/scrollable from a card.
    `.card` has `touch-action: none` (site.css ~331) and `useSpecimenCard` captures the pointer, so a
    touch that starts on a card neither scrolls the strip nor the page (measured scrollLeft 0 -> 0,
    scrollY 0 -> 0 on Pixel 7 emulation). In strip mode (`.stage.is-strip`) disable drag entirely:
    no pointer capture, `touch-action: pan-x pan-y`, keep click/keyboard activation.

A3. Grid layout breaks family names letter-by-letter.
    In `.catalog-list.layout-grid`, `.family-name` (site.css ~1000, `overflow-wrap: anywhere`) sits in a
    flex row next to the "Download family" button and collapses to 14 px wide ("Newsreader" renders
    221 px tall, one letter per line). Fix the family head layout in grid mode (wrap the button to a
    second row or give the name a min width), keep list mode unchanged.

A4. Focus after a scan never lands on results.
    `App.jsx:27` calls `results?.focus()` but `#results` (`Catalog.jsx`, `<main class="catalog" id="results">`)
    has no `tabindex="-1"`, so focus stays on body. Add the tabindex (and `outline: none` for the
    programmatic focus only) and verify `document.activeElement` after a scan.

A5. Inconsistent verb in folder delivery mode.
    With "Save to folder" selected, the family button reads "Save family (3)" but the per-face button
    still reads "Download ZIP" (`FaceCard.jsx:9` LABELS). Make the face button follow `store.delivery`
    the same way `FamilyRow.jsx` does (Save / Download, and the "again" label).

A6. Mobile catalog toolbar eats 37% of the viewport.
    On 390 px the sticky `.toolbar` is 251 px tall under a 57 px header. Collapse it while scrolled
    (e.g. keep search + All/Selected on one row, move Preview/layout/actions behind a "More" popover
    or hide the second row once `scrollY` passes the catalog head). Target <= 120 px sticky height on
    phones; do not change desktop.

## Part B: feature - free-form draggable hero cards (the user's explicit request)

Today `useSpecimenCard` in `core/src/web/src/lib/interaction.js` clamps drag to +-90 px (`DRAG_X`, `DRAG_Y`)
and `settle()` springs the card back on release; arrow keys are clamped the same way. The user wants the
cards to be movable anywhere on the page, not only inside a small area.

Requirements:
- Desktop scattered mode only (after A1, that is >= 1280 px). Strip mode keeps A2 behaviour.
- Drag moves the card freely; on release it STAYS where it was dropped (no spring back). Keep the tilt
  and sheen while hovering, keep the subtle rotate-with-velocity during drag.
- Clamp only to the viewport/document so a card can never be dropped fully off-screen (keep at least
  ~48 px of the card visible).
- While dragging and after drop, the card must render ABOVE the hero text and form. Today
  `.stage.is-scattered` has `z-index: -1` (site.css ~304), so a moved card goes under the H1 and the
  address field. Rework the stacking so cards are above content but pointer events still reach the
  form and buttons when a card is not covering them (the stage itself must stay `pointer-events: none`).
- Persist positions per card in `localStorage` (use `readLocal`/`writeLocal` from `lib/storage.js`),
  restore on load, and reset them when the viewport size class changes (e.g. store the viewport width
  with the offsets and drop them if it differs by more than ~10%).
- Escape on a focused card returns it to its original spot (already partly wired: `cancel()`), and add
  a small "Reset layout" affordance that appears only when at least one card has been moved
  (an IconButton with tooltip near the scroll cue is fine; no explanatory text on the page).
- Keyboard: arrow keys keep nudging (10 px, Shift = 24 px) with the same viewport clamp, and the
  nudged position is persisted like a drag.
- Reduced motion: dragging still works, only the spring/tilt is skipped (existing `prefersReduced()`).
- Click-vs-drag: keep the existing 6 px threshold and click suppression after a drag.
- A drag must not select text or start native image drag.

Verify with Playwright: drag a card 400 px right / 300 px down, release, assert its bounding box stays
there, reload and assert it is restored, press Escape and assert it returns, and assert the H1 is
not obscured when no card is over it. Also check that scanning and the address field still work
with a card parked next to them.

## Part C: technical cleanup (after A and B)

C1. `AppState.scans` in `core/src/app/serve.rs:35` is never evicted, so in hosted mode memory grows per
    scanned site. Add a TTL sweep like `workflow::start_cleanup` does for archives (e.g. 30 min, and cap
    the map at ~64 entries). Add a unit test.
C2. `hero.webp`, `plate.webp`, `studio.webp`, `press.webp` (~260 KB) are embedded via `asset()` in serve.rs
    but referenced nowhere in the UI. Propose removal to the user (the files and the match arms); do not
    delete without confirmation.
C3. `/api/grab` (`grab` in serve.rs) duplicates `/api/export` and the UI never calls it. Confirm the CLI
    and extension do not use it either (grep `api/grab`), then propose removing it.
C4. Repository hygiene (propose only, list exact paths, wait for approval): untracked junk in the repo
    root (`coresrcwebstyle.css`, `coresrcwebstyle_test.css`, `write-css.js`, `scan-test.js`, `test-scan.js`,
    `nul`, the eight PNGs, `.189f7bdfdaeffffa-00000000.bun-build` at 135 MB) and the fact that the whole
    redesign (13 modified + ~40 new files) is uncommitted.
C5. Add Open Graph / Twitter meta to `core/src/web/index.html` for the hosted edition (title, description,
    `og:image` can point at `/assets/fount-logo.svg` for now).

## Part D: visual polish (lower priority; bounded changes, keep the current editorial direction)

D1. Add a light/dark theme toggle in the header. CSS already supports `:root[data-theme="light"]`
    (base.css:41); add the symmetric `[data-theme="dark"]` override, persist the choice in localStorage,
    default to system. Use an icon button with tooltip (sun/moon), no text label.
D2. Section spacing: the landing is 4842 px tall at 1440x900 and "How it works" opens with an almost
    empty screen. Reduce vertical section padding by ~25-30% (check `.section` in site.css) and re-check
    that nothing overlaps at 1280 and 390.
D3. Playground weight control shows "400 / 700"; use "Regular / Bold" (and Regular / Semi Bold / Extra
    Bold for Geist) via the existing WEIGHT_NAMES idea in `lib/fonts.js`.
D4. Header "Scan a site" on the landing only focuses the field that is already centered on screen. Hide it
    on the landing (keep "New scan" in the catalog), or make it scroll+focus only when the field is
    off-screen.

## Reporting

Report in the AGENTS.md format (Result / Changed / Verified / Your action / Risks). State the test URL and
port, list commands run with pass/fail, and call out explicitly what was not verified (Safari, physical
devices, hosted deployment, installed extension).
