"use strict";

const state = {
  fonts: [],
  selected: new Set(),
  origin: "",
  cache: new Map(), // url -> { bytes: Uint8Array, blobUrl: string }
};

const el = {
  origin: document.getElementById("origin"),
  filter: document.getElementById("filter"),
  sample: document.getElementById("sample"),
  size: document.getElementById("size"),
  selectAll: document.getElementById("select-all"),
  selectNone: document.getElementById("select-none"),
  count: document.getElementById("count"),
  list: document.getElementById("font-list"),
  empty: document.getElementById("empty"),
  status: document.getElementById("status"),
  grabZip: document.getElementById("grab-zip"),
  grabFiles: document.getElementById("grab-files"),
  faceStyle: (() => {
    const s = document.createElement("style");
    document.head.appendChild(s);
    return s;
  })(),
};

// The page-injected font collector lives in discover.js (shared with the Rust
// CLI/web app) and is exposed as the global `collectFontsInPage`.

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function init() {
  FontConverter.ready().catch(() => {});
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id || !/^https?:/.test(tab.url || "")) {
      showEmpty("Open a normal web page, then click the icon.", true);
      return;
    }
    try {
      state.origin = new URL(tab.url).host;
      el.origin.textContent = state.origin;
    } catch {}

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN", // needed to read fonts captured by capture.js (also runs in MAIN)
      func: collectFontsInPage,
      args: [{ includeBytes: true }],
    });
    const found = (results && results[0] && results[0].result) || [];

    // Merge fonts the background recorded at the network layer (extensionless or
    // Web-Worker-loaded fonts that in-page inspection can't see).
    const networkUrls = await getNetworkFonts(tab.id);
    const seen = new Set(found.map((f) => f.url));
    for (const url of networkUrls) {
      if (seen.has(url)) continue;
      seen.add(url);
      found.push({ url, family: "", weight: "400", style: "normal", format: "", fromNetwork: true });
    }

    found.forEach((f, i) => (f.id = `${i}:${f.url}`));
    deriveDisplayNames(found, slugFromUrl(tab.url));
    state.fonts = found;

    if (found.length === 0) {
      showEmpty("No downloadable fonts found on this page.", false);
      return;
    }
    render();
    updateSelection();
  } catch (error) {
    showEmpty("Couldn't read this page: " + error.message, true);
  }
}

// Read font URLs recorded by the background service worker for this tab.
async function getNetworkFonts(tabId) {
  try {
    const k = `fonts:${tabId}`;
    const store = await chrome.storage.session.get(k);
    return (store[k] || []).map((f) => f.url);
  } catch {
    return [];
  }
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const seg = (u.pathname.split("/").filter(Boolean).pop() || "").replace(/[-_]+/g, " ").trim();
    if (seg && !/\.(html?|php|aspx?)$/i.test(seg)) {
      return seg.replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return u.host.replace(/^www\./, "");
  } catch {
    return "Font";
  }
}

// Give URL-only candidates a readable name from their file name, falling back to
// the page slug for extensionless endpoints.
function deriveDisplayNames(fonts, fallback) {
  for (const font of fonts) {
    if (font.family && font.family.length > 1) continue;
    let name = "";
    try {
      const file = decodeURIComponent(new URL(font.url, location.href).pathname.split("/").pop() || "");
      if (/\.(woff2|woff|ttf|otf)$/i.test(file)) {
        name = file.replace(/\.(woff2|woff|ttf|otf)$/i, "").replace(/[_-]+/g, " ").trim();
      }
    } catch {
      /* extensionless or non-URL (captured) */
    }
    if (!name || name.length < 2) {
      name = fallback || "Font";
      if (/instance/i.test(font.url || "")) name += " Instance";
    }
    font.family = name;
  }
}

function showEmpty(message, isError) {
  el.empty.textContent = message;
  el.empty.className = "empty" + (isError ? " error" : "");
  el.empty.hidden = false;
  el.count.textContent = "";
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function matchesFilter(font, query) {
  if (!query) return true;
  if (font.family.toLowerCase().includes(query)) return true;
  return font.url.toLowerCase().includes(query);
}

function filteredFonts() {
  const query = el.filter.value.trim().toLowerCase();
  return query ? state.fonts.filter((f) => matchesFilter(f, query)) : state.fonts;
}

const previewObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      previewObserver.unobserve(entry.target);
      loadPreview(entry.target.dataset.id);
    }
  },
  { root: el.list, rootMargin: "200px 0px" }
);

function render() {
  el.empty.hidden = true;
  const fonts = filteredFonts();
  el.count.textContent =
    fonts.length === state.fonts.length
      ? `${state.fonts.length}`
      : `${fonts.length}/${state.fonts.length}`;

  el.list.querySelectorAll(".font-card").forEach((c) => c.remove());
  if (fonts.length === 0) {
    el.empty.textContent = "No fonts match your filter.";
    el.empty.className = "empty";
    el.empty.hidden = false;
    return;
  }

  const sample = el.sample.value || "The quick brown fox";
  const frag = document.createDocumentFragment();
  fonts.forEach((font, index) => frag.appendChild(buildCard(font, sample, index)));
  el.list.appendChild(frag);

  el.list.querySelectorAll(".font-card").forEach((card) => previewObserver.observe(card));
}

function buildCard(font, sample, index) {
  const card = document.createElement("article");
  card.className = "specimen font-card" + (state.selected.has(font.id) ? " selected" : "");
  card.dataset.id = font.id;
  card.style.setProperty("--d", `${Math.min(index, 16) * 0.02}s`);

  const badges = [];
  if (font.weight && font.weight !== "400") badges.push(`<span class="badge">${esc(font.weight)}</span>`);
  if (font.style && font.style !== "normal") badges.push(`<span class="badge">${esc(font.style)}</span>`);
  if (font.variable) badges.push(`<span class="badge variable">var</span>`);
  const fmt = font.format || extFromUrl(font.url);
  if (fmt) badges.push(`<span class="badge fmt">${esc(fmt)}</span>`);

  const number = String(index + 1).padStart(2, "0");
  card.innerHTML = `
    <div class="specimen-head">
      <label class="pick">
        <input type="checkbox" ${state.selected.has(font.id) ? "checked" : ""}>
        <span class="mark"></span>
        <span class="idx">${number}</span>
        <span class="font-name" title="${esc(font.family)}">${esc(font.family)}</span>
      </label>
      <div class="badges">${badges.join("")}</div>
    </div>
    <div class="preview loading">${esc(sample)}</div>
  `;

  card.querySelector("input").addEventListener("change", (event) => {
    if (event.target.checked) state.selected.add(font.id);
    else state.selected.delete(font.id);
    card.classList.toggle("selected", event.target.checked);
    updateSelection();
  });

  return card;
}

async function loadPreview(id) {
  const card = el.list.querySelector(`.font-card[data-id="${cssEscape(id)}"]`);
  if (!card) return;
  const preview = card.querySelector(".preview");
  const font = state.fonts.find((f) => f.id === id);
  if (!font) return;

  try {
    const entry = await ensureBytes(font);
    const family = `fg-${cssId(id)}`;
    el.faceStyle.appendChild(
      document.createTextNode(`@font-face{font-family:"${family}";src:url("${entry.blobUrl}");}`)
    );
    preview.style.fontFamily = `"${family}", system-ui, sans-serif`;
    preview.classList.remove("loading");
  } catch {
    preview.classList.remove("loading");
    preview.style.opacity = "0.4";
    preview.textContent = "(preview unavailable)";
  }
}

// ---------------------------------------------------------------------------
// Fetching + conversion
// ---------------------------------------------------------------------------
async function ensureBytes(font) {
  const cached = state.cache.get(font.url);
  if (cached) return cached;

  let bytes;
  if (font.b64) {
    // Captured (JS-injected) font — bytes travelled inline, there is no URL to refetch.
    const binary = atob(font.b64);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  } else {
    const response = await fetch(font.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }

  const blobUrl = URL.createObjectURL(new Blob([bytes]));
  const entry = { bytes, blobUrl };
  state.cache.set(font.url, entry);
  return entry;
}

function formatCode(font) {
  const fmt = (font.format || extFromUrl(font.url) || "").toLowerCase();
  if (fmt.includes("woff2")) return 1;
  if (fmt === "woff") return 2;
  if (fmt === "truetype" || fmt === "opentype" || fmt === "ttf" || fmt === "otf") return 3;
  return 0; // auto-sniff in WASM
}

async function convertSelected(onProgress) {
  const fonts = state.fonts.filter((f) => state.selected.has(f.id));
  const converted = [];
  const failures = [];
  let done = 0;

  for (const font of fonts) {
    try {
      const entry = await ensureBytes(font);
      const sfnt = await FontConverter.convert(
        entry.bytes,
        formatCode(font),
        font.family,
        font.weight,
        font.style
      );
      const ext = FontConverter.sfntExtension(sfnt);
      converted.push({ name: outputName(font, ext), data: sfnt });
    } catch (error) {
      failures.push(`${font.family}: ${error.message}`);
    }
    done += 1;
    onProgress(done, fonts.length);
  }
  return { converted, failures };
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------
el.grabZip.addEventListener("click", () => grab("zip"));
el.grabFiles.addEventListener("click", () => grab("files"));

let grabbing = false;
async function grab(mode) {
  if (grabbing || state.selected.size === 0) return;
  grabbing = true;
  setButtons(false);

  const total = state.selected.size;
  setStatus(`Converting 0/${total}…`, "");
  const { converted, failures } = await convertSelected((done, n) =>
    setStatus(`Converting ${done}/${n}…`, "")
  );

  if (converted.length === 0) {
    setStatus(failures[0] || "Nothing converted", "error");
    grabbing = false;
    setButtons(state.selected.size > 0);
    return;
  }

  try {
    if (mode === "zip") {
      const blob = await Zip.create(converted);
      await download(URL.createObjectURL(blob), `FontGrabber/${zipName()}`);
    } else {
      for (const file of converted) {
        const blob = new Blob([file.data], { type: "application/octet-stream" });
        await download(URL.createObjectURL(blob), `FontGrabber/${file.name}`);
      }
    }
    const failNote = failures.length ? ` · ${failures.length} failed` : "";
    setStatus(`Saved ${converted.length} file${converted.length === 1 ? "" : "s"}${failNote}`, "ok");
  } catch (error) {
    setStatus("Download failed: " + error.message, "error");
  } finally {
    grabbing = false;
    // Re-enable buttons without clobbering the success/error status message.
    setButtons(state.selected.size > 0);
  }
}

function download(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------
el.filter.addEventListener("input", debounce(render, 150));
el.sample.addEventListener("input", () => {
  const sample = el.sample.value || "The quick brown fox";
  el.list.querySelectorAll(".preview").forEach((p) => {
    if (!p.classList.contains("loading")) p.textContent = sample;
    else p.textContent = sample;
  });
});
el.size.addEventListener("input", () => {
  document.documentElement.style.setProperty("--preview-size", `${el.size.value}px`);
});
el.selectAll.addEventListener("click", () => {
  for (const font of filteredFonts()) state.selected.add(font.id);
  syncChecks();
  updateSelection();
});
el.selectNone.addEventListener("click", () => {
  state.selected.clear();
  syncChecks();
  updateSelection();
});

function syncChecks() {
  el.list.querySelectorAll(".font-card").forEach((card) => {
    const on = state.selected.has(card.dataset.id);
    card.querySelector("input").checked = on;
    card.classList.toggle("selected", on);
  });
}

function updateSelection() {
  const n = state.selected.size;
  setButtons(n > 0);
  if (!grabbing) setStatus(n ? `${n} selected` : "", "");
}

function setButtons(enabled) {
  el.grabZip.disabled = !enabled;
  el.grabFiles.disabled = !enabled;
}

function setStatus(message, kind) {
  el.status.textContent = message;
  el.status.className = "status" + (kind ? " " + kind : "");
}

// ---------------------------------------------------------------------------
// Filename helpers (mirrors the CLI's output naming)
// ---------------------------------------------------------------------------
function outputName(font, ext) {
  const family = sanitize(font.family) || "Font";
  const weight = (font.weight || "400").toLowerCase();
  const style = (font.style || "normal").toLowerCase();
  const styleSuffix = style === "normal" || style === "regular" ? "" : `-${style}`;
  return `${family}-${weight}${styleSuffix}.${ext}`;
}

function sanitize(value) {
  return value
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function zipName() {
  const host = sanitize(state.origin) || "fonts";
  return `${host}-fonts.zip`;
}

function extFromUrl(url) {
  const m = (url || "").toLowerCase().match(/\.(woff2|woff|ttf|otf)/);
  if (!m) return "";
  return m[1] === "ttf" ? "truetype" : m[1] === "otf" ? "opentype" : m[1];
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}
function esc(v) {
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cssId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, (c) => "_" + c.charCodeAt(0).toString(16));
}
function cssEscape(v) {
  return window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/"/g, '\\"');
}

document.documentElement.style.setProperty("--preview-size", `${el.size.value}px`);
init();
