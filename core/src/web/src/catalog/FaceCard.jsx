import { useStore } from "../store.jsx";
import { faceStyle, faceWeight, familyName, styleLabel } from "../lib/fonts.js";
import { Button } from "../ui/Button.jsx";
import { Checkbox } from "../ui/Checkbox.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";
import { Preview } from "./Preview.jsx";

/** The button says what will actually happen, which depends on the delivery. */
function downloadLabel(status, delivery) {
  if (status === "preparing") return "Preparing…";
  if (status === "error") return "Retry";
  const verb = delivery === "folder" ? "Save" : "Download ZIP";
  return status === "done" ? `${verb} again` : verb;
}

/**
 * One face. The whole card toggles selection, so the target is the card and
 * not just the checkbox — clicks that land on a control inside it, or that
 * finish a text selection, are left alone.
 */
export function FaceCard({ font }) {
  const store = useStore();
  const selected = store.selectedSet.has(font.id);
  const style = styleLabel(font);
  const family = familyName(font);
  const source = font.sources?.[0];
  const status = store.downloadStates[font.id];
  const weight = font.variable ? font.weight : faceWeight(font);
  const info = [weight, font.stretch, source?.format].filter(Boolean);
  const action = downloadLabel(status, store.delivery);

  const onCardClick = (event) => {
    if (store.busy) return;
    if (event.target.closest("input, button, label, summary, a, .disclosure"))
      return;
    if (getSelection()?.toString()) return;
    store.toggleFace(font.id, !selected);
  };

  return (
    <article
      class="face"
      data-selected={String(selected)}
      data-downloaded={String(status === "done")}
      onClick={onCardClick}
    >
      <div class="face-head">
        <div class="face-id">
          <h4 class="face-family">{family}</h4>
          <span class="face-style">{style}</span>
        </div>
        <Checkbox
          checked={selected}
          disabled={store.busy}
          label={`Select ${family} ${style}`}
          hideLabel
          onChange={(next) => store.toggleFace(font.id, next)}
        />
      </div>

      <Preview font={font} text={store.sampleText} />

      <div class="face-foot">
        <span class="face-info">{info.join(" · ")}</span>
        <Button
          size="s"
          variant="quiet"
          icon="download"
          disabled={store.busy}
          onClick={() => store.download([font.id])}
          aria-label={`${action} ${family} ${style}`}
        >
          {action}
        </Button>
      </div>

      <Disclosure summary="File details" class="face-details">
        <dl class="detail-list">
          <div>
            <dt>Type</dt>
            <dd>
              {font.variable ? "Variable font" : "Static font"} · Weight{" "}
              {weight} · {faceStyle(font)}
            </dd>
          </div>
          <div>
            <dt>Character range</dt>
            <dd>
              {font.unicode_range ||
                "Not declared by the website. Use Check selected text to inspect the file."}
            </dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd class="detail-source">{source?.url || "Unavailable"}</dd>
          </div>
        </dl>
      </Disclosure>
    </article>
  );
}
