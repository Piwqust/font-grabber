// The extension popup, built from the same component library as the website.
// State lives in this one component; everything that touches Chrome, fonts or
// files lives in engine.js.
import { render } from "preact";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import { Button, IconButton } from "../../core/src/web/src/ui/Button.jsx";
import { Checkbox } from "../../core/src/web/src/ui/Checkbox.jsx";
import { Disclosure } from "../../core/src/web/src/ui/Disclosure.jsx";
import { Field } from "../../core/src/web/src/ui/Field.jsx";
import { Segmented } from "../../core/src/web/src/ui/Segmented.jsx";
import { Slider } from "../../core/src/web/src/ui/Slider.jsx";
import { Tooltip } from "../../core/src/web/src/ui/Tooltip.jsx";

import * as localEngine from "./engine.js";
import { selectBackend } from "./backend.js";
const engine = selectBackend(localEngine);
import {
  previewFamily,
  resetPreviews,
  retryFailedPreviews,
  usePreview,
} from "./previews.js";

const READY_STATUS = {
  message: "TTF / OTF · saved to Downloads / Fount",
  kind: "",
};

function Popup() {
  const [fonts, setFonts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [sample, setSample] = useState("");
  const [size, setSize] = useState(34);
  const [visibleCount, setVisibleCount] = useState(engine.PAGE_SIZE);
  const [delivery, setDelivery] = useState("zip");

  const [page, setPage] = useState({ host: "", url: "", tabId: null });
  const [scanning, setScanning] = useState(true);
  const [scanNote, setScanNote] = useState(null);
  const [empty, setEmpty] = useState(null); // {title, message, action}
  const [grabbing, setGrabbing] = useState(false);
  const [progress, setProgress] = useState(null); // {done, total}
  const [status, setStatus] = useState(READY_STATUS);
  const [failures, setFailures] = useState([]);
  const [undoIds, setUndoIds] = useState([]);

  const cancelled = useRef(false);
  const pageRef = useRef(page);
  pageRef.current = page;
  const busy = scanning || grabbing;

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return fonts.filter(
      (font) =>
        (!selectedOnly || selectedSet.has(font.id)) &&
        engine.matchesQuery(font, needle),
    );
  }, [fonts, query, selectedOnly, selectedSet]);

  useEffect(() => {
    document.documentElement.style.setProperty("--preview-size", `${size}px`);
  }, [size]);

  // -- Scan ----------------------------------------------------------------
  const scan = useCallback(async () => {
    setScanning(true);
    setEmpty(null);
    setScanNote("Finding fonts on this page…");
    engine.warmConverter();
    try {
      const result = await engine.scanActiveTab();
      const samePage = pageRef.current.url === result.url;
      if (samePage) {
        // A rescan of the same page keeps what worked and retries what did not.
        retryFailedPreviews();
      } else {
        resetPreviews();
        engine.resetCache();
      }
      engine.setSourceTab(result.tabId);

      const saved = samePage
        ? null
        : await engine.loadUiState(result.tabId, result.url);
      const keep = samePage ? selected : saved?.selected || [];

      setPage({ host: result.host, url: result.url, tabId: result.tabId });
      setFonts(result.fonts);
      setSelected(
        keep.filter((id) => result.fonts.some((font) => font.id === id)),
      );
      if (!samePage) {
        setSelectedOnly(!!saved?.selectedOnly);
        setSample(saved?.sample || "");
        setQuery(saved?.filter || "");
        setSize(Number(saved?.size) || 34);
      }
      setVisibleCount(engine.PAGE_SIZE);
      setUndoIds([]);
      setFailures([]);
      setStatus(READY_STATUS);
      setScanNote(result.fonts.length ? null : "No font files detected.");
      if (!result.fonts.length)
        setEmpty({
          title: "No downloadable fonts yet",
          message: "Scroll the source page to load its fonts, then scan again.",
          action: "rescan",
        });
    } catch (error) {
      const unsupported = error.code === "unsupported";
      setScanNote(
        unsupported
          ? null
          : "Couldn't read this page. Use Scan again to retry.",
      );
      setEmpty({
        title: unsupported
          ? "This page cannot be scanned"
          : "Couldn't scan this page",
        message: unsupported
          ? error.message
          : `${error.message} Open a website and try again.`,
        action: unsupported ? null : "rescan",
      });
      if (unsupported) setFonts([]);
    } finally {
      setScanning(false);
    }
  }, [selected]);

  useEffect(() => {
    scan();
    // Only on open: a rescan is an explicit action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Persistence ---------------------------------------------------------
  useEffect(() => {
    if (!page.tabId) return;
    const timer = setTimeout(
      () =>
        engine.saveUiState(page.tabId, {
          url: page.url,
          selected,
          sample,
          filter: query,
          size: String(size),
          selectedOnly,
        }),
      180,
    );
    return () => clearTimeout(timer);
  }, [page, selected, sample, query, size, selectedOnly]);

  // -- Selection -----------------------------------------------------------
  const toggle = (id, on) =>
    setSelected((current) =>
      on
        ? [...new Set([...current, id])]
        : current.filter((value) => value !== id),
    );

  const clearSelection = () => {
    setUndoIds(selected);
    setSelected([]);
  };

  // -- Download ------------------------------------------------------------
  const grab = async (ids = selected) => {
    if (busy || !ids.length) return;
    cancelled.current = false;
    setGrabbing(true);
    setFailures([]);
    setProgress({ done: 0, total: ids.length });
    setStatus({ message: "Preparing fonts. Keep this window open…", kind: "" });

    try {
      const wanted = new Set(ids);
      const { converted, failures: failed } = await engine.convertFonts(
        fonts.filter((font) => wanted.has(font.id)),
        {
          isCancelled: () => cancelled.current,
          onProgress: (done, total) => {
            setProgress({ done, total });
            setStatus({
              message: `Preparing ${done} of ${total} fonts…`,
              kind: "",
            });
          },
        },
      );

      if (cancelled.current) {
        setStatus({
          message: "Download cancelled. Your selection is kept.",
          kind: "",
        });
        return;
      }
      setFailures(failed);
      if (!converted.length) {
        setStatus({
          message: "No files prepared. Open the details below to retry.",
          kind: "error",
        });
        return;
      }

      await engine.deliver(converted, delivery, page.host);
      setStatus({
        message: `Download started: ${converted.length} font${
          converted.length === 1 ? "" : "s"
        }.${failed.length ? " Check skipped files below." : " Find it in Downloads / Fount."}`,
        kind: failed.length ? "error" : "success",
      });
    } catch (error) {
      setFailures(ids.map((id) => ({ id, message: error.message })));
      setStatus({
        message: "Download failed. Use Retry below.",
        kind: "error",
      });
    } finally {
      setGrabbing(false);
      setProgress(null);
    }
  };

  const shown = filtered.slice(0, visibleCount);
  const canReset = Boolean(sample) || size !== 34;

  return (
    <>
      <header class="pop-head">
        <div class="pop-brand">
          <span class="pop-wordmark">Fount</span>
          <span class="pop-origin" title={page.host}>
            {page.host || "Current page"}
          </span>
        </div>
        <Tooltip text="Scan this page again">
          <IconButton
            icon="refresh"
            size="s"
            label="Scan page again"
            disabled={busy}
            onClick={scan}
          />
        </Tooltip>
      </header>

      <div class="pop-controls">
        <Field
          label="Search fonts"
          hideLabel
          icon="search"
          size="s"
          type="search"
          placeholder="Search fonts or styles"
          autocomplete="off"
          value={query}
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setVisibleCount(engine.PAGE_SIZE);
          }}
        />

        <div class="pop-row">
          <Segmented
            label="Show fonts"
            size="s"
            options={[
              { value: "all", label: "All" },
              { value: "selected", label: "Selected", badge: selected.length },
            ]}
            value={selectedOnly ? "selected" : "all"}
            onChange={(value) => {
              setSelectedOnly(value === "selected");
              setVisibleCount(engine.PAGE_SIZE);
            }}
          />
          <span class="pop-count" role="status">
            {filtered.length} / {fonts.length}
          </span>
        </div>

        <Disclosure summary="Preview settings" class="pop-preview">
          <Field
            label="Preview text"
            value={sample}
            maxLength={160}
            placeholder="Try your own words"
            autocomplete="off"
            size="s"
            onInput={(event) => setSample(event.currentTarget.value)}
          />
          <Slider
            label="Size"
            min={20}
            max={64}
            suffix=" px"
            value={size}
            onInput={setSize}
          />
          <Button
            size="s"
            variant="text"
            icon="refresh"
            disabled={!canReset}
            onClick={() => {
              setSample("");
              setSize(34);
            }}
          >
            Reset text and size
          </Button>
        </Disclosure>

        <div class="pop-row pop-actions">
          <Button
            size="s"
            variant="text"
            disabled={
              busy || !filtered.some((font) => !selectedSet.has(font.id))
            }
            onClick={() =>
              setSelected([
                ...new Set([...selected, ...filtered.map((f) => f.id)]),
              ])
            }
          >
            Select matches
          </Button>
          <Button
            size="s"
            variant="text"
            disabled={busy || !selected.length}
            onClick={clearSelection}
          >
            Clear
          </Button>
          {undoIds.length && !selected.length ? (
            <Button
              size="s"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSelected(
                  undoIds.filter((id) => fonts.some((font) => font.id === id)),
                );
                setUndoIds([]);
              }}
            >
              Undo clear
            </Button>
          ) : null}
        </div>

        {scanNote ? (
          <p class="status status-busy" role="status">
            {scanNote}
          </p>
        ) : null}
      </div>

      <main class="pop-list" aria-label="Font results" aria-busy={scanning}>
        {empty ? (
          <div class="pop-empty">
            <span class="pop-empty-mark" aria-hidden="true">
              Aa
            </span>
            <h2>{empty.title}</h2>
            <p>{empty.message}</p>
            {empty.action === "rescan" ? (
              <Button variant="outline" size="s" icon="refresh" onClick={scan}>
                Scan again
              </Button>
            ) : null}
          </div>
        ) : null}

        {!empty && !shown.length && fonts.length ? (
          <div class="pop-empty">
            <h2>
              {selectedOnly ? "Nothing selected here" : "No matching fonts"}
            </h2>
            <p>
              {selectedOnly
                ? "Choose faces in All to build your download."
                : "Try another name or clear your search."}
            </p>
            <Button
              variant="outline"
              size="s"
              onClick={() => {
                setQuery("");
                setSelectedOnly(false);
              }}
            >
              Show all fonts
            </Button>
          </div>
        ) : null}

        {shown.map((font) => (
          <FaceRow
            key={font.id}
            font={font}
            sample={sample}
            selected={selectedSet.has(font.id)}
            disabled={busy}
            onToggle={toggle}
            onDownload={() => grab([font.id])}
          />
        ))}

        {filtered.length > shown.length ? (
          <Button
            variant="outline"
            size="s"
            icon="chevronDown"
            class="pop-more"
            onClick={() => setVisibleCount((n) => n + engine.PAGE_SIZE)}
          >
            Show more ({shown.length} of {filtered.length})
          </Button>
        ) : null}
      </main>

      <footer class="pop-foot">
        <div class="pop-row">
          <strong class="pop-selection">
            {selected.length
              ? `${selected.length} font${selected.length === 1 ? "" : "s"} selected`
              : "Select fonts to download"}
          </strong>
          <Segmented
            label="Download format"
            size="s"
            options={[
              { value: "zip", label: "ZIP" },
              { value: "files", label: "Files" },
            ]}
            value={delivery}
            disabled={grabbing}
            onChange={setDelivery}
          />
        </div>

        <div class="pop-row pop-download">
          <Button
            variant="solid"
            size="m"
            full
            iconEnd="download"
            busy={grabbing}
            disabled={busy || !selected.length}
            onClick={() => grab()}
          >
            {grabbing
              ? "Preparing…"
              : selected.length
                ? `Download ${selected.length} font${selected.length === 1 ? "" : "s"}`
                : "Download selected"}
          </Button>
          {grabbing ? (
            <Button
              size="m"
              variant="outline"
              onClick={() => {
                cancelled.current = true;
                setStatus({
                  message: "Cancelling after the current font…",
                  kind: "",
                });
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>

        {progress ? (
          <div
            class="pop-progress"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemin={0}
            aria-valuemax={progress.total}
          >
            <span style={`width:${(progress.done / progress.total) * 100}%`} />
          </div>
        ) : null}

        <p class={`status status-${status.kind || "plain"}`} role="status">
          {status.message}
        </p>

        {failures.length ? (
          <Disclosure
            summary={`${failures.length} font${failures.length === 1 ? "" : "s"} could not be prepared`}
            tone="warning"
            defaultOpen
          >
            <ul class="pop-failures">
              {failures.map((failure) => (
                <li key={failure.id}>{failure.message}</li>
              ))}
            </ul>
            <Button
              size="s"
              variant="outline"
              icon="refresh"
              disabled={grabbing}
              onClick={() => grab(failures.map((failure) => failure.id))}
            >
              Retry failed fonts
            </Button>
          </Disclosure>
        ) : null}
      </footer>
    </>
  );
}

function FaceRow({ font, sample, selected, disabled, onToggle, onDownload }) {
  const { ref, state } = usePreview(font);
  const style = engine.styleLabel(font);
  const label = `${font.family} ${style}`;

  const onRowClick = (event) => {
    if (disabled) return;
    if (event.target.closest("input, button, label, summary")) return;
    if (getSelection()?.toString()) return;
    onToggle(font.id, !selected);
  };

  return (
    <article
      class="pop-face"
      data-selected={String(selected)}
      onClick={onRowClick}
    >
      <div class="pop-face-head">
        <Checkbox
          checked={selected}
          disabled={disabled}
          label={`Select ${label}`}
          hideLabel
          onChange={(next) => onToggle(font.id, next)}
        />
        <div class="pop-face-id">
          <h3>{font.family}</h3>
          <span>{style}</span>
        </div>
        <span class="pop-face-format">
          {font.format || engine.extFromUrl(font.url) || "Font file"}
        </span>
      </div>

      <p
        ref={ref}
        class={`preview is-${state}`}
        style={
          state === "ready"
            ? `font-family:"${previewFamily(font.id)}", serif`
            : undefined
        }
      >
        {sample || font.family}
      </p>
      {state === "failed" ? (
        <p class="preview-note">Preview unavailable. Fallback font shown.</p>
      ) : null}

      <div class="pop-face-foot">
        <Button
          size="s"
          variant="quiet"
          icon="download"
          disabled={disabled}
          aria-label={`Download ${label}`}
          onClick={onDownload}
        >
          Download
        </Button>
      </div>
    </article>
  );
}

render(<Popup />, document.getElementById("root"));
