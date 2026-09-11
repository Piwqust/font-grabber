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
  familyKey,
  matchesFilter,
  normalizeUrl,
} from "./lib/fonts.js";
import { resetPreviews } from "./lib/previews.js";
import {
  clearHistory,
  forgetSite,
  historyEntries,
  loadSession,
  readLocal,
  rememberSite,
  saveSession,
  writeLocal,
} from "./lib/storage.js";

export const PAGE_SIZE = 40;
const FACES_PER_FAMILY = 40;
const COVERAGE_BATCH = 80;

export const HOSTED =
  typeof document !== "undefined" && document.body.dataset.hosted === "true";

const StoreContext = createContext(null);

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

  history: historyEntries(),
};

export function StoreProvider({ children }) {
  const [state, setState] = useState(initialState);
  const scanRef = useRef(null);
  const coverageRef = useRef(0);
  const restored = useRef(false);
  const latest = useRef(state);
  latest.current = state;

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

  const groups = useMemo(() => familyGroups(filtered), [filtered]);
  const busy = state.scanning || state.grabbing;
  const delivery = HOSTED ? "zip" : state.delivery;

  // -- Session -------------------------------------------------------------
  useEffect(() => {
    const saved = loadSession();
    restored.current = true;
    if (!saved) return;
    const fonts = saved.fonts;
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
      } catch {
        patch({
          status: {
            message: "Enter a website address, such as example.com.",
            kind: "error",
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
        const fonts = report.fonts || [];
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
          showExtensionHelp: fonts.length === 0,
          status: fonts.length
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
        else
          patch({
            status: {
              message: `Could not scan this page. Check the address and retry. ${error.message}`,
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
