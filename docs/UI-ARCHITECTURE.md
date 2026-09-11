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
      Preview.jsx  SelectionPanel.jsx  Reports.jsx
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

## State

`store.jsx` holds one object and updates it through `patch`. Components read
what they need and call actions; none of them keep a second copy of the truth.
The store owns the scan lifecycle (including cancellation), selection, filtering,
preview settings, export and the coverage check, and mirrors what matters into
`sessionStorage` so a reload keeps the collection.

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
