# Fount: components and motion — 2026-09-06

## Result

Added Web Awesome 3.12.0 and Motion 13.2.0 to the existing Rust-served vanilla-JavaScript website. Only the used components are imported: button, tooltip, spinner and copy-button. No React migration, paid component pack, runtime CDN or external icon service was added. The extension was not changed in this pass.

Sources: [Web Awesome installation](https://webawesome.com/docs/), [Motion JavaScript](https://motion.dev/docs/quick-start). The installed `emil-design-eng` skill guided motion frequency, timing, keyboard behaviour and reduced motion. `pick-ui-library` was inspected as a reference; its React-oriented primitives were not adopted for this vanilla project.

## Component review

| Before | After | Why |
| --- | --- | --- |
| Preview text and size had to be reset separately | Web Awesome reset button clears the sample and restores 48 px, then focuses the sample input | One action to return to comparison defaults |
| Folder success was a long path in text | Web Awesome copy-button appears after successful folder export, using the actual returned path | Copy the folder location without selecting text manually |
| Loading was indicated mainly by a text message | Web Awesome spinner and aria-busy on the download action; scan spinner uses the same component | Consistent, immediate feedback without an invented percentage |
| Active tab switched its background abruptly | Motion moves a separate background indicator in 220 ms | Shows the relation between All and Selected without moving controls |
| Settings and download bar appeared abruptly | 160–180 ms entry transitions, with popover origin at its lower right | Makes state changes easier to follow |
| Dormant FountMotion code could stagger every result for seconds | Actual Motion integration, first six cards only, entire sequence below 300 ms | Fast arrival without delaying a large collection |
| Bare settings/reset icons | Web Awesome contextual tooltips | Secondary explanations beside the relevant control |
| Address label disappeared on mobile | Compact visible label above the address within the field | Meaning remains visible after typing |

Keyboard-initiated Motion effects are skipped. Reduced-motion changes complete running Motion animations and skip new transitions. Selection, filtering and download actions are never gated on animation completion. The native ZIP/Folder select and popover semantics were preserved.

## Files and build

- `core/src/web/ui.js`: selective component imports and the Motion helpers.
- `scripts/build-ui.cjs`: esbuild bundle, stylesheet and third-party notices.
- `core/src/web/assets/ui.js`, `ui.css`, `ui.js.LEGAL.txt`, `ui-LICENSES.txt`: committed-to-workspace build outputs embedded in the executable.
- `core/src/web/index.html`, `app.js`, `style.css`: component wiring, state changes, Fount theme overrides and accessible labels.
- `core/src/app/serve.rs`: four explicit asset responses, preserving the self-contained binary.
- `package.json`, `package-lock.json`: exact UI-library versions and esbuild 0.28.2 as a build dependency.

Rebuild order: `npm run build:ui`, then `cargo build --manifest-path core/Cargo.toml --offline`, then restart Fount. The final local server was rebuilt and restarted at http://127.0.0.1:8787/.

Raw bundle size: JS approximately 245 KB, CSS 51,635 bytes. These are local assets, not additional remote requests. This is the payload cost of the selected components and motion library; no claim of zero overhead is made.

## Verification

- UI bundle build, Rust build, JS syntax check and Prettier checks passed.
- Rust tests: 29 passed. The existing unused-code warnings for TransferMethod::label and ScanRequest.webdriver_url remain.
- `npm audit --omit=dev`: zero reported vulnerabilities at the time of the check.
- `output/playwright/components/check-components.js`: 16 checks passed in WebKit, including actual clipboard copy, resetting preview, tab-indicator alignment, loading/error states, reduced motion, keyboard use, four viewport widths and no external component asset requests.
- Previous service regression script: 27 checks passed, including real ZIP and folder exports, fixed panel geometry across seven widths, Escape focus return, selection persistence and Undo.
- Chromium smoke: reset preview, active tab indicator and Escape dismissal passed; zero JavaScript errors observed.
- Axe initially found the new icon-only reset button lacked a name within its shadow DOM. Fixed with slotted accessible text rather than an unsupported host aria-label. The mobile URL label issue was also fixed. Final desktop and mobile axe runs returned no violations.
- A deliberate HTTP 503 in the error test produces an expected console network error; it is not an unexpected runtime failure.

Screenshots: `output/playwright/components/desktop-final.png`, `mobile.png`. Backups of the pre-change files: `output/playwright/components/before/`.

## Limits

No production deployment, physical-device Safari/Firefox run or screen-reader session was performed. Automated accessibility checks are sampled and do not constitute a WCAG certification. The existing popup conversion lifecycle and backend scan cancellation semantics were not changed. Clipboard failure is handled by the library's error feedback; the tested localhost flow successfully copied to the clipboard.

