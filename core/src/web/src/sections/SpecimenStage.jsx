import { useState } from "preact/hooks";
import { useSpecimenCard } from "../lib/interaction.js";
import { useMediaQuery } from "../lib/motion.js";
import { useStore } from "../store.jsx";
import { Icon } from "../ui/Icon.jsx";

/** The hero is laid out for a 74rem measure; below this the cards would sit on
    top of the headline, so they become a strip instead. */
export const STAGE_QUERY = "(min-width: 1280px)";

/**
 * The type specimens that frame the hero. Each one is a real control: hover
 * tilts it, dragging moves it anywhere on the page, clicking changes what it
 * shows, and arrow keys do the same from the keyboard. The whole card is the
 * hit area — there is no small target inside it.
 *
 * Below the stage breakpoint the cards become a swipeable strip instead of a
 * scattered arrangement, so nothing is positioned off-screen on a phone. A
 * strip card is not draggable: a touch that starts on one has to scroll the
 * strip and the page.
 */
export function SpecimenStage({ resetSignal = 0, onMove }) {
  const wide = useMediaQuery(STAGE_QUERY);
  const shared = { movable: wide, resetSignal, onMove };
  return (
    <div
      class={`stage ${wide ? "is-scattered" : "is-strip"}`}
      aria-label="Type specimens"
    >
      <BrowserCard {...shared} />
      <SerifCard {...shared} />
      <DiscoveryCard {...shared} />
      <CodeCard {...shared} />
    </div>
  );
}

/** Only a card that can actually be moved should say so. */
const moveHint = (movable) =>
  movable ? " Arrow keys move the card, Escape puts it back." : "";

/**
 * A card explains itself through its accessible name and the pointer that
 * appears over it. There is no on-card caption: the specimens are meant to be
 * looked at, and a strip of instructions along the bottom of each one turned
 * four pieces of type into four buttons.
 */

const SITES = [
  {
    host: "vercel.com",
    family: "Geist",
    kind: "Sans-serif",
    glyph: "Aa",
    font: "var(--sans)",
  },
  {
    host: "stripe.com",
    family: "Sohne",
    kind: "Grotesque",
    glyph: "Rg",
    font: "var(--sans)",
  },
  {
    host: "apple.com",
    family: "SF Pro",
    kind: "Neo-grotesque",
    glyph: "Ag",
    font: "var(--sans)",
  },
  {
    host: "notion.so",
    family: "Inter",
    kind: "Interface",
    glyph: "Nn",
    font: "var(--sans)",
  },
];

function BrowserCard(props) {
  const [index, setIndex] = useState(0);
  const site = SITES[index];
  const ref = useSpecimenCard({
    ...props,
    id: "browser",
    enterDelay: 0.15,
    onActivate: () => setIndex((i) => (i + 1) % SITES.length),
  });

  return (
    <button
      ref={ref}
      type="button"
      class="card card-browser"
      aria-label={`${site.family} specimen from ${site.host}. Activate to show the next website.${moveHint(props.movable)}`}
    >
      <span class="browser-bar">
        <span class="browser-lights" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span class="browser-url">https://{site.host}</span>
      </span>
      <span class="card-body">
        <span class="card-glyph" style={`font-family:${site.font}`}>
          {site.glyph}
        </span>
        <span class="card-name">{site.family}</span>
        <span class="card-foot">
          <span>{site.kind}</span>
          <span>
            {index + 1}/{SITES.length}
          </span>
        </span>
      </span>
    </button>
  );
}

const GLYPHS = ["Ag", "Rf", "&", "Qy"];
const WEIGHTS = [
  { label: "Regular", weight: 400, style: "normal" },
  { label: "Italic", weight: 400, style: "italic" },
  { label: "Bold", weight: 700, style: "normal" },
];

function SerifCard(props) {
  const [glyph, setGlyph] = useState(0);
  const [weight, setWeight] = useState(0);
  const active = WEIGHTS[weight];
  const ref = useSpecimenCard({
    ...props,
    id: "serif",
    enterDelay: 0.23,
    onActivate: () => {
      setGlyph((g) => (g + 1) % GLYPHS.length);
      setWeight((w) => (w + 1) % WEIGHTS.length);
    },
  });

  return (
    <button
      ref={ref}
      type="button"
      class="card card-serif"
      aria-label={`Newsreader specimen, ${active.label}. Activate to change the glyph and weight.${moveHint(props.movable)}`}
    >
      <span
        class="card-glyph card-glyph-serif"
        style={`font-weight:${active.weight};font-style:${active.style}`}
      >
        {GLYPHS[glyph]}
      </span>
      <span class="card-name">Newsreader</span>
      <span class="card-kind">Serif</span>
      <span class="card-rule" aria-hidden="true" />
      <span class="card-styles">
        {WEIGHTS.map((option, index) => (
          <span
            key={option.label}
            data-active={String(index === weight)}
            style={`font-weight:${option.weight};font-style:${option.style}`}
          >
            {option.label}
          </span>
        ))}
      </span>
    </button>
  );
}

function DiscoveryCard(props) {
  const store = useStore();
  const ref = useSpecimenCard({
    ...props,
    id: "discovery",
    enterDelay: 0.31,
    onActivate: () => {
      if (store.busy) return;
      store.runScan({ url: location.origin + "/", mode: "static" });
    },
  });

  return (
    <button
      ref={ref}
      type="button"
      class="card card-discovery"
      disabled={store.busy}
      aria-label={`Find the fonts used on this page.${moveHint(props.movable)}`}
    >
      <Icon name="globe" size={22} class="card-mark" />
      <span class="card-kind">A little type discovery</span>
      <span class="card-glyph card-glyph-serif">Aa</span>
      <span class="card-foot card-foot-block">
        Find the fonts
        <br />
        on this page
        <Icon name="arrowUpRight" size={14} />
      </span>
    </button>
  );
}

const SNIPPETS = [
  { family: "Geist", file: "geist-400.woff2" },
  { family: "Newsreader", file: "newsreader-700.woff2" },
  { family: "Plex Mono", file: "plex-mono-400.woff2" },
];

function CodeCard(props) {
  const [index, setIndex] = useState(0);
  const snippet = SNIPPETS[index];
  const ref = useSpecimenCard({
    ...props,
    id: "code",
    enterDelay: 0.39,
    onActivate: () => setIndex((i) => (i + 1) % SNIPPETS.length),
  });

  return (
    <button
      ref={ref}
      type="button"
      class="card card-code"
      aria-label={`Font face rule for ${snippet.family}. Activate to show the next rule.${moveHint(props.movable)}`}
    >
      <span class="code-head">
        <span>@font-face</span>
        <Icon name="copy" size={16} />
      </span>
      <code class="code-body">
        <span class="code-line">
          font-family: <em>'{snippet.family}'</em>;
        </span>
        <span class="code-line">src: url(…/{snippet.file})</span>
        <span class="code-line">format('woff2');</span>
      </code>
    </button>
  );
}
