// Small primitives shared by the four directions. They carry the behaviour
// (edited state, reset, validation, cascade) and almost no visual opinion: each
// direction styles them through its own stylesheet.
import { useId } from "preact/hooks";
import { FAMILY_GROUPS, LICENCES, useModel, fileStem } from "./model.jsx";

export { FAMILY_GROUPS, LICENCES, fileStem };

/** What the written copy of this face will be called on disk. */
export function outName(font, stem) {
  const ext = font.format === "ttf" || font.format === "otf" ? font.format : "otf";
  return stem + "." + ext;
}

export function TextInput({
  label,
  value = "",
  placeholder = "Not set",
  area = false,
  mono = false,
  big = false,
  error = "",
  hint = "",
  edited = false,
  original = "",
  onInput,
  onReset,
  class: cls = "",
}) {
  const id = useId();
  const Tag = area ? "textarea" : "input";
  return (
    <div
      class={"pf " + cls}
      data-edited={String(Boolean(edited))}
      data-invalid={String(Boolean(error))}
    >
      <label class="pf-label" for={id}>
        {label}
      </label>
      <Tag
        id={id}
        class={"pf-input" + (mono ? " is-mono" : "") + (big ? " is-big" : "")}
        value={value}
        rows={area ? 3 : undefined}
        placeholder={placeholder}
        spellcheck={false}
        autocomplete="off"
        aria-invalid={error ? "true" : undefined}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
      <div class="pf-foot">
        {error ? (
          <p class="pf-error">{error}</p>
        ) : hint ? (
          <p class="pf-hint">{hint}</p>
        ) : null}
        {edited && onReset ? (
          <button type="button" class="pf-reset" onClick={onReset}>
            Reset
            <span class="pf-reset-was"> was {original || "not set"}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The one control that renames every face in the family. */
export function FamilyName({ label = "Family name", big = false, class: cls = "" }) {
  const model = useModel();
  const field = model.shared("family");
  return (
    <TextInput
      class={"pf-family " + cls}
      label={label}
      value={field.value}
      placeholder={field.mixed ? "Several values" : "Family name"}
      big={big}
      edited={field.edited}
      original={field.original}
      error={model.familyIssue("family")}
      hint={
        field.mixed
          ? "These files disagree. Typing here gives all of them one name."
          : ""
      }
      onInput={(value) => model.setFamily("family", value)}
      onReset={() => model.resetFamily("family")}
    />
  );
}

/** One group of family-scope records: authorship, legal, or release. */
export function FamilyFields({ group }) {
  const model = useModel();
  return (
    <>
      {group.id === "legal" ? <LicencePresets /> : null}
      {group.fields.map(([key, label, extra]) => {
        const field = model.shared(key);
        return (
          <TextInput
            key={key}
            label={label}
            value={field.value}
            placeholder={field.mixed ? "Several values" : extra.placeholder}
            area={extra.area}
            mono={extra.mono}
            edited={field.edited}
            original={field.original}
            error={model.familyIssue(key)}
            hint={field.mixed ? "These files disagree." : ""}
            onInput={(value) => model.setFamily(key, value)}
            onReset={() => model.resetFamily(key)}
          />
        );
      })}
    </>
  );
}

export function LicencePresets() {
  const model = useModel();
  const current = model.shared("license").value;
  return (
    <div class="pf-presets" role="group" aria-label="Licence presets">
      <span class="pf-presets-label">Preset</span>
      {LICENCES.map((licence) => (
        <button
          key={licence.value}
          type="button"
          class="pf-preset"
          aria-pressed={current === licence.text ? "true" : "false"}
          onClick={() => model.applyLicence(licence)}
        >
          {licence.label}
        </button>
      ))}
    </div>
  );
}

/**
 * The four per-face records. Closed, the face follows the family name; opened,
 * the derived names are handed over to be typed and stop following it.
 */
export function FaceOverrides({ font }) {
  const model = useModel();
  const value = model.effective(font);
  const manual = model.isManual(font);
  const id = "manual-" + font.id;

  return (
    <div class="pf-face" data-manual={String(manual)}>
      <div class="pf-face-switch">
        <input
          id={id}
          type="checkbox"
          checked={manual}
          onChange={(event) => model.manual(font, event.currentTarget.checked)}
        />
        <label for={id}>Custom names for {value.subfamily || "this face"}</label>
      </div>

      {manual ? (
        <div class="pf-face-fields">
          {[
            ["subfamily", "Style name", {}],
            ["full_name", "Full name", {}],
            ["postscript", "PostScript name", { mono: true }],
            ["filename", "File name", { mono: true }],
          ].map(([key, label, extra]) => (
            <TextInput
              key={key}
              label={label}
              value={value[key]}
              mono={extra.mono}
              error={model.issueFor(font, key)}
              onInput={(next) => model.setFace(font.id, key, next)}
            />
          ))}
        </div>
      ) : (
        <dl class="pf-derived">
          <div>
            <dt>Style</dt>
            <dd>{value.subfamily}</dd>
          </div>
          <div>
            <dt>Full name</dt>
            <dd>{value.full_name}</dd>
          </div>
          <div>
            <dt>PostScript</dt>
            <dd class="is-mono">{value.postscript}</dd>
          </div>
          <div>
            <dt>File</dt>
            <dd class="is-mono">{outName(font, value.filename)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/** before -> after, with the arrow only when something actually moves. */
export function Change({ before, after }) {
  const same = before === after;
  return (
    <span class="pf-change" data-same={String(same)}>
      <span class="pf-before">{before || "not set"}</span>
      {same ? null : (
        <>
          <span class="pf-arrow" aria-hidden="true">
            {"\u2192"}
          </span>
          <span class="pf-after">{after || "removed"}</span>
        </>
      )}
    </span>
  );
}

/** Everything blocking the write, named per field so it can be fixed. */
export function Issues() {
  const model = useModel();
  if (!model.issues.length) return null;
  return (
    <div class="pf-issues" role="alert">
      <strong>
        {model.issues.length} field{model.issues.length === 1 ? "" : "s"} need
        attention
      </strong>
      <ul>
        {model.issues.map((issue) => (
          <li key={issue.id + issue.key}>
            <b>{issue.face}</b> {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A line of the chosen face, set in that very font. */
export function Specimen({ font, text, size = "2rem" }) {
  return (
    <span
      class="pf-specimen"
      style={{ fontFamily: "'" + font.previewFamily + "'", fontSize: size }}
    >
      {text}
    </span>
  );
}

export function SampleControl({ label = "Preview text" }) {
  const model = useModel();
  const id = useId();
  return (
    <div class="pf-sample">
      <label for={id}>{label}</label>
      <input
        id={id}
        value={model.sample}
        onInput={(event) => model.setSample(event.currentTarget.value)}
      />
    </div>
  );
}

export function FamilyTabs() {
  const model = useModel();
  if (model.groups.length < 2) return null;
  return (
    <nav class="pf-groups" aria-label="Font families">
      {model.groups.map((name) => (
        <button
          key={name}
          type="button"
          class="pf-group"
          aria-current={name === model.group ? "true" : undefined}
          onClick={() => model.setGroup(name)}
        >
          {name}
          <small>
            {model.fonts.filter((font) => (font.names.family || "Unnamed family") === name).length}
          </small>
        </button>
      ))}
    </nav>
  );
}

/** The write action, shared so every direction downloads the same real files. */
export function WriteButton({ label, class: cls = "" }) {
  const model = useModel();
  const count = model.familyFonts.length;
  const blocked = Boolean(model.busy) || model.issues.length > 0 || !count;
  return (
    <button
      type="button"
      class={"pf-write " + cls}
      disabled={blocked}
      onClick={() => model.download()}
    >
      {label || (model.report ? "Write again" : "Write " + count + " copies")}
    </button>
  );
}

/** Local files in. Every direction styles this trigger its own way. */
export function LoadFiles({ label = "Load fonts", class: cls = "" }) {
  const model = useModel();
  return (
    <label class={"pf-load " + cls}>
      <span>{label}</span>
      <input
        type="file"
        multiple
        accept=".ttf,.otf,.woff,.woff2"
        onChange={(event) => {
          const files = [...event.currentTarget.files];
          event.currentTarget.value = "";
          if (files.length) model.loadFiles(files);
        }}
      />
    </label>
  );
}

export function ResetDraft({ label = "Reset draft", class: cls = "" }) {
  const model = useModel();
  const dirty = model.changed.length > 0;
  return (
    <button
      type="button"
      class={"pf-reset-draft " + cls}
      disabled={!dirty}
      onClick={model.resetAll}
    >
      {label}
    </button>
  );
}

/** One line of truth about what the app is doing or has just done. */
export function StatusLine({ class: cls = "" }) {
  const model = useModel();
  const kind = model.error
    ? "error"
    : model.busy
      ? "busy"
      : model.notice
        ? "done"
        : "idle";
  const text = model.error
    ? model.error
    : model.busy
      ? model.busy + "..."
      : model.notice
        ? model.notice
        : model.changed.length
          ? model.changed.length +
            " of " +
            model.fonts.length +
            " files will be rewritten"
          : "No changes yet. Originals are never touched.";
  return (
    <p class={"pf-status " + cls} data-kind={kind} role={kind === "error" ? "alert" : "status"}>
      {text}
      {model.error ? (
        <button type="button" class="pf-status-retry" onClick={model.loadSamples}>
          Reload samples
        </button>
      ) : null}
    </p>
  );
}

/** The per-file result of a real write. */
export function WriteReport() {
  const model = useModel();
  if (!model.report?.results?.length) return null;
  return (
    <div class="pf-report">
      <strong>
        {model.report.saved_count} of {model.report.requested_count} written
      </strong>
      <ul>
        {model.report.results.map((item) => (
          <li key={item.id} data-ok={String(Boolean(item.saved ?? item.ok ?? !item.error))}>
            <span>{item.filename || item.file || item.id}</span>
            {item.error ? <em>{item.error}</em> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
