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

function key(tabId) {
  return `fonts:${tabId}`;
}

async function recordFont(tabId, url, contentType) {
  const k = key(tabId);
  const store = await chrome.storage.session.get(k);
  const list = store[k] || [];
  if (list.some((f) => f.url === url)) return;
  list.push({ url, contentType: contentType || "" });
  // Cap to avoid unbounded growth on font-heavy pages.
  if (list.length > 400) list.shift();
  await chrome.storage.session.set({ [k]: list });
}

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0) return;
    const header = (details.responseHeaders || []).find(
      (h) => h.name.toLowerCase() === "content-type"
    );
    const contentType = header ? header.value || "" : "";
    const looksFont =
      (contentType && FONT_CT.test(contentType) && !/json|html|css|javascript/i.test(contentType)) ||
      FONT_EXT.test(details.url);
    if (looksFont) recordFont(details.tabId, details.url, contentType);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Reset a tab's list when it starts loading a new page.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && changeInfo.url) {
    chrome.storage.session.remove(key(tabId));
  }
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(key(tabId)));
