// Pure helpers for turning the server's flat list of faces into the family
// groups the catalogue renders. Nothing here touches the DOM.

export const DEFAULT_SAMPLE = "The shape of everyday things.";

export function familyKey(font) {
  const name = (font.family || "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  return name && name !== "unnamed font" ? "family:" + name : "file:" + font.id;
}

export function familyGroups(fonts) {
  const groups = new Map();
  for (const font of fonts) {
    const key = familyKey(font);
    if (!groups.has(key))
      groups.set(key, { key, name: font.family || "Unnamed font", fonts: [] });
    groups.get(key).fonts.push(font);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    fonts: group.fonts
      .slice()
      .sort(
        (a, b) =>
          (parseFloat(a.weight) || 400) - (parseFloat(b.weight) || 400) ||
          a.style.localeCompare(b.style),
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
      font.style && font.style !== "normal" ? " · " + font.style : ""
    }`;
  // Some foundries ship the real style only in the CSS family name
  // ("GT-Eesti-Display-Bold"), so read it back off the name when it is there.
  const fromCss = (font.family || "").match(
    /(Thin|Hairline|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy)( Italic| Oblique)?$/i,
  );
  if (fromCss)
    return (fromCss[1] + (fromCss[2] || "")).replace(
      /([a-z])([A-Z])/g,
      "$1 $2",
    );
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
