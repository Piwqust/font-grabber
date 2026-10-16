// Storage is best-effort: private windows and locked-down browsers throw on
// access, and the app has to stay usable when it does.
import { HOSTED } from "./auth.js";

export function readLocal(key, fallback) {
  try {
    return (HOSTED && key === HISTORY_KEY ? sessionStorage : localStorage).getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key, value) {
  try {
    (HOSTED && key === HISTORY_KEY ? sessionStorage : localStorage).setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

const HISTORY_KEY = "fount-history-v1";
const HISTORY_LIMIT = 20;

export function historyEntries() {
  try {
    const entries = JSON.parse(readLocal(HISTORY_KEY, "[]"));
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((item) => {
        try {
          const url = new URL(item.url);
          return (
            ["http:", "https:"].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            typeof item.time === "number" &&
            Number.isFinite(item.count)
          );
        } catch {
          return false;
        }
      })
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function rememberSite(url, mode, count) {
  const parsed = new URL(url);
  // Never persist credentials that were pasted into the address.
  if (parsed.username || parsed.password) return historyEntries();
  const entries = [
    { url, mode, count, time: Date.now() },
    ...historyEntries().filter((item) => item.url !== url),
  ].slice(0, HISTORY_LIMIT);
  writeLocal(HISTORY_KEY, JSON.stringify(entries));
  return entries;
}

export function forgetSite(url) {
  const entries = historyEntries().filter((item) => item.url !== url);
  writeLocal(HISTORY_KEY, JSON.stringify(entries));
  return entries;
}

export function clearHistory() {
  writeLocal(HISTORY_KEY, "[]");
  return [];
}

/* --- Specimen card layout --------------------------------------------------
   Where the hero cards were last dropped. The offsets are measured against a
   layout that depends on the window width, so the width is stored alongside
   them and the whole arrangement is dropped once the window has changed size
   enough that the old offsets would no longer mean the same thing. */

const CARDS_KEY = "fount-cards-v1";
const CARDS_WIDTH_TOLERANCE = 0.1;

function readCards() {
  try {
    const saved = JSON.parse(readLocal(CARDS_KEY, "null"));
    if (!saved || typeof saved !== "object") return null;
    if (!Number.isFinite(saved.width) || saved.width <= 0) return null;
    if (!saved.cards || typeof saved.cards !== "object") return null;
    return saved;
  } catch {
    return null;
  }
}

/** True when the stored offsets were measured at roughly this window width. */
export function cardLayoutFits() {
  const saved = readCards();
  if (!saved) return true;
  return (
    Math.abs(saved.width - innerWidth) / saved.width <= CARDS_WIDTH_TOLERANCE
  );
}

export function cardPositions() {
  const saved = cardLayoutFits() ? readCards() : null;
  if (!saved) return {};
  const out = {};
  for (const [id, value] of Object.entries(saved.cards)) {
    if (Number.isFinite(value?.x) && Number.isFinite(value?.y))
      out[id] = { x: value.x, y: value.y };
  }
  return out;
}

export function cardPosition(id) {
  return cardPositions()[id] || { x: 0, y: 0 };
}

export function rememberCardPosition(id, position) {
  const cards = cardPositions();
  if (position.x === 0 && position.y === 0) delete cards[id];
  else cards[id] = { x: Math.round(position.x), y: Math.round(position.y) };
  writeLocal(CARDS_KEY, JSON.stringify({ width: innerWidth, cards }));
}

export function forgetCardPosition(id) {
  rememberCardPosition(id, { x: 0, y: 0 });
}

export function clearCardPositions() {
  writeLocal(CARDS_KEY, JSON.stringify({ width: innerWidth, cards: {} }));
}

const SESSION_KEY = "fount-web-session-v2";

export function saveSession(session) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* Storage may be disabled or full; the live session stays usable. */
  }
}

export function loadSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (
      !saved ||
      !Array.isArray(saved.fonts) ||
      !saved.url ||
      !/^https?:$/.test(new URL(saved.url).protocol)
    )
      return null;
    return saved;
  } catch {
    return null;
  }
}

/* --- Metadata draft --------------------------------------------------------
   The editor keeps its own entry, so a reload in the middle of renaming a
   family does not lose the draft. Only what can be serialised is written: the
   chosen files themselves stay in memory, and their previews are simply
   reloaded as fallbacks after a reload. */

const METADATA_KEY = "fount-metadata-v1";

/* A draft left behind when the editor is closed before downloading. Opening
   the same files again brings it back, so leaving the editor is never how
   typed changes get lost. One is kept: it belongs to the last files edited. */
const PARKED_KEY = "fount-metadata-parked-v1";

export function parkMetadataDraft(entry) {
  try {
    if (!entry) sessionStorage.removeItem(PARKED_KEY);
    else sessionStorage.setItem(PARKED_KEY, JSON.stringify(entry));
  } catch {
    /* Without storage the draft simply is not kept. */
  }
}

export function loadParkedDraft() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PARKED_KEY));
    return saved && typeof saved.key === "string" ? saved : null;
  } catch {
    return null;
  }
}

export function clearPrivateSession() {
  for (const key of [SESSION_KEY, METADATA_KEY, PARKED_KEY, HISTORY_KEY]) {
    try { sessionStorage.removeItem(key); } catch {}
  }
  try { localStorage.removeItem(HISTORY_KEY); } catch {}
}

export function saveMetadataSession(draft) {
  try {
    if (!draft) sessionStorage.removeItem(METADATA_KEY);
    else sessionStorage.setItem(METADATA_KEY, JSON.stringify(draft));
  } catch {
    /* Storage may be disabled or full; the live draft stays usable. */
  }
}

export function loadMetadataSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(METADATA_KEY));
    if (
      !saved ||
      !Array.isArray(saved.fonts) ||
      !saved.fonts.length ||
      !saved.source ||
      !["scan", "upload"].includes(saved.source.kind)
    )
      return null;
    return {
      ...saved,
      familyDraft: saved.familyDraft || {},
      faceDrafts: saved.faceDrafts || {},
    };
  } catch {
    return null;
  }
}
