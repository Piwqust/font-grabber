import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import * as api from "../../core/src/web/src/lib/api.js";
import { deriveFullName, derivePostscript, deriveFilename, normalizeVersion, urlProblem, FAMILY_FIELDS, FACE_FIELDS, fileStem } from "../../core/src/web/src/metadata/derive.js";

const Context = createContext(null);
const empty = () => ({ families: {}, faces: {} });
const demoFiles = ["geist-400.woff2", "geist-600.woff2", "geist-800.woff2", "newsreader-400.woff2", "newsreader-400i.woff2", "newsreader-700.woff2"];

export function Model({ children }) {
  const [fonts, setFonts] = useState([]), [draft, setDraft] = useState(empty), [group, setGroup] = useState(""), [busy, setBusy] = useState("Loading sample fonts"), [error, setError] = useState(""), [report, setReport] = useState(null), [notice, setNotice] = useState(""), [origin, setOrigin] = useState("Sample fonts"), [sample, setSample] = useState("The shape of things.");
  const filesRef = useRef([]), uploadRef = useRef(null), loadedRef = useRef([]), operation = useRef(false), generation = useRef(0);
  async function loadFiles(files, label = "Your files") {
    if (operation.current) return; operation.current = true; setBusy("Reading font metadata"); setError("");
    try {
      if (!files.length || files.length > 16) throw new Error("Choose between 1 and 16 font files.");
      if (files.some(file => file.size > 20 * 1024 * 1024)) throw new Error("Each font must be 20 MB or smaller.");
      if (files.reduce((total, file) => total + file.size, 0) > 64 * 1024 * 1024) throw new Error("Choose at most 64 MB of fonts.");
      const uploaded = await Promise.all(files.map(async file => ({ name: file.name, data: await api.fileToBase64(file) })));
      const data = await api.inspectMetadata({ kind: "upload", files: uploaded });
      if (!data.fonts?.length) throw new Error(data.failures?.map(item => item.error).join("; ") || "These files could not be read. Choose another font.");
      for (const face of loadedRef.current) document.fonts.delete(face);
      loadedRef.current = []; const token = ++generation.current;
      const inspected = await Promise.all(data.fonts.map(async (font, index) => {
        const previewFamily = "FountPreview" + token + "_" + index;
        try { const face = new FontFace(previewFamily, await files[index].arrayBuffer()); await face.load(); document.fonts.add(face); loadedRef.current.push(face); return { ...font, previewFamily }; } catch { return { ...font, previewFamily: "Geist" }; }
      }));
      filesRef.current = files; uploadRef.current = { id: data.upload_id, created: Date.now() }; setFonts(inspected); setGroup(inspected[0].names.family || "Unnamed family"); setDraft(empty()); setReport(null); setNotice(""); setOrigin(label);
    } catch (err) { setError(err.message); } finally { operation.current = false; setBusy(""); }
  }
  async function loadSamples() {
    if (operation.current) return; setBusy("Loading sample fonts");
    try { const files = await Promise.all(demoFiles.map(async name => { const response = await fetch("/assets/" + name); if (!response.ok) throw new Error("Sample fonts are unavailable. Choose files from your computer."); return new File([await response.blob()], name, { type: "font/woff2" }); })); await loadFiles(files, "Sample fonts"); } catch (err) { setError(err.message); setBusy(""); }
  }
  useEffect(() => { loadSamples(); return () => { for (const face of loadedRef.current) document.fonts.delete(face); }; }, []);
  const familyOf = font => font.names.family || "Unnamed family";
  const groups = [...new Set(fonts.map(familyOf))], familyFonts = fonts.filter(font => familyOf(font) === group);
  function effective(font) {
    const common = draft.families[familyOf(font)] || {}, face = draft.faces[font.id] || {}, family = common.family ?? font.names.family ?? "", subfamily = face.subfamily ?? font.names.subfamily ?? "Regular", namingChanged = common.family !== undefined || face.subfamily !== undefined;
    const full_name = face.full_name ?? (namingChanged ? deriveFullName(family, subfamily) : font.names.full_name || deriveFullName(family, subfamily));
    const postscript = face.postscript ?? (namingChanged ? derivePostscript(family, subfamily) : font.names.postscript || derivePostscript(family, subfamily));
    const filename = face.filename ?? (namingChanged ? deriveFilename(postscript) : fileStem(font.file));
    return { ...font.names, ...common, family, subfamily, full_name, postscript, filename };
  }
  function changes(font) { const values = effective(font), result = []; for (const key of ["family", ...FACE_FIELDS, ...FAMILY_FIELDS]) { const before = key === "filename" ? fileStem(font.file) : font.names[key] || "", after = key === "version" && draft.families[familyOf(font)]?.version !== undefined ? normalizeVersion(values[key]) : values[key] || ""; if (after !== before) result.push({ key, before, after }); } return result; }
  const changed = fonts.filter(font => changes(font).length);
  function mutate(update) { setDraft(update); setReport(null); setNotice(""); }
  function setFamily(key, value) { mutate(old => ({ ...old, families: { ...old.families, [group]: { ...old.families[group], [key]: value } } })); }
  function resetFamily(key) { mutate(old => { const common = { ...old.families[group] }; delete common[key]; return { ...old, families: { ...old.families, [group]: common } }; }); }
  function setFace(id, key, value) { mutate(old => ({ ...old, faces: { ...old.faces, [id]: { ...old.faces[id], [key]: value } } })); }
  function resetFace(id) { mutate(old => { const face = { ...old.faces[id] }; for (const key of FACE_FIELDS) delete face[key]; return { ...old, faces: { ...old.faces, [id]: face } }; }); }
  function manual(font, on) { if (!on) return resetFace(font.id); const values = effective(font); mutate(old => ({ ...old, faces: { ...old.faces, [font.id]: Object.fromEntries(FACE_FIELDS.map(key => [key, values[key]])) } })); }
  function shared(key) { const values = new Set(familyFonts.map(font => font.names[key] || "")); return { mixed: values.size > 1, original: values.size === 1 ? [...values][0] : "", value: draft.families[group]?.[key] ?? (values.size === 1 ? [...values][0] : "") }; }
  const issues = [];
  for (const font of fonts) { const value = effective(font), add = (key, message) => issues.some(item => item.id === font.id && item.key === key) || issues.push({ id: font.id, key, message }); if (!value.family.trim()) add("family", "Enter a family name."); if (!value.subfamily.trim()) add("subfamily", "Enter a style name."); if (!value.full_name.trim()) add("full_name", "Enter a full name."); if (!value.postscript || !/^[\x21-\x7e]+$/.test(value.postscript) || /[[\](){}<>/%]/.test(value.postscript) || value.postscript.length > 63) add("postscript", "Use 1 to 63 ASCII characters without spaces or reserved symbols."); if (!value.filename || /[<>:\"/\\|?*\x00-\x1f]/.test(value.filename) || /[. ]$/.test(value.filename)) add("filename", "Enter a valid file name without an extension."); for (const key of ["vendor_url", "designer_url", "license_url"]) if (draft.families[familyOf(font)]?.[key] !== undefined && urlProblem(value[key])) add(key, urlProblem(value[key])); if (draft.families[familyOf(font)]?.version !== undefined && normalizeVersion(value.version) === null) add("version", "Enter a version such as 1.000."); }
  async function download(ids) { if (operation.current || issues.length || !fonts.length) return; operation.current = true; setBusy("Preparing font copies"); setReport(null); setNotice(""); try { const uploaded = await Promise.all(filesRef.current.map(async file => ({ name: file.name, data: await api.fileToBase64(file) }))); if (!uploadRef.current?.id) { const data = await api.inspectMetadata({ kind: "upload", files: uploaded }); uploadRef.current = { id: data.upload_id, created: Date.now() }; } const payload = fonts.filter(font => !ids || ids.includes(font.id)).map(font => { const entries = changes(font), names = Object.fromEntries(entries.filter(item => item.key !== "filename").map(item => [item.key, item.after])), file = entries.find(item => item.key === "filename"); return { id: font.id, names, ...(file ? { filename: file.after } : {}) }; }); const result = await api.applyMetadata({ source: { kind: "upload", upload_id: uploadRef.current.id }, delivery: "zip", fonts: payload }); setReport(result); if (result.download_url) { const blob = await api.fetchArchive(result.download_url); if (!blob.size) throw new Error("The archive was empty. Try preparing the files again."); api.triggerDownload(blob, result.filename); setNotice(result.saved_count + " of " + result.requested_count + " files prepared. Download started."); } } catch (err) { setError(err.message); } finally { operation.current = false; setBusy(""); } }
  return <Context.Provider value={{ fonts, draft, group, setGroup, groups, familyFonts, effective, changes, changed, shared, setFamily, resetFamily, setFace, resetFace, manual, busy, error, report, notice, origin, sample, setSample, issues, loadFiles, loadSamples, download, resetAll() { setDraft(empty()); setReport(null); setNotice("Changes reset."); } }}>{children}</Context.Provider>;
}
export const useModel = () => useContext(Context);
