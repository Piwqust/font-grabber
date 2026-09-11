// Run against a freshly built Fount: node scripts/check-family-workflow.cjs [base URL]
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output", "family-workflow");
fs.mkdirSync(output, { recursive: true });
const base = process.argv[2] || "http://127.0.0.1:8787";
const checks = [];
function check(value, label) {
  assert.ok(value, label);
  checks.push(label);
}
const source = fs.readFileSync(path.join(root, "core/src/web/app.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source.slice(0, source.indexOf("let visibleCount")), context);
const grouped = vm.runInContext(
  `familyGroups([
{id:'1',family:' Test ',weight:'400',style:'normal'},
{id:'2',family:'test',weight:'700',style:'normal'},
{id:'3',family:'Test Display',weight:'400',style:'normal'},
{id:'4',family:'',weight:'400',style:'normal'},
{id:'5',family:'',weight:'400',style:'normal'}])`,
  context,
);
check(
  grouped.length === 4 && grouped[0].fonts.length === 2,
  "Conservative family grouping and separate unnamed faces",
);
let repaired = false;
const fixture = http.createServer((req, res) => {
  const routes = {
    "/regular.woff2": "geist-400.woff2",
    "/bold.woff2": "geist-600.woff2",
    "/missing.woff2": "geist-800.woff2",
  };
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html");
    return res.end(`<style>
    @font-face{font-family:Test Family;src:url('/regular.woff2');font-weight:400}
    @font-face{font-family:Test Family;src:url('/bold.woff2');font-weight:700}
    @font-face{font-family:Missing;src:url('/missing.woff2');font-weight:400}
    @font-face{font-family:Broken;src:url('/broken.ttf');font-weight:400}
    </style><h1>Font workflow fixture</h1>`);
  }
  if (req.url === "/broken.ttf") {
    res.setHeader("Content-Type", "font/ttf");
    const broken = Buffer.alloc(128);
    broken[1] = 1;
    return res.end(broken);
  }
  if (routes[req.url] && (req.url !== "/missing.woff2" || repaired)) {
    res.setHeader("Content-Type", "font/woff2");
    return res.end(
      fs.readFileSync(path.join(root, "core/src/web/assets", routes[req.url])),
    );
  }
  res.writeHead(404);
  res.end("Missing");
});
async function post(endpoint, body) {
  const res = await fetch(base + endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  assert.ok(res.ok, JSON.stringify(data));
  return data;
}
(async () => {
  await new Promise((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  let browser;
  try {
    const streamed = await fetch(base + "/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, mode: "static", stream: true }),
    });
    const events = (await streamed.text()).trim().split("\n").map(JSON.parse);
    check(
      events[0].stage === "page_source" &&
        events.some((e) => e.stage === "organizing"),
      "Real structured scan stages",
    );
    const report = events.find((e) => e.type === "result").report;
    check(
      report.fonts.length === 4,
      "Real fixture discovery finds all four faces",
    );
    const ids = report.fonts.map((f) => f.id);
    const exported = await post("/api/export", {
      url,
      mode: "static",
      ids,
      delivery: "zip",
    });
    check(
      exported.saved_count === 2 && exported.requested_count === 4,
      "Partial export reports exact success count",
    );
    check(
      exported.results.some(
        (r) => r.stage === "download" && r.status === "error",
      ) &&
        exported.results.some(
          (r) => r.stage === "conversion" && r.status === "error",
        ),
      "Download and conversion failures keep their IDs",
    );
    const archive = await fetch(base + exported.download_url);
    check(
      archive.ok && archive.headers.get("Content-Type").includes("zip"),
      "Prepared archive downloads",
    );
    fs.writeFileSync(
      path.join(output, "partial.zip"),
      Buffer.from(await archive.arrayBuffer()),
    );
    check(
      (await fetch(base + "/api/export/expired-test")).status === 410,
      "Missing or expired archive has a recoverable response",
    );
    repaired = true;
    const missing = report.fonts.find((f) => f.family === "Missing");
    const retry = await post("/api/export", {
      url,
      mode: "static",
      ids: [missing.id],
      delivery: "zip",
    });
    check(
      retry.saved_count === 1 && retry.results.length === 1,
      "Retry exports only the requested failed file",
    );
    const healthy = report.fonts
      .filter((f) => f.family === "Test Family")
      .map((f) => f.id);
    const folder = path.join(output, "saved");
    const saved = await post("/api/export", {
      url,
      mode: "static",
      ids: healthy,
      delivery: "folder",
      output_dir: folder,
    });
    check(
      saved.saved_count === 2 &&
        saved.results.every((r) => fs.statSync(r.file).size > 100),
      "Real folder export produces font files",
    );
    const bytes = fs.readFileSync(saved.results[0].file);
    const repeated = await post("/api/export", {
      url,
      mode: "static",
      ids: healthy,
      delivery: "folder",
      output_dir: folder,
    });
    check(
      repeated.results[0].file !== saved.results[0].file &&
        bytes.equals(fs.readFileSync(saved.results[0].file)),
      "Repeated folder export preserves existing files",
    );
    const denied = await post("/api/export", {
      url,
      mode: "static",
      ids: healthy,
      delivery: "folder",
      output_dir: saved.results[0].file,
    });
    check(
      denied.saved_count === 0 &&
        denied.results.every(
          (r) => r.stage === "write" && r.status === "error",
        ),
      "Write failures are reported per file",
    );
    const coverage = await post("/api/coverage", {
      url,
      mode: "static",
      ids: healthy,
      text: "Hello Жя",
    });
    check(
      coverage.results.every((r) => !r.error && r.missing.includes("Ж")),
      "Coverage checks the actual Latin subsets",
    );
    const badCoverage = await post("/api/coverage", {
      url,
      mode: "static",
      ids: [report.fonts.find((f) => f.family === "Broken").id],
      text: "A",
    });
    check(
      !!badCoverage.results[0].error,
      "Corrupted font coverage is an error, not unsupported text",
    );
    const legacy = await fetch(base + "/api/grab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        mode: "static",
        ids: healthy,
        delivery: "zip",
      }),
    });
    check(
      legacy.ok && legacy.headers.get("Content-Type").includes("zip"),
      "Existing direct ZIP API remains compatible",
    );
    browser = await chromium.launch({ headless: true });
    const uiContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    });
    const page = await uiContext.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.screenshot({ path: path.join(output, "start-desktop.png") });
    await page.locator("#url").fill(url);
    await page.locator("#mode").selectOption("static");
    await page.locator("#scan-btn").click();
    await page.waitForFunction(
      () =>
        !document.querySelector("#scan-btn").disabled &&
        document.querySelectorAll(".family-group").length === 3,
    );
    const family = page.locator(".family-group").filter({
      has: page.locator(".family-name", { hasText: "Test Family" }),
    });
    check(
      await page
        .locator("#font-list")
        .evaluate((e) => e.classList.contains("list-layout")),
      "Compact list is the default",
    );
    await page.locator("#select-all").click();
    const partialDownload = page.waitForEvent("download");
    await page.locator("#grab-btn").click();
    await partialDownload;
    await page.waitForFunction(
      () => !document.querySelector("#grab-btn").disabled,
    );
    check(
      (await page.locator("#export-summary").innerText()).includes("3 of 4"),
      "UI shows partial ZIP success",
    );
    const retryResponse = page.waitForResponse((r) =>
      r.url().endsWith("/api/export"),
    );
    await page.locator("#retry-failed").click();
    const retried = await retryResponse;
    check(
      retried.request().postDataJSON().ids.length === 1,
      "UI retry sends only the failed ID",
    );
    await page.waitForFunction(
      () => !document.querySelector("#grab-btn").disabled,
    );
    check(
      (await page.locator("#export-summary").innerText()).includes("0 of 1"),
      "UI shows total failure without claiming a download",
    );
    await page.locator("#select-none").click();
    await family.locator(".family-toggle").click();
    check(
      (await family.locator(".font-card").count()) === 2,
      "Family disclosure shows individual faces",
    );
    await family.locator(".pick input").first().check();
    check(
      await family.locator(".group-pick").evaluate((e) => e.indeterminate),
      "Partial family selection is visible",
    );
    await page.locator("#layout-grid").click();
    check(
      await family.locator(".pick input").first().isChecked(),
      "Switching layout preserves selection",
    );
    await page.locator("#filter").fill("bold");
    await page.waitForFunction(
      () => document.querySelectorAll(".font-card").length === 1,
    );
    await page.locator("#select-all").click();
    await page.locator("#filter").fill("");
    await page.waitForFunction(
      () => document.querySelectorAll(".family-group").length === 3,
    );
    check(
      (await page.locator("#selection-tab-count").innerText()) === "2",
      "Search selection adds matching faces only",
    );
    await page.locator("#sample").fill("Hello Жя");
    await page.locator("#check-text").click();
    await page.waitForFunction(() =>
      document
        .querySelector("#coverage-status")
        .textContent.startsWith("Checked"),
    );
    check(
      (await page.locator("#coverage-items").innerText()).includes("Missing:"),
      "Character results appear in the UI",
    );
    await page.reload();
    await page.locator(".family-group").first().waitFor();
    check(
      (await page.locator("#layout-grid").getAttribute("aria-pressed")) ===
        "true" &&
        (await page.locator("#selection-tab-count").innerText()) === "2",
      "Reload preserves layout and selection",
    );
    await page.locator("#layout-list").click();
    await page.locator("#grab-btn").click();
    const download = await page.waitForEvent("download");
    await download.saveAs(path.join(output, "browser.zip"));
    await page.waitForFunction(
      () => !document.querySelector("#grab-btn").disabled,
    );
    check(
      (await page.locator("#grab-status").innerText()).includes("2 of 2"),
      "Browser export reports the prepared files",
    );
    await page.locator("#save-settings").click();
    await page.locator("#delivery").selectOption("folder");
    await page.locator("#output-dir").fill(path.join(output, "browser-folder"));
    await page.keyboard.press("Escape");
    check(
      (await page.evaluate(() => document.activeElement.id)) ===
        "save-settings",
      "Download settings restore keyboard focus",
    );
    await page.locator("#grab-btn").click();
    await page.waitForFunction(() =>
      document.querySelector("#grab-status").textContent.startsWith("Saved 2"),
    );
    check(true, "Browser folder export succeeds");
    await page.locator("#select-none").click();
    await page.locator("#undo-selection").click();
    check(
      (await page.locator("#selection-tab-count").innerText()) === "2",
      "Undo restores selection across families",
    );
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `No horizontal overflow at ${width}px`,
      );
      if (width <= 390)
        check(
          (await page.locator("#grab-tools").boundingBox()).height < 120,
          `Compact mobile download bar at ${width}px`,
        );
      await page.locator("#save-settings").click();
      const box = await page.locator("#save-popover").boundingBox();
      check(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= 900,
        `Settings fit at ${width}px`,
      );
      await page.keyboard.press("Escape");
      await page.screenshot({
        path: path.join(output, `catalog-${width}.png`),
      });
    }
    const historyPage = await page.context().newPage();
    await historyPage.goto(base);
    await historyPage.locator("#recent-sites > summary").click();
    check(
      (await historyPage.locator("#history-list").innerText()).includes(url),
      "History is available in a new tab without a collection",
    );
    await historyPage.locator(".history-pick").first().click();
    check(
      (await historyPage.locator("#url").inputValue()) === url &&
        !(await historyPage.locator("#results").isVisible()),
      "History fills the address without starting a scan",
    );
    await historyPage.locator("#clear-history").click();
    check(
      !(await historyPage.locator("#recent-sites").isVisible()),
      "History can be cleared",
    );
    await historyPage.close();

    // Deliberate UI-only fixtures cover large catalogues without downloading 1000 fonts.
    const largeFonts = Array.from({ length: 1050 }, (_, i) => ({
      id: "large-" + i,
      family: i < 90 ? "Large Family" : "Family " + i,
      weight: i === 0 ? "100 900" : String(100 + (i % 9) * 100),
      style: "normal",
      variable: i === 0,
      scripts: [],
      sources: [],
      unicode_range: i === 2 ? "U+400-4FF" : null,
    }));
    await page.route("**/api/scan", (route) =>
      route.fulfill({
        json: { fonts: largeFonts, warnings: [], used_browser: false },
      }),
    );
    await page.locator("#scan-btn").click();
    await page.waitForFunction(() =>
      document.querySelector("#masthead-count").textContent.includes("1050"),
    );
    check(
      (await page.locator(".family-group").count()) === 40,
      "Large catalog renders only the first 40 families",
    );
    await page.locator("#load-more").click();
    check(
      (await page.locator(".family-group").count()) === 80,
      "More families are loaded in a bounded batch",
    );
    check(
      await page.evaluate(() =>
        document.activeElement.classList.contains("family-toggle"),
      ),
      "Loading families moves keyboard focus into new results",
    );
    const largeFamily = page.locator(".family-group").filter({
      has: page.locator(".family-name", { hasText: "Large Family" }),
    });
    await largeFamily.locator(".family-toggle").click();
    check(
      (await largeFamily.locator(".font-card").count()) === 40,
      "Large family faces are also paginated",
    );
    await largeFamily.locator(".more-faces").click();
    check(
      (await largeFamily.locator(".font-card").count()) === 80,
      "Next face batch is displayed",
    );
    await largeFamily.locator(".select-variable").click();
    check(
      (await page.locator("#selection-tab-count").innerText()) === "1",
      "Variable-only selection selects the variable face",
    );
    await page.locator("#view-selected").click();
    check(
      (await page.locator(".font-card").count()) === 1,
      "Selected view preserves the family structure",
    );
    await page.locator(".pick input").focus();
    await page.keyboard.press("Space");
    check(
      await page.locator("#reset-filter").isVisible(),
      "Removing the last selected face shows a recovery action",
    );
    await page.unroute("**/api/scan");
    await page.route("**/api/scan", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route
        .fulfill({ status: 503, json: { error: "Controlled failure" } })
        .catch(() => {});
    });
    await page.locator("#scan-btn").click();
    await page.locator("#cancel-scan").click();
    await page.waitForFunction(
      () => !document.querySelector("#scan-btn").disabled,
    );
    check(
      (await page.locator("#scan-status").innerText()).includes(
        "Stopped waiting",
      ),
      "Stopping the wait keeps the current collection",
    );
    await page.locator("#scan-btn").click();
    await page.waitForFunction(
      () => !document.querySelector("#scan-btn").disabled,
    );
    check(
      (await page.locator("#retry-scan").isVisible()) &&
        (await page.locator("#extension-help").isVisible()),
      "Scan errors expose retry and extension guidance",
    );
    await page.unroute("**/api/scan");

    const axePath = path.join(root, "output/playwright/ux-service/axe.min.js");
    if (fs.existsSync(axePath)) {
      await page.addScriptTag({ path: axePath });
      const violations = await page.evaluate(async () =>
        (
          await axe.run(document, {
            runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] },
          })
        ).violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      );
      fs.writeFileSync(
        path.join(output, "accessibility.json"),
        JSON.stringify(violations, null, 2),
      );
      check(
        violations.length === 0,
        "Automated accessibility checks: " + JSON.stringify(violations),
      );
    }
    const noStorage = await browser.newContext();
    await noStorage.addInitScript(() => {
      Storage.prototype.getItem = () => {
        throw new Error("Storage disabled");
      };
      Storage.prototype.setItem = () => {
        throw new Error("Storage disabled");
      };
    });
    const noStoragePage = await noStorage.newPage();
    await noStoragePage.goto(base);
    await noStoragePage.locator("#try-demo").click();
    await noStoragePage.locator(".family-group").first().waitFor();
    check(
      (await noStoragePage.locator(".family-group").count()) > 0,
      "Scanning remains usable when browser storage is unavailable",
    );
    await noStorage.close();
    check(
      errors.length === 0,
      `No browser JavaScript errors: ${errors.join(", ")}`,
    );
    await browser.close();
    browser = null;
    fs.writeFileSync(
      path.join(output, "checks.json"),
      JSON.stringify(checks, null, 2),
    );
    console.log(`${checks.length} checks passed. Artifacts: ${output}`);
  } finally {
    if (browser) await browser.close();
    fixture.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
