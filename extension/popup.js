"use strict";

const state = {
  fonts: [],
  selected: new Set(),
  origin: "",
  tabId: null,
  cache: new Map(), // url -> { bytes: Uint8Array, blobUrl: string }
  faces: new Set(), // preview @font-face rules already written (survives re-render)
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
    state.tabId = tab.id;
    try {
      state.origin = new URL(tab.url).host;
      el.origin.textContent = state.origin;
    } catch {}

    // allFrames: tester widgets and font previews are frequently inside an iframe,
    // and capture.js already runs in every frame.
    const inject = (target) =>
      chrome.scripting.executeScript({
        target,
        world: "MAIN", // needed to read fonts captured by capture.js (also runs in MAIN)
        func: collectFontsInPage,
        args: [{ includeBytes: true }],
      });
    let results;
    try {
      results = await inject({ tabId: tab.id, allFrames: true });
    } catch {
      // A frame that refuses injection must not cost us the main document.
      results = await inject({ tabId: tab.id });
    }
    const found = [];
    const seenUrls = new Set();
    for (const frame of results || []) {
      for (const font of (frame && frame.result) || []) {
        font.frameId = frame.frameId;
        // "captured:N" is per-frame, so qualify it before de-duplicating by URL.
        if (font.url.startsWith("captured:")) {
          font.url = `captured:${frame.frameId}:${font.url.slice("captured:".length)}`;
        }
        if (seenUrls.has(font.url)) continue;
        seenUrls.add(font.url);
        found.push(font);
      }
    }

    // Merge fonts the background recorded at the network layer (extensionless or
    // Web-Worker-loaded fonts that in-page inspection can't see).
    const networkUrls = await getNetworkFonts(tab.id);
    for (const url of networkUrls) {
      if (seenUrls.has(url)) continue;
      seenUrls.add(url);
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
    const currentFamily = (font.family || "").trim();
    const genericFamily = !currentFamily || /^font-style-\d+$/i.test(currentFamily);
    if (!genericFamily) continue;
    let metadata = null;
    try {
      const file = decodeURIComponent(new URL(font.url, location.href).pathname.split("/").pop() || "");
      metadata = metadataFromFontFilename(file);
    } catch {
      /* extensionless or non-URL (captured) */
    }
    if (metadata) {
      font.family = metadata.family;
      font.weight = metadata.weight;
      font.style = metadata.style;
      continue;
    }
    let name = fallback || "Font";
    if (/instance/i.test(font.url || "")) name += " Instance";
    font.family = name;
  }
}

function metadataFromFontFilename(file) {
  let stem = file
    .replace(/\.(woff2?|ttf|otf)$/i, "")
    .replace(/\.subset$/i, "")
    .replace(/\.(ttf|otf)$/i, "")
    .replace(/[-_](web|desktop)$/i, "");
  const match = stem.match(/[-_](Thin|Hairline|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy|Super)(Italic|Oblique)?$/i);
  if (!match) {
    const family = humanizeFontStem(stem);
    return family.length > 1 ? { family, weight: "400", style: "normal" } : null;
  }

  const weights = {
    thin: "100",
    hairline: "100",
    extralight: "200",
    ultralight: "200",
    light: "300",
    regular: "400",
    book: "400",
    medium: "500",
    semibold: "600",
    demibold: "600",
    bold: "700",
    extrabold: "800",
    ultrabold: "800",
    black: "900",
    heavy: "900",
    super: "900",
  };
  const family = humanizeFontStem(stem.slice(0, match.index));
  if (family.length < 2) return null;
  return {
    family,
    weight: weights[match[1].toLowerCase()] || "400",
    style: match[2] ? match[2].toLowerCase() : "normal",
  };
}

function humanizeFontStem(value) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(LC|Cyr|Cyrillic|Latin)$/i, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    // Filtering re-renders the cards; only write each rule once.
    if (!state.faces.has(family)) {
      state.faces.add(family);
      el.faceStyle.appendChild(
        document.createTextNode(`@font-face{font-family:"${family}";src:url("${entry.blobUrl}");}`)
      );
    }
    preview.style.fontFamily = `"${family}", system-ui, sans-serif`;
    preview.classList.remove("loading");
  } catch {
    preview.classList.remove("loading");
    preview.dataset.failed = "1";
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
    try {
      const response = await fetch(font.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (directError) {
      // Some foundry CDNs reject extension-origin requests because they require
      // the open page as Referer. Fetch in that page's MAIN world so the browser
      // supplies the legitimate Referer and cookies, then return the bytes.
      bytes = await fetchBytesInPage(font).catch((pageError) => {
        throw new Error(`${directError.message}; page fetch: ${pageError.message}`);
      });
    }
  }

  const blobUrl = URL.createObjectURL(new Blob([bytes]));
  const entry = { bytes, blobUrl };
  state.cache.set(font.url, entry);
  return entry;
}

async function fetchBytesInPage(font) {
  if (!state.tabId) throw new Error("No source tab");
  const frameId = Number.isInteger(font.frameId) ? font.frameId : 0;
  const results = await chrome.scripting.executeScript({
    target: { tabId: state.tabId, frameIds: [frameId] },
    world: "MAIN",
    func: async (url) => {
      // `same-origin` keeps page cookies for same-origin font endpoints and omits
      // them for CDNs. The latter matters because many font CDNs answer with
      // `Access-Control-Allow-Origin: *`, which browsers reject with credentials.
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
      }
      return btoa(binary);
    },
    args: [font.url],
  });
  const encoded = results && results[0] && results[0].result;
  if (!encoded) throw new Error("Page returned no font data");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// The real bytes beat the page's own declaration: sites mislabel `format()` and
// serve .woff2 URLs holding .woff (and vice versa), and a wrong code makes the
// converter fail outright instead of just guessing.
function magicFormat(bytes) {
  if (!bytes || bytes.length < 4) return 0;
  const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (sig === "wOF2") return 1;
  if (sig === "wOFF") return 2;
  if (sig === "OTTO" || sig === "true") return 3; // not "ttcf": a collection is not a single sfnt
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return 3;
  return 0;
}

function formatCode(font, bytes) {
  const sniffed = magicFormat(bytes);
  if (sniffed) return sniffed;
  const fmt = (font.format || extFromUrl(font.url) || "").toLowerCase();
  if (fmt.includes("woff2")) return 1;
  if (fmt === "woff") return 2;
  if (fmt === "truetype" || fmt === "opentype" || fmt === "ttf" || fmt === "otf") return 3;
  return 0; // let the WASM side try
}

async function convertSelected(onProgress) {
  const fonts = state.fonts.filter((f) => state.selected.has(f.id));
  const converted = [];
  const failures = [];
  const usedNames = new Set();
  let done = 0;

  for (const font of fonts) {
    try {
      const entry = await ensureBytes(font);
      const sfnt = await FontConverter.convert(
        entry.bytes,
        formatCode(font, entry.bytes),
        font.family,
        font.weight,
        font.style
      );
      const ext = FontConverter.sfntExtension(sfnt);
      converted.push({ name: uniqueName(outputName(font, ext), usedNames), data: sfnt });
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
    if (!p.dataset.failed) p.textContent = sample; // keep the "(unavailable)" note
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
  const weight = sanitize((font.weight || "400").toLowerCase()) || "400";
  const style = sanitize((font.style || "normal").toLowerCase());
  const styleSuffix = style === "normal" || style === "regular" || !style ? "" : `-${style}`;
  return `${family}-${weight}${styleSuffix}.${ext}`;
}

// Two faces can legitimately reduce to the same file name (same family/weight, or
// several unnamed faces falling back to the page slug). A ZIP holding duplicate
// entries fails to extract, so make every name distinct.
function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  while (used.has(`${stem}-${n}${ext}`)) n += 1;
  const unique = `${stem}-${n}${ext}`;
  used.add(unique);
  return unique;
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
