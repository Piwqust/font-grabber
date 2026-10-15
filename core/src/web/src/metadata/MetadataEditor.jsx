import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useStore } from "../store.jsx";
import { hostOf, DEFAULT_SAMPLE } from "../lib/fonts.js";
import { Preview } from "../catalog/Preview.jsx";
import { Button } from "../ui/Button.jsx";
import { Slider } from "../ui/Slider.jsx";
import { Spinner } from "../ui/Spinner.jsx";
import { Checkbox } from "../ui/Checkbox.jsx";
import { Icon } from "../ui/Icon.jsx";
import { MetadataIntro } from "../sections/MetadataIntro.jsx";
import { ExportReport } from "../catalog/Reports.jsx";
import { MetaField, BeforeAfter } from "./MetaField.jsx";
import {
  draftIssues,
  effectiveNames,
  faceDiffers,
  faceLabel,
  fileStem,
  issueFor,
  sourceName,
  sourceFamily,
} from "./derive.js";

// A single document: family details first, followed by every style preview.

export function MetadataEditor() {
  const store = useStore();
  const meta = store.metadata;

  // Every hook runs before the loading and empty branches below.
  const issues = useMemo(
    () => draftIssues(meta),
    [meta.fonts, meta.familyDraft, meta.faceDrafts],
  );

  const families = useMemo(() => [...new Set(meta.fonts.map(sourceFamily))], [meta.fonts]);
  const [proofSize, setProofSize] = useState(40);

  useEffect(() => {
    document.getElementById("metadata")?.focus({ preventScroll: true });
    scrollTo({ top: 0, behavior: "instant" });
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--proof-size", proofSize + "px");
  }, [proofSize]);

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
      <div class="me-intro">
        <div>
          <h1>Customize font</h1>
          <p>Change the name, author, links and licence details stored in your font.</p>
        </div>
        <span class="me-source">{origin} <span aria-hidden="true">/</span> {total} {total === 1 ? "file" : "files"}</span>
      </div>
      <section id="font-details" aria-label="Font details">
        <RenamePanel family={family} total={total} issues={issues} families={families} />
        <Issues issues={issues} />
        <Records issues={issues} />
      </section>
      <section class="me-styles" id="font-styles" aria-labelledby="font-styles-title">
        <div class="me-styles-heading">
          <div>
            <h2 id="font-styles-title">Styles</h2>
            <p>{total} {total === 1 ? "style" : "styles"}. Preview your changes below.</p>
          </div>
        </div>
        <div class="me-specimen-controls">
          <label class="me-sample">
            <span class="field-label">Preview text</span>
            <input value={store.sample} placeholder={DEFAULT_SAMPLE}
              onInput={(event) => store.setSample(event.currentTarget.value)} />
          </label>
          <Slider label="Size" value={proofSize} min={18} max={120} step={1}
            suffix="px" onInput={setProofSize} />
        </div>
        <div class="sp-proofs me-style-list">
          {meta.fonts.map((font) => <Face key={font.id} font={font} issues={issues} />)}
        </div>
      </section>

      <Failures />
      <Footer changing={changing} total={total} />
    </main>
  );
}

/** One explicit family rename, applied to every selected file. */
function RenamePanel({ family, total, issues, families }) {
  const store = useStore();
  const meta = store.metadata;
  const typed = meta.familyDraft.family;
  const edited = typed !== undefined;
  const original = sharedOriginal(meta.fonts, "family");
  const value = edited ? typed : families.length > 1 ? "" : family;
  const error = issueFor(issues, "family");

  return (
    <section class="me-bar sp-hero" aria-label="Rename font family">
      <div class="me-name-original">
        <span class="me-bar-label">Original family name</span>
        <p>{original || (families.length > 1 ? "Multiple families" : family)}</p>
        <span class="me-name-scope">{total === 1 ? "1 font file" : `Applies to all ${total} files`}</span>
      </div>
      <Icon name="arrowRight" class="me-name-arrow" size={22} />
      <div class="me-bar-name">
        <label class="me-bar-label" for="meta-family">
          New family name <span class="me-edit-label"><Icon name="pencil" size={13} /> Editable</span>
        </label>
        <div class="me-bar-field">
          <input
            id="meta-family"
            class="me-bar-input sp-hero-input"
            value={value}
            placeholder={families.length > 1 ? "Enter a shared family name" : "Enter a family name"}
            aria-invalid={Boolean(error)}
            aria-describedby="meta-family-hint"
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
              disabled={meta.applying}
              onClick={() => store.resetField("family", "family")}
            >
              <Icon name="undo" size={13} />
              Reset name
            </button>
          ) : null}
        </div>
        <p class="me-name-hint" id="meta-family-hint" data-error={String(Boolean(error))}>
          {error || "Type a new name here. Full names and file names update with it; custom names stay as typed."}
        </p>
      </div>
    </section>
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

/* -- One face: compact row + collapsible details --------------------------- */

function Face({ font, issues }) {
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

  const toggleManual = (on) =>
    store.setFaceField(
      font.id,
      on
        ? { manual: true, subfamily: eff.subfamily, full_name: eff.full_name,
            postscript: eff.postscript, filename: eff.filename }
        : { manual: false, subfamily: undefined, full_name: undefined,
            postscript: undefined, filename: undefined },
    );

  const faceField = (key, fieldLabel, extra = {}) => (
    <MetaField id={"meta-" + key + "-" + font.id} label={fieldLabel}
      value={draft[key]} error={issueFor(issues, key + ":" + font.id)}
      disabled={meta.applying}
      onChange={(next) => store.setFaceField(font.id, key, next)}
      onReset={() => store.resetField("face", key, font.id)} {...extra} />
  );

  const hasIssue = issues.some((issue) => issue.key.endsWith(":" + font.id));
  // Open the details when an issue appears, but never close them under the
  // person's cursor once it is fixed: the toggle stays theirs.
  const details = useRef(null);
  useEffect(() => {
    if (hasIssue && details.current) details.current.open = true;
  }, [hasIssue]);

  return (
    <article class="sp-proof me-face" data-differs={String(differs)}>
      <div class="me-face-row">
        <div class="me-face-row-meta">
          <span class="me-face-style">{label}</span>
          <span class="me-style-format">{font.format?.toUpperCase()}</span>
          {differs ? <span class="me-face-dot" title="Changed" /> : null}
        </div>
        <div class="me-face-row-preview">
          {preview ? <Preview font={preview} text={sample} /> :
            <span class="me-face-row-fallback">{sample}</span>}
        </div>
        <p class="me-face-file sp-proof-diff">
          <BeforeAfter before={stem + "." + ext} after={eff.filename + "." + ext} />
        </p>
      </div>

      <details class="me-style-details" ref={details}>
        <summary>
          Customize this style
          <span>{manual ? "Custom names" : "Automatic"}{hasIssue ? " · has issues" : ""}</span>
        </summary>
        <div class="me-face-switch">
          <Checkbox checked={manual} disabled={meta.applying}
            label={"Edit the names of " + label + " by hand"}
            onChange={toggleManual} />
        </div>
        {manual ? (
          <div class="me-face-fields">
            {faceField("subfamily", "Style name", { original: sourceName(font, "subfamily") })}
            {faceField("full_name", "Full name", { original: sourceName(font, "full_name") })}
            {faceField("postscript", "PostScript name", {
              original: sourceName(font, "postscript"), mono: true,
              hint: "ASCII, no spaces, at most 63 characters." })}
            {faceField("filename", "File name", {
              original: stem, mono: true, hint: "Without the extension." })}
          </div>
        ) : (
          <dl class="me-face-records">
            <Record label="Style" value={eff.subfamily} />
            <Record label="Full name" value={eff.full_name} />
            <Record label="PostScript" value={eff.postscript} mono />
            <Record label="File name" value={eff.filename + "." + ext} mono />
          </dl>
        )}
      </details>
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

/* -- Font details --------------------------------------------------------- */

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
      compact
      onChange={(next) => store.setFamilyField(key, next)}
      onReset={() => store.resetField("family", key)}
      {...extra}
    />
  );

  return (
    <div class="me-records sp-records" id="meta-panel-records">
      <p class="me-records-note">
        {fonts.length === 1 ? "Applies to this file." : `Applies to all ${fonts.length} files.`}
        {" "}Untouched fields keep their original values.
      </p>
      <section class="me-detail-section" aria-labelledby="meta-authors-title">
        <div class="me-detail-heading">
          <h2 id="meta-authors-title">Authors & links</h2>
          <p>Who made the font, and where to find them.</p>
        </div>
        <div class="me-detail-fields">
          {field("manufacturer", "Foundry or publisher", { placeholder: "Studio or company name" })}
          {field("vendor_url", "Foundry website", { placeholder: "https://example.com" })}
          {field("designer", "Designer", { placeholder: "Name of the designer" })}
          {field("designer_url", "Designer website", { placeholder: "https://example.com" })}
        </div>
      </section>
      <section class="me-detail-section" aria-labelledby="meta-about-title">
        <div class="me-detail-heading">
          <h2 id="meta-about-title">About the font</h2>
          <p>A short description and the release version.</p>
        </div>
        <div class="me-detail-fields">
          <div class="me-detail-wide">
            {field("description", "Description", { multiline: true, rows: 3,
              placeholder: "Describe the typeface, its character or intended use" })}
          </div>
          {field("version", "Version", { placeholder: "1.000", mono: true })}
        </div>
      </section>
      <section class="me-detail-section" aria-labelledby="meta-license-title">
        <div class="me-detail-heading">
          <h2 id="meta-license-title">Licence & rights</h2>
          <p>The terms and credits stored in the font. Use Presets to fill in licence details.</p>
        </div>
        <div class="me-detail-fields">
          <div class="me-detail-wide">
            {field("license", "Licence text", { multiline: true, rows: 4,
              placeholder: "Terms of use for this font" })}
          </div>
          <div class="me-detail-wide">
            {field("license_url", "Licence address", { placeholder: "https://example.com/license" })}
          </div>
          {field("copyright", "Copyright", { multiline: true, rows: 2,
            placeholder: "Copyright notice" })}
          {field("trademark", "Trademark", { placeholder: "Registered name, if any" })}
        </div>
      </section>
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
            title="Customized files"
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
