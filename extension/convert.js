"use strict";

// Thin wrapper around the no-bindgen WASM converter (see wasm/src/lib.rs).
// Loads the module once; re-instantiates if a conversion traps so one bad font
// cannot corrupt later conversions.
const FontConverter = (() => {
  let instance = null;
  let loading = null;

  async function load() {
    const url = chrome.runtime.getURL("convert.wasm");
    try {
      const { instance: inst } = await WebAssembly.instantiateStreaming(fetch(url), {});
      return inst;
    } catch {
      // Fallback if the .wasm isn't served as application/wasm.
      const bytes = await (await fetch(url)).arrayBuffer();
      const { instance: inst } = await WebAssembly.instantiate(bytes, {});
      return inst;
    }
  }

  async function ready() {
    if (instance) return instance;
    if (!loading) loading = load().then((inst) => (instance = inst));
    return loading;
  }

  function view(ex) {
    return new Uint8Array(ex.memory.buffer);
  }

  function writeBytes(ex, bytes) {
    const ptr = ex.alloc(bytes.length);
    // Re-read the view: alloc may have grown (and detached) the buffer.
    view(ex).set(bytes, ptr);
    return ptr;
  }

  // format: 0 auto, 1 woff2, 2 woff, 3 sfnt passthrough
  async function convert(bytes, format, family, weight, style) {
    const ex = (await ready()).exports;
    const meta = new TextEncoder().encode(
      `${family || ""}\t${weight || "400"}\t${style || "normal"}`
    );

    const fontPtr = writeBytes(ex, bytes);
    const metaPtr = writeBytes(ex, meta);

    let ok;
    try {
      ok = ex.convert(fontPtr, bytes.length, format, metaPtr, meta.length);
    } catch (trap) {
      // A panic=abort trap leaves memory suspect; rebuild the instance.
      instance = null;
      loading = null;
      throw new Error("Conversion crashed: " + trap.message);
    }

    if (ok !== 1) {
      const ep = ex.error_ptr();
      const el = ex.error_len();
      const message = new TextDecoder().decode(view(ex).slice(ep, ep + el));
      ex.dealloc(fontPtr, bytes.length);
      ex.dealloc(metaPtr, meta.length);
      throw new Error(message || "Conversion failed");
    }

    const rp = ex.result_ptr();
    const rl = ex.result_len();
    const out = view(ex).slice(rp, rp + rl); // copy out before next call overwrites it

    ex.dealloc(fontPtr, bytes.length);
    ex.dealloc(metaPtr, meta.length);
    return out;
  }

  // 'otf' if the sfnt starts with OTTO, otherwise 'ttf'.
  function sfntExtension(bytes) {
    if (bytes.length >= 4 && bytes[0] === 0x4f && bytes[1] === 0x54 && bytes[2] === 0x54 && bytes[3] === 0x4f) {
      return "otf";
    }
    return "ttf";
  }

  return { convert, sfntExtension, ready };
})();
