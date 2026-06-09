"use strict";

const state = {
  url: "",
  mode: "auto",
  fonts: [],
  selected: new Set(),
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
  fontStyle: document.getElementById("font-face-styles") || createStyleSheet(),
};

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
  // Stagger the entrance, but cap the delay so deep rows don't wait forever.
  card.style.setProperty("--d", `${Math.min(index, 18) * 0.025}s`);

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
  card.innerHTML = `
    <div class="specimen-head">
      <label class="pick">
        <input type="checkbox" ${checked}>
        <span class="mark"></span>
        <span class="idx">${number}</span>
        <span class="font-name">${escapeHtml(font.family)}</span>
      </label>
      <div class="badges">${badges.join("")}</div>
    </div>
    <p class="preview loading" data-id="${escapeAttr(font.id)}">${escapeHtml(sample)}</p>
  `;

  const checkbox = card.querySelector("input");
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selected.add(font.id);
    else state.selected.delete(font.id);
    card.classList.toggle("selected", checkbox.checked);
    updateSelection();
  });

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

el.url.focus();
