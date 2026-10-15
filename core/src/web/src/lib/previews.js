// Loads each face's actual font file so previews are set in the real type.
//
// Two constraints shape this. A page can carry a thousand faces, so files are
// fetched only when a preview scrolls near the viewport. And a new scan must
// invalidate everything the previous one registered, or stale @font-face rules
// keep answering for ids that have been reused.
import { useEffect, useRef, useState } from "preact/hooks";
import { fontProxyUrl } from "./api.js";
import { cssId } from "./fonts.js";
import { apiFetch } from "./auth.js";

const status = new Map(); // id -> "loading" | "ready" | "failed"
const faces = new Map(); // id -> FontFace
const listeners = new Map(); // id -> Set<listener>
const previewQueue = [];
const controllers = new Map();
const MAX_ACTIVE_PREVIEWS = 2;
let activePreviews = 0;
let generation = 0;

// Listeners are keyed by face id so a file arriving only re-renders the
// previews waiting on it, not every row in the catalogue.
function emit(id) {
  if (id === undefined) {
    for (const set of listeners.values())
      for (const listener of set) listener();
    return;
  }
  for (const listener of listeners.get(id) || []) listener();
}

function subscribe(id, listener) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id).add(listener);
  return () => {
    const set = listeners.get(id);
    set?.delete(listener);
    if (set && !set.size) listeners.delete(id);
  };
}

/** Drops every registered face. Called when a scan replaces the collection. */
export function resetPreviews() {
  generation++;
  previewQueue.length = 0;
  for (const controller of controllers.values()) controller.abort();
  controllers.clear();
  for (const face of faces.values()) {
    try {
      document.fonts.delete(face);
    } catch {
      /* The face may already have been removed. */
    }
  }
  faces.clear();
  status.clear();
  emit();
}

export function previewFamily(id) {
  return `fg-${cssId(id)}`;
}

/** Drops one face, for a preview whose file is about to go away. */
export function dropPreview(id) {
  controllers.get(id)?.abort();
  controllers.delete(id);
  for (let i = previewQueue.length - 1; i >= 0; i--)
    if (previewQueue[i].id === id) previewQueue.splice(i, 1);
  const face = faces.get(id);
  if (face) {
    try {
      document.fonts.delete(face);
    } catch {
      /* The face may already have been removed. */
    }
    faces.delete(id);
  }
  status.delete(id);
  emit(id);
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function load(font) {
  const mine = generation;
  const controller = new AbortController();
  controllers.set(font.id, controller);
  const stale = () => mine !== generation || controller.signal.aborted;
  try {
    const sources = font.sources?.filter(Boolean) || [];
    if (!sources.length) throw new Error("No source file for this face");
    let lastError;
    for (const source of sources) {
      // A file chosen on this computer is already local: it is read from its
      // object URL, not through the proxy the server uses for remote files.
      const href = source.local ? source.url : fontProxyUrl(source.url);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          if (stale()) return;
          const response = await apiFetch(href, { signal: controller.signal });
          if (!response.ok) throw new Error("Preview unavailable (" + response.status + ")");
          const face = new FontFace(previewFamily(font.id), await response.arrayBuffer());
          await face.load();
          if (stale()) return;
          document.fonts.add(face);
          faces.set(font.id, face);
          status.set(font.id, "ready");
          emit(font.id);
          return;
        } catch (error) {
          if (stale()) return;
          lastError = error;
          if (attempt === 0) await wait(350);
        }
      }
    }
    throw lastError || new Error("Preview unavailable");
  } catch {
    if (stale()) return;
    status.set(font.id, "failed");
  } finally {
    if (controllers.get(font.id) === controller) controllers.delete(font.id);
  }
  emit(font.id);
}

function drainPreviewQueue() {
  while (activePreviews < MAX_ACTIVE_PREVIEWS && previewQueue.length) {
    const font = previewQueue.shift();
    // Several previews can share a face. Follow subscribers, not the first
    // DOM node, which a search may replace while another still needs the font.
    if (!listeners.has(font.id)) {
      status.delete(font.id);
      continue;
    }
    activePreviews += 1;
    load(font).finally(() => {
      activePreviews -= 1;
      drainPreviewQueue();
    });
  }
}

function enqueuePreview(font) {
  if (!font || status.has(font.id)) return;
  status.set(font.id, "loading");
  emit(font.id);
  previewQueue.push(font);
  drainPreviewQueue();
}

// A single observer for every preview on the page; 300px of margin means the
// file is usually decoded by the time the row is actually looked at.
const observer =
  typeof IntersectionObserver === "function"
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            const font = pending.get(entry.target);
            if (font) enqueuePreview(font);
          }
        },
        { rootMargin: "300px 0px" },
      )
    : null;

const pending = new WeakMap();

/**
 * Attaches a preview element to the loader.
 * @returns {{ref: object, state: "loading"|"ready"|"failed"}}
 */
export function usePreview(font) {
  const ref = useRef(null);
  const [state, setState] = useState(() =>
    font ? status.get(font.id) || "loading" : "loading",
  );
  // A reset empties the queue and the node was unobserved when it first came
  // into view, so a new scan of the same site must observe it again.
  const [epoch, setEpoch] = useState(generation);

  useEffect(() => {
    if (!font) return;
    const sync = () => {
      setState(status.get(font.id) || "loading");
      setEpoch(generation);
    };
    sync();
    return subscribe(font.id, sync);
  }, [font?.id]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !font) return;
    if (status.get(font.id) === "ready" || status.get(font.id) === "failed")
      return;
    if (!observer) {
      enqueuePreview(font);
      return;
    }
    pending.set(node, font);
    observer.observe(node);
    return () => {
      observer.unobserve(node);
      pending.delete(node);
    };
  }, [font?.id, epoch]);

  return { ref, state };
}
