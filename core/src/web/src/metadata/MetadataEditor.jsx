import { useEffect, useMemo, useState } from "preact/hooks";
import { useStore } from "../store.jsx";
import { hostOf, DEFAULT_SAMPLE } from "../lib/fonts.js";
import { Preview } from "../catalog/Preview.jsx";
import { Button } from "../ui/Button.jsx";
import { Slider } from "../ui/Slider.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { Checkbox } from "../ui/Checkbox.jsx";
import { MetadataIntro } from "../sections/MetadataIntro.jsx";
import { ExportSettings } from "../catalog/ExportSettings.jsx";
import { ExportReport } from "../catalog/Reports.jsx";
import { MetaField, BeforeAfter } from "./MetaField.jsx";
import {
  LICENSE_PRESETS,
  draftIssues,
  effectiveNames,
  faceDiffers,
  faceLabel,
  fileStem,
  issueFor,
  sourceName,
  sourceFamily,
} from "./derive.js";

// ---------------------------------------------------------------------------
// MetadataEditor -- specimen-sheet layout.
//
// The global Header already handles identity, back-button, and theme. This
// component only draws the content area: a secondary action bar, the family
// headline, a control strip, proof rows, family records, and a status footer.
// ---------------------------------------------------------------------------

/** Group key for metadata fonts: uses names.family, not the catalogue familyKey. */
function metaFamily(font) {
  return (font.names?.family || "").trim().toLowerCase() || "unnamed";
}

export function MetadataEditor() {
  const store = useStore();
  const meta = store.metadata;

  // All hooks before any conditional return.
  const issues = useMemo(
    () => draftIssues(meta),
    [meta.fonts, meta.familyDraft, meta.faceDrafts],
  );

  const families = useMemo(() => {
    const seen = new Map();
    for (const f of meta.fonts) {
      const key = metaFamily(f);
      if (!seen.has(key)) seen.set(key, sourceFamily(f) || "Unnamed");
    }
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [meta.fonts]);

  const [activeKey, setActiveKey] = useState("");
  const [proofSize, setProofSize] = useState(42);

  useEffect(() => {
    document.getElementById("metadata")?.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: "instant" });
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--proof-size", proofSize + "px");
  }, [proofSize]);

  useEffect(() => {
    if (families.length && !families.some((f) => f.key === activeKey)) {
      setActiveKey(families[0].key);
    }
  }, [families, activeKey]);

  // Derived values that depend on hooks above.
  const first = meta.fonts[0];
  const family = first ? effectiveNames(meta, first).family : "";
  const source = meta.source;
  const originLabel =
    source?.kind === "upload"
      ? "Your files"
      : source?.url
        ? hostOf(source.url)
        : "";

  // --- Loading / empty states (after all hooks) ---
  if (meta.inspecting) {
    return (
      <main class="metadata" id="metadata" tabindex="-1">
        <p class="metadata-loading" role="status">
          <Spinner size={18} />
          {meta.status?.message || "Reading the names…"}
        </p>
      </main>
    );
  }
  if (!meta.fonts.length) {
    return (
      <main class="metadata" id="metadata" tabindex="-1">
        <EmptyEditor />
      </main>
    );
  }

  const fonts = meta.fonts.filter((f) => metaFamily(f) === activeKey);
  const changing = meta.fonts.filter((f) => faceDiffers(meta, f)).length;
  const total = meta.fonts.length;

  return (
    <main class="metadata metadata-specimen" id="metadata" tabindex="-1">
      <ActionBar count={fonts.length} issues={issues} />
      <FamilyHeadline family={family} total={total} changing={changing} origin={originLabel} />
      <ControlStrip
        families={families}
        activeKey={activeKey}
        setActiveKey={setActiveKey}
        proofSize={proofSize}
        setProofSize={setProofSize}
      />
      <section class="sp-proofs" aria-label="Faces">
        {fonts.map((font) => (
          <ProofRow key={font.id} font={font} issues={issues} />
        ))}
      </section>
      <InspectFailures />
      <FamilyRecords issues={issues} />
      <StatusFooter changing={changing} total={total} />
    </main>
  );
}

/* -- Files that could not be read ---------------------------------------- */

/**
 * Named here rather than only in the empty editor: when some files were read
 * and others were not, the ones that failed still have to be accounted for,
 * or a person is left comparing counts to work out what is missing.
 */
function InspectFailures() {
  const store = useStore();
  const failures = store.metadata.failures;
  if (!failures.length) return null;

  return (
    <section class="metadata-failures" aria-labelledby="meta-failures-title">
      <h3 id="meta-failures-title">Could not be read</h3>
      <ul>
        {failures.map((failure) => (
          <li key={failure.id}>
            <span class="metadata-failure-name">
              {failure.file || failure.id}
            </span>
            <span class="metadata-failure-why">{failure.error}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -- Action bar (below the global Header) -------------------------------- */

function ActionBar({ count, issues }) {
  const store = useStore();
  const meta = store.metadata;
  const verb = store.delivery === "folder" ? "Save" : "Write";
  return (
    <>
      {issues.length ? (
        <div class="metadata-issues" role="alert">
          <strong>
            {issues.length} field{issues.length === 1 ? "" : "s"} need
            attention:
          </strong>
          <ul>
            {issues.map((issue) => (
              <li key={issue.key}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div class="sp-action-bar">
        <ExportSettings busy={meta.applying} />
        <Button size="s" variant="outline" onClick={store.closeMetadata}>Back</Button>
        <Button
          id="metadata-apply"
          size="s"
          variant="solid"
          busy={meta.applying}
          disabled={!count || meta.applying || issues.length > 0}
          onClick={() => store.applyMetadata()}
        >
          {verb} {count} {count === 1 ? "copy" : "copies"}
        </Button>
      </div>
    </>
  );
}

/* -- Family headline ------------------------------------------------------ */

function FamilyHeadline({ family, total, changing, origin }) {
  const store = useStore();
  const meta = store.metadata;
  const typed = meta.familyDraft.family;
  const edited = typed !== undefined;
  const value = edited ? typed : family;
  const original = sharedOriginal(meta.fonts, "family");

  return (
    <section class="sp-hero">
      <label class="sp-hero-label" for="meta-family">Family name</label>
      <input
        id="meta-family"
        class="sp-hero-input"
        value={value}
        placeholder="Family name"
        spellcheck={false}
        autocomplete="off"
        disabled={meta.applying}
        onInput={(e) => store.setFamilyField("family", e.currentTarget.value)}
      />
      <div class="sp-hero-stats">
        <span>{total} face{total === 1 ? "" : "s"}</span>
        <span>{changing} changing</span>
        {origin ? <span>{origin}</span> : null}
      </div>
      {edited ? (
        <button type="button" class="sp-hero-reset" onClick={() => store.resetField("family", "family")}>
          Reset to {original || "not set"}
        </button>
      ) : null}
    </section>
  );
}

/* -- Control strip -------------------------------------------------------- */

function ControlStrip({ families, activeKey, setActiveKey, proofSize, setProofSize }) {
  const store = useStore();

  return (
    <div class="sp-strip">
      {families.length > 1 ? (
        <Segmented
          label="Family"
          size="s"
          options={families.map((f) => ({
            value: f.key,
            label: f.label,
            badge: store.metadata.fonts.filter((x) => metaFamily(x) === f.key).length,
          }))}
          value={activeKey}
          onChange={setActiveKey}
        />
      ) : null}
      <div class="sp-strip-spacer" />
      <label class="sp-proof-text">
        <span class="field-label">Proof text</span>
        <input
          value={store.sample}
          placeholder={DEFAULT_SAMPLE}
          onInput={(e) => store.patch({ sample: e.currentTarget.value })}
        />
      </label>
      <Slider label="Size" value={proofSize} min={18} max={96} step={1} suffix="px" onInput={setProofSize} />
    </div>
  );
}

/* -- Proof row ------------------------------------------------------------ */

function ProofRow({ font, issues }) {
  const store = useStore();
  const meta = store.metadata;
  const draft = meta.faceDrafts[font.id] || {};
  const manual = Boolean(draft.manual);
  const eff = effectiveNames(meta, font);
  const differs = faceDiffers(meta, font);
  const label = faceLabel(meta, font);
  const stem = fileStem(font.file);
  const ext = font.format === "woff2" ? "otf" : font.format || "otf";
  const sample = store.sampleText;
  const preview = meta.previews[font.id];

  // Turning this on copies the derived names into the draft, which is also
  // what stops a later family rename from rewriting them.
  const toggleManual = (on) =>
    store.setFaceField(
      font.id,
      on
        ? {
            manual: true,
            subfamily: eff.subfamily,
            full_name: eff.full_name,
            postscript: eff.postscript,
            filename: eff.filename,
          }
        : {
            manual: false,
            subfamily: undefined,
            full_name: undefined,
            postscript: undefined,
            filename: undefined,
          },
    );

  const faceField = (key, fieldLabel, extra = {}) => (
    <MetaField
      id={"meta-" + key + "-" + font.id}
      label={fieldLabel}
      value={draft[key]}
      error={issueFor(issues, key + ":" + font.id)}
      disabled={meta.applying}
      onChange={(v) => store.setFaceField(font.id, key, v)}
      onReset={() => store.resetField("face", key, font.id)}
      {...extra}
    />
  );

  return (
    <article class="sp-proof" data-differs={String(differs)}>
      <div class="sp-proof-left">
        <div class="sp-proof-specimen">
          {preview ? (
            <Preview font={preview} text={sample} />
          ) : (
            <p class="preview is-failed" style={"font-size:var(--proof-size,42px)"}>{sample}</p>
          )}
        </div>
        <div class="sp-proof-caption">
          <span class="sp-proof-style">{label}</span>
          <span class="sp-proof-diff">
            <BeforeAfter before={stem + "." + ext} after={eff.filename + "." + ext} />
          </span>
        </div>
      </div>
      <div class="sp-proof-divider" aria-hidden="true" />
      <div class="sp-proof-right">
        <div class="sp-proof-manual">
          <Checkbox
            checked={manual}
            disabled={meta.applying}
            label={"Edit the names of " + label + " by hand"}
            onChange={toggleManual}
          />
        </div>
        {manual ? (
          <>
            {faceField("subfamily", "Style name", {
              original: sourceName(font, "subfamily"),
            })}
            {faceField("full_name", "Full name", {
              original: sourceName(font, "full_name"),
            })}
            {faceField("postscript", "PostScript name", {
              original: sourceName(font, "postscript"),
              mono: true,
              hint: "ASCII, no spaces, at most 63 characters.",
            })}
            {faceField("filename", "File name", {
              original: stem,
              mono: true,
              hint: "Without the extension.",
            })}
          </>
        ) : (
          <>
        <div class="sp-proof-field">
          <span class="sp-proof-field-label">Style name</span>
          <span class="sp-proof-field-value">{eff.subfamily || "not set"}</span>
        </div>
        <div class="sp-proof-field">
          <span class="sp-proof-field-label">Full name</span>
          <span class="sp-proof-field-value">{eff.full_name || "not set"}</span>
        </div>
        <div class="sp-proof-field is-mono">
          <span class="sp-proof-field-label">PostScript</span>
          <span class="sp-proof-field-value">{eff.postscript || "not set"}</span>
        </div>
        <div class="sp-proof-field is-mono">
          <span class="sp-proof-field-label">File name</span>
          <span class="sp-proof-field-value">{eff.filename + "." + ext}</span>
        </div>
          </>
        )}
      </div>
    </article>
  );
}

/* -- Family records ------------------------------------------------------- */

function FamilyRecords({ issues }) {
  const store = useStore();
  const meta = store.metadata;
  const fonts = meta.fonts;
  const [open, setOpen] = useState(true);

  const field = (key, label, extra = {}) => (
    <MetaField
      id={"meta-" + key}
      label={label}
      value={meta.familyDraft[key]}
      original={sharedOriginal(fonts, key)}
      hint={variesHint(fonts, key)}
      error={issueFor(issues, key)}
      disabled={meta.applying}
      onChange={(v) => store.setFamilyField(key, v)}
      onReset={() => store.resetField("family", key)}
      {...extra}
    />
  );

  const license = valueOf(meta, fonts, "license");
  const preset = meta.familyDraft.licensePreset || presetOf(license) || "custom";
  const choosePreset = (value) => {
    const chosen = LICENSE_PRESETS.find((p) => p.value === value);
    if (!chosen || !chosen.text) { store.setFamilyField({ licensePreset: value }); return; }
    store.setFamilyField({ licensePreset: value, license: chosen.text, license_url: chosen.url });
  };

  return (
    <section class="sp-records">
      <button type="button" class="sp-records-toggle" aria-expanded={String(open)} onClick={() => setOpen(!open)}>
        <span class="sp-records-chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span class="field-label">Family records</span>
      </button>
      {open ? (
        <div class="sp-records-grid">
          <div class="sp-records-col">
            <h3 class="field-label">Authorship</h3>
            {field("manufacturer", "Author or foundry")}
            {field("designer", "Designer")}
            {field("vendor_url", "Foundry website", { placeholder: "https://example.com" })}
            {field("designer_url", "Designer website", { placeholder: "https://example.com" })}
          </div>
          <div class="sp-records-col">
            <h3 class="field-label">Legal</h3>
            <Segmented label="Licence" size="s" options={LICENSE_PRESETS} value={preset} disabled={meta.applying} onChange={choosePreset} />
            {field("copyright", "Copyright", { multiline: true, rows: 2 })}
            {field("trademark", "Trademark")}
            {field("license", "Licence text", { multiline: true, rows: 2 })}
            {field("license_url", "Licence address", { placeholder: "https://example.com/license" })}
          </div>
          <div class="sp-records-col">
            <h3 class="field-label">Version and description</h3>
            {field("version", "Version", { placeholder: "1.000", mono: true })}
            {field("description", "Description", { multiline: true, rows: 3 })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/* -- Status footer -------------------------------------------------------- */

function StatusFooter({ changing, total }) {
  const store = useStore();
  const meta = store.metadata;
  const status = meta.status;
  const nameFor = (item) => {
    const font = meta.fonts.find((c) => c.id === item.id);
    if (!font) return item.family || item.id;
    return effectiveNames(meta, font).family + " " + faceLabel(meta, font);
  };
  return (
    <footer class="sp-footer">
      <p class="sp-footer-status" role="status">
        {status
          ? status.message
          : changing
            ? changing + " of " + total + " files will be rewritten. Originals are never touched."
            : "No changes yet. Originals are never touched."}
      </p>
      {meta.report ? (
        <>
          <ExportReport title="Metadata results" report={meta.report} nameFor={nameFor} onDismiss={store.editMetadataAgain} onRetry={store.retryMetadata} />
          <Button
            variant="outline"
            size="s"
            icon="pencil"
            onClick={store.editMetadataAgain}
          >
            Edit again
          </Button>
        </>
      ) : null}
    </footer>
  );
}

/* -- Empty editor --------------------------------------------------------- */

function EmptyEditor() {
  const store = useStore();
  const meta = store.metadata;
  return (
    <div class="metadata-empty">
      {meta.status ? (
        <p class={"status status-" + (meta.status.kind || "plain")} role={meta.status.kind === "error" ? "alert" : "status"}>
          {meta.status.message}
        </p>
      ) : null}
      {meta.failures.length ? (
        <ul class="metadata-empty-failures">
          {meta.failures.map((f) => (
            <li key={f.id}>
              <span class="metadata-failure-name">{f.file || f.id}</span>
              <span class="metadata-failure-why">{f.error}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <MetadataIntro />
    </div>
  );
}

/* -- Helpers -------------------------------------------------------------- */

function sharedOriginal(fonts, key) {
  const values = new Set(fonts.map((f) => sourceName(f, key) ?? ""));
  return values.size === 1 ? ([...values][0] || null) : null;
}
function variesHint(fonts, key) {
  if (fonts.length < 2) return undefined;
  const values = new Set(fonts.map((f) => sourceName(f, key) ?? ""));
  return values.size > 1 ? "The files do not agree on this. Editing it sets all of them." : undefined;
}
function valueOf(meta, fonts, key) {
  const typed = meta.familyDraft[key];
  return typed === undefined ? sharedOriginal(fonts, key) : typed;
}
function presetOf(license) {
  if (!license) return null;
  return LICENSE_PRESETS.find((p) => p.text && p.text === license)?.value || null;
}
