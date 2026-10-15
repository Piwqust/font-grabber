// Pure helpers for the metadata editor. Nothing here touches the DOM or the
// store: given the slice and one font, they say what the output will be called.
//
// The rules come from docs/METADATA-EDITOR.md. Two of them shape everything
// else: an untouched field keeps whatever the source font had, and a family
// rename cascades into the derived names of every face that was not edited by
// hand.

/** Family-scope fields, in the order the form shows them. */
export const FAMILY_FIELDS = [
  "copyright",
  "trademark",
  "manufacturer",
  "designer",
  "description",
  "vendor_url",
  "designer_url",
  "license",
  "license_url",
  "version",
];

export const URL_FIELDS = ["vendor_url", "designer_url", "license_url"];

/** Per-face fields that can be overridden by hand. */
export const FACE_FIELDS = ["subfamily", "full_name", "postscript", "filename"];

export const LICENSE_PRESETS = [
  {
    value: "ofl",
    label: "OFL 1.1",
    text:
      "This Font Software is licensed under the SIL Open Font License, " +
      "Version 1.1. This license is available with a FAQ at " +
      "https://openfontlicense.org",
    url: "https://openfontlicense.org",
  },
  {
    value: "apache",
    label: "Apache 2.0",
    text:
      "Licensed under the Apache License, Version 2.0. You may obtain a copy " +
      "of the License at https://www.apache.org/licenses/LICENSE-2.0",
    url: "https://www.apache.org/licenses/LICENSE-2.0",
  },
  { value: "custom", label: "Custom", text: null, url: null },
];

/**
 * Quick-fill presets. Each one writes the family-scope records that go
 * together in practice, so a licence and a version are one click rather than
 * four fields on a second tab. The family name is never touched.
 */
export const METADATA_PRESETS = [
  {
    value: "open-source",
    label: "Open source",
    description: "OFL 1.1, version 1.000",
    fields: {
      licensePreset: "ofl",
      license:
        "This Font Software is licensed under the SIL Open Font License, " +
        "Version 1.1. This license is available with a FAQ at " +
        "https://openfontlicense.org",
      license_url: "https://openfontlicense.org",
      version: "1.000",
    },
  },
  {
    value: "apache",
    label: "Apache 2.0",
    description: "Apache licence, version 1.000",
    fields: {
      licensePreset: "apache",
      license:
        "Licensed under the Apache License, Version 2.0. You may obtain a copy " +
        "of the License at https://www.apache.org/licenses/LICENSE-2.0",
      license_url: "https://www.apache.org/licenses/LICENSE-2.0",
      version: "1.000",
    },
  },
  {
    value: "reserved",
    label: "All rights reserved",
    description: "Custom licence, version 1.000",
    fields: {
      licensePreset: "custom",
      license: "This font is not free software. All rights reserved.",
      license_url: "",
      version: "1.000",
    },
  },
];

const NON_ASCII = /[^\x20-\x7E]/g;
// PostScript names may not carry these, and never a space.
const POSTSCRIPT_FORBIDDEN = /[[\](){}<>/%\s]/g;
const FILE_FORBIDDEN = /[^A-Za-z0-9._-]/g;

export function asciiOnly(value) {
  return String(value ?? "").replace(NON_ASCII, "");
}

export function postscriptSafe(value) {
  return asciiOnly(value).replace(POSTSCRIPT_FORBIDDEN, "");
}

export function fileSafe(value) {
  return asciiOnly(value).replace(FILE_FORBIDDEN, "");
}

/** "PlexMono-Regular.woff2" becomes "PlexMono-Regular". */
export function fileStem(file) {
  const name = String(file || "");
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function sourceName(font, key) {
  const value = font?.names?.[key];
  return value == null || value === "" ? null : value;
}

export function sourceFamily(font) {
  return sourceName(font, "family") || "";
}

export function sourceSubfamily(font) {
  return sourceName(font, "subfamily") || "Regular";
}

export function deriveFullName(family, subfamily) {
  return [family.trim(), subfamily.trim()].filter(Boolean).join(" ");
}

/** `Family-Subfamily`, ASCII, no spaces, at most 63 characters. */
export function derivePostscript(family, subfamily) {
  const left = postscriptSafe(family);
  const right = postscriptSafe(subfamily);
  return (right ? `${left}-${right}` : left).slice(0, 63);
}

export function deriveFilename(postscript) {
  return fileSafe(postscript).slice(0, 80);
}

/**
 * Accepts "1.000" or "Version 1.000" and normalises to "Version X.YYY".
 * Returns "" for an empty value, which removes the record, and null for
 * anything that is not a version.
 */
export function normalizeVersion(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const match = /^(?:version\s+)?(\d{1,5})(?:[.,](\d{1,5}))?$/i.exec(text);
  if (!match) return null;
  const minor = (match[2] || "0").padEnd(3, "0").slice(0, 3);
  return `Version ${Number(match[1])}.${minor}`;
}

export function urlProblem(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol))
      return "Use an http:// or https:// address.";
    return null;
  } catch {
    return "Use a full address, such as https://example.com.";
  }
}

/** The draft value of a family field, or the source value when untouched. */
export function familyValue(meta, font, key) {
  const typed = meta.familyDraft[key];
  return typed === undefined ? sourceName(font, key) ?? "" : typed;
}

/**
 * What each of the four name records of this face will say once the draft is
 * applied. A face field nobody has typed into is derived from the family name,
 * which is what makes a rename cascade. Until the family or style name actually
 * changes there is nothing to cascade, so those fields keep the source values.
 */
export function effectiveNames(meta, font) {
  const draft = meta.faceDrafts[font.id] || {};
  const typedFamily = meta.familyDraft.family;
  const family = typedFamily === undefined ? sourceFamily(font) : typedFamily;
  const subfamily = draft.subfamily ?? sourceSubfamily(font);
  const renamed =
    family !== sourceFamily(font) || subfamily !== sourceSubfamily(font);
  const fullName =
    draft.full_name ??
    (renamed
      ? deriveFullName(family, subfamily)
      : sourceName(font, "full_name") ?? "");
  const postscript =
    draft.postscript ??
    (renamed
      ? derivePostscript(family, subfamily)
      : sourceName(font, "postscript") ?? "");
  const filename =
    draft.filename ??
    (renamed ? deriveFilename(postscript) : fileStem(font.file));
  return { family, subfamily, full_name: fullName, postscript, filename };
}

/** The server's rule for name ID 6: printable ASCII, no delimiters, 63 max. */
export function postscriptProblem(value) {
  if (value.length > 63) return "is longer than 63 characters";
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code < 33 || code > 126) return "may only use ASCII letters, digits and punctuation, without spaces";
    if ("[](){}<>/%".includes(char)) return "may not contain [ ] ( ) { } < > / or %";
  }
  return null;
}

/** The name records this face changes, keyed as the API expects. */
export function faceChanges(meta, font) {
  const effective = effectiveNames(meta, font);
  const changes = {};
  for (const key of ["family", "subfamily", "full_name", "postscript"]) {
    const original = sourceName(font, key) ?? "";
    if (effective[key] !== original) changes[key] = effective[key];
  }
  return changes;
}

/** The family-scope records the draft changes, against this source font. */
export function familyChanges(meta, font) {
  const changes = {};
  for (const key of FAMILY_FIELDS) {
    const typed = meta.familyDraft[key];
    if (typed === undefined) continue;
    const value = key === "version" ? normalizeVersion(typed) : typed;
    if (value == null) continue; // Invalid version; apply is blocked anyway.
    const original = sourceName(font, key) ?? "";
    if (value === original) continue;
    changes[key] = value;
  }
  return changes;
}

/** True when applying the draft would change anything about this face. */
export function faceDiffers(meta, font) {
  return (
    Object.keys(faceChanges(meta, font)).length > 0 ||
    Object.keys(familyChanges(meta, font)).length > 0 ||
    effectiveNames(meta, font).filename !== fileStem(font.file)
  );
}

/** The `fonts` array of a POST /api/metadata/apply body. */
export function applyPayload(meta, ids = null) {
  const wanted = ids ? new Set(ids) : null;
  return meta.fonts
    .filter((font) => !wanted || wanted.has(font.id))
    .map((font) => {
      const effective = effectiveNames(meta, font);
      const body = {
        id: font.id,
        names: { ...faceChanges(meta, font), ...familyChanges(meta, font) },
      };
      if (effective.filename !== fileStem(font.file))
        body.filename = effective.filename;
      return body;
    });
}

/**
 * Everything that must be fixed before the draft can be applied. Each entry
 * names the field, so the form can mark it and the live region can read it out.
 */
export function draftIssues(meta) {
  const issues = [];
  const family = meta.familyDraft.family;
  if (family !== undefined && !family.trim())
    issues.push({ key: "family", message: "A family name is required." });

  for (const key of URL_FIELDS) {
    const typed = meta.familyDraft[key];
    if (typed === undefined) continue;
    const problem = urlProblem(typed);
    if (problem) issues.push({ key, message: problem });
  }

  const version = meta.familyDraft.version;
  if (version !== undefined && normalizeVersion(version) === null)
    issues.push({
      key: "version",
      message: "Write the version as a number, such as 1.000.",
    });

  for (const font of meta.fonts) {
    const effective = effectiveNames(meta, font);
    // An empty family is already reported once; do not repeat it per face.
    if (!effective.family.trim()) continue;
    // Only a name that will be sent is checked, as on the server: an untouched
    // source name is never rewritten, so it cannot block the download.
    const problem =
      effective.postscript !== (sourceName(font, "postscript") ?? "") &&
      postscriptProblem(effective.postscript);
    if (problem)
      issues.push({
        key: `postscript:${font.id}`,
        message: `The PostScript name for ${effective.subfamily} ${problem}.`,
      });
    if (!effective.filename)
      issues.push({
        key: `filename:${font.id}`,
        message: `${effective.subfamily} needs a file name.`,
      });
  }
  return issues;
}

export function issueFor(issues, key) {
  return issues.find((issue) => issue.key === key)?.message || null;
}

/** What the face list and the per-face form call this face. */
export function faceLabel(meta, font) {
  return effectiveNames(meta, font).subfamily || sourceSubfamily(font);
}
