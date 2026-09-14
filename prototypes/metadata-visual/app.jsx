// Four visual directions for the metadata page, over one real data layer.
// The picker sets data-direction on <html>, which is what scopes each
// stylesheet, so the directions cannot bleed into one another.
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Model, useModel } from "./model.jsx";
import { ConsolePage } from "./directions/Console.jsx";
import { SpecimenPage } from "./directions/Specimen.jsx";
import { StudioPage } from "./directions/Studio.jsx";
import { SheetPage } from "./directions/Sheet.jsx";

const DIRECTIONS = [
  { id: "console", label: "Console", Page: ConsolePage, note: "Dark two-pane workbench" },
  { id: "specimen", label: "Specimen", Page: SpecimenPage, note: "Editorial, type-led" },
  { id: "studio", label: "Studio", Page: StudioPage, note: "Stage plus control panel" },
  { id: "sheet", label: "Sheet", Page: SheetPage, note: "Everything as one table" },
];

function App() {
  const initial = new URLSearchParams(location.search).get("d");
  const start = Math.max(
    0,
    DIRECTIONS.findIndex((item) => item.id === initial),
  );
  const [index, setIndex] = useState(start);
  const current = DIRECTIONS[index];

  useEffect(() => {
    document.documentElement.dataset.direction = current.id;
    const url = new URL(location);
    url.searchParams.set("d", current.id);
    history.replaceState(null, "", url);
  }, [current.id]);

  return (
    <Model>
      <Frame index={index} setIndex={setIndex} />
    </Model>
  );
}

function Frame({ index, setIndex }) {
  const model = useModel();
  const { Page, id } = DIRECTIONS[index];
  const ready = model.fonts.length > 0;

  return (
    <>
      <div class="proto-root" key={id}>
        {ready ? (
          <Page />
        ) : (
          <Booting />
        )}
      </div>
      <Picker index={index} setIndex={setIndex} />
    </>
  );
}

/** Before the first inspect returns there is nothing honest to draw yet. */
function Booting() {
  const model = useModel();
  return (
    <div class="proto-boot" role="status">
      <p class="proto-boot-title">Fount metadata</p>
      <p class="proto-boot-line">
        {model.error ? model.error : (model.busy || "Preparing") + "..."}
      </p>
      {model.error ? (
        <button type="button" onClick={model.loadSamples}>
          Try the sample fonts again
        </button>
      ) : null}
    </div>
  );
}

/** The direction switcher. Keys 1-4 and arrows move between directions. */
function Picker({ index, setIndex }) {
  const bar = useRef(null);
  const highlight = useRef(null);
  const items = useRef([]);

  const move = () => {
    const item = items.current[index];
    if (!item || !highlight.current) return;
    highlight.current.style.width = item.offsetWidth + "px";
    highlight.current.style.transform = "translateX(" + item.offsetLeft + "px)";
  };

  useEffect(() => {
    move();
    const id = requestAnimationFrame(() => bar.current?.setAttribute("data-ready", ""));
    return () => cancelAnimationFrame(id);
  }, [index]);

  useEffect(() => {
    addEventListener("resize", move);
    return () => removeEventListener("resize", move);
  }, [index]);

  useEffect(() => {
    const onKey = (event) => {
      const target = event.target;
      if (
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.isContentEditable ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const number = Number(event.key);
      if (number >= 1 && number <= DIRECTIONS.length) setIndex(number - 1);
      else if (event.key === "ArrowRight")
        setIndex((index + 1) % DIRECTIONS.length);
      else if (event.key === "ArrowLeft")
        setIndex((index - 1 + DIRECTIONS.length) % DIRECTIONS.length);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [index]);

  return (
    <nav ref={bar} class="proto-picker" aria-label="Visual directions">
      <span ref={highlight} class="proto-picker-highlight" aria-hidden="true" />
      {DIRECTIONS.map((item, i) => (
        <button
          key={item.id}
          ref={(element) => {
            items.current[i] = element;
          }}
          type="button"
          class="proto-picker-item"
          data-active={index === i ? "" : undefined}
          aria-current={index === i ? "true" : undefined}
          title={item.note}
          onClick={() => setIndex(i)}
        >
          <b>{i + 1}</b>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

render(<App />, document.getElementById("app"));
