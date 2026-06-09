"use strict";

// Shared font discovery — enumerates every font on a page. Runs in the page's MAIN
// world from two places that share this exact file:
//   • the extension, via chrome.scripting.executeScript (popup.js)
//   • the CLI / local web app, via headless Chrome (core/src/discovery/headless.rs)
//
// Keep it fully self-contained: no imports, no closure over outer scope (it is
// serialized and injected). `opts.includeBytes` controls whether dynamically
// captured fonts carry their raw bytes as base64 — the extension needs them (there
// is no URL to refetch), while the Rust side downloads by URL and passes false.
function collectFontsInPage(opts) {
  opts = opts || {};
  const includeBytes = opts.includeBytes !== false;

  const FONT_EXT = /\.(woff2|woff|ttf|otf)(\?|#|$)/i;
  const out = new Map(); // url -> candidate

  const stripQuotes = (v) => (v || "").trim().replace(/^["']|["']$/g, "");
  const firstFamily = (v) => stripQuotes((v || "").split(",")[0]);

  const normWeight = (v) => {
    const token = (v || "").trim().split(/\s+/)[0].toLowerCase();
    if (token === "normal" || token === "") return "400";
    if (token === "bold") return "700";
    return token;
  };
  const normStyle = (v) => {
    const token = (v || "").trim().split(/\s+/)[0].toLowerCase();
    return token === "italic" || token === "oblique" ? token : "normal";
  };
  const formatFromUrl = (url) => {
    const m = url.toLowerCase().match(/\.(woff2|woff|ttf|otf)/);
    if (!m) return "";
    return m[1] === "ttf" ? "truetype" : m[1] === "otf" ? "opentype" : m[1];
  };
  const priority = (fmt) => ({ woff2: 1, woff: 2, truetype: 3, opentype: 4 }[fmt] || 9);

  function addCandidate(rawUrl, base, family, weight, style, fmtHint) {
    let url;
    try {
      url = new URL(rawUrl, base).href;
    } catch {
      return;
    }
    if (!/^https?:|^data:/.test(url)) return;
    if (!FONT_EXT.test(url) && !url.startsWith("data:")) return;
    const fmt = fmtHint || formatFromUrl(url);
    if (fmt === "svg" || fmt === "embedded-opentype" || fmt === "eot") return;

    const existing = out.get(url);
    if (existing) {
      if (family && (!existing.family || existing.family.length < 2)) existing.family = family;
      return;
    }
    out.set(url, { url, family: family || "", weight: weight || "400", style: style || "normal", format: fmt });
  }

  // 1. @font-face rules from accessible stylesheets (rich metadata).
  for (const sheet of Array.from(document.styleSheets)) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet without CORS — covered by step 2
    }
    if (!rules) continue;
    const base = sheet.href || document.baseURI;
    for (const rule of Array.from(rules)) {
      if (rule.constructor.name !== "CSSFontFaceRule" && rule.type !== 5) continue;
      const family = firstFamily(rule.style.getPropertyValue("font-family"));
      const weight = normWeight(rule.style.getPropertyValue("font-weight"));
      const style = normStyle(rule.style.getPropertyValue("font-style"));
      const src = rule.style.getPropertyValue("src");
      if (!src) continue;

      // Collect each url()/format() pair, then keep the best one.
      const sources = [];
      const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*(['"]?)([^'")]+)\3\s*\))?/gi;
      let match;
      while ((match = re.exec(src)) !== null) {
        const url = match[2];
        const fmt = (match[4] || "").toLowerCase().split(/\s+/)[0] || "";
        sources.push({ url, fmt });
      }
      sources.sort((a, b) => priority(a.fmt || formatFromUrl(a.url)) - priority(b.fmt || formatFromUrl(b.url)));
      const best = sources[0];
      if (best) addCandidate(best.url, base, family, weight, style, best.fmt);
    }
  }

  // 2. Any font file the page actually loaded (catches cross-origin CSS).
  try {
    for (const entry of performance.getEntriesByType("resource")) {
      if (FONT_EXT.test(entry.name)) addCandidate(entry.name, document.baseURI, "", "400", "normal", "");
    }
  } catch {
    /* performance API unavailable */
  }

  // 2b. Site catalog adapter — Displaay. The tester only fetches the styles you
  //     interact with, so reading the page's own data is the only way to get the
  //     COMPLETE family (master variable font + every named instance) up front.
  try {
    if (/(^|\.)displaay\.net$/i.test(location.hostname)) {
      const loaderData =
        (window.__reactRouterContext && window.__reactRouterContext.state && window.__reactRouterContext.state.loaderData) ||
        (window.__reactRouterDataRouter && window.__reactRouterDataRouter.state && window.__reactRouterDataRouter.state.loaderData) ||
        null;
      const families = [];
      const seenFamily = new Set();
      (function walk(node, depth) {
        if (!node || typeof node !== "object" || depth > 10) return;
        if (Array.isArray(node)) {
          for (const item of node) walk(item, depth + 1);
          return;
        }
        if (node.name && node.glyphsFile && node.glyphsFile.activeRevision && node.glyphsFile.activeRevision.id) {
          if (!seenFamily.has(node.id)) {
            seenFamily.add(node.id);
            families.push(node);
          }
        }
        for (const key in node) {
          try {
            walk(node[key], depth + 1);
          } catch {}
        }
      })(loaderData, 0);

      for (const family of families) {
        const vfId = family.glyphsFile.activeRevision.id;
        // Master variable font — one file that contains the whole family.
        out.set(`https://w.displaay.net/tester/file/${vfId}`, {
          url: `https://w.displaay.net/tester/file/${vfId}`,
          family: `${family.name} Variable`,
          weight: "400",
          style: "normal",
          format: "",
          variable: true,
        });
        // Every named instance, flattened to a static TTF.
        const rev = family.glyphsFile.activeRevision;
        const instances =
          family.instances || (rev.families && rev.families[0] && rev.families[0].instances) || [];
        for (const instance of instances) {
          if (!instance || !instance.id) continue;
          const axes = instance.axes || [];
          const wght = (axes.find((a) => a.name === "wght") || {}).value;
          const slnt = (axes.find((a) => a.name === "slnt") || {}).value;
          const label = (instance.key || instance.name || "").trim();
          const italic = (slnt && slnt !== 0) || /italic/i.test(label);
          const url = `https://w.displaay.net/tester/file/instance/${instance.id}/ttf`;
          out.set(url, {
            url,
            family: `${family.name} ${label}`.trim(),
            weight: wght ? String(wght) : "400",
            style: italic ? "italic" : "normal",
            format: "",
          });
        }
      }
    }
  } catch {
    /* catalog shape changed — fall back to network capture */
  }

  const list = Array.from(out.values());

  // 3. Fonts captured by capture.js (FontFace/fetch hooks) — dynamically injected
  //    fonts with no @font-face rule or font-extension URL.
  try {
    const captured = window.__fontGrabberCaptured || [];
    const toB64 = (bytes) => {
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      return btoa(binary);
    };
    const slug = (() => {
      const seg = (location.pathname.split("/").filter(Boolean).pop() || "").replace(/[-_]+/g, " ").trim();
      if (seg) return seg.replace(/\b\w/g, (c) => c.toUpperCase());
      return (document.title || "Font").split(/[|–\-—]/)[0].trim();
    })();
    captured.forEach((c, index) => {
      if (!c.bytes || !c.bytes.length) return;
      if (!includeBytes && !c.url) return; // URL-only consumer can't use inline bytes
      const looksUuid = !c.family || /^font-[0-9a-f-]{8,}$/i.test(c.family) || c.family.length < 2;
      const entry = {
        url: c.url || `captured:${index}`,
        family: looksUuid ? slug : c.family,
        weight: c.weight && /^\d/.test(c.weight) ? c.weight.split(/\s+/)[0] : "400",
        style: /italic|oblique/i.test(c.style) ? c.style.toLowerCase().split(/\s+/)[0] : "normal",
        format: "",
        variable: /\s/.test(c.weight || "") || /\s/.test(c.stretch || ""),
      };
      if (includeBytes) {
        entry.b64 = toB64(c.bytes);
        entry.captured = true;
      }
      list.push(entry);
    });
  } catch {
    /* no captured fonts */
  }

  return list;
}

// Expose for headless Chrome (core/src/discovery/headless.rs) which appends a call.
if (typeof window !== "undefined") window.collectFontsInPage = collectFontsInPage;
