# Fount UI architecture — 2026-09-10

Both surfaces — the website served by the Rust binary and the Chrome extension
popup — are Preact applications built from one component library and one set of
design tokens. Nothing is written twice.

## Layout

```
core/src/web/
  src/
    main.jsx              mounts <App/> into #root
    App.jsx               landing page or catalogue, never both
    store.jsx             the single owner of application state
    lib/
      api.js              every call to the Rust server
      fonts.js            family grouping, style labels, URL normalising
      storage.js          localStorage / sessionStorage, history, session
      previews.js         lazy @font-face loading for specimen text
      motion.js           animation primitives and the motion hooks
      interaction.js      pointer tilt, drag and keyboard for the hero cards
    ui/                   the component library — shared with the extension
      Button.jsx  Field.jsx  Segmented.jsx  Checkbox.jsx  Slider.jsx
      Disclosure.jsx  Popover.jsx  Tooltip.jsx  Spinner.jsx
      CopyButton.jsx  Reveal.jsx  Icon.jsx
    sections/             landing page
      Header.jsx  Hero.jsx  SpecimenStage.jsx  ScanForm.jsx
      HowItWorks.jsx  Capabilities.jsx  Playground.jsx
      Extension.jsx  Footer.jsx
    catalog/              results
      Catalog.jsx  Toolbar.jsx  FamilyRow.jsx  FaceCard.jsx
      Preview.jsx  SelectionPanel.jsx  Reports.jsx  ExportSettings.jsx
    metadata/             the name-table editor
      MetadataEditor.jsx  the third top-level screen, next to landing and catalogue
      FaceList.jsx        the face column, previews and the "differs" marker
      MetadataForm.jsx    the family form and the per-face overrides
      MetaField.jsx       one field: value, original, reset
      DeliverPanel.jsx    ZIP / folder choice and the apply button
      derive.js           rename cascade, PostScript and file-name rules, validation
  styles/
    fonts-web.css         @font-face, /assets paths
    fonts-ext.css         @font-face, extension paths
    base.css              tokens, dark theme, reset, utilities   [shared]
    components.css        every component in ui/                 [shared]
    site.css              header, hero, sections, catalogue, footer

extension/
  src/
    popup.jsx             the popup, using the same ui/ components
    engine.js             Chrome, font bytes, conversion, downloads
    previews.js           preview loading from the engine's byte cache
  popup.src.css           popup layout only
  zip.js convert.js discover.js capture.js background.js   (unchanged)
```

## Build

```
npm run build:ui          builds everything once
npm run dev:ui            rebuilds on change while designing
```

Outputs, all committed because the Rust binary embeds them:

| Output | Sources |
| --- | --- |
| `core/src/web/assets/app.js` | `core/src/web/src/**` |
| `core/src/web/style.css` | `fonts-web` + `base` + `components` + `site` |
| `extension/popup.bundle.js` | `extension/src/**` + `core/src/web/src/ui/**` |
| `extension/popup.css` | `fonts-ext` + `base` + `components` + `popup.src` |

Never edit `style.css`, `popup.css`, `assets/app.js` or `popup.bundle.js` by
hand — the build overwrites them. Rebuild order after a UI change:

```
npm run build:ui
cargo build --manifest-path core/Cargo.toml --release --offline
```

## Checks

```
node scripts/check-metadata-ui.cjs 8790        front end only, /api/metadata/* mocked
node scripts/check-metadata-editor.cjs <url>   end to end against a running binary
```

The first needs nothing but the built assets. The second needs the release
binary serving on a free port (8790 and up; 8787 and 8788 belong to the user)
and reads the name table out of the ZIP it downloads, so it catches anything
that goes wrong between the form and the bytes on disk.

## State

`store.jsx` holds one object and updates it through `patch`. Components read
what they need and call actions; none of them keep a second copy of the truth.
The store owns the scan lifecycle (including cancellation), selection, filtering,
preview settings, export and the coverage check, and mirrors what matters into
`sessionStorage` so a reload keeps the collection.

`metadata` is a slice of that same store, not a second one: `open`, `source`,
`uploadId`, `fonts` (what `/api/metadata/inspect` read out of the files),
`familyDraft`, `faceDrafts`, `inspecting`, `applying`, `status` and `report`.
The store owns the whole editing lifecycle — `openMetadataFromSelection`,
`openMetadataFromFiles`, `setFamilyField`, `setFaceField`, `resetField`,
`applyMetadata`, `closeMetadata` — and mirrors the draft into `sessionStorage`
(`fount-metadata-v1`) the way the scan session is mirrored, so a reload keeps
the draft and the upload session id. Components in `metadata/` read the draft
and call those actions; `derive.js` is the only place that knows how a family
rename turns into full names, PostScript names and file names.

Every request still goes through `lib/api.js`, which owns the two metadata
endpoints as well: `inspectMetadata` (scan ids, or local files read to base64)
and `applyMetadata`. The apply response has the same shape as `/api/export`,
so the download, the ZIP fetch and `Reports.jsx` are reused rather than
rebuilt. On the Rust side the routes live in `core/src/app/serve/metadata.rs`,
the name-table rewriting in `core/src/convert/name_repair.rs`. The contract
between the two sides is `docs/METADATA-EDITOR.md`.

The extension keeps its state in the popup component instead, because its
lifecycle is different: the popup is destroyed every time it closes, and what
survives lives in `chrome.storage.session`, keyed per tab.

## Motion

Two rules hold everywhere, enforced in `lib/motion.js`:

1. **`prefers-reduced-motion` wins.** Running animations are completed rather
   than abandoned, so nothing is left half-transformed, and scroll reveals
   resolve to visible immediately.
2. **Keyboard navigation skips decorative motion.** `play()` is a no-op while
   the last input was a key; `playAlways()` is for motion that carries state.

Scroll reveals default to *visible* and earn their hidden state only once an
observer is attached, so any failure path leaves content readable instead of
stranded at `opacity: 0`.

Two things learned the hard way and encoded in the code:

- Motion cannot resolve `transform: "none"` as a keyframe against a function
  list; it produces a zero matrix. Both ends of a transform animation are always
  spelled out.
- Motion also cannot read a transform *function list* back off an element as an
  implicit first keyframe. Where an element's transform is written directly — the
  hero cards — the easing is left to CSS transitions instead, and
  `lib/interaction.js` is the only writer of that property.

## The hero cards

`useSpecimenCard` gives one element pointer tilt, a sheen that tracks the
cursor, drag with a spring release, arrow-key nudging, Escape to reset and
Enter/Space to cycle its specimen. The whole card is the hit area. A drag never
counts as a click, and the suppression is a deadline rather than a one-shot
listener so a drag that ends off the card cannot eat the next real click.

## Accessibility

- Tab order reaches the address field before the specimen cards.
- Every icon-only control has an accessible name; every card states what
  activating it does and that arrow keys move it.
- The popover is the native one: light dismiss, Escape and focus return come
  from the platform.
- Both themes are defined from tokens; dark mode follows `prefers-color-scheme`.
