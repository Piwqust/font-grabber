// Every call to the Rust server lives here, so components never build a URL or
// parse a response body themselves.

async function readJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

/**
 * Runs a scan. The server streams NDJSON progress events; `onStage` is called
 * with a human-readable message for each one.
 */
export async function scan({ url, mode, signal, onStage }) {
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, mode, stream: true }),
    signal,
  });
  if (!response.headers.get("Content-Type")?.includes("application/x-ndjson"))
    return readJson(response);

  const stages = {
    page_source: "Reading the page and its stylesheets…",
    browser: "Opening the page in a browser and collecting dynamic fonts…",
    organizing: "Organising font families…",
  };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let report;

  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "stage") onStage?.(stages[event.stage] || "Scanning…");
    if (event.type === "error") throw new Error(event.error);
    if (event.type === "result") report = event.report;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (done) break;
    }
    consume(buffer);
  } finally {
    reader.releaseLock();
  }
  if (!report)
    throw new Error("The scan ended before results arrived. Try again.");
  return report;
}

export async function exportFonts({ url, mode, ids, delivery, outputDir }) {
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      mode,
      ids,
      delivery,
      output_dir: outputDir || null,
    }),
  });
  return readJson(response);
}

export async function fetchArchive(downloadUrl) {
  const response = await fetch(downloadUrl);
  if (!response.ok)
    throw new Error("The archive is unavailable. Prepare the download again.");
  return response.blob();
}

export async function checkCoverage({ url, mode, ids, text }) {
  const response = await fetch("/api/coverage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, mode, ids, text }),
  });
  return readJson(response);
}

/** The server proxies font files so previews are not blocked by CORS. */
export function fontProxyUrl(sourceUrl) {
  return `/api/font?url=${encodeURIComponent(sourceUrl)}`;
}

/* --- Metadata editor -------------------------------------------------------
   Two endpoints, both taking a `source` that is either the scan the catalogue
   came from or files the person chose. See docs/METADATA-EDITOR.md. */

/** Reads one File as base64, without the `data:` prefix. */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () =>
      reject(new Error(`Could not read ${file.name} from your computer.`));
    reader.readAsDataURL(file);
  });
}

/** Reads the current name tables so the editor starts from real values. */
export async function inspectMetadata(source) {
  const response = await fetch("/api/metadata/inspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  return readJson(response);
}

/** Writes the draft into the fonts and returns an export-shaped result. */
export async function applyMetadata({ source, delivery, outputDir, fonts }) {
  const response = await fetch("/api/metadata/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source,
      delivery,
      output_dir: outputDir || null,
      fonts,
    }),
  });
  return readJson(response);
}

export function triggerDownload(blob, filename) {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
}
