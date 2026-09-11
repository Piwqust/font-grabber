import { useState } from "preact/hooks";
import { weightName } from "../lib/fonts.js";
import { Reveal } from "../ui/Reveal.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { Slider } from "../ui/Slider.jsx";
import { Field } from "../ui/Field.jsx";

const FACES = [
  {
    value: "sans",
    label: "Geist",
    stack: "var(--sans)",
    weights: [400, 600, 800],
  },
  {
    value: "serif",
    label: "Newsreader",
    stack: "var(--serif)",
    weights: [400, 700],
  },
  { value: "mono", label: "Plex Mono", stack: "var(--mono)", weights: [400] },
];

/**
 * A working type tester using the faces this page already loads. It is the
 * same preview model the catalogue uses, so what it feels like here is what a
 * scanned face will feel like.
 */
export function Playground() {
  const [face, setFace] = useState("serif");
  const [size, setSize] = useState(64);
  const [weight, setWeight] = useState(400);
  const [italic, setItalic] = useState(false);
  const [text, setText] = useState("Handgloves & quartz sphinx");

  const active = FACES.find((option) => option.value === face);
  const weights = active.weights;
  const currentWeight = weights.includes(weight) ? weight : weights[0];

  return (
    <section
      class="section playground"
      id="playground"
      aria-labelledby="playground-title"
    >
      <div class="section-head">
        <Reveal as="p" class="eyebrow">
          Try it
        </Reveal>
        <Reveal as="h2" class="section-title" id="playground-title" delay={60}>
          Type something.
          <br /> See it set.
        </Reveal>
      </div>

      <Reveal class="playground-panel" delay={100}>
        <div
          class="playground-canvas"
          style={`font-family:${active.stack};font-size:${size}px;font-weight:${currentWeight};font-style:${
            italic ? "italic" : "normal"
          }`}
        >
          <p class="playground-specimen">{text || "Type something."}</p>
        </div>

        <div class="playground-controls">
          <Field
            label="Specimen text"
            hideLabel
            size="m"
            value={text}
            maxLength={80}
            placeholder="Type something"
            onInput={(event) => setText(event.currentTarget.value)}
            class="playground-text"
          />

          <Control label="Typeface">
            <Segmented
              label="Typeface"
              size="s"
              options={FACES.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={face}
              onChange={(next) => {
                setFace(next);
                const nextWeights = FACES.find((o) => o.value === next).weights;
                if (!nextWeights.includes(weight)) setWeight(nextWeights[0]);
                if (next === "mono") setItalic(false);
              }}
            />
          </Control>

          <Control label="Weight">
            <Segmented
              label="Weight"
              size="s"
              // A type tester names its weights the way a specimen does.
              options={weights.map((value) => ({
                value: String(value),
                label: weightName(value),
              }))}
              value={String(currentWeight)}
              onChange={(next) => setWeight(Number(next))}
            />
          </Control>

          <Control label="Style">
            <Segmented
              label="Style"
              size="s"
              options={[
                { value: "normal", label: "Roman" },
                { value: "italic", label: "Italic" },
              ]}
              value={italic ? "italic" : "normal"}
              disabled={face === "mono"}
              onChange={(next) => setItalic(next === "italic")}
            />
          </Control>

          <Slider
            label="Size"
            min={28}
            max={132}
            suffix=" px"
            value={size}
            onInput={setSize}
            class="playground-size"
          />
        </div>
      </Reveal>
    </section>
  );
}

/** A visible caption for a control whose own label is screen-reader only. */
function Control({ label, children }) {
  return (
    <div class="playground-control">
      <span class="playground-control-label" aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}
