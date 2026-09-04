"use strict";

const HOSTED = document.body.dataset.hosted === "true";

const state = {
  url: "",
  mode: "auto",
  fonts: [],
  selected: new Set(),
  drafts: {},
  expanded: new Set(),
};

const el = {
  form: document.getElementById("scan-form"),
  url: document.getElementById("url"),
  mode: document.getElementById("mode"),
  scanBtn: document.getElementById("scan-btn"),
  scanStatus: document.getElementById("scan-status"),
  warnings: document.getElementById("warnings"),
  results: document.getElementById("results"),
  filter: document.getElementById("filter"),
  count: document.getElementById("count"),
  sample: document.getElementById("sample"),
  size: document.getElementById("size"),
  sizeValue: document.getElementById("size-value"),
  selectAll: document.getElementById("select-all"),
  selectNone: document.getElementById("select-none"),
  selectedCount: document.getElementById("selected-count"),
  list: document.getElementById("font-list"),
  grabBar: document.getElementById("grab-bar"),
  outputDir: document.getElementById("output-dir"),
  grabBtn: document.getElementById("grab-btn"),
  grabStatus: document.getElementById("grab-status"),
  bulkFamily: document.getElementById("bulk-family"),
  bulkFamilyCtl: document.getElementById("bulk-family-ctl"),
  fontStyle: document.getElementById("font-face-styles") || createStyleSheet(),
};

if (HOSTED) {
  const edition = document.getElementById("edition-label");
  if (edition) edition.textContent = "Hosted";
}

function createStyleSheet() {
  const style = document.createElement("style");
  style.id = "font-face-styles";
  document.head.appendChild(style);
  return style;
}

// Lazily load each font's @font-face only when its card scrolls into view, so a
// 1000-font page does not fetch 1000 files at once.
const loaded = new Set();
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const card = entry.target;
    observer.unobserve(card);
    loadPreview(card.dataset.id);
  }
}, { rootMargin: "300px 0px" });

function loadPreview(id) {
  if (loaded.has(id)) return;
  const font = state.fonts.find((f) => f.id === id);
  if (!font || !font.sources || !font.sources.length) return;
  loaded.add(id);

  const source = font.sources[0];
  const family = `fg-${cssId(id)}`;
  const proxied = `/api/font?url=${encodeURIComponent(source.url)}`;
  const rule = `@font-face{font-family:"${family}";src:url("${proxied}")${formatHint(source)};font-display:swap;}`;
  el.fontStyle.appendChild(document.createTextNode(rule));

  const preview = document.querySelector(`.preview[data-id="${cssEscape(id)}"]`);
  if (preview) {
    preview.style.fontFamily = `"${family}", system-ui, sans-serif`;
    preview.classList.remove("loading");
  }
}

function formatHint(source) {
  const map = { woff2: "woff2", woff: "woff", truetype: "truetype", opentype: "opentype" };
  const fmt = map[source.format];
  return fmt ? ` format("${fmt}")` : "";
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------
el.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await runScan();
});

async function runScan() {
  const url = el.url.value.trim();
  if (!url) return;
  state.url = url;
  state.mode = el.mode.value;

  setScanStatus("Scanning… this can take a moment on large sites.", "spinner");
  el.scanBtn.disabled = true;
  el.warnings.hidden = true;

  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, mode: state.mode }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`);

    state.fonts = data.fonts || [];
    state.selected = new Set();
    state.expanded = new Set();
    state.drafts = {};
    for (const font of state.fonts) {
      state.drafts[font.id] = makeDraft(font, url);
    }
    resetPreviews();
    renderWarnings(data.warnings || []);

    if (state.fonts.length === 0) {
      setScanStatus("No fonts found on that page.", "");
      el.results.hidden = true;
      el.grabBar.hidden = true;
      return;
    }

    const browserNote = data.used_browser ? " · via browser rendering" : "";
    setScanStatus(`Found ${state.fonts.length} face${state.fonts.length === 1 ? "" : "s"}${browserNote}.`, "");
    const mc = document.getElementById("masthead-count");
    if (mc) mc.textContent = `${state.fonts.length} faces`;
    renderFonts();
    el.results.hidden = false;
    el.grabBar.hidden = false;
    updateSelection();
  } catch (error) {
    setScanStatus(error.message, "error");
    el.results.hidden = true;
    el.grabBar.hidden = true;
  } finally {
    el.scanBtn.disabled = false;
  }
}

function resetPreviews() {
  loaded.clear();
  el.fontStyle.textContent = "";
}

function setScanStatus(message, kind) {
  if (kind === "spinner") {
    el.scanStatus.className = "status";
    el.scanStatus.innerHTML = `<span class="spin"></span>${escapeHtml(message)}`;
  } else {
    el.scanStatus.className = `status${kind ? " " + kind : ""}`;
    el.scanStatus.textContent = message;
  }
  el.scanStatus.hidden = !message;
}

function renderWarnings(warnings) {
  if (!warnings.length) {
    el.warnings.hidden = true;
    return;
  }
  const items = warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("");
  el.warnings.innerHTML = `<strong>Warnings</strong><ul>${items}</ul>`;
  el.warnings.hidden = false;
}

// ---------------------------------------------------------------------------
// Render font list
// ---------------------------------------------------------------------------
// Match against the family name *and* the source file name, because some foundries
// ship obfuscated CSS family names (e.g. "Ee-Di-Bold") while the real name only
// survives in the font URL ("GT-Eesti-LC-Display-Bold.woff2").
function matchesFilter(font, query) {
  if (!query) return true;
  if (font.family.toLowerCase().includes(query)) return true;
  const draft = state.drafts[font.id];
  if (draft && draft.family.toLowerCase().includes(query)) return true;
  const src = font.sources && font.sources[0] ? font.sources[0].url.toLowerCase() : "";
  return src.includes(query);
}

function filteredFonts() {
  const query = el.filter.value.trim().toLowerCase();
  return query ? state.fonts.filter((f) => matchesFilter(f, query)) : state.fonts;
}

function renderFonts() {
  const query = el.filter.value.trim().toLowerCase();
  const fonts = filteredFonts();

  el.count.textContent = query
    ? `${fonts.length} of ${state.fonts.length}`
    : `${state.fonts.length} fonts`;

  el.list.innerHTML = "";
  if (fonts.length === 0) {
    el.list.innerHTML = `<p class="empty">No fonts match “${escapeHtml(query)}”.</p>`;
    return;
  }

  const sample = el.sample.value || "The quick brown fox";
  const frag = document.createDocumentFragment();
  fonts.forEach((font, index) => frag.appendChild(buildCard(font, sample, index)));
  el.list.appendChild(frag);

  for (const card of el.list.querySelectorAll(".font-card")) {
    if (loaded.has(card.dataset.id)) {
      const preview = card.querySelector(".preview");
      preview.style.fontFamily = `"fg-${cssId(card.dataset.id)}", system-ui, sans-serif`;
      preview.classList.remove("loading");
    } else {
      observer.observe(card);
    }
  }
}

function buildCard(font, sample, index) {
  const card = document.createElement("article");
  card.className = "specimen font-card" + (state.selected.has(font.id) ? " selected" : "");
  card.dataset.id = font.id;
  card.style.setProperty("--d", `${Math.min(index, 18) * 0.025}s`);

  const draft = state.drafts[font.id] || makeDraft(font, state.url);
  state.drafts[font.id] = draft;

  const badges = [];
  if (font.weight && font.weight !== "400") badges.push(badge(font.weight));
  if (font.style && font.style !== "normal") badges.push(badge(font.style));
  if (font.stretch) badges.push(badge(font.stretch));
  for (const script of font.scripts || []) badges.push(badge(script));
  if (font.variable) badges.push(badge("var", "variable"));
  const fmt = font.sources && font.sources[0] ? font.sources[0].format : null;
  if (fmt) badges.push(badge(fmt, "fmt"));

  const number = String(index + 1).padStart(2, "0");
  const checked = state.selected.has(font.id) ? "checked" : "";
  const expanded = state.expanded.has(font.id);
  card.innerHTML = `
    <div class="specimen-head">
      <label class="pick">
        <input type="checkbox" ${checked}>
        <span class="mark"></span>
        <span class="idx">${number}</span>
      </label>
      <input class="font-name" data-field="family" value="${escapeAttr(draft.family)}" spellcheck="false" autocomplete="off">
      <button class="name-toggle" type="button" aria-expanded="${expanded ? "true" : "false"}">Names</button>
      <div class="badges">${badges.join("")}</div>
    </div>
    <div class="specimen-names" ${expanded ? "" : "hidden"}>
      <label>Subfamily <input data-field="subfamily" value="${escapeAttr(draft.subfamily)}" spellcheck="false" autocomplete="off"></label>
      <label>Full name <input data-field="full_name" value="${escapeAttr(draft.full_name)}" spellcheck="false" autocomplete="off"></label>
      <label>PostScript <input data-field="postscript" value="${escapeAttr(draft.postscript)}" spellcheck="false" autocomplete="off"></label>
      <label>Filename <input data-field="filename" value="${escapeAttr(draft.filename)}" spellcheck="false" autocomplete="off"></label>
    </div>
    <p class="preview loading" data-id="${escapeAttr(font.id)}">${escapeHtml(sample)}</p>
  `;

  const checkbox = card.querySelector(".pick input");
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selected.add(font.id);
    else state.selected.delete(font.id);
    card.classList.toggle("selected", checkbox.checked);
    updateSelection();
  });

  const toggle = card.querySelector(".name-toggle");
  const names = card.querySelector(".specimen-names");
  toggle.addEventListener("click", () => {
    const open = names.hidden;
    names.hidden = !open;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) state.expanded.add(font.id);
    else state.expanded.delete(font.id);
  });

  for (const input of card.querySelectorAll("input[data-field]")) {
    input.addEventListener("input", () => {
      writeDraftField(font.id, input.dataset.field, input.value);
      if (input.dataset.field === "family" || input.dataset.field === "subfamily") {
        syncAutoFields(card, font.id);
      }
    });
  }

  return card;
}

function badge(text, extra) {
  return `<span class="badge${extra ? " " + extra : ""}">${escapeHtml(String(text))}</span>`;
}

// ---------------------------------------------------------------------------
// Toolbar interactions
// ---------------------------------------------------------------------------
el.filter.addEventListener("input", debounce(renderFonts, 150));

el.sample.addEventListener("input", () => {
  const sample = el.sample.value || "The quick brown fox";
  for (const preview of el.list.querySelectorAll(".preview")) {
    preview.textContent = sample;
  }
});

el.size.addEventListener("input", () => {
  el.sizeValue.textContent = el.size.value;
  document.documentElement.style.setProperty("--preview-size", `${el.size.value}px`);
});

el.selectAll.addEventListener("click", () => {
  for (const font of filteredFonts()) state.selected.add(font.id);
  syncCheckboxes();
  updateSelection();
});

el.selectNone.addEventListener("click", () => {
  state.selected.clear();
  syncCheckboxes();
  updateSelection();
});

function syncCheckboxes() {
  for (const card of el.list.querySelectorAll(".font-card")) {
    const checked = state.selected.has(card.dataset.id);
    card.querySelector("input").checked = checked;
    card.classList.toggle("selected", checked);
  }
}

function updateSelection() {
  const n = state.selected.size;
  el.selectedCount.textContent = `${n} selected`;
  el.grabBtn.disabled = n === 0;
  if (el.bulkFamilyCtl) {
    el.bulkFamilyCtl.hidden = n === 0;
    if (n > 0) {
      const first = state.drafts[[...state.selected][0]];
      if (first && document.activeElement !== el.bulkFamily) {
        el.bulkFamily.value = first.family;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Grab
// ---------------------------------------------------------------------------
for (const radio of document.querySelectorAll('input[name="delivery"]')) {
  radio.addEventListener("change", () => {
    el.outputDir.hidden = deliveryMode() !== "folder";
  });
}

function deliveryMode() {
  const checked = document.querySelector('input[name="delivery"]:checked');
  return checked ? checked.value : "zip";
}

el.grabBtn.addEventListener("click", async () => {
  const ids = [...state.selected];
  if (!ids.length) return;
  const delivery = deliveryMode();

  setGrabStatus(`Downloading and converting ${ids.length} font${ids.length === 1 ? "" : "s"}…`, "");
  el.grabBtn.disabled = true;

  try {
    const res = await fetch("/api/grab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: state.url,
        mode: state.mode,
        ids,
        delivery,
        output_dir: el.outputDir.value.trim() || null,
        names: namesPayload(ids),
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Grab failed (${res.status})`);
    }

    if (delivery === "folder") {
      const data = await res.json();
      const failures = (data.download_failures.length + data.conversion_failures.length);
      const failNote = failures ? ` · ${failures} failed` : "";
      setGrabStatus(`Saved ${data.saved_count} file${data.saved_count === 1 ? "" : "s"} to ${data.output_dir}${failNote}`, "success");
    } else {
      const blob = await res.blob();
      const filename = filenameFromResponse(res) || "fonts.zip";
      triggerDownload(blob, filename);
      setGrabStatus(`Downloaded ${filename}`, "success");
    }
  } catch (error) {
    setGrabStatus(error.message, "error");
  } finally {
    el.grabBtn.disabled = state.selected.size === 0;
  }
});

function setGrabStatus(message, kind) {
  el.grabStatus.textContent = message;
  el.grabStatus.className = `grab-status${kind ? " " + kind : ""}`;
}

function triggerDownload(blob, filename) {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}

function filenameFromResponse(res) {
  const header = res.headers.get("Content-Disposition") || "";
  const match = header.match(/filename="?([^"]+)"?/);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function cssId(id) {
  return id.replace(/[^a-zA-Z0-9_-]/g, (c) => "_" + c.charCodeAt(0).toString(16));
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

if (el.bulkFamily) {
  el.bulkFamily.addEventListener("change", () => {
    const family = el.bulkFamily.value.trim();
    if (!family || state.selected.size === 0) return;
    for (const id of state.selected) {
      writeDraftField(id, "family", family);
    }
    renderFonts();
  });
}

function writeDraftField(id, field, value) {
  const draft = state.drafts[id];
  if (!draft) return;
  draft[field] = value;
  draft.dirty = true;
  if (field === "full_name") draft.dirtyFull = true;
  if (field === "postscript") draft.dirtyPs = true;
  if (field === "filename") draft.dirtyFile = true;
  if (field === "family" || field === "subfamily") {
    if (!draft.dirtyFull) draft.full_name = composeFull(draft.family, draft.subfamily);
    if (!draft.dirtyPs) draft.postscript = composePs(draft.family, draft.subfamily);
    if (!draft.dirtyFile) draft.filename = composeFile(draft.family, draft.subfamily);
  }
}

function syncAutoFields(card, id) {
  const draft = state.drafts[id];
  if (!draft) return;
  const map = {
    full_name: draft.full_name,
    postscript: draft.postscript,
    filename: draft.filename,
  };
  for (const [field, value] of Object.entries(map)) {
    const input = card.querySelector(`input[data-field="${field}"]`);
    if (input && document.activeElement !== input) input.value = value;
  }
}

function namesPayload(ids) {
  return ids
    .map((id) => {
      const draft = state.drafts[id];
      if (!draft || !draft.dirty) return null;
      return {
        id,
        family: draft.family,
        subfamily: draft.subfamily,
        full_name: draft.full_name,
        postscript: draft.postscript,
        filename: draft.filename,
      };
    })
    .filter(Boolean);
}

function makeDraft(font, pageUrl) {
  let family = (font.family || "").trim();
  const sourceUrl = font.sources && font.sources[0] ? font.sources[0].url : "";
  const suggested = typefaceFromUrl(sourceUrl) || typefaceFromUrl(pageUrl);
  const dirty = looksObfuscated(family) && !!suggested;
  if (dirty) family = suggested;
  const subfamily = defaultSubfamily(font);
  return {
    family: family || "Font",
    subfamily,
    full_name: composeFull(family || "Font", subfamily),
    postscript: composePs(family || "Font", subfamily),
    filename: composeFile(family || "Font", subfamily),
    dirty,
    dirtyFull: false,
    dirtyPs: false,
    dirtyFile: false,
  };
}

function looksObfuscated(name) {
  const value = (name || "").trim();
  if (!value) return true;
  if (/^font-style-\d+$/i.test(value)) return true;
  if (/^[A-Z]{1,3}-[A-Z]{1,3}(-|$)/.test(value)) return true;
  return false;
}

function typefaceFromUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, window.location.href);
    const parts = parsed.pathname.split("/").filter(Boolean);
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      let segment = decodeURIComponent(parts[index]).replace(/\.(woff2?|ttf|otf|html?|php|aspx?)$/i, "");
      if (!segment || /^(typeface|font|fonts|family|download|static|assets|css|js|woff2?)$/i.test(segment)) {
        continue;
      }
      if (segment.length < 3) continue;
      if (/^v?\d+(\.\d+)*$/.test(segment)) continue;
      return humanizeSegment(segment);
    }
  } catch {
    /* ignore */
  }
  return "";
}

function humanizeSegment(segment) {
  return segment
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase())
    .trim();
}

function defaultSubfamily(font) {
  const fromCss = (font.family || "").match(
    /(Thin|Hairline|ExtraLight|UltraLight|Light|Regular|Book|Medium|SemiBold|DemiBold|Bold|ExtraBold|UltraBold|Black|Heavy)( Italic| Oblique)?$/i
  );
  if (fromCss) {
    return (fromCss[1] + (fromCss[2] || "")).replace(/([a-z])([A-Z])/g, "$1 $2");
  }
  const style = (font.style || "").toLowerCase();
  const italic = style === "italic" || style === "oblique";
  const weight = String(font.weight || "400");
  if (weight === "700" && italic) return "Bold Italic";
  if (weight === "700") return "Bold";
  if (italic) return style === "oblique" ? "Oblique" : "Italic";
  return "Regular";
}

function composeFull(family, subfamily) {
  if (!subfamily || /^regular$/i.test(subfamily)) return family;
  return `${family} ${subfamily}`;
}

function composePs(family, subfamily) {
  const left = (family || "").replace(/[^A-Za-z0-9-]/g, "");
  const right = (subfamily || "").replace(/[^A-Za-z0-9-]/g, "");
  const value = right && !/^regular$/i.test(subfamily || "") ? `${left}-${right}` : left;
  return (value || "Font").slice(0, 63);
}

function composeFile(family, subfamily) {
  const left = sanitizeStem(family);
  const right = sanitizeStem(subfamily);
  if (!right || /^regular$/i.test(subfamily || "")) return left;
  return `${left}-${right}`;
}

function sanitizeStem(value) {
  return (value || "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "Font";
}

el.url.focus();
