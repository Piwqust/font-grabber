// Everything the popup does that is not rendering: talking to the tab, reading
// font bytes, converting them and writing files out. Kept apart from the view
// so the parts that are hard to get right — the in-page fetch fallback, the
// format sniffing, the conversion lifecycle — are not tangled with markup.
//
// FontConverter, Zip and collectFontsInPage come from the classic scripts the
// popup page loads first (convert.js, zip.js, discover.js).

export const PAGE_SIZE = 60;

const WEIGHT_NAMES = {
  100: "Thin",
  200: "Extra Light",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "Semi Bold",
  700: "Bold",
  800: "Extra Bold",
  900: "Black",
};

export function styleLabel(font) {
  const base = font.variable
    ? "Variable"
    : WEIGHT_NAMES[font.weight] || font.weight || "Regular";
  return (
    base + (font.style && font.style !== "normal" ? " · " + font.style : "")
  );
}

export function extFromUrl(url) {
  const match = (url || "").toLowerCase().match(/\.(woff2|woff|ttf|otf)/);
  if (!match) return "";
  return match[1] === "ttf"
    ? "truetype"
    : match[1] === "otf"
      ? "opentype"
      : match[1];
}

export function cssId(id) {
  return id.replace(
    /[^a-zA-Z0-9_-]/g,
    (c) => "_" + c.charCodeAt(0).toString(16),
  );
}

export function matchesQuery(font, query) {
  if (!query) return true;
  return `${font.family} ${font.url} ${styleLabel(font)}`
    .toLowerCase()
    .includes(query);
}

// ---------------------------------------------------------------------------
// Naming
// ---------------------------------------------------------------------------

function humanizeStem(value) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(LC|Cyr|Cyrillic|Latin)$/i, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FILENAME_WEIGHTS = {
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

function metadataFromFilename(file) {
  const stem = file
    .replace(/\.(woff2?|ttf|otf)$/i, "")
    .replace(/\.subset$/i, "")
    .replace(/\.(ttf|otf)$/i, "")
    .replace(/[-_](web|desktop)$/i, "");
  const match = stem.match(
    /[-_](Thin|Hairline|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy|Super)(Italic|Oblique)?$/i,
  );
  if (!match) {
    const family = humanizeStem(stem);
    return family.length > 1
      ? { family, weight: "400", style: "normal" }
      : null;
  }
  const family = humanizeStem(stem.slice(0, match.index));
  if (family.length < 2) return null;
  return {
    family,
    weight: FILENAME_WEIGHTS[match[1].toLowerCase()] || "400",
    style: match[2] ? match[2].toLowerCase() : "normal",
  };
}

function slugFromUrl(url) {
  try {
    const parsed = new URL(url);
    const segment = (parsed.pathname.split("/").filter(Boolean).pop() || "")
      .replace(/[-_]+/g, " ")
      .trim();
    if (segment && !/\.(html?|php|aspx?)$/i.test(segment))
      return segment.replace(/\b\w/g, (c) => c.toUpperCase());
    return parsed.host.replace(/^www\./, "");
  } catch {
    return "Font";
  }
}

/** Gives URL-only candidates a readable name derived from their file name. */
function deriveDisplayNames(fonts, fallback) {
  for (const font of fonts) {
    const current = (font.family || "").trim();
    if (current && !/^font-style-\d+$/i.test(current)) continue;
    let metadata = null;
    try {
      const file = decodeURIComponent(
        new URL(font.url, location.href).pathname.split("/").pop() || "",
      );
      metadata = metadataFromFilename(file);
    } catch {
      /* extensionless, or a captured font with no real URL */
    }
    if (metadata) {
      font.family = metadata.family;
      font.weight = metadata.weight;
      font.style = metadata.style;
      continue;
    }
    font.family =
      (fallback || "Font") +
      (/instance/i.test(font.url || "") ? " Instance" : "");
  }
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

async function networkFonts(tabId) {
  try {
    const key = `fonts:${tabId}`;
    const store = await chrome.storage.session.get(key);
    return (store[key] || []).map((entry) => entry.url);
  } catch {
    return [];
  }
}

/**
 * Reads the fonts of the active tab.
 * @returns {Promise<{fonts:Array, tabId:number, url:string, host:string}>}
 * @throws {Error} with `code === "unsupported"` for pages that cannot be scanned.
 */
export async function scanActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) {
    const error = new Error(
      "Open a website tab, then open Fount again. Browser settings and the extension store are protected.",
    );
    error.code = "unsupported";
    throw error;
  }

  const inject = (target) =>
    chrome.scripting.executeScript({
      target,
      world: "MAIN",
      func: collectFontsInPage,
      args: [{ includeBytes: true }],
    });

  let results;
  try {
    results = await inject({ tabId: tab.id, allFrames: true });
  } catch {
    // Some pages refuse all-frames injection; the top frame is still worth having.
    results = await inject({ tabId: tab.id });
  }

  const found = [];
  const seen = new Set();
  for (const frame of results || [])
    for (const font of frame.result || []) {
      font.frameId = frame.frameId;
      // Captured fonts are keyed per frame, or two frames collide on one id.
      if (font.url.startsWith("captured:"))
        font.url = `captured:${frame.frameId}:${font.url.slice(9)}`;
      if (seen.has(font.url)) continue;
      seen.add(font.url);
      found.push(font);
    }

  for (const url of await networkFonts(tab.id)) {
    if (seen.has(url)) continue;
    seen.add(url);
    found.push({
      url,
      family: "",
      weight: "400",
      style: "normal",
      format: "",
      fromNetwork: true,
    });
  }

  for (const font of found) font.id = font.url;
  deriveDisplayNames(found, slugFromUrl(tab.url));

  return {
    fonts: found,
    tabId: tab.id,
    url: tab.url,
    host: new URL(tab.url).host,
  };
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

const cache = new Map(); // url -> {bytes, blobUrl}
const loads = new Map(); // url -> Promise
let sourceTabId = null;

export function setSourceTab(tabId) {
  sourceTabId = tabId;
}

/** Drops every cached file. Called when the popup moves to a different page. */
export function resetCache() {
  for (const entry of cache.values()) URL.revokeObjectURL(entry.blobUrl);
  cache.clear();
  loads.clear();
}

async function fetchBytesInPage(font) {
  if (!sourceTabId) throw new Error("No source tab");
  const frameId = Number.isInteger(font.frameId) ? font.frameId : 0;
  const results = await chrome.scripting.executeScript({
    target: { tabId: sourceTabId, frameIds: [frameId] },
    world: "MAIN",
    func: async (url) => {
      // `same-origin` keeps page cookies for same-origin endpoints and omits
      // them for CDNs — many font CDNs answer `Access-Control-Allow-Origin: *`,
      // which browsers reject when credentials are attached.
      const response = await fetch(url, { credentials: "same-origin" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = "";
      const chunk = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunk)
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + chunk),
        );
      return btoa(binary);
    },
    args: [font.url],
  });
  const encoded = results?.[0]?.result;
  if (!encoded) throw new Error("Page returned no font data");
  return decodeBase64(encoded);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readBytes(font) {
  const cached = cache.get(font.url);
  if (cached) return cached;

  let bytes;
  if (font.b64) {
    // A captured font: the bytes travelled inline, there is no URL to refetch.
    bytes = decodeBase64(font.b64);
  } else {
    try {
      const response = await fetch(font.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (directError) {
      // Some foundry CDNs reject extension-origin requests because they require
      // the open page as Referer. Fetching from that page's MAIN world makes the
      // browser supply a legitimate Referer and the page's cookies.
      bytes = await fetchBytesInPage(font).catch((pageError) => {
        throw new Error(
          `${directError.message}; page fetch: ${pageError.message}`,
        );
      });
    }
  }

  const entry = { bytes, blobUrl: URL.createObjectURL(new Blob([bytes])) };
  cache.set(font.url, entry);
  return entry;
}

export function ensureBytes(font) {
  if (!loads.has(font.url))
    loads.set(
      font.url,
      readBytes(font).catch((error) => {
        // Forget the failure so a rescan or retry can try the file again.
        loads.delete(font.url);
        throw error;
      }),
    );
  return loads.get(font.url);
}

// ---------------------------------------------------------------------------
// Conversion and delivery
// ---------------------------------------------------------------------------

// The real bytes beat the page's own declaration: sites mislabel `format()` and
// serve .woff2 URLs holding .woff, and a wrong code makes the converter fail
// outright rather than merely guess.
function magicFormat(bytes) {
  if (!bytes || bytes.length < 4) return 0;
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (signature === "wOF2") return 1;
  if (signature === "wOFF") return 2;
  // Deliberately not "ttcf": a collection is not a single sfnt.
  if (signature === "OTTO" || signature === "true") return 3;
  if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0)
    return 3;
  return 0;
}

function formatCode(font, bytes) {
  const sniffed = magicFormat(bytes);
  if (sniffed) return sniffed;
  const declared = (font.format || extFromUrl(font.url) || "").toLowerCase();
  if (declared.includes("woff2")) return 1;
  if (declared === "woff") return 2;
  if (["truetype", "opentype", "ttf", "otf"].includes(declared)) return 3;
  return 0; // Let the WASM side try.
}

function sanitize(value) {
  return String(value)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function outputName(font, ext) {
  const family = sanitize(font.family) || "Font";
  const weight = sanitize(String(font.weight || "400"));
  const style = sanitize(font.style || "normal");
  return `${family}-${weight}${style && style !== "normal" ? "-" + style : ""}.${ext}`;
}

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

export function zipName(host) {
  return `${sanitize(host) || "fonts"}-fonts.zip`;
}

/**
 * Converts the given fonts to sfnt files, one at a time so the popup stays
 * responsive and a cancel can land between files.
 * @param {() => boolean} isCancelled polled between fonts.
 */
export async function convertFonts(fonts, { onProgress, isCancelled }) {
  const converted = [];
  const failures = [];
  const used = new Set();
  let done = 0;

  for (const font of fonts) {
    if (isCancelled()) break;
    try {
      const entry = await ensureBytes(font);
      if (isCancelled()) break;
      const sfnt = await FontConverter.convert(
        entry.bytes,
        formatCode(font, entry.bytes),
        font.family,
        font.weight,
        font.style,
        null,
      );
      converted.push({
        name: uniqueName(
          outputName(font, FontConverter.sfntExtension(sfnt)),
          used,
        ),
        data: sfnt,
      });
    } catch (error) {
      failures.push({
        id: font.id,
        message: `${font.family}: ${error.message}`,
      });
    }
    done++;
    onProgress?.(done, fonts.length);
    // Yield so the progress bar actually paints between files.
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  return { converted, failures };
}

export async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) =>
      chrome.downloads.download({ url, filename, saveAs: false }, (id) => {
        if (chrome.runtime.lastError)
          reject(new Error(chrome.runtime.lastError.message));
        else resolve(id);
      }),
    );
  } finally {
    // The download reads from the URL asynchronously; revoking at once breaks it.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

export async function deliver(converted, mode, host) {
  if (mode === "zip") {
    await downloadBlob(await Zip.create(converted), "Fount/" + zipName(host));
    return;
  }
  for (const file of converted)
    await downloadBlob(
      new Blob([file.data], { type: "application/octet-stream" }),
      "Fount/" + file.name,
    );
}

// ---------------------------------------------------------------------------
// Per-tab session state
// ---------------------------------------------------------------------------

export async function loadUiState(tabId, url) {
  try {
    const key = "fount-ui:" + tabId;
    const stored = (await chrome.storage.session.get(key))[key];
    return stored?.url === url ? stored : null;
  } catch {
    return null;
  }
}

export function saveUiState(tabId, value) {
  if (!tabId) return;
  chrome.storage.session.set({ ["fount-ui:" + tabId]: value }).catch(() => {});
}

export function warmConverter() {
  FontConverter.ready().catch(() => {});
}
