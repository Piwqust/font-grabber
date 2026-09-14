import { useStore } from "../store.jsx";
import { Checkbox } from "../ui/Checkbox.jsx";
import { Disclosure } from "../ui/Disclosure.jsx";
import { Segmented } from "../ui/Segmented.jsx";
import { BeforeAfter, MetaField, DerivedValue } from "./MetaField.jsx";
import {
  LICENSE_PRESETS,
  effectiveNames,
  faceLabel,
  fileStem,
  issueFor,
  sourceName,
} from "./derive.js";

/**
 * The form. One column of sections, in the order the records matter: what the
 * font is called, who made it, what may be done with it, and which version
 * this is.
 *
 * Every family-scope field is one control for the whole selection. Where the
 * chosen files do not already agree on a value, the field says so rather than
 * quietly showing the first one.
 */
export function MetadataForm({ issues }) {
  const store = useStore();
  const meta = store.metadata;
  const fonts = meta.fonts;

  const field = (key, label, { hint, ...extra } = {}) => (
    <MetaField
      id={`meta-${key}`}
      label={label}
      value={meta.familyDraft[key]}
      original={sharedOriginal(fonts, key)}
      hint={
        [hint, variesHint(fonts, key)].filter(Boolean).join(" ") || undefined
      }
      error={issueFor(issues, key)}
      disabled={meta.applying}
      onChange={(value) => store.setFamilyField(key, value)}
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
    <div class="metadata-form">
      <section class="meta-section" aria-labelledby="meta-names-section">
        <h2 class="meta-section-title" id="meta-names-section">
          Names
        </h2>
        <p class="meta-section-note">
          The family name is written to every file. Style, full and PostScript
          names follow it unless a face is edited by hand.
        </p>
        {field("family", "Family name", {
          hint: "Shown in every font menu. Applies to all of the files.",
          placeholder: "Family name",
        })}

        <div class="meta-faces">
          {fonts.map((font) => (
            <FaceNames key={font.id} font={font} issues={issues} />
          ))}
        </div>
      </section>

      <details class="meta-advanced" open>
        <summary>Additional metadata <span>Author, licence, version and description</span></summary>
        <div class="meta-advanced-body">
      <section class="meta-section" aria-labelledby="meta-authorship-section">
        <h2 class="meta-section-title" id="meta-authorship-section">
          Authorship
        </h2>
        {field("manufacturer", "Author or foundry")}
        {field("designer", "Designer")}
        {field("vendor_url", "Foundry website", {
          placeholder: "https://example.com",
        })}
        {field("designer_url", "Designer website", {
          placeholder: "https://example.com",
        })}
      </section>

      <section class="meta-section" aria-labelledby="meta-legal-section">
        <h2 class="meta-section-title" id="meta-legal-section">
          Legal
        </h2>
        {field("copyright", "Copyright", { multiline: true, rows: 2 })}
        {field("trademark", "Trademark")}
        <div class="meta-preset">
          <Segmented
            label="Licence"
            size="s"
            options={LICENSE_PRESETS}
            value={preset}
            disabled={meta.applying}
            onChange={choosePreset}
          />
          <p class="meta-section-note">
            A preset fills in the licence text and its address; both stay
            editable.
          </p>
        </div>
        {field("license", "Licence text", { multiline: true, rows: 3 })}
        {field("license_url", "Licence address", {
          placeholder: "https://example.com/license",
        })}
      </section>

      <section class="meta-section" aria-labelledby="meta-version-section">
        <h2 class="meta-section-title" id="meta-version-section">
          Version and description
        </h2>
        {field("version", "Version", {
          placeholder: "1.000",
          hint: "Written as Version X.YYY.",
          mono: true,
        })}
        {field("description", "Description", { multiline: true, rows: 3 })}
      </section>
        </div>
      </details>
    </div>
  );
}

/**
 * One face. Closed, it states what the face will be called. Opened, it offers
 * the derived names and a switch that hands them over to be typed, which is
 * also what stops a later family rename from rewriting them.
 */
function FaceNames({ font, issues }) {
  const store = useStore();
  const meta = store.metadata;
  const draft = meta.faceDrafts[font.id] || {};
  const effective = effectiveNames(meta, font);
  const manual = Boolean(draft.manual);
  const label = faceLabel(meta, font);

  const toggleManual = (on) =>
    store.setFaceField(
      font.id,
      on
        ? {
            manual: true,
            subfamily: effective.subfamily,
            full_name: effective.full_name,
            postscript: effective.postscript,
            filename: effective.filename,
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
      id={`meta-${key}-${font.id}`}
      label={fieldLabel}
      value={draft[key]}
      original={extra.original}
      error={issueFor(issues, `${key}:${font.id}`)}
      disabled={meta.applying}
      onChange={(value) => store.setFaceField(font.id, key, value)}
      onReset={() => store.resetField("face", key, font.id)}
      {...extra}
    />
  );

  return (
    <Disclosure
      class="meta-face"
      summary={label}
      meta={effective.full_name}
      defaultOpen={meta.fonts.length <= 3}
    >
      <Checkbox
        checked={manual}
        disabled={meta.applying}
        label={`Edit the names of ${label} by hand`}
        onChange={toggleManual}
      />

      {manual ? (
        <div class="meta-face-fields">
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
            original: fileStem(font.file),
            mono: true,
            hint: "Without the extension.",
          })}
        </div>
      ) : (
        <div class="meta-derived-grid">
          <DerivedValue label="Style name" value={effective.subfamily} />
          <DerivedValue label="Full name" value={effective.full_name} />
          <DerivedValue label="PostScript" value={effective.postscript} />
          <DerivedValue label="File name" value={effective.filename} />
        </div>
      )}

      <p class="meta-face-line">
        <span class="meta-face-line-row">
          <BeforeAfter
            before={sourceName(font, "full_name") || fileStem(font.file)}
            after={effective.full_name}
          />
        </span>
        <span class="meta-face-line-row">
          <BeforeAfter
            before={fileStem(font.file)}
            after={effective.filename}
          />
        </span>
      </p>
    </Disclosure>
  );
}

/** The value a family field will send: what was typed, or what all files say. */
function valueOf(meta, fonts, key) {
  const typed = meta.familyDraft[key];
  return typed === undefined ? sharedOriginal(fonts, key) : typed;
}

/** The original value when every chosen file agrees on it, otherwise null. */
function sharedOriginal(fonts, key) {
  const values = new Set(fonts.map((font) => sourceName(font, key) ?? ""));
  if (values.size !== 1) return null;
  return [...values][0] || null;
}

function variesHint(fonts, key) {
  if (fonts.length < 2) return undefined;
  const values = new Set(fonts.map((font) => sourceName(font, key) ?? ""));
  return values.size > 1
    ? "The files do not agree on this. Editing it sets all of them."
    : undefined;
}

function presetOf(license) {
  if (!license) return null;
  return (
    LICENSE_PRESETS.find((item) => item.text && item.text === license)?.value ||
    null
  );
}
