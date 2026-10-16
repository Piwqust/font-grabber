// The single owner of application state.
//
// Everything the catalogue and the scan form need lives here as one object,
// updated through `patch`. Components read what they need and call actions;
// none of them keep a second copy of the truth.
import { createContext } from "preact";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import * as api from "./lib/api.js";
import {
  DEFAULT_SAMPLE,
  collectionLabel,
  familyGroups,
  compareFaces,
  familyKey,
  hostOf,
  matchesFilter,
  normalizeUrl,
  prepareCatalogFonts,
} from "./lib/fonts.js";
import { dropPreview, resetPreviews } from "./lib/previews.js";
import { applyPayload, draftIssues } from "./metadata/derive.js";
import {
  clearHistory,
  forgetSite,
  historyEntries,
  loadMetadataSession,
  loadParkedDraft,
  loadSession,
  parkMetadataDraft,
  readLocal,
  rememberSite,
  saveMetadataSession,
  saveSession,
  writeLocal,
} from "./lib/storage.js";

export const PAGE_SIZE = 40;
const FACES_PER_FAMILY = 40;
const COVERAGE_BATCH = 80;

// The same limits the server enforces, checked here so a file that cannot be
// accepted is refused before it is read and posted.
const UPLOAD_LIMIT = 16;
const UPLOAD_FILE_BYTES = 20 * 1024 * 1024;
const UPLOAD_TOTAL_BYTES = 64 * 1024 * 1024;
export const FONT_FILE_TYPES = ".ttf,.otf,.woff,.woff2";
const FONT_FILE_NAME = /\.(ttf|otf|woff2?)$/i;

import { HOSTED } from "./lib/auth.js";
export { HOSTED };

const StoreContext = createContext(null);

/* The metadata editor is a screen of its own, so its state is one nested slice
   rather than a dozen more top-level keys. `familyDraft` and `faceDrafts` hold
   only what has actually been typed: a key that is absent means "whatever the
   source font says", which is what lets a family rename cascade and a reset
   restore the original. */
const emptyMetadata = {
  open: false,
  source: null, // {kind:"scan", url, mode, ids} | {kind:"upload", files:[{name,size}]}
  uploadId: null,
  fonts: [],
  failures: [],
  previews: {}, // id -> a font-like object usePreview() can load
  familyDraft: {},
  faceDrafts: {},
  inspecting: false,
  applying: false,
  status: null,
  report: null,
  confirmLeave: false, // asked before leaving unsaved changes to local files
  restoredDraft: false, // changes from an earlier visit were brought back
};

/** Whether anything has been typed into the editor. */
function hasDraftChanges(meta) {
  return (
    Object.keys(meta.familyDraft || {}).length > 0 ||
    Object.values(meta.faceDrafts || {}).some(
      (draft) => draft && Object.keys(draft).length > 0,
    )
  );
}

/** Identifies a set of scanned files, so a parked draft finds its way back. */
function draftKey(source) {
  if (source?.kind !== "scan") return null;
  return `${source.url}|${[...source.ids].sort().join(",")}`;
}

const VIEW_RANK = { landing: 0, catalog: 1, editor: 2 };
const historyUrl = () => location.pathname + location.search;

/**
 * Previews for a draft restored from sessionStorage. Only a scan can be
 * rebuilt: the files chosen on this computer no longer exist in this document.
 */
function restoredPreviews(draft, scanFonts) {
  if (draft.source?.kind !== "scan") return {};
  const wanted = new Set(draft.fonts.map((font) => font.id));
  const previews = {};
  for (const font of scanFonts)
    if (wanted.has(font.id) && font.sources?.[0]) previews[font.id] = font;
  return previews;
}

const initialState = {
  // Scan
  url: "",
  mode: "auto",
  scanning: false,
  status: null, // {message, kind: "" | "error" | "busy"}
  warnings: [],
  showExtensionHelp: false,
  canRetry: false,

  // Results
  source: "",
  scannedMode: "auto",
  fonts: [],
  selected: [],
  selectedOnly: false,
  query: "",
  layout: readLocal("fount-layout", "list") === "grid" ? "grid" : "list",
  visibleCount: PAGE_SIZE,
  expanded: [],
  familyLimits: {},
  undoIds: [],

  // Preview
  sample: "",
  previewSize: 32,

  // Export
  delivery: "zip",
  outputDir: "",
  grabbing: false,
  grabStatus: null,
  exportReport: null,
  savedFolder: "",
  downloadStates: {},

  // Coverage
  coverage: null, // {checking, status, items}

  // Metadata editor
  heroTask: "find", // which control the landing page is offering
  metadata: emptyMetadata,

  history: historyEntries(),
};

export function StoreProvider({ children }) {
  const [state, setState] = useState(() => ({ ...initialState, history: historyEntries() }));
  const scanRef = useRef(null);
  const coverageRef = useRef(0);
  const restored = useRef(false);
  const latest = useRef(state);
  latest.current = state;
  // Object URLs made for local previews, and the id of the control the editor
  // was opened from, so focus can go back to it on close.
  const objectUrls = useRef([]);
  const mounted = useRef(true);
  const metadataReturn = useRef(null);
  // One inspect at a time: a newer one, or closing the editor, drops the old.
  const inspectSeq = useRef(0);
  const inspectRef = useRef(null);

  const patch = useCallback((updates) => {
    setState((current) => ({
      ...current,
      ...(typeof updates === "function" ? updates(current) : updates),
    }));
  }, []);

  // -- Derived -------------------------------------------------------------
  const selectedSet = useMemo(() => new Set(state.selected), [state.selected]);
  const expandedSet = useMemo(() => new Set(state.expanded), [state.expanded]);

  const filtered = useMemo(() => {
    const query = state.query.trim().toLowerCase();
    return state.fonts.filter(
      (font) =>
        matchesFilter(font, query) &&
        (!state.selectedOnly || selectedSet.has(font.id)),
    );
  }, [state.fonts, state.query, state.selectedOnly, selectedSet]);

  const groups = useMemo(
    () => familyGroups(filtered, state.source),
    [filtered, state.source],
  );
  const busy = state.scanning || state.grabbing;
  const delivery = HOSTED ? "zip" : state.delivery;

  // -- Session -------------------------------------------------------------
  useEffect(() => () => {
    mounted.current = false;
    scanRef.current?.abort();
    for (const item of objectUrls.current) URL.revokeObjectURL(item.url);
    resetPreviews();
  }, []);
  useEffect(() => {
    const saved = loadSession();
    const draft = loadMetadataSession();
    restored.current = true;
    if (draft) {
      // Nothing was clicked in this document, so closing a restored draft goes
      // back to the control that way in belongs to.
      metadataReturn.current =
        draft.source.kind === "upload"
          ? "metadata-files"
          : "edit-metadata-selection";
      patch((current) => ({
        metadata: {
          ...current.metadata,
          ...draft,
          open: true,
          previews: restoredPreviews(draft, saved?.fonts || []),
          status: {
            message:
              draft.source.kind === "upload"
                ? "Draft restored. Choose the files again if the download fails."
                : "Draft restored.",
            kind: "",
          },
        },
      }));
    }
    if (!saved) return;
    const fonts = prepareCatalogFonts(saved.fonts);
    patch({
      url: saved.url,
      source: saved.url,
      mode: saved.mode || "auto",
      scannedMode: saved.mode || "auto",
      fonts,
      selected: (saved.selected || []).filter((id) =>
        fonts.some((font) => font.id === id),
      ),
      selectedOnly: !!saved.selectedOnly,
      query: saved.query || "",
      sample: saved.sample || "",
      previewSize: Number(saved.size) || 32,
      delivery: saved.delivery === "folder" && !HOSTED ? "folder" : "zip",
      outputDir: saved.outputDir || "",
      visibleCount: Math.max(
        PAGE_SIZE,
        Math.min(Number(saved.visibleCount) || PAGE_SIZE, fonts.length),
      ),
      status: fonts.length
        ? {
            message:
              "Previous collection restored. Scan again to check for changes.",
            kind: "",
          }
        : null,
    });
  }, [patch]);

  useEffect(() => {
    if (!restored.current || !state.fonts.length) return;
    const timer = setTimeout(
      () =>
        saveSession({
          url: state.source,
          mode: state.scannedMode,
          fonts: state.fonts,
          selected: state.selected,
          selectedOnly: state.selectedOnly,
          query: state.query,
          sample: state.sample,
          size: state.previewSize,
          delivery,
          outputDir: state.outputDir,
          visibleCount: state.visibleCount,
        }),
      200,
    );
    return () => clearTimeout(timer);
  }, [
    state.source,
    state.scannedMode,
    state.fonts,
    state.selected,
    state.selectedOnly,
    state.query,
    state.sample,
    state.previewSize,
    state.outputDir,
    state.visibleCount,
    delivery,
  ]);

  useEffect(() => {
    document.documentElement.style.setProperty(
      "--preview-size",
      `${state.previewSize}px`,
    );
  }, [state.previewSize]);

  // The draft is mirrored on the same terms as the collection: what can be
  // serialised is written, the files themselves cannot be and are not.
  const meta = state.metadata;
  useEffect(() => {
    if (!restored.current) return;
    if (!meta.open || !meta.fonts.length) {
      saveMetadataSession(null);
      return;
    }
    const timer = setTimeout(
      () =>
        saveMetadataSession({
          source: meta.source,
          uploadId: meta.uploadId,
          fonts: meta.fonts,
          failures: meta.failures,
          familyDraft: meta.familyDraft,
          faceDrafts: meta.faceDrafts,
        }),
      200,
    );
    return () => clearTimeout(timer);
  }, [
    meta.open,
    meta.source,
    meta.uploadId,
    meta.fonts,
    meta.failures,
    meta.familyDraft,
    meta.faceDrafts,
  ]);

  // -- Scan ----------------------------------------------------------------
  const runScan = useCallback(
    async (override = {}) => {
      const current = latest.current;
      if (current.scanning || current.grabbing) return;
      const raw = override.url ?? current.url;
      const mode = override.mode ?? current.mode;
      let url;
      try {
        url = normalizeUrl(raw);
      } catch (error) {
        patch({
          status: {
            message:
              error.message === "empty"
                ? "Enter a website address, such as example.com."
                : "That doesn't look like a website address. Try something like example.com.",
            kind: "error",
            field: true,
          },
          canRetry: false,
        });
        return;
      }

      const keepSelection =
        current.source === url ? new Set(current.selected) : new Set();
      const controller = new AbortController();
      scanRef.current = controller;

      patch({
        url,
        mode,
        scanning: true,
        canRetry: false,
        showExtensionHelp: false,
        warnings: [],
        status: {
          message: "Scanning… this can take a moment on large sites.",
          kind: "busy",
        },
      });

      try {
        const report = await api.scan({
          url,
          mode,
          signal: controller.signal,
          onStage: (message) => patch({ status: { message, kind: "busy" } }),
        });
        const fonts = prepareCatalogFonts(report.fonts || []);
        // Both ways of reading the page failing to even open it means the
        // site is missing or down, which is a different problem from a page
        // that opened and simply had no fonts to give.
        const warnings = report.warnings || [];
        const unreachable =
          !fonts.length &&
          !report.used_browser &&
          warnings.some((w) => w.startsWith("Static scan failed: Failed to fetch page"));
        coverageRef.current++;
        resetPreviews();
        patch({
          source: url,
          scannedMode: mode,
          fonts,
          selected: [...keepSelection].filter((id) =>
            fonts.some((f) => f.id === id),
          ),
          selectedOnly: false,
          query: "",
          visibleCount: PAGE_SIZE,
          expanded: [],
          familyLimits: {},
          undoIds: [],
          downloadStates: {},
          exportReport: null,
          coverage: null,
          grabStatus: null,
          savedFolder: "",
          warnings: report.warnings || [],
          history: rememberSite(url, mode, fonts.length),
          showExtensionHelp: fonts.length === 0 && !unreachable,
          canRetry: unreachable,
          status: unreachable
            ? {
                message: `Could not open ${hostOf(url)}. Check the address: the site may not exist, or it may be down right now.`,
                kind: "error",
              }
            : fonts.length
            ? {
                message: `Found ${fonts.length} face${fonts.length === 1 ? "" : "s"}${
                  report.used_browser ? " via browser rendering" : ""
                }.`,
                kind: "success",
              }
            : {
                message:
                  "No downloadable fonts found. Try another page or Browser rendering.",
                kind: "",
              },
        });
      } catch (error) {
        if (error.name === "AbortError")
          patch({
            status: {
              message:
                "Stopped waiting. Previous results are kept; the server may still finish the scan.",
              kind: "",
            },
          });
        else if (error.status === 429)
          // The server is busy, not the address wrong: say only what it said.
          patch({
            status: { message: error.message, kind: "error" },
            canRetry: true,
          });
        else
          patch({
            status: {
              message: /^Invalid URL/.test(error.message)
                ? "That doesn't look like a website address. Try something like example.com."
                : `Could not scan this page. ${error.message} Check the address and try again.`,
              kind: "error",
            },
            canRetry: true,
            showExtensionHelp: true,
          });
      } finally {
        scanRef.current = null;
        patch({ scanning: false });
      }
    },
    [patch],
  );

  const cancelScan = useCallback(() => scanRef.current?.abort(), []);

  const clearResults = useCallback(() => {
    if (latest.current.scanning || latest.current.grabbing) return;
    resetPreviews();
    patch({
      fonts: [],
      selected: [],
      source: "",
      status: null,
      warnings: [],
      showExtensionHelp: false,
      canRetry: false,
      exportReport: null,
      coverage: null,
      grabStatus: null,
    });
  }, [patch]);

  // -- Selection -----------------------------------------------------------
  const setSelected = useCallback(
    (updater) =>
      patch((current) => {
        const next = new Set(current.selected);
        updater(next, current);
        return { selected: [...next] };
      }),
    [patch],
  );

  const toggleFace = useCallback(
    (id, on) => setSelected((set) => (on ? set.add(id) : set.delete(id))),
    [setSelected],
  );

  const toggleFamily = useCallback(
    (key, on) =>
      setSelected((set, current) => {
        const query = current.query.trim().toLowerCase();
        for (const font of current.fonts) {
          if (familyKey(font) !== key || !matchesFilter(font, query)) continue;
          if (on) set.add(font.id);
          else set.delete(font.id);
        }
      }),
    [setSelected],
  );

  const selectVariableOnly = useCallback(
    (key) =>
      setSelected((set, current) => {
        for (const font of current.fonts) {
          if (familyKey(font) !== key) continue;
          if (font.variable) set.add(font.id);
          else set.delete(font.id);
        }
      }),
    [setSelected],
  );

  const selectAllMatches = useCallback(
    () => setSelected((set) => filtered.forEach((font) => set.add(font.id))),
    [setSelected, filtered],
  );

  const clearSelection = useCallback(
    () =>
      patch((current) => ({
        undoIds: current.selected,
        selected: [],
      })),
    [patch],
  );

  const undoClear = useCallback(
    () =>
      patch((current) => ({
        selected: current.undoIds.filter((id) =>
          current.fonts.some((font) => font.id === id),
        ),
        undoIds: [],
      })),
    [patch],
  );

  const toggleExpanded = useCallback(
    (key) =>
      patch((current) => {
        const next = new Set(current.expanded);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { expanded: [...next] };
      }),
    [patch],
  );

  const showMoreFaces = useCallback(
    (key) =>
      patch((current) => ({
        familyLimits: {
          ...current.familyLimits,
          [key]:
            (current.familyLimits[key] || FACES_PER_FAMILY) + FACES_PER_FAMILY,
        },
      })),
    [patch],
  );

  const setLayout = useCallback(
    (layout) => {
      writeLocal("fount-layout", layout);
      patch({ layout });
    },
    [patch],
  );

  // -- Export --------------------------------------------------------------
  const download = useCallback(
    async (ids, retryContext = null) => {
      const current = latest.current;
      if (current.scanning || current.grabbing || !ids.length) return;
      const mode = HOSTED ? "zip" : current.delivery;
      const outputDir = retryContext
        ? retryContext.outputDir
        : current.outputDir.trim();

      patch({
        grabbing: true,
        savedFolder: "",
        downloadStates: {
          ...current.downloadStates,
          ...Object.fromEntries(ids.map((id) => [id, "preparing"])),
        },
        grabStatus: {
          message: `Downloading and converting ${ids.length} font${ids.length === 1 ? "" : "s"}…`,
          kind: "busy",
        },
      });

      try {
        const data = await api.exportFonts({
          url: current.source,
          mode: current.scannedMode,
          ids,
          delivery: mode,
          outputDir,
        });
        const states = Object.fromEntries(
          data.results.map((item) => [
            item.id,
            item.status === "error" ? "error" : "done",
          ]),
        );
        const complete = data.saved_count === data.requested_count;

        if (mode === "folder") {
          patch((s) => ({
            downloadStates: { ...s.downloadStates, ...states },
            exportReport: { ...data, delivery: mode, ids, outputDir },
            savedFolder: data.saved_count ? data.output_dir : "",
            grabStatus: {
              message: `Saved ${data.saved_count} of ${data.requested_count} files`,
              kind: complete ? "success" : "error",
            },
          }));
        } else if (data.download_url) {
          const blob = await api.fetchArchive(data.download_url);
          api.triggerDownload(blob, data.filename);
          patch((s) => ({
            downloadStates: { ...s.downloadStates, ...states },
            exportReport: { ...data, delivery: mode, ids, outputDir },
            grabStatus: {
              message: `Download started · ${data.saved_count} of ${data.requested_count} files prepared`,
              kind: complete ? "success" : "error",
            },
          }));
        } else {
          patch((s) => ({
            downloadStates: { ...s.downloadStates, ...states },
            exportReport: { ...data, delivery: mode, ids, outputDir },
            grabStatus: {
              message: "No files could be exported. See the report below.",
              kind: "error",
            },
          }));
        }
      } catch (error) {
        patch((s) => ({
          downloadStates: {
            ...s.downloadStates,
            ...Object.fromEntries(ids.map((id) => [id, "error"])),
          },
          grabStatus: { message: error.message, kind: "error" },
        }));
      } finally {
        patch((s) => ({
          grabbing: false,
          downloadStates: Object.fromEntries(
            Object.entries(s.downloadStates).filter(
              ([, value]) => value !== "preparing",
            ),
          ),
        }));
      }
    },
    [patch],
  );

  const retryFailed = useCallback(() => {
    const report = latest.current.exportReport;
    if (!report) return;
    download(
      report.results
        .filter((item) => item.status === "error")
        .map((item) => item.id),
      report,
    );
  }, [download]);

  // -- Coverage ------------------------------------------------------------
  const checkCoverage = useCallback(async () => {
    const current = latest.current;
    const text = current.sample.trim();
    if (
      !text ||
      !current.selected.length ||
      current.scanning ||
      current.grabbing
    )
      return;
    if (current.coverage?.checking) return;
    const mine = ++coverageRef.current;
    const ids = [...current.selected];

    patch({
      coverage: {
        checking: true,
        status: `Checking ${ids.length} selected files…`,
        items: [],
      },
    });

    let checked = 0;
    let failures = 0;
    try {
      for (let offset = 0; offset < ids.length; offset += COVERAGE_BATCH) {
        if (mine !== coverageRef.current) return;
        const data = await api.checkCoverage({
          url: current.source,
          mode: current.scannedMode,
          ids: ids.slice(offset, offset + COVERAGE_BATCH),
          text: current.sample,
        });
        if (mine !== coverageRef.current) return;
        const batch = data.results.map((item) => {
          const problem =
            item.error ||
            (item.missing.length
              ? `Missing: ${item.missing.join(" ")}`
              : "All characters present");
          const failed = Boolean(item.error || item.missing.length);
          if (failed) failures++;
          checked++;
          return { id: item.id, problem, failed };
        });
        patch((s) => ({
          coverage: {
            checking: true,
            status: `Checked ${checked} of ${ids.length} files · ${failures} need attention`,
            items: [...(s.coverage?.items || []), ...batch],
          },
        }));
      }
      patch((s) => ({ coverage: { ...s.coverage, checking: false } }));
    } catch (error) {
      if (mine === coverageRef.current)
        patch((s) => ({
          coverage: { ...s.coverage, checking: false, status: error.message },
        }));
    }
  }, [patch]);

  const dismissCoverage = useCallback(() => {
    coverageRef.current++;
    patch({ coverage: null });
  }, [patch]);

  // -- Metadata editor -----------------------------------------------------
  const patchMetadata = useCallback(
    (updates) =>
      patch((current) => ({
        metadata: {
          ...current.metadata,
          ...(typeof updates === "function"
            ? updates(current.metadata)
            : updates),
        },
      })),
    [patch],
  );

  /** Drops the object URLs and preview faces the last upload registered. */
  const releaseUploads = useCallback(() => {
    for (const { id, url } of objectUrls.current) {
      dropPreview(id);
      URL.revokeObjectURL(url);
    }
    objectUrls.current = [];
  }, []);

  const cancelInspect = useCallback(() => {
    inspectSeq.current++;
    inspectRef.current?.abort();
    inspectRef.current = null;
  }, []);

  /** Starts an inspect; the returned `stale()` turns true once it is superseded. */
  const startMetadata = useCallback(
    (source, previews, message, fallbackId) => {
      cancelInspect();
      const mine = inspectSeq.current;
      const controller = new AbortController();
      inspectRef.current = controller;
      // A drag, or a file dialogue that has already closed, leaves nothing
      // focused; the control that belongs to this way in is the fallback.
      metadataReturn.current = document.activeElement?.id || fallbackId || null;
      patchMetadata({
        ...emptyMetadata,
        open: true,
        source,
        previews,
        inspecting: true,
        status: { message, kind: "busy" },
      });
      return {
        signal: controller.signal,
        stale: () => mine !== inspectSeq.current || !mounted.current,
      };
    },
    [patchMetadata, cancelInspect],
  );

  /** Turns an inspect response into the slice the form reads. */
  const receiveInspection = useCallback(
    (data, requested) => {
      // Scanned files are listed in the catalogue's order, so a family split
      // by script reads Latin first here too.
      const previews = latest.current.metadata.previews || {};
      const fonts = (data.fonts || [])
        .slice()
        .sort((a, b) =>
          previews[a.id] && previews[b.id]
            ? compareFaces(previews[a.id], previews[b.id])
            : 0,
        );
      const failures = data.failures || [];
      const total = fonts.length + failures.length || requested;
      // Changes typed into these same files before the editor was left are
      // put back, for the faces that are still here.
      const parked = loadParkedDraft();
      const key = draftKey(latest.current.metadata.source);
      let restoredDrafts = null;
      if (parked && key && parked.key === key && fonts.length) {
        const ids = new Set(fonts.map((font) => font.id));
        restoredDrafts = {
          familyDraft: parked.familyDraft || {},
          faceDrafts: Object.fromEntries(
            Object.entries(parked.faceDrafts || {}).filter(([id]) => ids.has(id)),
          ),
          restoredDraft: true,
        };
        parkMetadataDraft(null);
      }
      patchMetadata({
        ...restoredDrafts,
        fonts,
        failures,
        uploadId: data.upload_id || null,
        inspecting: false,
        status: !fonts.length
          ? {
              message:
                "None of these files could be read. They may not be fonts.",
              kind: "error",
            }
          : failures.length
            ? {
                message: `${fonts.length} of ${total} files are ready to edit. The rest could not be read.`,
                kind: "error",
              }
            : null,
      });
      return fonts;
    },
    [patchMetadata],
  );

  const failMetadata = useCallback(
    (error) =>
      patchMetadata({
        inspecting: false,
        status: {
          message: `The names could not be read. ${error.message}`,
          kind: "error",
        },
      }),
    [patchMetadata],
  );

  const openMetadataFromSelection = useCallback(async () => {
    const current = latest.current;
    if (current.scanning || current.grabbing || current.metadata.inspecting)
      return;
    const ids = current.selected.filter((id) =>
      current.fonts.some((font) => font.id === id),
    );
    if (!ids.length) return;

    releaseUploads();
    const chosen = new Set(ids);
    const previews = {};
    for (const font of current.fonts)
      if (chosen.has(font.id) && font.sources?.[0]) previews[font.id] = font;

    const source = {
      kind: "scan",
      url: current.source,
      mode: current.scannedMode,
      ids,
    };
    const request = startMetadata(
      source,
      previews,
      `Reading the names in ${ids.length} file${ids.length === 1 ? "" : "s"}…`,
      "edit-metadata-selection",
    );
    try {
      const data = await api.inspectMetadata(source, request.signal);
      if (!request.stale()) receiveInspection(data, ids.length);
    } catch (error) {
      if (!request.stale()) failMetadata(error);
    }
  }, [releaseUploads, startMetadata, receiveInspection, failMetadata]);

  const openMetadataFromFiles = useCallback(
    async (fileList) => {
      const all = [...(fileList || [])];
      const chosen = all.filter((file) => FONT_FILE_NAME.test(file.name));
      const refused = all.length - chosen.length;
      const tooBig = chosen.filter((file) => file.size > UPLOAD_FILE_BYTES);
      const total = chosen.reduce((sum, file) => sum + file.size, 0);

      const problem = !chosen.length
        ? "Choose TTF, OTF, WOFF or WOFF2 files."
        : chosen.length > UPLOAD_LIMIT
          ? `Choose at most ${UPLOAD_LIMIT} files at a time.`
          : tooBig.length
            ? `${tooBig[0].name} is larger than 20 MB.`
            : total > UPLOAD_TOTAL_BYTES
              ? "Those files come to more than 64 MB together."
              : null;
      if (problem) {
        cancelInspect();
        metadataReturn.current = document.activeElement?.id || "metadata-files";
        patchMetadata({
          ...emptyMetadata,
          open: true,
          source: { kind: "upload", files: [] },
          status: { message: problem, kind: "error" },
        });
        return;
      }

      releaseUploads();
      const skipped = refused
        ? ` ${refused} other file${refused === 1 ? " was" : "s were"} skipped.`
        : "";
      const request = startMetadata(
        {
          kind: "upload",
          files: chosen.map((file) => ({ name: file.name, size: file.size })),
        },
        {},
        `Reading the names in ${chosen.length} file${
          chosen.length === 1 ? "" : "s"
        }…${skipped}`,
        "metadata-files",
      );

      try {
        const files = await Promise.all(
          chosen.map(async (file) => ({
            name: file.name,
            data: await api.fileToBase64(file),
          })),
        );
        if (request.stale()) return;
        const data = await api.inspectMetadata(
          { kind: "upload", files },
          request.signal,
        );
        if (request.stale()) return;
        const fonts = receiveInspection(data, chosen.length);

        // Previews come from the files themselves; there is nothing to fetch.
        const previews = {};
        for (const font of fonts) {
          // The contract keys an uploaded font as `upload:<index>`; the name
          // is the fallback for anything that does not follow that.
          const index = Number(String(font.id).split(":")[1]);
          const file = Number.isInteger(index)
            ? chosen[index]
            : chosen.find((candidate) => candidate.name === font.file);
          if (!file) continue;
          const url = URL.createObjectURL(file);
          objectUrls.current.push({ id: font.id, url });
          previews[font.id] = {
            id: font.id,
            sources: [{ url, format: font.format, local: true }],
          };
        }
        patchMetadata({ previews });
      } catch (error) {
        if (!request.stale()) failMetadata(error);
      }
    },
    [
      cancelInspect,
      releaseUploads,
      startMetadata,
      receiveInspection,
      failMetadata,
      patchMetadata,
    ],
  );

  const setFamilyField = useCallback(
    (key, value) =>
      patchMetadata((meta) => ({
        familyDraft: {
          ...meta.familyDraft,
          ...(typeof key === "object" ? key : { [key]: value }),
        },
      })),
    [patchMetadata],
  );

  const setFaceField = useCallback(
    (id, key, value) =>
      patchMetadata((meta) => ({
        faceDrafts: {
          ...meta.faceDrafts,
          [id]: {
            ...meta.faceDrafts[id],
            ...(typeof key === "object" ? key : { [key]: value }),
          },
        },
      })),
    [patchMetadata],
  );

  /**
   * Forgets one edit. Removing the key rather than blanking it is the whole
   * point: the field goes back to reading, and sending, the source value.
   */
  const resetField = useCallback(
    (scope, key, id) =>
      patchMetadata((meta) => {
        if (scope === "family") {
          const familyDraft = { ...meta.familyDraft };
          delete familyDraft[key];
          return { familyDraft };
        }
        const face = { ...meta.faceDrafts[id] };
        delete face[key];
        return { faceDrafts: { ...meta.faceDrafts, [id]: face } };
      }),
    [patchMetadata],
  );

  const applyMetadata = useCallback(
    async (ids = null) => {
      const current = latest.current;
      const draft = current.metadata;
      if (!draft.open || draft.applying || draft.inspecting) return;
      if (!draft.fonts.length) return;
      if (draftIssues(draft).length) {
        patchMetadata({
          status: {
            message: "Fix the fields marked below, then try again.",
            kind: "error",
          },
        });
        return;
      }
      if (draft.source.kind === "upload" && !draft.uploadId) {
        patchMetadata({
          status: {
            message:
              "The uploaded files are no longer on the server. Choose them again.",
            kind: "error",
          },
        });
        return;
      }

      const mode = HOSTED ? "zip" : current.delivery;
      const outputDir = current.outputDir.trim();
      const source =
        draft.source.kind === "upload"
          ? { kind: "upload", upload_id: draft.uploadId }
          : { kind: "scan", url: draft.source.url, mode: draft.source.mode };
      const fonts = applyPayload(draft, ids);

      patch({ savedFolder: "" });
      patchMetadata({
        applying: true,
        report: null,
        status: {
          message: `Writing the names into ${fonts.length} file${fonts.length === 1 ? "" : "s"}…`,
          kind: "busy",
        },
      });

      try {
        const data = await api.applyMetadata({
          source,
          delivery: mode,
          outputDir,
          fonts,
        });
        const complete = data.saved_count === data.requested_count;
        const report = {
          ...data,
          delivery: mode,
          ids: fonts.map((font) => font.id),
          outputDir,
        };

        if (mode === "folder") {
          patch({ savedFolder: data.saved_count ? data.output_dir : "" });
          patchMetadata({
            report,
            status: {
              message: `Saved ${data.saved_count} of ${data.requested_count} files`,
              kind: complete ? "success" : "error",
            },
          });
        } else if (data.download_url) {
          const blob = await api.fetchArchive(data.download_url);
          api.triggerDownload(blob, data.filename);
          patchMetadata({
            report,
            status: {
              message: `Download started · ${data.saved_count} of ${data.requested_count} files prepared`,
              kind: complete ? "success" : "error",
            },
          });
        } else {
          patchMetadata({
            report,
            status: {
              message: "No files could be written. See the report below.",
              kind: "error",
            },
          });
        }
      } catch (error) {
        patchMetadata({ status: { message: error.message, kind: "error" } });
      } finally {
        patchMetadata({ applying: false });
      }
    },
    [patch, patchMetadata],
  );

  const retryMetadata = useCallback(() => {
    const report = latest.current.metadata.report;
    if (!report) return;
    applyMetadata(
      report.results
        .filter((item) => item.status === "error")
        .map((item) => item.id),
    );
  }, [applyMetadata]);

  /** Keeps the draft, clears the outcome, so the form can be edited again. */
  const editMetadataAgain = useCallback(
    () => patchMetadata({ status: null, report: null }),
    [patchMetadata],
  );

  /**
   * Leaves the editor. Changes to scanned files are parked and come back when
   * the same files are opened again. Local files cannot be reopened from
   * memory, so leaving them with unsaved changes asks first; `force` is the
   * answer. Returns whether the editor actually closed.
   */
  const closeMetadata = useCallback(({ force = false } = {}) => {
    const meta = latest.current.metadata;
    if (meta.applying) return false;
    const changed = hasDraftChanges(meta);
    if (changed && meta.source?.kind === "upload" && !meta.report && !force) {
      patchMetadata({ confirmLeave: true });
      return false;
    }
    const key = draftKey(meta.source);
    if (key && meta.fonts.length) {
      if (changed && !meta.report) {
        parkMetadataDraft({
          key,
          familyDraft: meta.familyDraft,
          faceDrafts: meta.faceDrafts,
        });
        patch({
          status: {
            message:
              "Your font changes are kept. Open Customize font with the same files to continue.",
            kind: "",
          },
        });
      } else if (loadParkedDraft()?.key === key) parkMetadataDraft(null);
    }
    cancelInspect();
    if (["#font-details", "#font-styles"].includes(location.hash)) {
      history.replaceState(history.state, "", location.pathname + location.search);
    }
    releaseUploads();
    // Leaving an editor that was opened from local files lands back on the
    // drop zone, not on the address field: that is where it came from.
    const fromFiles = latest.current.metadata.source?.kind === "upload";
    patch((current) => ({
      heroTask: fromFiles ? "metadata" : current.heroTask,
      metadata: { ...emptyMetadata },
    }));
    saveMetadataSession(null);
    const id = metadataReturn.current;
    metadataReturn.current = null;
    // The trigger is re-created with the screen behind the editor, so it is
    // waited for over a few frames rather than assumed to be there already.
    let tries = 12;
    const restore = () => {
      const target = document.getElementById(id || "") ||
        document.getElementById("edit-metadata-selection") ||
        document.getElementById("edit-metadata-bar") ||
        document.getElementById("metadata-files") ||
        document.getElementById("url");
      if (target) {
        target.scrollIntoView({ block: "center", behavior: "instant" });
        target.focus({ preventScroll: true });
      }
      else if (--tries > 0) requestAnimationFrame(restore);
    };
    requestAnimationFrame(restore);
    return true;
  }, [cancelInspect, releaseUploads, patch, patchMetadata]);

  /** Throws away changes that were brought back from an earlier visit. */
  const discardRestoredDraft = useCallback(
    () => patchMetadata({ familyDraft: {}, faceDrafts: {}, restoredDraft: false }),
    [patchMetadata],
  );
  const keepEditing = useCallback(
    () => patchMetadata({ confirmLeave: false }),
    [patchMetadata],
  );

  // -- Browser history -------------------------------------------------------
  // The three screens share one address, so the history entries carry which
  // screen they stand for. Going deeper pushes an entry; going back out by a
  // button walks back over the entry it pushed, so the browser's Back button
  // and the page's own buttons always agree on where "back" is.
  const view = state.metadata.open
    ? "editor"
    : state.fonts.length
      ? "catalog"
      : "landing";
  const lastView = useRef(null);
  const fromPop = useRef(false);
  const skipPop = useRef(0);
  useEffect(() => {
    const previous = lastView.current;
    lastView.current = view;
    if (previous === null || !restored.current) {
      if (!history.state?.fount)
        history.replaceState({ ...history.state, fount: view }, "");
      return;
    }
    if (previous === view) return;
    if (fromPop.current) {
      fromPop.current = false;
      return;
    }
    // A reload restores the screen its entry already stands for.
    if (history.state?.fount === view) return;
    if (VIEW_RANK[view] > VIEW_RANK[previous]) {
      history.pushState({ fount: view }, "", historyUrl());
    } else if (history.state?.fount === previous) {
      skipPop.current += 1;
      history.back();
    } else {
      history.replaceState({ fount: view }, "", historyUrl());
    }
  }, [view]);

  useEffect(() => {
    const onPop = (event) => {
      const current = lastView.current;
      if (skipPop.current) {
        // Our own step back. It may land on a deeper entry than the screen
        // now showing (the logo leaves the editor and the catalogue at once).
        skipPop.current -= 1;
        if (event.state?.fount !== current)
          history.replaceState({ fount: current }, "", historyUrl());
        return;
      }
      // In-page anchors inside the editor make entries of their own.
      if (!event.state?.fount && /^#font-/.test(location.hash)) return;
      const target = event.state?.fount || "landing";
      if (target === current) return;
      if (current === "editor") {
        fromPop.current = true;
        if (!closeMetadata()) {
          fromPop.current = false;
          history.pushState({ fount: "editor" }, "", historyUrl());
          return;
        }
        if (target === "landing") clearResults();
        return;
      }
      if (current === "catalog" && target === "landing") {
        if (latest.current.scanning || latest.current.grabbing) {
          history.pushState({ fount: "catalog" }, "", historyUrl());
          return;
        }
        fromPop.current = true;
        clearResults();
        return;
      }
      // Forward into a screen that no longer exists keeps the entry honest.
      history.replaceState({ fount: current }, "", historyUrl());
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [closeMetadata, clearResults]);

  // Changing the preview text invalidates a coverage run made against the old text.
  const setSample = useCallback(
    (sample) =>
      patch((current) => {
        if (current.coverage) coverageRef.current++;
        return { sample, coverage: null };
      }),
    [patch],
  );

  const value = {
    ...state,
    delivery,
    busy,
    selectedSet,
    expandedSet,
    filtered,
    groups,
    sampleText: state.sample || DEFAULT_SAMPLE,
    hasResults: state.fonts.length > 0,
    collectionLabel: collectionLabel(state.fonts),
    filteredLabel: collectionLabel(filtered),
    patch,
    runScan,
    cancelScan,
    clearResults,
    toggleFace,
    toggleFamily,
    selectVariableOnly,
    selectAllMatches,
    clearSelection,
    undoClear,
    toggleExpanded,
    showMoreFaces,
    setLayout,
    setSample,
    download,
    retryFailed,
    checkCoverage,
    dismissCoverage,
    openMetadataFromSelection,
    openMetadataFromFiles,
    setFamilyField,
    setFaceField,
    resetField,
    applyMetadata,
    retryMetadata,
    editMetadataAgain,
    closeMetadata,
    discardRestoredDraft,
    keepEditing,
    forgetSite: (url) => patch({ history: forgetSite(url) }),
    clearHistory: () => patch({ history: clearHistory() }),
  };

  return (
    <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
  );
}

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside StoreProvider");
  return store;
}
