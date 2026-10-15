// Pure helpers for turning the server's flat list of faces into the family
// groups the catalogue renders. Nothing here touches the DOM.

export const DEFAULT_SAMPLE = "The shape of everyday things.";

const WEIGHTS = {
  thin: [100, "Thin"],
  hairline: [100, "Hairline"],
  extralight: [200, "Extra Light"],
  ultralight: [200, "Ultra Light"],
  light: [300, "Light"],
  regular: [400, "Regular"],
  book: [400, "Book"],
  medium: [500, "Medium"],
  semibold: [600, "Semi Bold"],
  demibold: [600, "Demi Bold"],
  bold: [700, "Bold"],
  extrabold: [800, "Extra Bold"],
  ultrabold: [800, "Ultra Bold"],
  heavy: [800, "Heavy"],
  black: [900, "Black"],
  extrablack: [950, "Extra Black"],
  ultrablack: [950, "Ultra Black"],
};

function cleanName(value) {
  return String(value || "").normalize("NFC").trim().replace(/\s+/g, " ");
}

// CSS aliases often put the face name in the family and declare every face
// as 400/normal. Keep that source identity intact for previews and export.
function namedFaceOptions(font) {
  const name = cleanName(font.family);
  if (WEIGHTS[name.replace(/[\s_-]/g, "").toLowerCase()]) return [];
  const tokens = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_-]+/).filter(Boolean);
  const slant = /^(italic|oblique)$/i.test(tokens.at(-1) || "")
    ? tokens.pop().toLowerCase()
    : "";
  const style = slant || font.style || "normal";
  const styleSuffix = style === "italic" ? " Italic" : style === "oblique" ? " Oblique" : "";
  const options = [];
  for (const length of [2, 1]) {
    if (tokens.length <= length) continue;
    const weight = WEIGHTS[tokens.slice(-length).join("").toLowerCase()];
    if (!weight) continue;
    const family = tokens.slice(0, -length).join(" ");
    options.push({ family, weight: weight[0], style, label: weight[1] + styleSuffix });
  }
  if (!options.length && tokens.length &&
      (slant || (font.variable && /^(variable|vf)$/i.test(tokens.at(-1))))) {
    if (!slant) tokens.pop();
    if (tokens.length) options.push({
      family: tokens.join(" "),
      weight: parseFloat(font.weight) || 400,
      style,
      label: slant === "oblique" ? "Oblique" : slant ? "Italic" : "Variable",
    });
  }
  return options;
}

/** Resolve aliases against the complete scan, before search/selection filters.
 * Sibling styles provide evidence: a standalone family such as Arial Black
 * keeps its name. Trying both compound and simple weights also distinguishes
 * GT Mechanik Semi + Bold from a face actually named Semi Bold.
 */
export function prepareCatalogFonts(fonts) {
  const options = fonts.map(namedFaceOptions);
  const siblings = new Map();
  for (const faces of options) for (const face of faces) {
    const key = face.family.toLowerCase();
    if (!siblings.has(key)) siblings.set(key, new Set());
    siblings.get(key).add(`${face.weight}|${face.style}|${face.label}`);
  }
  return fonts.map((font, index) => {
    const candidates = options[index].slice().sort((a, b) =>
      siblings.get(b.family.toLowerCase()).size - siblings.get(a.family.toLowerCase()).size,
    );
    const face = candidates[0];
    const { catalog, ...original } = font;
    if (!face || siblings.get(face.family.toLowerCase()).size < 2) return original;
    return { ...original, catalog: face };
  });
}

export function familyName(font) {
  return font.catalog?.family || font.family || "Unnamed font";
}

export function faceWeight(font) {
  return font.catalog?.weight ?? (parseFloat(font.weight) || 400);
}

export function faceStyle(font) {
  return font.catalog?.style || font.style || "normal";
}

export function familyKey(font) {
  const name = cleanName(familyName(font)).toLowerCase();
  return name && name !== "unnamed font" && name !== "(unknown)"
    ? "family:" + name
    : "file:" + font.id;
}

// Path words that describe the page rather than name a typeface.
const PAGE_WORDS = new Set([
  "typeface", "typefaces", "font", "fonts", "family", "families", "collection",
  "collections", "product", "products", "shop", "store", "buy", "catalog",
  "catalogue", "specimen", "specimens", "retail", "library", "index", "html",
]);

/** "/typeface/gt-mechanik" -> ["mechanik"]: the last segment that names something. */
function pageTokens(pageUrl) {
  let segments;
  try {
    segments = new URL(pageUrl).pathname.toLowerCase().split("/");
  } catch {
    return [];
  }
  for (const segment of segments.reverse()) {
    const tokens = segment
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !PAGE_WORDS.has(t) && !/^\d+$/.test(t));
    if (tokens.length) return tokens;
  }
  return [];
}

// Roman before italic before oblique at the same weight, as a type specimen reads.
const STYLE_ORDER = { normal: 0, italic: 1, oblique: 2 };
const styleRank = (font) => STYLE_ORDER[faceStyle(font)] ?? 3;

/**
 * Foundry pages often load the whole catalogue, so the typeface the page is
 * about would otherwise sit somewhere in an alphabetical list of hundreds.
 * Families named by the scanned address come first; the rest keep scan order.
 */
export function familyGroups(fonts, pageUrl = "") {
  const groups = new Map();
  for (const font of fonts) {
    const key = familyKey(font);
    if (!groups.has(key))
      groups.set(key, { key, name: familyName(font), fonts: [] });
    groups.get(key).fonts.push(font);
  }
  const tokens = pageTokens(pageUrl);
  const relevance = (group) => {
    const words = new Set(cleanName(group.name).toLowerCase().split(/[\s_-]+/));
    return tokens.filter((t) => words.has(t)).length;
  };
  return [...groups.values()]
    .map((group, order) => ({ group, order, score: relevance(group) }))
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ group, score }) => ({
      ...group,
      onPage: score > 0,
      fonts: group.fonts
        .slice()
        .sort(
          (a, b) =>
            faceWeight(a) - faceWeight(b) ||
            styleRank(a) - styleRank(b) ||
            faceStyle(a).localeCompare(faceStyle(b)),
        ),
    }));
}

export function collectionLabel(fonts) {
  const n = familyGroups(fonts).length;
  return `${n} ${n === 1 ? "family" : "families"} · ${fonts.length} ${
    fonts.length === 1 ? "face" : "faces"
  }`;
}

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

/** "600" -> "Semi Bold". Falls back to the number for anything unusual. */
export function weightName(weight) {
  return WEIGHT_NAMES[String(weight)] || String(weight);
}

export function styleLabel(font) {
  if (font.variable)
    return `Variable${
      faceStyle(font) !== "normal" ? " · " + faceStyle(font) : ""
    }`;
  if (font.catalog) return font.catalog.label;
  // Some foundries ship the real style only in the CSS family name
  // ("GT-Eesti-Display-Bold"), so read it back off the name when it is there.
  const fromCss = namedFaceOptions(font)[0];
  if (fromCss) return fromCss.label;
  const style = (font.style || "").toLowerCase();
  const italic = style === "italic" || style === "oblique";
  const weightName = WEIGHT_NAMES[String(font.weight || "400")] || "Regular";
  const slant = style === "oblique" ? "Oblique" : "Italic";
  if (!italic) return weightName;
  return weightName === "Regular" ? slant : `${weightName} ${slant}`;
}

// Match the family name, the readable style and the source file name, because
// obfuscated CSS names often keep the real name only in the font URL.
export function matchesFilter(font, query) {
  if (!query) return true;
  if (
    `${familyName(font)} ${styleLabel(font)}`.toLowerCase().includes(query) ||
    (font.family || "").toLowerCase().includes(query) ||
    styleLabel(font).toLowerCase().includes(query)
  )
    return true;
  const src = font.sources?.[0]?.url.toLowerCase() || "";
  return src.includes(query);
}

export function cssId(id) {
  return id.replace(
    /[^a-zA-Z0-9_-]/g,
    (c) => "_" + c.charCodeAt(0).toString(16),
  );
}

export function formatHint(source) {
  const map = {
    woff2: "woff2",
    woff: "woff",
    truetype: "truetype",
    opentype: "opentype",
  };
  const fmt = map[source.format];
  return fmt ? ` format("${fmt}")` : "";
}

export function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Normalises what a person typed into an absolute http(s) URL, or throws. */
export function normalizeUrl(raw) {
  let url = raw.trim();
  if (!url) throw new Error("empty");
  if (!/^[a-z][a-z\d+.-]*:/i.test(url)) url = `https://${url}`;
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname)
    throw new Error("protocol");
  return parsed.href;
}
