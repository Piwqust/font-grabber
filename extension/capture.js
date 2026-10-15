"use strict";

// Runs at document_start in the page's MAIN world. Many type-foundry "testers"
// load a font by fetching raw bytes and injecting them with `new FontFace(name,
// arrayBuffer)` from an extensionless URL — invisible to @font-face/URL scanning.
// We hook FontFace (and, conservatively, fetch) to capture those bytes so the
// popup can offer them for download. Captured entries live on window so the popup
// can read them via an executeScript call in the MAIN world.
(() => {
  if (window.__fontGrabberCaptureInstalled) return;
  window.__fontGrabberCaptureInstalled = true;
  const captured = (window.__fontGrabberCaptured = []);
  // FontFace calls whose source is a CSS `url()` string/array instead of raw
  // bytes. The browser fetches those internally (never through window.fetch), so
  // this is the only place the family name and the file URL appear together.
  const urlFaces = (window.__fontGrabberUrlFaces = []);

  const MAGIC = [
    [0x77, 0x4f, 0x46, 0x32], // wOF2
    [0x77, 0x4f, 0x46, 0x46], // wOFF
    [0x00, 0x01, 0x00, 0x00], // TrueType
    [0x4f, 0x54, 0x54, 0x4f], // OTTO
    [0x74, 0x72, 0x75, 0x65], // true
    [0x74, 0x74, 0x63, 0x66], // ttcf
  ];
  const isFont = (b) => b && b.length >= 4 && MAGIC.some((m) => m.every((x, i) => b[i] === x));

  // This runs on every page, so captured bytes must stay bounded for the
  // lifetime of long-lived testers that build FontFaces over and over.
  const MAX_ENTRIES = 64;
  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 96 * 1024 * 1024;
  let totalBytes = 0;

  // Length plus a few header bytes collides for same-size styles of one family
  // (WOFF lengths are 4-byte aligned), so hash the whole buffer.
  const fingerprint = (b) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 0x01000193);
    return `${b.length}:${(h >>> 0).toString(16)}`;
  };

  // Merge captures of the same bytes; fill in family/url when a later hook knows more.
  function record({ family, url, bytes, descriptors }) {
    if (!isFont(bytes) || bytes.length > MAX_FILE_BYTES) return;
    const key = fingerprint(bytes);
    let entry = captured.find((c) => c.key === key);
    if (!entry) {
      if (captured.length >= MAX_ENTRIES || totalBytes + bytes.length > MAX_TOTAL_BYTES) return;
      totalBytes += bytes.length;
      entry = { key, family: "", url: "", weight: "", style: "", stretch: "", bytes };
      captured.push(entry);
    }
    if (family && !entry.family) entry.family = String(family).replace(/^["']|["']$/g, "");
    if (url && !entry.url) entry.url = url;
    if (descriptors) {
      if (descriptors.weight && !entry.weight) entry.weight = String(descriptors.weight);
      if (descriptors.style && !entry.style) entry.style = String(descriptors.style);
      if (descriptors.stretch && !entry.stretch) entry.stretch = String(descriptors.stretch);
    }
  }

  const toBytes = (source) => {
    if (source instanceof ArrayBuffer) return new Uint8Array(source.slice(0));
    if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
    return null;
  };

  // A FontFace source can also be CSS `src` text — a string, or an array of
  // strings that the browser joins with commas (Commercial Type does exactly
  // that: [`url("…woff2")`, `url("…woff")`]). Pull every url() out of it.
  const urlsFromCssSource = (source) => {
    const text = Array.isArray(source) ? source.join(",") : String(source || "");
    const found = [];
    const re = /url\(\s*(['\"]?)([^'\")]+)\1\s*\)/gi;
    let match;
    while ((match = re.exec(text)) !== null) {
      const raw = (match[2] || "").trim();
      if (!raw || raw.startsWith("data:")) continue;
      try {
        found.push(new URL(raw, document.baseURI).href);
      } catch {}
    }
    return found;
  };

  // Records the family/descriptors a page attached to a URL-sourced FontFace.
  // No bytes here: the consumer refetches by URL (the extension via host
  // permissions, the Rust side over HTTP).
  function recordUrlFace(family, source, descriptors) {
    const urls = urlsFromCssSource(source);
    if (!urls.length) return;
    const name = String(family || "").replace(/^[\"']|[\"']$/g, "").trim();
    const d = descriptors || {};
    for (const url of urls) {
      let entry = urlFaces.find((f) => f.url === url);
      if (!entry) {
        entry = { url, family: "", weight: "", style: "", stretch: "" };
        urlFaces.push(entry);
      }
      if (name && !entry.family) entry.family = name;
      if (d.weight != null && d.weight !== "" && !entry.weight) entry.weight = String(d.weight);
      if (d.style && !entry.style) entry.style = String(d.style);
      if (d.stretch && !entry.stretch) entry.stretch = String(d.stretch);
    }
  }

  // --- Hook FontFace (the primary path) ---
  const NativeFontFace = window.FontFace;
  if (NativeFontFace) {
    const Hook = function (family, source, descriptors) {
      try {
        if (source && typeof source !== "string") {
          const bytes = toBytes(source);
          if (bytes) record({ family, bytes, descriptors });
          else recordUrlFace(family, source, descriptors);
        } else if (source) {
          recordUrlFace(family, source, descriptors);
        }
      } catch {}
      // Reflect.construct keeps `class X extends FontFace` working: the instance
      // gets X.prototype instead of a plain native FontFace.
      return Reflect.construct(NativeFontFace, [family, source, descriptors], new.target || NativeFontFace);
    };
    Hook.prototype = NativeFontFace.prototype;
    try {
      window.FontFace = Hook;
    } catch {}
  }

  // --- Hook fetch (catches extensionless font endpoints) ---
  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function (...args) {
      const request = args[0];
      const url = typeof request === "string" ? request : request && request.url;
      // `this` is undefined when fetch is called detached — e.g. `(0, fetch)(url)`,
      // which bundlers emit. Native fetch throws "Illegal invocation" on that, so
      // fall back to the global; never break the page's own requests.
      return nativeFetch.apply(this || window, args).then((res) => {
        try {
          const ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
          const looksFont = /font|woff|sfnt/i.test(ct) || /\.(woff2|woff|ttf|otf)(\?|#|$)/i.test(url || res.url || "");
          if (looksFont) {
            res
              .clone()
              .arrayBuffer()
              .then((buf) => record({ url: res.url || url || "", bytes: new Uint8Array(buf) }))
              .catch(() => {});
          }
        } catch {}
        return res;
      });
    };
  }
})();
