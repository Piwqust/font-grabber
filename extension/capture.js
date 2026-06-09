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

  const MAGIC = [
    [0x77, 0x4f, 0x46, 0x32], // wOF2
    [0x77, 0x4f, 0x46, 0x46], // wOFF
    [0x00, 0x01, 0x00, 0x00], // TrueType
    [0x4f, 0x54, 0x54, 0x4f], // OTTO
    [0x74, 0x72, 0x75, 0x65], // true
    [0x74, 0x74, 0x63, 0x66], // ttcf
  ];
  const isFont = (b) => b && b.length >= 4 && MAGIC.some((m) => m.every((x, i) => b[i] === x));

  // Merge captures of the same bytes; fill in family/url when a later hook knows more.
  function record({ family, url, bytes, descriptors }) {
    if (!isFont(bytes)) return;
    const key = `${bytes.length}:${bytes[4]}:${bytes[8]}:${bytes[bytes.length - 1]}`;
    let entry = captured.find((c) => c.key === key);
    if (!entry) {
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

  // --- Hook FontFace (the primary path) ---
  const NativeFontFace = window.FontFace;
  if (NativeFontFace) {
    const Hook = function (family, source, descriptors) {
      try {
        if (source && typeof source !== "string") {
          const bytes = toBytes(source);
          if (bytes) record({ family, bytes, descriptors });
        }
      } catch {}
      return new NativeFontFace(family, source, descriptors);
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
      return nativeFetch.apply(this, args).then((res) => {
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
