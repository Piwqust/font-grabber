// Loads each face's actual font file so previews are set in the real type.
//
// Two constraints shape this. A page can carry a thousand faces, so files are
// fetched only when a preview scrolls near the viewport. And a new scan must
// invalidate everything the previous one registered, or stale @font-face rules
// keep answering for ids that have been reused.
import { useEffect, useRef, useState } from "preact/hooks";
import { fontProxyUrl } from "./api.js";
import { cssId, formatHint } from "./fonts.js";

const status = new Map(); // id -> "loading" | "ready" | "failed"
const faces = new Map(); // id -> FontFace
const listeners = new Map(); // id -> Set<listener>
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

async function load(font) {
  if (status.has(font.id)) return;
  const mine = generation;
  status.set(font.id, "loading");
  emit(font.id);
  try {
    const source = font.sources?.[0];
    if (!source) throw new Error("No source file for this face");
    // A file chosen on this computer is already local: it is read from its
    // object URL, not through the proxy the server uses for remote files.
    const href = source.local ? source.url : fontProxyUrl(source.url);
    const face = new FontFace(
      previewFamily(font.id),
      `url("${href}")${formatHint(source)}`,
    );
    await face.load();
    if (mine !== generation) return;
    document.fonts.add(face);
    faces.set(font.id, face);
    status.set(font.id, "ready");
  } catch {
    if (mine !== generation) return;
    status.set(font.id, "failed");
  }
  emit(font.id);
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
            if (font) load(font);
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

  useEffect(() => {
    if (!font) return;
    setState(status.get(font.id) || "loading");
    return subscribe(font.id, () => setState(status.get(font.id) || "loading"));
  }, [font?.id]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !font || !observer) return;
    if (status.get(font.id) === "ready" || status.get(font.id) === "failed")
      return;
    pending.set(node, font);
    observer.observe(node);
    return () => {
      observer.unobserve(node);
      pending.delete(node);
    };
  }, [font?.id]);

  return { ref, state };
}
