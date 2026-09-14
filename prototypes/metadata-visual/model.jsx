// Shared data layer for the four visual directions. It talks to the real Fount
// metadata endpoints, so every direction edits real name tables and downloads
// real files: the differences between them are visual and structural only.
import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import * as api from "../../core/src/web/src/lib/api.js";
import {
  FACE_FIELDS,
  FAMILY_FIELDS,
  deriveFilename,
  deriveFullName,
  derivePostscript,
  fileStem,
  normalizeVersion,
  urlProblem,
} from "../../core/src/web/src/metadata/derive.js";

const Context = createContext(null);
const emptyDraft = () => ({ families: {}, faces: {} });

const SAMPLE_FILES = [
  "geist-400.woff2",
  "geist-600.woff2",
  "geist-800.woff2",
  "newsreader-400.woff2",
  "newsreader-400i.woff2",
  "newsreader-700.woff2",
];

export const FAMILY_GROUPS = [
  {
    id: "authorship",
    label: "Authorship",
    fields: [
      ["manufacturer", "Author or foundry", {}],
      ["designer", "Designer", {}],
      ["vendor_url", "Foundry website", { placeholder: "https://" }],
      ["designer_url", "Designer website", { placeholder: "https://" }],
    ],
  },
  {
    id: "legal",
    label: "Legal",
    fields: [
      ["copyright", "Copyright", { area: true }],
      ["trademark", "Trademark", {}],
      ["license", "Licence text", { area: true }],
      ["license_url", "Licence address", { placeholder: "https://" }],
    ],
  },
  {
    id: "release",
    label: "Version and description",
    fields: [
      ["version", "Version", { placeholder: "1.000", mono: true }],
      ["description", "Description", { area: true }],
    ],
  },
];

export const LICENCES = [
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
];

export function Model({ children }) {
  const [fonts, setFonts] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [group, setGroup] = useState("");
  const [busy, setBusy] = useState("Loading sample fonts");
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);
  const [notice, setNotice] = useState("");
  const [origin, setOrigin] = useState("Sample fonts");
  const [sample, setSample] = useState("The shape of things");

  const filesRef = useRef([]);
  const uploadRef = useRef(null);
  const facesRef = useRef([]);
  const workingRef = useRef(false);
  const tokenRef = useRef(0);

  async function loadFiles(files, label = "Your files") {
    if (workingRef.current) return;
    workingRef.current = true;
    setBusy("Reading font metadata");
    setError("");
    try {
      if (!files.length || files.length > 16)
        throw new Error("Choose between 1 and 16 font files.");
      if (files.some((file) => file.size > 20 * 1024 * 1024))
        throw new Error("Each font must be 20 MB or smaller.");
      if (files.reduce((total, file) => total + file.size, 0) > 64 * 1024 * 1024)
        throw new Error("Choose at most 64 MB of fonts in one go.");

      const uploaded = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          data: await api.fileToBase64(file),
        })),
      );
      const data = await api.inspectMetadata({ kind: "upload", files: uploaded });
      if (!data.fonts?.length)
        throw new Error(
          data.failures?.map((item) => item.error).join("; ") ||
            "These files could not be read. Choose another font.",
        );

      for (const face of facesRef.current) document.fonts.delete(face);
      facesRef.current = [];
      const token = ++tokenRef.current;
      const inspected = await Promise.all(
        data.fonts.map(async (font, index) => {
          const previewFamily = "FountPreview" + token + "_" + index;
          try {
            const face = new FontFace(
              previewFamily,
              await files[index].arrayBuffer(),
            );
            await face.load();
            document.fonts.add(face);
            facesRef.current.push(face);
            return { ...font, previewFamily };
          } catch {
            return { ...font, previewFamily: "Geist" };
          }
        }),
      );

      filesRef.current = files;
      uploadRef.current = data.upload_id || null;
      setFonts(inspected);
      setGroup(inspected[0].names.family || "Unnamed family");
      setDraft(emptyDraft());
      setReport(null);
      setNotice("");
      setOrigin(label);
    } catch (err) {
      setError(err.message);
    } finally {
      workingRef.current = false;
      setBusy("");
    }
  }

  async function loadSamples() {
    if (workingRef.current) return;
    setBusy("Loading sample fonts");
    try {
      const files = await Promise.all(
        SAMPLE_FILES.map(async (name) => {
          const response = await fetch("/assets/" + name);
          if (!response.ok)
            throw new Error(
              "Sample fonts are unavailable. Choose files from your computer.",
            );
          return new File([await response.blob()], name, { type: "font/woff2" });
        }),
      );
      await loadFiles(files, "Sample fonts");
    } catch (err) {
      setError(err.message);
      setBusy("");
    }
  }

  useEffect(() => {
    loadSamples();
    return () => {
      for (const face of facesRef.current) document.fonts.delete(face);
    };
  }, []);

  const familyOf = (font) => font.names.family || "Unnamed family";
  const groups = [...new Set(fonts.map(familyOf))];
  const familyFonts = fonts.filter((font) => familyOf(font) === group);

  /** What every name record of this face will say once the draft is applied. */
  function effective(font) {
    const common = draft.families[familyOf(font)] || {};
    const face = draft.faces[font.id] || {};
    const family = common.family ?? font.names.family ?? "";
    const subfamily = face.subfamily ?? font.names.subfamily ?? "Regular";
    const renamed = common.family !== undefined || face.subfamily !== undefined;
    const full_name =
      face.full_name ??
      (renamed
        ? deriveFullName(family, subfamily)
        : font.names.full_name || deriveFullName(family, subfamily));
    const postscript =
      face.postscript ??
      (renamed
        ? derivePostscript(family, subfamily)
        : font.names.postscript || derivePostscript(family, subfamily));
    const filename =
      face.filename ?? (renamed ? deriveFilename(postscript) : fileStem(font.file));
    return { ...font.names, ...common, family, subfamily, full_name, postscript, filename };
  }

  /** Every record this face changes, as before/after pairs. */
  function changes(font) {
    const values = effective(font);
    const common = draft.families[familyOf(font)] || {};
    const result = [];
    for (const key of ["family", ...FACE_FIELDS, ...FAMILY_FIELDS]) {
      const before = key === "filename" ? fileStem(font.file) : font.names[key] || "";
      const raw = values[key] || "";
      const after =
        key === "version" && common.version !== undefined
          ? normalizeVersion(raw) ?? raw
          : raw;
      if (after !== before) result.push({ key, before, after });
    }
    return result;
  }

  const changed = fonts.filter((font) => changes(font).length);

  function mutate(update) {
    setDraft(update);
    setReport(null);
    setNotice("");
  }

  const setFamily = (key, value) =>
    mutate((old) => ({
      ...old,
      families: {
        ...old.families,
        [group]: { ...old.families[group], [key]: value },
      },
    }));

  const resetFamily = (key) =>
    mutate((old) => {
      const common = { ...old.families[group] };
      delete common[key];
      return { ...old, families: { ...old.families, [group]: common } };
    });

  const setFace = (id, key, value) =>
    mutate((old) => ({
      ...old,
      faces: { ...old.faces, [id]: { ...old.faces[id], [key]: value } },
    }));

  const resetFace = (id) =>
    mutate((old) => {
      const face = { ...old.faces[id] };
      for (const key of FACE_FIELDS) delete face[key];
      return { ...old, faces: { ...old.faces, [id]: face } };
    });

  /** Hand the derived names of one face over to be typed, or give them back. */
  function manual(font, on) {
    if (!on) return resetFace(font.id);
    const values = effective(font);
    mutate((old) => ({
      ...old,
      faces: {
        ...old.faces,
        [font.id]: Object.fromEntries(FACE_FIELDS.map((key) => [key, values[key]])),
      },
    }));
  }

  const isManual = (font) =>
    FACE_FIELDS.some((key) => (draft.faces[font.id] || {})[key] !== undefined);

  /** A family-scope field: the typed value, or what all chosen files agree on. */
  function shared(key) {
    const values = new Set(familyFonts.map((font) => font.names[key] || ""));
    const original = values.size === 1 ? [...values][0] : "";
    return {
      mixed: values.size > 1,
      original,
      edited: draft.families[group]?.[key] !== undefined,
      value: draft.families[group]?.[key] ?? original,
    };
  }

  function applyLicence(preset) {
    setFamily("license", preset.text);
    setFamily("license_url", preset.url);
  }

  // Everything that must be fixed before the draft can be written.
  const issues = [];
  for (const font of fonts) {
    const value = effective(font);
    const common = draft.families[familyOf(font)] || {};
    const add = (key, message) => {
      if (!issues.some((item) => item.id === font.id && item.key === key))
        issues.push({ id: font.id, key, message, face: value.subfamily });
    };
    if (!value.family.trim()) add("family", "Enter a family name.");
    if (!value.subfamily.trim()) add("subfamily", "Enter a style name.");
    if (!value.full_name.trim()) add("full_name", "Enter a full name.");
    if (
      !value.postscript ||
      !/^[\x21-\x7e]+$/.test(value.postscript) ||
      /[[\](){}<>/%]/.test(value.postscript) ||
      value.postscript.length > 63
    )
      add(
        "postscript",
        "Use 1 to 63 ASCII characters without spaces or reserved symbols.",
      );
    if (
      !value.filename ||
      /[<>:"/\\|?*\x00-\x1f]/.test(value.filename) ||
      /[. ]$/.test(value.filename)
    )
      add("filename", "Enter a valid file name without an extension.");
    for (const key of ["vendor_url", "designer_url", "license_url"])
      if (common[key] !== undefined && urlProblem(value[key]))
        add(key, urlProblem(value[key]));
    if (common.version !== undefined && normalizeVersion(value.version) === null)
      add("version", "Enter a version such as 1.000.");
  }

  const issueFor = (font, key) =>
    issues.find((item) => item.id === font.id && item.key === key)?.message || "";
  const familyIssue = (key) =>
    issues.find(
      (item) => item.key === key && familyFonts.some((font) => font.id === item.id),
    )?.message || "";

  /** Writes the draft into copies of the files and downloads the archive. */
  async function download(ids = null) {
    if (workingRef.current || issues.length || !fonts.length) return;
    workingRef.current = true;
    setBusy("Preparing font copies");
    setError("");
    setReport(null);
    setNotice("");
    try {
      if (!uploadRef.current) {
        const uploaded = await Promise.all(
          filesRef.current.map(async (file) => ({
            name: file.name,
            data: await api.fileToBase64(file),
          })),
        );
        const data = await api.inspectMetadata({ kind: "upload", files: uploaded });
        uploadRef.current = data.upload_id;
      }
      const wanted = ids ? new Set(ids) : null;
      const payload = fonts
        .filter((font) => !wanted || wanted.has(font.id))
        .map((font) => {
          const entries = changes(font);
          const names = Object.fromEntries(
            entries
              .filter((item) => item.key !== "filename")
              .map((item) => [item.key, item.after]),
          );
          const file = entries.find((item) => item.key === "filename");
          return { id: font.id, names, ...(file ? { filename: file.after } : {}) };
        });
      const result = await api.applyMetadata({
        source: { kind: "upload", upload_id: uploadRef.current },
        delivery: "zip",
        fonts: payload,
      });
      setReport(result);
      if (result.download_url) {
        const blob = await api.fetchArchive(result.download_url);
        if (!blob.size)
          throw new Error("The archive was empty. Prepare the files again.");
        api.triggerDownload(blob, result.filename);
        setNotice(
          result.saved_count +
            " of " +
            result.requested_count +
            " files written. Download started.",
        );
      }
    } catch (err) {
      // A failed apply can invalidate the session; force a fresh upload next time.
      uploadRef.current = null;
      setError(err.message);
    } finally {
      workingRef.current = false;
      setBusy("");
    }
  }

  const value = {
    fonts,
    draft,
    group,
    groups,
    familyFonts,
    setGroup,
    effective,
    changes,
    changed,
    shared,
    setFamily,
    resetFamily,
    setFace,
    resetFace,
    manual,
    isManual,
    applyLicence,
    busy,
    error,
    report,
    notice,
    origin,
    sample,
    setSample,
    issues,
    issueFor,
    familyIssue,
    loadFiles,
    loadSamples,
    download,
    resetAll() {
      setDraft(emptyDraft());
      setReport(null);
      setNotice("Draft reset. The files are back to their original names.");
    },
  };

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useModel = () => useContext(Context);
export { fileStem };
