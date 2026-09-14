import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useStore } from "../store.jsx";
import { hostOf, DEFAULT_SAMPLE } from "../lib/fonts.js";
import { Preview } from "../catalog/Preview.jsx";
import { Button } from "../ui/Button.jsx";
import { Slider } from "../ui/Slider.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { Checkbox } from "../ui/Checkbox.jsx";
import { Icon } from "../ui/Icon.jsx";
import { MetadataIntro } from "../sections/MetadataIntro.jsx";
import { ExportSettings } from "../catalog/ExportSettings.jsx";
import { ExportReport } from "../catalog/Reports.jsx";
import { Popover } from "../ui/Popover.jsx";
import { MetaField, BeforeAfter } from "./MetaField.jsx";
import {
  LICENSE_PRESETS,
  METADATA_PRESETS,
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
// MetadataEditor -- an inspector, not a scrolling form.
//
// The page is a workspace with a fixed frame: a bar that always says what is
// being written and offers the one action, a rail of the faces being edited,
// and one face open at a time set large in its own type. Family-wide records
// live on a second tab, because they are a different job from naming a face.
//
// Layout classes are prefixed `me-`. A few older names (.sp-proof, .sp-proofs,
// .sp-records-toggle, .sp-hero-stats) are kept where they still describe the
// same thing, so the QA scripts keep their hold on the parts that did not
// change meaning.
// ---------------------------------------------------------------------------

/** Group key for metadata fonts: uses names.family, not the catalogue familyKey. */
function metaFamily(font) {
  return (font.names?.family || "").trim().toLowerCase() || "unnamed";
}

export function MetadataEditor() {
  const store = useStore();
  const meta = store.metadata;

  // Every hook runs before the loading and empty branches below.
  const issues = useMemo(
    () => draftIssues(meta),
    [meta.fonts, meta.familyDraft, meta.faceDrafts],
  );

  const families = useMemo(() => {
    const seen = new Map();
    for (const font of meta.fonts) {
      const key = metaFamily(font);
      if (!seen.has(key)) seen.set(key, sourceFamily(font) || "Unnamed");
    }
    return [...seen.entries()].map(([key, label]) => ({ key, label }));
  }, [meta.fonts]);

  const [activeFamily, setActiveFamily] = useState("");
  const [pickedId, setPickedId] = useState(null);
  const [proofSize, setProofSize] = useState(56);
  const [tab, setTab] = useState("faces");

  const fonts = useMemo(
    () => meta.fonts.filter((font) => metaFamily(font) === activeFamily),
    [meta.fonts, activeFamily],
  );

  // The open face, resolved rather than stored: a family switch, a reload or a
  // file that failed to read must never leave the rail pointing at nothing.
  const openId = fonts.some((font) => font.id === pickedId)
    ? pickedId
    : fonts[0]?.id || null;
  const open = fonts.find((font) => font.id === openId) || null;

  useEffect(() => {
    document.getElementById("metadata")?.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: "instant" });
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--proof-size", proofSize + "px");
  }, [proofSize]);

  useEffect(() => {
    if (families.length && !families.some((f) => f.key === activeFamily)) {
      setActiveFamily(families[0].key);
    }
  }, [families, activeFamily]);

  const first = meta.fonts[0];
  const family = first ? effectiveNames(meta, first).family : "";
  const source = meta.source;
  const origin =
    source?.kind === "upload"
      ? "Your files"
      : source?.url
        ? hostOf(source.url)
        : "";

  if (meta.inspecting) {
    return (
      <main class="metadata me" id="metadata" tabindex="-1">
        <p class="metadata-loading me-loading" role="status">
          <Spinner size={18} />
          {meta.status?.message || "Reading the names\u2026"}
        </p>
      </main>
    );
  }

  if (!meta.fonts.length) {
    return (
      <main class="metadata me" id="metadata" tabindex="-1">
        <EmptyEditor />
      </main>
    );
  }

  const changing = meta.fonts.filter((font) => faceDiffers(meta, font)).length;
  const total = meta.fonts.length;

  return (
    <main class="metadata me metadata-specimen" id="metadata" tabindex="-1">
      <Bar
        family={family}
        total={total}
        changing={changing}
        origin={origin}
        issues={issues}
        families={families}
        activeFamily={activeFamily}
        setActiveFamily={setActiveFamily}
      />

      <Issues issues={issues} />

      <div class="me-tabs" role="tablist" aria-label="What is being edited">
        <button
          type="button"
          role="tab"
          class="me-tab"
          id="meta-tab-faces"
          aria-selected={String(tab === "faces")}
          aria-controls="meta-panel-faces"
          data-active={String(tab === "faces")}
          onClick={() => setTab("faces")}
        >
          Faces
          <span class="me-tab-count">{total}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="me-tab sp-records-toggle"
          id="meta-tab-records"
          aria-selected={String(tab === "records")}
          aria-expanded={String(tab === "records")}
          aria-controls="meta-panel-records"
          data-active={String(tab === "records")}
          onClick={() => setTab("records")}
        >
          Family records
        </button>
      </div>

      {tab === "faces" ? (
        <div
          class="me-work"
          id="meta-panel-faces"
          role="tabpanel"
          aria-labelledby="meta-tab-faces"
        >
          <Rail fonts={fonts} openId={openId} onPick={setPickedId} />
          <section class="sp-proofs me-stage" aria-label="Faces">
            {open ? (
              <Face
                key={open.id}
                font={open}
                issues={issues}
                proofSize={proofSize}
                setProofSize={setProofSize}
              />
            ) : null}
          </section>
        </div>
      ) : (
        <Records issues={issues} />
      )}

      <Failures />
      <Footer changing={changing} total={total} />
    </main>
  );
}

/* -- The bar -------------------------------------------------------------- */

/**
 * What is being written, and the only action that writes it. It stays against
 * the header while the stage scrolls, so the family name and the button are
 * never somewhere further up the page.
 */
function Bar({
  family,
  total,
  changing,
  origin,
  issues,
  families,
  activeFamily,
  setActiveFamily,
}) {
  const store = useStore();
  const meta = store.metadata;
  const typed = meta.familyDraft.family;
  const edited = typed !== undefined;
  const value = edited ? typed : family;
  const original = sharedOriginal(meta.fonts, "family");
  const verb = store.delivery === "folder" ? "Save" : "Write";

  // Sticky border appears after a short scroll so the bar reads as pinned.
  const barRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => {
      setScrolled((was) => (was ? scrollY > 8 : scrollY > 32));
    };
    addEventListener("scroll", onScroll, { passive: true });
    return () => removeEventListener("scroll", onScroll);
  }, []);

  const applyPreset = (preset) => {
    store.setFamilyField(preset.fields);
  };

  return (
    <header class="me-bar sp-hero" ref={barRef} data-scrolled={String(scrolled)}>
      <div class="me-bar-name">
        <label class="me-bar-label" for="meta-family">
          Family name
        </label>
        <div class="me-bar-field">
          <input
            id="meta-family"
            class="me-bar-input sp-hero-input"
            value={value}
            placeholder="Family name"
            spellcheck={false}
            autocomplete="off"
            disabled={meta.applying}
            onInput={(event) =>
              store.setFamilyField("family", event.currentTarget.value)
            }
          />
          {edited ? (
            <button
              type="button"
              class="me-bar-reset sp-hero-reset"
              onClick={() => store.resetField("family", "family")}
            >
              <Icon name="undo" size={13} />
              Reset to {original || "not set"}
            </button>
          ) : null}
        </div>
        <p class="me-bar-stats sp-hero-stats">
          <span>
            {total} face{total === 1 ? "" : "s"}
          </span>
          <span data-live={String(changing > 0)}>{changing} changing</span>
          {origin ? <span>{origin}</span> : null}
        </p>
      </div>

      <div class="me-bar-actions">
        <Popover
          title="Quick fill"
          trigger={
            <Button size="s" variant="quiet" icon="spark" disabled={meta.applying}>
              Presets
            </Button>
          }
        >
          <div class="me-presets">
            {METADATA_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                class="me-preset-item"
                onClick={() => applyPreset(preset)}
              >
                <span class="me-preset-label">{preset.label}</span>
                <span class="me-preset-desc">{preset.description}</span>
              </button>
            ))}
          </div>
          <p class="popover-note">
            Fills in licence and version. The family name stays as you typed it.
          </p>
        </Popover>
        {families.length > 1 ? (
          <Segmented
            label="Family"
            size="s"
            options={families.map((item) => ({
              value: item.key,
              label: item.label,
            }))}
            value={activeFamily}
            onChange={setActiveFamily}
          />
        ) : null}
        <ExportSettings busy={meta.applying} />
        <Button size="s" variant="outline" onClick={store.closeMetadata}>
          Back
        </Button>
        <Button
          id="metadata-apply"
          size="s"
          variant="solid"
          busy={meta.applying}
          disabled={!total || meta.applying || issues.length > 0}
          onClick={() => store.applyMetadata()}
        >
          {verb} {total} {total === 1 ? "copy" : "copies"}
        </Button>
      </div>
    </header>
  );
}

function Issues({ issues }) {
  if (!issues.length) return null;
  return (
    <div class="metadata-issues me-issues" role="alert">
      <strong>
        {issues.length} field{issues.length === 1 ? "" : "s"} need attention:
      </strong>
      <ul>
        {issues.map((issue) => (
          <li key={issue.key}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}

/* -- The rail ------------------------------------------------------------- */

/**
 * The faces, each set in its own type. Selection is a filled block rather than
 * an outline, and a face the draft touches carries a mark, so the rail answers
 * "what is going to change" without opening anything.
 */
function Rail({ fonts, openId, onPick }) {
  const store = useStore();
  const meta = store.metadata;

  return (
    <div class="me-rail" role="tablist" aria-label="Faces" aria-orientation="vertical">
      {fonts.map((font) => {
        const label = faceLabel(meta, font);
        const differs = faceDiffers(meta, font);
        const active = font.id === openId;
        const preview = meta.previews[font.id];
        return (
          <button
            type="button"
            role="tab"
            key={font.id}
            class="me-rail-item"
            data-active={String(active)}
            data-differs={String(differs)}
            aria-selected={String(active)}
            onClick={() => onPick(font.id)}
          >
            <span class="me-rail-mark" aria-hidden="true" />
            <span class="me-rail-sample">
              {preview ? (
                <Preview font={preview} text="Aa" />
              ) : (
                <span class="me-rail-sample-fallback">Aa</span>
              )}
            </span>
            <span class="me-rail-text">
              <span class="me-rail-style">{label}</span>
              <span class="me-rail-file">{fileStem(font.file)}</span>
            </span>
            {differs ? <span class="me-rail-dot" title="Edited" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/* -- One face ------------------------------------------------------------- */

function Face({ font, issues, proofSize, setProofSize }) {
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
      onChange={(next) => store.setFaceField(font.id, key, next)}
      onReset={() => store.resetField("face", key, font.id)}
      {...extra}
    />
  );

  return (
    <article class="sp-proof me-face" data-differs={String(differs)}>
      <div class="me-specimen">
        <div class="me-specimen-type">
          {preview ? (
            <Preview font={preview} text={sample} />
          ) : (
            <p
              class="preview is-failed"
              style="font-size:var(--proof-size,56px)"
            >
              {sample}
            </p>
          )}
        </div>
        <div class="me-specimen-controls">
          <label class="me-sample">
            <span class="field-label">Proof text</span>
            <input
              value={store.sample}
              placeholder={DEFAULT_SAMPLE}
              onInput={(event) =>
                store.patch({ sample: event.currentTarget.value })
              }
            />
          </label>
          <Slider
            label="Size"
            value={proofSize}
            min={18}
            max={120}
            step={1}
            suffix="px"
            onInput={setProofSize}
          />
        </div>
      </div>

      <div class="me-face-head">
        <h2 class="me-face-title">{label}</h2>
        <p class="me-face-file sp-proof-diff">
          <BeforeAfter
            before={stem + "." + ext}
            after={eff.filename + "." + ext}
          />
        </p>
      </div>

      <div class="me-face-switch">
        <Checkbox
          checked={manual}
          disabled={meta.applying}
          label={"Edit the names of " + label + " by hand"}
          onChange={toggleManual}
        />
        <p class="me-face-switch-note">
          {manual
            ? "These names stay as typed when the family is renamed."
            : "These names follow the family name."}
        </p>
      </div>

      {manual ? (
        <div class="me-face-fields">
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
        </div>
      ) : (
        <dl class="me-face-records">
          <Record label="Style name" value={eff.subfamily} />
          <Record label="Full name" value={eff.full_name} />
          <Record label="PostScript" value={eff.postscript} mono />
          <Record label="File name" value={eff.filename + "." + ext} mono />
        </dl>
      )}
    </article>
  );
}

/** One derived name. Kept on the old class names: it is the same record. */
function Record({ label, value, mono = false }) {
  return (
    <div class={"sp-proof-field me-record" + (mono ? " is-mono" : "")}>
      <dt class="sp-proof-field-label me-record-label">{label}</dt>
      <dd class="sp-proof-field-value me-record-value">{value || "not set"}</dd>
    </div>
  );
}

/* -- Family records ------------------------------------------------------- */

function Records({ issues }) {
  const store = useStore();
  const meta = store.metadata;
  const fonts = meta.fonts;

  const field = (key, label, extra = {}) => (
    <MetaField
      id={"meta-" + key}
      label={label}
      value={meta.familyDraft[key]}
      original={sharedOriginal(fonts, key)}
      hint={variesHint(fonts, key)}
      error={issueFor(issues, key)}
      disabled={meta.applying}
      onChange={(next) => store.setFamilyField(key, next)}
      onReset={() => store.resetField("family", key)}
      {...extra}
    />
  );

  const license = valueOf(meta, fonts, "license");
  const preset =
    meta.familyDraft.licensePreset || presetOf(license) || "custom";
  const choosePreset = (value) => {
    const chosen = LICENSE_PRESETS.find((item) => item.value === value);
    if (!chosen || !chosen.text) {
      store.setFamilyField({ licensePreset: value });
      return;
    }
    store.setFamilyField({
      licensePreset: value,
      license: chosen.text,
      license_url: chosen.url,
    });
  };

  return (
    <div
      class="me-records sp-records"
      id="meta-panel-records"
      role="tabpanel"
      aria-labelledby="meta-tab-records"
    >
      <p class="me-records-note">
        Written into every file in this selection. A field left alone keeps
        whatever the font already said.
      </p>
      <div class="me-records-grid sp-records-grid">
        <section class="me-records-col sp-records-col">
          <h3 class="me-records-title">Authorship</h3>
          {field("manufacturer", "Author or foundry")}
          {field("designer", "Designer")}
          {field("vendor_url", "Foundry website", {
            placeholder: "https://example.com",
          })}
          {field("designer_url", "Designer website", {
            placeholder: "https://example.com",
          })}
        </section>
        <section class="me-records-col sp-records-col">
          <h3 class="me-records-title">Legal</h3>
          <Segmented
            label="Licence"
            size="s"
            options={LICENSE_PRESETS}
            value={preset}
            disabled={meta.applying}
            onChange={choosePreset}
          />
          {field("copyright", "Copyright", { multiline: true, rows: 2 })}
          {field("trademark", "Trademark")}
          {field("license", "Licence text", { multiline: true, rows: 3 })}
          {field("license_url", "Licence address", {
            placeholder: "https://example.com/license",
          })}
        </section>
        <section class="me-records-col sp-records-col">
          <h3 class="me-records-title">Version and description</h3>
          {field("version", "Version", { placeholder: "1.000", mono: true })}
          {field("description", "Description", { multiline: true, rows: 4 })}
        </section>
      </div>
    </div>
  );
}

/* -- Files that could not be read ---------------------------------------- */

function Failures() {
  const store = useStore();
  const failures = store.metadata.failures;
  if (!failures.length) return null;

  return (
    <section
      class="metadata-failures me-failures"
      aria-labelledby="meta-failures-title"
    >
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

/* -- Footer --------------------------------------------------------------- */

function Footer({ changing, total }) {
  const store = useStore();
  const meta = store.metadata;
  const status = meta.status;
  const nameFor = (item) => {
    const font = meta.fonts.find((candidate) => candidate.id === item.id);
    if (!font) return item.family || item.id;
    return effectiveNames(meta, font).family + " " + faceLabel(meta, font);
  };

  return (
    <footer class="me-footer sp-footer">
      <p class="me-footer-status sp-footer-status" role="status">
        {status
          ? status.message
          : changing
            ? changing +
              " of " +
              total +
              " files will be rewritten. Originals are never touched."
            : "No changes yet. Originals are never touched."}
      </p>
      {meta.report ? (
        <div class="me-footer-report">
          <ExportReport
            title="Metadata results"
            report={meta.report}
            nameFor={nameFor}
            onDismiss={store.editMetadataAgain}
            onRetry={store.retryMetadata}
          />
          <Button
            variant="outline"
            size="s"
            icon="pencil"
            onClick={store.editMetadataAgain}
          >
            Edit again
          </Button>
        </div>
      ) : null}
    </footer>
  );
}

/* -- Empty editor --------------------------------------------------------- */

function EmptyEditor() {
  const store = useStore();
  const meta = store.metadata;
  return (
    <div class="metadata-empty me-empty">
      {meta.status ? (
        <p
          class={"status status-" + (meta.status.kind || "plain")}
          role={meta.status.kind === "error" ? "alert" : "status"}
        >
          {meta.status.message}
        </p>
      ) : null}
      {meta.failures.length ? (
        <ul class="metadata-empty-failures">
          {meta.failures.map((failure) => (
            <li key={failure.id}>
              <span class="metadata-failure-name">
                {failure.file || failure.id}
              </span>
              <span class="metadata-failure-why">{failure.error}</span>
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
  const values = new Set(fonts.map((font) => sourceName(font, key) ?? ""));
  return values.size === 1 ? [...values][0] || null : null;
}

function variesHint(fonts, key) {
  if (fonts.length < 2) return undefined;
  const values = new Set(fonts.map((font) => sourceName(font, key) ?? ""));
  return values.size > 1
    ? "The files do not agree on this. Editing it sets all of them."
    : undefined;
}

function valueOf(meta, fonts, key) {
  const typed = meta.familyDraft[key];
  return typed === undefined ? sharedOriginal(fonts, key) : typed;
}

function presetOf(license) {
  if (!license) return null;
  return (
    LICENSE_PRESETS.find((item) => item.text && item.text === license)?.value ||
    null
  );
}
