// Real Grilli Type scan and export through Fount's catalogue.
// Usage: node scripts/check-catalogue.cjs http://127.0.0.1:8797
// --source-ui tests a rebuilt UI against an existing binary during development.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const base = process.argv[2] || "http://127.0.0.1:8797";
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output", "catalogue");
fs.mkdirSync(output, { recursive: true });
const source = "https://www.grillitype.com/typeface/gt-mechanik";
const checks = [];
function check(value, label) { assert.ok(value, label); checks.push(label); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (process.argv.includes("--source-ui")) {
      await page.route("**/app.js", (route) => route.fulfill({
        path: path.join(root, "core/src/web/assets/app.js"), contentType: "application/javascript",
      }));
      await page.route("**/style.css", (route) => route.fulfill({
        path: path.join(root, "core/src/web/style.css"), contentType: "text/css",
      }));
    }
    await page.goto(base);
    await page.getByLabel("Website address", { exact: true }).fill(source);
    await page.getByRole("button", { name: "Scan method: Auto", exact: true }).click();
    await page.getByRole("option", { name: /Quick/ }).click();
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/scan")),
      page.locator(".scan-form").getByRole("button", { name: "Find fonts", exact: true }).click(),
    ]);
    // Start reading the streamed body now; DevTools can drop it once the UI moves on.
    const body = response.text();
    await page.getByLabel("Search fonts", { exact: true }).waitFor({ timeout: 90000 });
    await page.getByLabel("Search fonts", { exact: true }).fill("GT Mechanik");
    await page.waitForFunction(() => document.querySelectorAll(".family").length === 3);
    check(await page.locator(".family-name").allTextContents().then((names) =>
      JSON.stringify(names.slice().sort()) === JSON.stringify(["GT Mechanik Mono", "GT Mechanik Poly", "GT Mechanik Semi"])),
      "A fresh real scan groups all 42 faces into Mono, Semi and Poly");
    const events = (await body).trim().split("\n").map((line) => JSON.parse(line));
    const report = events.find((event) => event.type === "result").report;
    fs.writeFileSync(path.join(output, "scan.json"), JSON.stringify(report, null, 2));
    check(report.fonts.filter((f) => /mechanik/i.test(f.family)).length === 42,
      "The server supplied all 42 original Mechanik identities");

    const mono = page.locator(".family").filter({ has: page.locator(".family-name", { hasText: "GT Mechanik Mono" }) });
    await mono.locator(".family-toggle").click();
    const expected = ["Thin", "Light", "Regular", "Medium", "Bold", "Heavy", "Black"]
      .flatMap((w) => [w, `${w} Oblique`]);
    assert.deepEqual(await mono.locator(".face-style").allTextContents(), expected);
    checks.push("Weights and obliques are labelled correctly and ordered from Thin to Black");
    await mono.getByRole("checkbox", { name: "Select matching faces in GT Mechanik Mono", exact: true }).check();
    check(await page.locator(".selection-file").count() === 14, "The family checkbox selects exactly 14 Mono faces");
    check((await page.locator(".selection-file-name").allTextContents()).every((name) =>
      name.startsWith("GT Mechanik Mono ")), "The selection uses readable family and style names");
    await mono.getByRole("checkbox", { name: "Select matching faces in GT Mechanik Mono", exact: true }).uncheck();

    await page.getByLabel("Search fonts", { exact: true }).fill("GT Mechanik Semi Bold");
    await page.waitForFunction(() => document.querySelectorAll(".family").length === 1);
    const semi = page.locator(".family");
    check((await semi.locator(".family-meta").innerText()).includes("2 faces of 14"),
      "A combined family/style query finds both Bold faces within the 14-face Semi family");
    await semi.getByRole("checkbox", { name: "Select matching faces in GT Mechanik Semi", exact: true }).check();
    check(await page.locator(".selection-file").count() === 2, "Filtered family selection picks only the two visible matches");
    await semi.getByRole("checkbox", { name: "Select matching faces in GT Mechanik Semi", exact: true }).uncheck();

    const [request, download] = await Promise.all([
      page.waitForRequest((r) => r.url().endsWith("/api/export")),
      page.waitForEvent("download", { timeout: 90000 }),
      semi.getByRole("button", { name: "Download all 14 files in GT Mechanik Semi", exact: true }).click(),
    ]);
    const payload = request.postDataJSON();
    check(payload.ids.length === 14 && payload.ids.every((id) =>
      report.fonts.some((f) => f.id === id && /GT-Mechanik-Semi-/.test(f.family))),
      "Download family sends every original Semi ID, including faces hidden by the filter");
    await download.saveAs(path.join(output, "mechanik-semi.zip"));
    check(!await download.failure(), "The real converter returns a downloadable family ZIP");

    await page.getByLabel("Search fonts", { exact: true }).fill("GT Mechanik");
    await page.waitForFunction(() => document.querySelectorAll(".family").length === 3);
    await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "The grouped catalogue has no horizontal overflow at 390px");
    await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
    await page.waitForFunction(() => sessionStorage.getItem("fount-web-session-v2")?.includes('"GT Mechanik"'));
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll(".family").length === 3);
    check(await page.locator(".family-name").allTextContents().then((names) => names.every((name) => name.startsWith("GT Mechanik "))),
      "Reloading a saved scan preserves grouping and the active search");
    check(await page.evaluate(() =>
      document.documentElement.scrollHeight <= Math.max(innerHeight,
        document.querySelector("footer").getBoundingClientRect().bottom + scrollY) + 2),
      "Collapsed families do not leave an empty scroll area below the footer");
    await page.screenshot({ path: path.join(output, "collapsed-mobile.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.screenshot({ path: path.join(output, "collapsed-desktop.png"), fullPage: true });
    check(errors.length === 0, `No browser JavaScript errors: ${errors.join(", ")}`);
    const log = checks.map((label) => `- ${label}`).join("\n") + "\n";
    fs.writeFileSync(path.join(output, "checks.md"), log);
    console.log(`${checks.length} catalogue checks passed.\n${log}`);
  } finally { await browser.close(); }
})().catch((error) => {
  console.error(`${checks.length} checks passed before failure.`, error);
  process.exitCode = 1;
});
