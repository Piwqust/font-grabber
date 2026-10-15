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

  function addCandidate(rawUrl, base, family, weight, style, fmtHint, isVariable) {
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
    out.set(url, {
      url,
      family: family || "",
      weight: weight || "400",
      style: style || "normal",
      format: fmt,
      variable: !!isVariable,
    });
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
      const rawWeight = rule.style.getPropertyValue("font-weight") || "";
      const weight = normWeight(rawWeight);
      const style = normStyle(rule.style.getPropertyValue("font-style"));
      // A weight *range* ("100 900") means the face is a variable font.
      const isVariable = /\s/.test(rawWeight.trim());
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
      if (best) addCandidate(best.url, base, family, weight, style, best.fmt, isVariable);
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

  // 2a. FontFace objects built from a CSS url() source (capture.js records them).
  //     Sites like commercialtype.com never write an @font-face rule: they call
  //     `new FontFace("Graphik", ['url("/webfonts/…woff2")', 'url("…woff")'], {…})`.
  //     The browser fetches those itself, so window.fetch never sees them and the
  //     performance entry alone carries no family/weight/style. This is the only
  //     place both halves are available, so it both adds and enriches candidates.
  try {
    for (const face of window.__fontGrabberUrlFaces || []) {
      if (!face || !face.url) continue;
      const weight = face.weight ? normWeight(face.weight) : "400";
      const style = face.style ? normStyle(face.style) : "normal";
      const variable = /\s/.test((face.weight || "").trim()) || /\s/.test((face.stretch || "").trim());
      const existing = out.get(face.url);
      if (existing) {
        if (face.family && (!existing.family || existing.family.length < 2)) existing.family = face.family;
        if (existing.weight === "400" && weight !== "400") existing.weight = weight;
        if (existing.style === "normal" && style !== "normal") existing.style = style;
        if (variable) existing.variable = true;
        continue;
      }
      addCandidate(face.url, document.baseURI, face.family, weight, style, "", variable);
    }
  } catch {
    /* no url-sourced FontFace records */
  }

  // 2b. document.fonts as a last resort for the family names of dynamically added
  //     faces. A FontFace exposes no source URL, so this can only fill in a name
  //     when exactly one unnamed candidate matches the weight/style — enough to
  //     stop a tester font from being reported as "(Unknown)".
  try {
    const named = [];
    document.fonts.forEach((face) => {
      const family = stripQuotes(face.family);
      if (!family) return;
      named.push({ family, weight: normWeight(face.weight), style: normStyle(face.style) });
    });
    for (const entry of out.values()) {
      if (entry.family && entry.family.length > 1) continue;
      const matches = named.filter((f) => f.weight === entry.weight && f.style === entry.style);
      const unique = new Set(matches.map((f) => f.family));
      if (unique.size === 1) entry.family = matches[0].family;
    }
  } catch {
    /* document.fonts unavailable */
  }

  // 2d. Site catalog adapter — Displaay. The tester only fetches the styles you
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

 // 2c. Site catalog adapter — Commercial Type. The family landing page
 //     (e.g. /catalog/graphik) renders specimen text as SVG images and never
 //     loads the product fonts at all; individual style pages inject them
 //     through `new FontFace(name, [url()], descriptors)`.  Reading the
 //     /json/catalog.js JSON that the page's own JS already fetched lets us
 //     enumerate every style and construct its deterministic /webfonts/ URL.
 try {
   if (/(^|\.)commercialtype\.com$/i.test(location.hostname)) {
     // Extract the family slug from the catalog URL path.
     const pathParts = location.pathname.split("/").filter(Boolean);
     const isCtCatalog = pathParts[0] === "catalog" && pathParts.length >= 2;
     if (isCtCatalog) {
       const catalogResp = performance.getEntriesByType("resource")
         .find((e) => /\/json\/catalog\.js/i.test(e.name));
        var ctUrl = catalogResp ? catalogResp.name : "/json/catalog.js";
        var ctXhr = new XMLHttpRequest();
        ctXhr.open("GET", ctUrl, false);
        ctXhr.send();
        if (ctXhr.status < 200 || ctXhr.status >= 300) throw new Error(ctXhr.status);
        var ctData = JSON.parse(ctXhr.responseText);
        var ctNames = ctData.names || [];
        var ctWeights = ctData.weights || [];
        // style_options: [id, name, suffix, position, price]
        var ctOpts = new Map();
        for (var so of ctData.style_options || []) ctOpts.set(so[0], so);
        var ctSuffix = function (ids) {
          if (!Array.isArray(ids) || !ids.length) return "";
          var oo = ids.map(function (i) { return ctOpts.get(Number(i)); })
            .filter(Boolean).sort(function (a, b) { return a[3] - b[3]; });
          return oo.length ? "-" + oo.map(function (o) { return o[2]; }).join("-") : "";
        };
        // collections: [id, catalog_item_id, name, ...]
        var ctColById = new Map();
        for (var cc of ctData.collections || []) ctColById.set(cc[0], { id: cc[0], url: cc[2].toLowerCase().replace(/\s+/g, "_") });
        // families: [id, cat, collection_id, msc, name, price, langs, similar, style_option_ids, short_names, bonus]
        var ctFams = [];
        for (var ff of ctData.families || []) {
          var fn = ff[4] || "";
          ctFams.push({ id: ff[0], name: fn, url: fn.toLowerCase().replace(/\s+/g, "_"), base: fn.replace(/\s+/g, ""), colId: ff[2], optIds: Array.isArray(ff[8]) ? ff[8] : [] });
        }
        var ctFamById = new Map(ctFams.map(function (f) { return [f.id, f]; }));
        // Determine which families the current URL targets.
        var ctSlug = pathParts[1];
        var ctCol = null;
        for (var cv of ctColById.values()) { if (cv.url === ctSlug) { ctCol = cv; break; } }
        var ctSelected;
        if (pathParts.length >= 3) {
          ctSelected = ctFams.filter(function (f) { return f.url === pathParts[2]; });
        } else if (ctCol) {
          ctSelected = ctFams.filter(function (f) { return f.colId === ctCol.id; });
        } else {
          ctSelected = ctFams.filter(function (f) { return f.url === ctSlug; });
        }
        // styles: [id, cat, family_id, name_idx, price_idx, weight_idx, italic_style, italic_for, ...]
        for (var sf of ctSelected) {
          var sfx = ctSuffix(sf.optIds);
          for (var ss of ctData.styles || []) {
            if (ss[2] !== sf.id) continue;
            var sn = ctNames[ss[3]] || "";
            var sw = ctWeights[ss[5]] || 400;
            var si = Number(ss[7]) > 0;
            var cs = ss[14] || "";
            var csn = (sf.name + cs).replace(/\s+/g, "-");
            var sb = sf.base + "-" + sn.replace(/\s+/g, "") + sfx + "-Web";
            var sp = "/webfonts/" + sf.url + "/" + sb;
            for (var ext of [".woff2", ".woff"]) {
              addCandidate(sp + ext, location.href, csn, String(sw), si ? "italic" : "normal", "");
            }
          }
        }
      }
    }
  } catch {
    /* Commercial Type catalog shape changed — fall back to page capture */
  }

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
      const url = c.url || `captured:${index}`;
      // The same file often shows up twice — once via @font-face/performance and
      // once through the capture hooks. Enrich the existing entry instead of
      // adding a second card for the same URL.
      const entry = out.get(url) || { url, family: "", weight: "400", style: "normal", format: "" };
      if (!entry.family || entry.family.length < 2) entry.family = looksUuid ? slug : c.family;
      if (entry.weight === "400" && c.weight && /^\d/.test(c.weight)) entry.weight = c.weight.split(/\s+/)[0];
      if (entry.style === "normal" && /italic|oblique/i.test(c.style)) {
        entry.style = c.style.toLowerCase().split(/\s+/)[0];
      }
      if (/\s/.test(c.weight || "") || /\s/.test(c.stretch || "")) entry.variable = true;
      if (includeBytes) {
        entry.b64 = toB64(c.bytes);
        entry.captured = true;
      }
      out.set(url, entry);
    });
  } catch {
    /* no captured fonts */
  }

  return Array.from(out.values());
}

// Expose for headless Chrome (core/src/discovery/headless.rs) which appends a call.
if (typeof window !== "undefined") window.collectFontsInPage = collectFontsInPage;
