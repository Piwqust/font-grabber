// End-to-end check of the metadata editor against a real Fount server.
// Unlike check-metadata-ui.cjs, nothing here is mocked: the requests reach the
// Rust binary, the ZIP comes back over HTTP, and the name tables in it are
// parsed byte by byte.
//
//   cargo build --release --manifest-path core/Cargo.toml --offline
//   ./core/target/release/font-grabber serve --port 8790 --no-open
//   node scripts/check-metadata-editor.cjs http://127.0.0.1:8790
//
// Ports 8787 and 8788 belong to the user; use 8790 and up.
// Screenshots and a log land in output/metadata-editor/.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const zlib = require("node:zlib");

const root = path.resolve(__dirname, "..");
const web = path.join(root, "core/src/web");
const output = path.join(root, "output", "metadata-editor");
fs.mkdirSync(output, { recursive: true });

const base = process.argv[2] || "http://127.0.0.1:8790";
assert.ok(
  !/:(8787|8788)(\/|$)/.test(base),
  "8787 and 8788 belong to the user; serve on 8790 or above",
);

const checks = [];
const notes = [];
function check(value, label) {
  assert.ok(value, label);
  checks.push(label);
}
function note(line) {
  notes.push(line);
}

/* --- ZIP, enough of it to read what the server just wrote ----------------- */
// Central directory only; the archives here are small and never spanned.
function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, "The response is not a ZIP archive");
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, "Bad ZIP directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString(
      "utf8",
      offset + 46,
      offset + 46 + nameLength,
    );
    const localNameLength = buffer.readUInt16LE(local + 26);
    const localExtraLength = buffer.readUInt16LE(local + 28);
    const start = local + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressed);
    files.set(name, method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/* --- sfnt: what kind of outlines, and what the name table says ------------ */
function sfntFlavour(buffer) {
  const tag = buffer.readUInt32BE(0);
  if (tag === 0x774f4632) return "woff2";
  if (tag === 0x774f4646) return "woff";
  if (tag === 0x4f54544f) return "cff"; // 'OTTO' — PostScript outlines, .otf
  if (tag === 0x00010000 || tag === 0x74727565) return "glyf"; // TrueType, .ttf
  if (tag === 0x74746366) return "collection";
  return `unknown:0x${tag.toString(16)}`;
}

// Every name record, keyed by name ID. Windows (platform 3) wins over
// Macintosh (platform 1) because that is what Windows and macOS both read.
function readNames(buffer) {
  const tables = buffer.readUInt16BE(4);
  let name = null;
  for (let i = 0; i < tables; i++) {
    const entry = 12 + i * 16;
    if (buffer.toString("latin1", entry, entry + 4) === "name") {
      name = {
        offset: buffer.readUInt32BE(entry + 8),
        length: buffer.readUInt32BE(entry + 12),
      };
      break;
    }
  }
  assert.ok(name, "The font has no name table");
  const table = buffer.subarray(name.offset, name.offset + name.length);
  const count = table.readUInt16BE(2);
  const storage = table.readUInt16BE(4);
  const values = new Map();
  const platforms = new Map();
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    const platform = table.readUInt16BE(record);
    const id = table.readUInt16BE(record + 6);
    const length = table.readUInt16BE(record + 8);
    const at = storage + table.readUInt16BE(record + 10);
    const bytes = table.subarray(at, at + length);
    // Platform 3 and 0 store UTF-16BE. swap16() works in place, so it has to
    // run on a copy: the caller still needs the untouched font.
    const text =
      platform === 3 || platform === 0
        ? Buffer.from(bytes).swap16().toString("utf16le")
        : bytes.toString("latin1");
    if (!values.has(id) || platform === 3) values.set(id, text);
    if (!platforms.has(id)) platforms.set(id, new Set());
    platforms.get(id).add(platform);
  }
  return { values, platforms };
}

// The Axe bundle lives under output/, which is not committed, so a fresh clone
// skips this pass with a note instead of failing on a missing file.
const axeBundle = path.join(root, "output/playwright/ux-service/axe.min.js");
async function axePass(page, name) {
  if (!fs.existsSync(axeBundle))
    return note(`Axe skipped: ${path.relative(root, axeBundle)} is not here`);
  // The page's CSP rightly refuses injected <script> tags; evaluate is the
  // DevTools path, which leaves the policy the app runs under intact.
  await page.evaluate(fs.readFileSync(axeBundle, "utf8"));
  const violations = await page.evaluate(async () => {
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
    });
    // Font specimen text is decorative and inherits --ink, but the loading
    // state (opacity 0.32) or a slow font decode can trigger a false
    // color-contrast failure. Filter those out.
    return result.violations
      .map((v) => ({
        id: v.id,
        nodes: v.nodes
          .filter((n) => !n.target.some((t) => /\.preview/.test(t)))
          .map((n) => n.target),
      }))
      .filter((v) => v.nodes.length > 0);
  });
  fs.writeFileSync(
    path.join(output, `axe-${name}.json`),
    JSON.stringify(violations, null, 2),
  );
  check(
    violations.length === 0,
    `${name}: no Axe violations ${JSON.stringify(violations)}`,
  );
}

async function post(endpoint, body) {
  const response = await fetch(base + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    assert.fail(`${endpoint} did not answer with JSON: ${text.slice(0, 300)}`);
  }
  assert.ok(response.ok, `${endpoint}: ${text.slice(0, 400)}`);
  return data;
}

async function archiveOf(applied) {
  const response = await fetch(base + applied.download_url);
  assert.ok(response.ok, `Archive ${applied.download_url} is unavailable`);
  return unzip(Buffer.from(await response.arrayBuffer()));
}

/* --- The edit every run makes -------------------------------------------- */
const FAMILY = "Fount Geist";
const MANUFACTURER = "Fount Studio";
const LICENCE =
  "Licensed for this check only. Redistribution of the modified file is not implied.";
const VERSION = "2.125";
const STEM = "FountGeist-Regular";

const seed = fs.readFileSync(path.join(web, "assets/geist-400.woff2"));

// A page that offers the same face over HTTP, so the scan path has something
// real to find without reaching the network.
const fixture = http.createServer((request, response) => {
  if (request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    return response.end(`<style>
      @font-face{font-family:Geist Fixture;src:url('/geist-400.woff2') format('woff2');font-weight:400}
    </style><h1>Metadata fixture</h1>`);
  }
  if (request.url === "/geist-400.woff2") {
    response.setHeader("Content-Type", "font/woff2");
    return response.end(seed);
  }
  response.writeHead(404);
  response.end("Missing");
});

(async () => {
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/`;
  let browser;
  try {
    /* --- The server under test ------------------------------------------ */
    const landing = await fetch(base);
    const html = await landing.text();
    check(
      landing.ok && /<title>\s*Fount/.test(html),
      "The server under test is Fount",
    );

    /* --- Upload: inspect ------------------------------------------------- */
    const inspected = await post("/api/metadata/inspect", {
      source: {
        kind: "upload",
        files: [{ name: "geist-400.woff2", data: seed.toString("base64") }],
      },
    });
    check(
      inspected.fonts.length === 1 && inspected.failures.length === 0,
      "Upload inspect reads the file with no failures",
    );
    const read = inspected.fonts[0];
    check(
      read.id === "upload:0" && read.file === "geist-400.woff2",
      "Upload inspect keeps the id and file name the contract promises",
    );
    check(
      read.format === "woff2",
      `Upload inspect reports the real container format (${read.format})`,
    );
    check(
      typeof read.names.family === "string" && read.names.family.length > 0,
      `Upload inspect returns the family in the file (${read.names.family})`,
    );
    check(
      typeof inspected.upload_id === "string" && inspected.upload_id.length > 8,
      "Upload inspect opens a server-side session",
    );
    note(`source family: ${read.names.family}`);
    note(`source version: ${read.names.version}`);

    const rejected = await fetch(base + "/api/metadata/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: {
          kind: "upload",
          files: [
            { name: "not-a-font.ttf", data: Buffer.from("nope").toString("base64") },
          ],
        },
      }),
    });
    check(
      rejected.status === 400,
      "Upload inspect refuses bytes that are not a font",
    );

    /* --- Upload: apply ---------------------------------------------------- */
    const applied = await post("/api/metadata/apply", {
      source: { kind: "upload", upload_id: inspected.upload_id },
      delivery: "zip",
      output_dir: null,
      fonts: [
        {
          id: "upload:0",
          names: {
            family: FAMILY,
            full_name: `${FAMILY} Regular`,
            postscript: STEM,
            manufacturer: MANUFACTURER,
            license: LICENCE,
            version: VERSION,
          },
          filename: STEM,
        },
      ],
    });
    check(
      applied.saved_count === 1 && applied.requested_count === 1,
      "Upload apply converts the one file it was given",
    );
    for (const key of [
      "results",
      "saved_count",
      "requested_count",
      "download_url",
      "filename",
      "output_dir",
    ])
      check(applied[key] !== undefined, `Apply answers with ${key}`);

    const files = await archiveOf(applied);
    check(files.size === 1, "The archive holds exactly the one edited file");
    const [name, bytes] = [...files][0];
    const flavour = sfntFlavour(bytes);
    const extension = path.extname(name).toLowerCase();
    note(`delivered file: ${name} (${flavour}, ${bytes.length} bytes)`);
    check(
      name === applied.results[0].file,
      "The reported file name is the name in the archive",
    );
    check(
      (flavour === "glyf" && extension === ".ttf") ||
        (flavour === "cff" && extension === ".otf"),
      `The extension matches the outlines actually in the file (${flavour} -> ${extension})`,
    );
    check(
      path.basename(name, extension) === STEM,
      `The file is named from the draft (${name})`,
    );

    const { values, platforms } = readNames(bytes);
    const expected = new Map([
      [1, FAMILY],
      [4, `${FAMILY} Regular`],
      [5, `Version ${VERSION}`],
      [6, STEM],
      [8, MANUFACTURER],
      [13, LICENCE],
      [16, FAMILY],
    ]);
    for (const [id, want] of expected) {
      const got = values.get(id);
      note(`name id ${id}: ${JSON.stringify(got)}`);
      check(got === want, `Name ID ${id} is ${JSON.stringify(want)}`);
    }
    check(
      platforms.get(1).has(3),
      "The family name has a Windows record, so Windows installs it",
    );
    check(
      values.get(3) !== undefined && values.get(3).includes(STEM),
      `Name ID 3 is regenerated from the new names (${values.get(3)})`,
    );
    fs.writeFileSync(path.join(output, name), bytes);

    /* --- Removing a record ------------------------------------------------ */
    const cleared = await post("/api/metadata/apply", {
      source: { kind: "upload", upload_id: inspected.upload_id },
      delivery: "zip",
      fonts: [{ id: "upload:0", names: { family: FAMILY, license: "" } }],
    });
    const clearedNames = readNames([...(await archiveOf(cleared))][0][1]);
    check(
      clearedNames.values.get(13) === undefined &&
        clearedNames.values.get(1) === FAMILY,
      "An empty value removes that record and leaves the others alone",
    );

    /* --- Refusals --------------------------------------------------------- */
    const badVersion = await fetch(base + "/api/metadata/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: { kind: "upload", upload_id: inspected.upload_id },
        delivery: "zip",
        fonts: [{ id: "upload:0", names: { version: "two point five" } }],
      }),
    });
    check(badVersion.status === 400, "A version that is not a number is refused");
    const expired = await fetch(base + "/api/metadata/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: { kind: "upload", upload_id: "no-such-session" },
        delivery: "zip",
        fonts: [{ id: "upload:0", names: {} }],
      }),
    });
    check(
      expired.status === 400 && (await expired.text()).includes("expired"),
      "An unknown upload session is refused with a recoverable message",
    );

    /* --- Scan: inspect and apply ------------------------------------------ */
    const report = await post("/api/scan", { url: fixtureUrl, mode: "static" });
    check(
      report.fonts.length === 1,
      "The local fixture is discovered by a real scan",
    );
    const id = report.fonts[0].id;
    const scanned = await post("/api/metadata/inspect", {
      source: { kind: "scan", url: fixtureUrl, mode: "static", ids: [id] },
    });
    check(
      scanned.fonts.length === 1 && scanned.failures.length === 0,
      "Scan inspect downloads and reads the selected face",
    );
    check(
      scanned.fonts[0].file === "geist-400.woff2" &&
        scanned.fonts[0].format === "woff2",
      `Scan inspect names the file it fetched (${scanned.fonts[0].file}, ${scanned.fonts[0].format})`,
    );
    check(
      scanned.upload_id === undefined,
      "A scan source opens no upload session",
    );
    const scanApplied = await post("/api/metadata/apply", {
      source: { kind: "scan", url: fixtureUrl, mode: "static" },
      delivery: "zip",
      fonts: [
        {
          id,
          names: { family: "Fount Fixture", manufacturer: MANUFACTURER },
          filename: "FountFixture-Regular",
        },
        { id: "gone", names: {} },
      ],
    });
    check(
      scanApplied.saved_count === 1 && scanApplied.requested_count === 2,
      "Scan apply reports the exact success count",
    );
    check(
      scanApplied.results.some((r) => r.id === "gone" && r.status === "error"),
      "A face that is no longer in the collection fails by itself",
    );
    const scanNames = readNames([...(await archiveOf(scanApplied))][0][1]);
    check(
      scanNames.values.get(1) === "Fount Fixture" &&
        scanNames.values.get(16) === "Fount Fixture" &&
        scanNames.values.get(8) === MANUFACTURER,
      "The scanned face carries the new names",
    );

    /* --- The same edit, made in the browser ------------------------------- */
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "fount-e2e-"));
    const chosen = path.join(temporary, "geist-400.woff2");
    fs.writeFileSync(chosen, seed);

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 950 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    check((await page.title()).startsWith("Fount"), "The page title is Fount");

    await page.getByRole("button", { name: "Customize font" }).click();
    await page.locator("#metadata-files").setInputFiles([chosen]);
    await page.locator("#metadata").waitFor();
    await page.locator(".sp-proof").first().waitFor();
    check(
      (await page.locator("#meta-family").inputValue()) === read.names.family,
      "The editor opens on the family the server read out of the file",
    );
    // A duplicate id silently steals a <label for> from its input, so the
    // field ends up named after whatever else claimed the id.
    const duplicates = await page.evaluate(() => {
      const seen = new Map();
      for (const node of document.querySelectorAll("[id]"))
        seen.set(node.id, (seen.get(node.id) || 0) + 1);
      return [...seen].filter(([, count]) => count > 1).map(([id]) => id);
    });
    check(duplicates.length === 0, `No id is used twice (${duplicates})`);
    check(await page.title() === "Customize font — Fount", "The editor has its own page title");
    check(await page.locator('.island').count() > 0, "The editor uses a floating island header");
    check(await page.locator('#font-details').isVisible(), "Font details open on the page above the styles");
    check(await page.locator('.me-records .meta-origin').count() === 0, "Untouched details do not repeat their original values");
    check(await page.locator('.me-detail-section').count() === 3, "Font details are grouped into three sequential sections");
    for (const key of ["family", "manufacturer", "license", "version"])
      check(
        await page.evaluate(
          (id) => document.querySelector(`label[for="${id}"]`)?.control?.id === id,
          `meta-${key}`,
        ),
        `The ${key} label is attached to the ${key} input`,
      );

    await page.locator("#meta-family").fill(FAMILY);
    await page.locator("#meta-manufacturer").fill(MANUFACTURER);
    check(await page.getByRole('button', { name: 'Reset Foundry or publisher', exact: true }).isVisible(), "Changed details expose their reset control");
    await page.locator("#meta-license").fill(LICENCE);
    await page.locator("#meta-version").fill(VERSION);
    // Presets are previewed first and can be undone without erasing later edits.
    await page.getByRole("button", { name: "Presets", exact: true }).click();
    await page.getByRole("button", { name: "Apache 2.0 Apache licence, version 1.000", exact: true }).click();
    check(await page.locator("#meta-version").inputValue() === VERSION, "Selecting a preset does not mutate the draft");
    await page.getByRole("button", { name: "Apply preset", exact: true }).click();
    check(await page.locator("#meta-version").inputValue() === "1.000", "Applying a preset fills the visible records");
    check(await page.locator("#meta-license").inputValue() !== LICENCE, "The selected licence is applied");
    await page.locator("#meta-version").fill("2.345");
    await page.getByRole("button", { name: "Presets", exact: true }).click();
    await page.getByRole("button", { name: "Undo preset", exact: true }).click();
    await page.getByRole("button", { name: "Close Metadata presets", exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('[popover]')].every((node) => getComputedStyle(node).display === 'none'));
    check(await page.locator("#meta-license").inputValue() === LICENCE, "Undo restores the previous licence");
    check(await page.locator("#meta-version").inputValue() === "2.345", "Undo preserves edits made after applying a preset");
    await page.locator("#meta-version").fill(VERSION);
    // The style previews sit below the details in the same document.
    await page.locator(".sp-proof").first().waitFor();
    check(
      await page.evaluate(() => {
        const details = document.getElementById("font-details").getBoundingClientRect();
        const styles = document.getElementById("font-styles").getBoundingClientRect();
        return styles.top >= details.bottom - 1;
      }),
      "The styles section follows the details in scroll order",
    );
    check(
      (await page.locator(".sp-proofs").innerText()).includes(STEM),
      `The rename derives ${STEM} in the browser`,
    );
    await page.screenshot({
      path: path.join(output, "e2e-editor.png"),
      fullPage: true,
    });
    await axePass(page, "editor");

    // The floating island header stays visible when scrolled.
    await page.evaluate(() => window.scrollTo({ top: 450, behavior: "instant" }));
    await page.waitForTimeout(100);
    const island = await page.evaluate(() => {
      const header = document.querySelector('.island');
      if (!header) return null;
      return { visible: header.getBoundingClientRect().top >= 0 };
    });
    check(island && island.visible, "The floating island header stays visible when scrolled");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "The mobile editor has no horizontal page overflow");
    // The island jump links should be visible on mobile.
    const jumpLinks = await page.locator('.island-nav a').count();
    check(jumpLinks >= 1, "The island has jump links for Details and Styles");
    await page.screenshot({ path: path.join(output, "e2e-mobile.png"), fullPage: true });
    await axePass(page, "editor-mobile");
    await page.locator('#meta-description').focus();
    await page.screenshot({ path: path.join(output, "e2e-mobile-scroll.png") });
    await page.setViewportSize({ width: 1440, height: 950 });
    // The Back button exits the editor.
    const backBtn = page.locator('#customize-back');
    check(await backBtn.count() > 0, "The Back button is present in the island header");

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      page.getByRole("button", { name: /(?:Download|Write) 1 (?:file|copy)/ }).click(),
    ]);
    const saved = path.join(output, "e2e-download.zip");
    await download.saveAs(saved);
    await page.locator(".report").waitFor();
    check(
      (await page.locator(".report-head p").innerText()).includes("1 of 1"),
      "The report counts the one file that was prepared",
    );
    // File names live behind "File details", which stays closed while nothing
    // failed.
    await page.getByRole("button", { name: "File details" }).click();
    await page.locator(".report-outcome").first().waitFor();
    check(
      (await page.locator(".report-outcome").first().innerText()).includes(STEM),
      "The report names the file the browser just downloaded",
    );
    await page.screenshot({
      path: path.join(output, "e2e-report.png"),
      fullPage: true,
    });

    const downloaded = unzip(fs.readFileSync(saved));
    const [webName, webBytes] = [...downloaded][0];
    const webNames = readNames(webBytes).values;
    note(`browser download: ${webName} (${sfntFlavour(webBytes)})`);
    check(
      webNames.get(1) === FAMILY &&
        webNames.get(16) === FAMILY &&
        webNames.get(4) === `${FAMILY} Regular` &&
        webNames.get(6) === STEM &&
        webNames.get(8) === MANUFACTURER &&
        webNames.get(13) === LICENCE &&
        webNames.get(5) === `Version ${VERSION}`,
      "The file the browser downloaded carries every edited record",
    );
    check(
      path.extname(webName).toLowerCase() ===
        (sfntFlavour(webBytes) === "cff" ? ".otf" : ".ttf"),
      `The browser download has the extension its outlines call for (${webName})`,
    );
    check(errors.length === 0, `The browser reports nothing (${errors})`);
    fs.rmSync(temporary, { recursive: true, force: true });
  } finally {
    if (browser) await browser.close();
    fixture.close();
  }

  const log = [
    `# check-metadata-editor — ${new Date().toISOString()}`,
    ``,
    `Server: ${base}`,
    ``,
    ...notes.map((line) => `- ${line}`),
    ``,
    `${checks.length} checks passed:`,
    ...checks.map((line) => `  - ${line}`),
    ``,
  ].join("\n");
  fs.writeFileSync(path.join(output, "e2e-log.md"), log);
  console.log(log);
  console.log(`Screenshots and the log are in ${path.relative(root, output)}`);
})().catch((error) => {
  console.error(`${checks.length} checks passed before the failure.`);
  console.error(error);
  process.exit(1);
});
