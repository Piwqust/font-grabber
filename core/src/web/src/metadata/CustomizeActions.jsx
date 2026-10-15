import { useState } from "preact/hooks";
import { useStore } from "../store.jsx";
import { Button } from "../ui/Button.jsx";
import { Popover } from "../ui/Popover.jsx";
import { ExportSettings } from "../catalog/ExportSettings.jsx";
import { METADATA_PRESETS, draftIssues } from "./derive.js";

export function CustomizeActions() {
  const store = useStore();
  const meta = store.metadata;
  if (!meta.fonts.length) return null;
  const total = meta.fonts.length;
  return <div class="customize-actions">
    <Presets onApplied={() => document.getElementById("meta-license-title")?.scrollIntoView({ block: "start" })} />
    <ExportSettings busy={meta.applying} />
    <Button id="metadata-apply" size="s" variant="solid" icon="download"
      busy={meta.applying} disabled={meta.applying || draftIssues(meta).length > 0}
      onClick={() => store.applyMetadata()}>
      {store.delivery === "folder" ? "Save" : "Download"} {total} {total === 1 ? "copy" : "copies"}
    </Button>
  </div>;
}

function Presets({ onApplied }) {
  const store = useStore();
  const [selected, setSelected] = useState(METADATA_PRESETS[0].value);
  const [undo, setUndo] = useState(null);
  const preset = METADATA_PRESETS.find((item) => item.value === selected);
  const busy = store.metadata.applying;
  const apply = (event) => {
    const previous = Object.fromEntries(Object.keys(preset.fields).map((key) => [key, store.metadata.familyDraft[key]]));
    setUndo({ previous, fields: preset.fields, label: preset.label });
    store.setFamilyField(preset.fields);
    event.currentTarget.closest("[popover]")?.hidePopover();
    onApplied();
  };
  const restore = () => {
    // Preserve any edits made after the preset was applied.
    const fields = Object.fromEntries(Object.entries(undo.previous).filter(([key]) => store.metadata.familyDraft[key] === undo.fields[key]));
    store.setFamilyField(fields);
    setUndo(null);
  };
  return <Popover title="Metadata presets" trigger={<Button class="presets-trigger" size="s" variant="quiet" icon="spark" disabled={busy} aria-label="Presets">Presets</Button>}>
    <p class="me-preset-intro">Fill in licence details and version for every selected file.</p>
    <div class="me-presets" role="group" aria-label="Choose a metadata preset">
      {METADATA_PRESETS.map((item) => <button key={item.value} type="button" class="me-preset-item"
        aria-pressed={selected === item.value} disabled={busy} onClick={() => setSelected(item.value)}>
        <span class="me-preset-label">{item.label}</span><span class="me-preset-desc">{item.description}</span>
      </button>)}
    </div>
    <div class="me-preset-preview"><span class="field-label">Values to apply</span>
      <p>{preset.fields.license}</p>
      <p class="me-preset-url">{preset.fields.license_url || "Licence address: cleared"}</p>
      <p>Version {preset.fields.version}</p>
    </div>
    <p class="popover-note">Replaces licence text, licence address and version. Use the licence that applies to your font.</p>
    <Button size="s" variant="solid" disabled={busy} onClick={apply}>Apply preset</Button>
    {undo ? <div class="me-preset-undo"><span role="status">Applied: {undo.label}</span><Button size="s" variant="quiet" disabled={busy} icon="undo" onClick={restore}>Undo preset</Button></div> : null}
  </Popover>;
}

