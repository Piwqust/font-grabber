// Preview loading for the popup. Same shape as the website's loader, but the
// bytes come from the engine's cache rather than a server proxy, because the
// popup has already had to fetch them through the page.
import { useEffect, useRef, useState } from "preact/hooks";
import { cssId, ensureBytes } from "./engine.js";

const status = new Map(); // id -> "loading" | "ready" | "failed"
const faces = new Map();
const listeners = new Map();
let generation = 0;

function emit(id) {
  for (const listener of listeners.get(id) || []) listener();
}

export function resetPreviews() {
  generation++;
  for (const face of faces.values()) {
    try {
      document.fonts.delete(face);
    } catch {
      /* Already removed. */
    }
  }
  faces.clear();
  status.clear();
  for (const id of [...listeners.keys()]) emit(id);
}

/** Forgets failed loads so a rescan retries them, keeping what already worked. */
export function retryFailedPreviews() {
  for (const [id, value] of [...status]) {
    if (value !== "failed") continue;
    status.delete(id);
    emit(id);
  }
}

export function previewFamily(id) {
  return "fg-" + cssId(id);
}

async function load(font) {
  if (status.has(font.id)) return;
  const mine = generation;
  status.set(font.id, "loading");
  emit(font.id);
  try {
    const entry = await ensureBytes(font);
    const face = new FontFace(
      previewFamily(font.id),
      `url("${entry.blobUrl}")`,
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

const pending = new WeakMap();
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
        { rootMargin: "150px 0px" },
      )
    : null;

export function usePreview(font) {
  const ref = useRef(null);
  const [state, setState] = useState(() => status.get(font.id) || "loading");

  useEffect(() => {
    if (!listeners.has(font.id)) listeners.set(font.id, new Set());
    const update = () => setState(status.get(font.id) || "loading");
    listeners.get(font.id).add(update);
    update();
    return () => {
      const set = listeners.get(font.id);
      set?.delete(update);
      if (set && !set.size) listeners.delete(font.id);
    };
  }, [font.id]);

  useEffect(() => {
    const node = ref.current;
    if (!node || !observer) return;
    const known = status.get(font.id);
    if (known === "ready" || known === "failed") return;
    pending.set(node, font);
    observer.observe(node);
    return () => {
      observer.unobserve(node);
      pending.delete(node);
    };
  }, [font.id]);

  return { ref, state };
}
