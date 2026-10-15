"use strict";

// Records the URL of every response that looks like a font (by Content-Type or
// extension), per tab. This is the reliable way to catch fonts that type-tester
// sites load from extensionless endpoints and/or inside Web Workers — those are
// invisible to in-page @font-face / FontFace inspection. The popup re-fetches
// these URLs (host permission bypasses CORS) and converts the bytes.
//
// State lives in chrome.storage.session so it survives service-worker restarts.

const FONT_CT = /font|woff|sfnt|octet-stream/i;
const FONT_EXT = /\.(woff2|woff|ttf|otf)(\?|#|$)/i;
// application/octet-stream is how extensionless font endpoints are usually
// served, but it is also every other binary — don't record the obvious non-fonts.
const NOT_FONT_EXT = /\.(js|mjs|json|webmanifest|css|html?|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|wav|wasm|pdf|zip|gz|br|map)(\?|#|$)/i;

function key(tabId) {
  return `fonts:${tabId}`;
}

// Per-tab lists are mirrored in memory so a burst of font responses (the normal
// case — a page requests all its faces at once) cannot lose entries to a
// read-modify-write race on chrome.storage.session. Writes are serialised behind
// a single promise chain; the memory mirror is rebuilt from storage after a
// service-worker restart.
const cache = new Map(); // tabId -> [{ url, contentType }]
// Bumped on navigation. A write queued for the previous page sees a stale
// generation and is dropped, instead of re-reading the old list from storage.
const generations = new Map(); // tabId -> number
let writeChain = Promise.resolve();

async function listFor(tabId) {
  let list = cache.get(tabId);
  if (!list) {
    const k = key(tabId);
    const store = await chrome.storage.session.get(k);
    list = store[k] || [];
    cache.set(tabId, list);
  }
  return list;
}

function recordFont(tabId, url, contentType) {
  const generation = generations.get(tabId) || 0;
  writeChain = writeChain
    .then(async () => {
      if ((generations.get(tabId) || 0) !== generation) return;
      const list = await listFor(tabId);
      if (list.some((f) => f.url === url)) return;
      list.push({ url, contentType: contentType || "" });
      // Cap to avoid unbounded growth on font-heavy pages.
      if (list.length > 400) list.shift();
      await chrome.storage.session.set({ [key(tabId)]: list });
    })
    .catch(() => {});
  return writeChain;
}

function forget(tabId, { closed = false } = {}) {
  generations.set(tabId, (generations.get(tabId) || 0) + 1);
  // An empty list, not a deletion: deleting would make the next write reload
  // the old page's list from storage before the removal below has run.
  cache.set(tabId, []);
  writeChain = writeChain
    .then(() => chrome.storage.session.remove(key(tabId)))
    .then(() => {
      if (closed) {
        cache.delete(tabId);
        generations.delete(tabId);
      }
    })
    .catch(() => {});
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const header = (details.responseHeaders || []).find(
      (h) => h.name.toLowerCase() === "content-type"
    );
    const contentType = header ? header.value || "" : "";
    const looksFont =
      (contentType &&
        FONT_CT.test(contentType) &&
        !/json|html|css|javascript/i.test(contentType) &&
        !NOT_FONT_EXT.test(details.url)) ||
      FONT_EXT.test(details.url);
    if (looksFont) recordFont(details.tabId, details.url, contentType);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Reset a tab's list when its top-level document is requested. This also covers
// reloads (tabs.onUpdated carries no url then) and always precedes the new
// page's own font requests.
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.tabId >= 0) forget(details.tabId);
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);
chrome.tabs.onRemoved.addListener((tabId) => forget(tabId, { closed: true }));
