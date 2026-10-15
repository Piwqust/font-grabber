// Real HTTPS browser/API check. Supply a running hosted instance behind Caddy.
// FOUNT_QA_URL=https://... FOUNT_QA_PASSWORD=... node scripts/check-hosted.cjs
// FOUNT_QA_SELF_SIGNED=1 is allowed only for localhost test certificates.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const base = process.env.FOUNT_QA_URL || "https://localhost:8443";
const password = process.env.FOUNT_QA_PASSWORD;
assert(password, "Set FOUNT_QA_PASSWORD in the test process environment");
const local = new URL(base).hostname === "localhost";
const out = path.resolve("output/hosted-preparation/browser");
fs.mkdirSync(out, { recursive: true });
const checks = [];
function check(value, label) { assert(value, label); checks.push(label); }

(async () => {
  const browser = await chromium.launch({ headless: true });
  let activePage;
  const network = [];
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: local && process.env.FOUNT_QA_SELF_SIGNED === "1", viewport: { width: 1440, height: 950 } });
    const page = await context.newPage();
    activePage = page;
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/api/")) network.push({ path: url.pathname, status: response.status() });
    });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    await page.locator("#fount-password").waitFor();
    check(await page.locator("#url, #metadata-files").count() === 0, "URL and uploads are absent before login");
    await page.screenshot({ path: path.join(out, "login-desktop.png") });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Login fits ${width}px`);
    }
    await page.screenshot({ path: path.join(out, "login-mobile.png") });
    for (const [method, endpoint] of [["POST","/api/scan"],["POST","/api/grab"],["POST","/api/export"],["POST","/api/coverage"],
      ["POST","/api/metadata/inspect"],["POST","/api/metadata/apply"],["GET","/api/export/guess"],["GET","/api/font?url=https://example.com/f.woff2"]]) {
      const response = await context.request.fetch(base + endpoint, { method, headers: { Origin: base }, data: {} });
      check(response.status() === 401, `Anonymous ${endpoint} is denied`);
    }
    await page.locator("#fount-password").fill("wrong-test-password");
    await page.locator("#fount-password").press("Enter");
    await page.getByText("Incorrect password. Try again.").waitFor();
    check(await page.locator("#fount-password").inputValue() === "", "Password input is cleared after submission");
    await page.locator("#fount-password").fill(password);
    await page.locator("#fount-password").press("Tab");
    check(await page.evaluate(() => document.activeElement?.textContent === "Sign in"), "Tab reaches the sign-in button");
    await page.keyboard.press("Enter");
    await page.locator("#url").waitFor();
    await page.waitForFunction(() => document.activeElement?.id === "url");
    check(await page.evaluate(() => document.activeElement?.id === "url"), "Successful login focuses the URL field");
    const session = (await context.cookies()).find(cookie => cookie.name === "__Host-fount_session");
    check(session?.secure && session.httpOnly && session.sameSite === "Strict", "Cookie has Secure, HttpOnly and SameSite=Strict");
    check(session.expires > Date.now()/1000 + 43100, "Cookie lives for 12 hours");
    check(!(await page.evaluate(() => document.cookie)).includes("fount_session"), "Session token is invisible to JavaScript");
    check(!JSON.stringify(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).includes(password), "Password is absent from browser storage");
    await page.reload();
    await page.locator("#url").waitFor();
    check(await page.locator("#fount-password").count() === 0, "Reload keeps server session");
    const denied = await context.request.post(base + "/api/scan", { headers: { Origin: "https://foreign.example" }, data: { url: "https://example.com" } });
    check(denied.status() === 403, "Cross-origin operation is denied");
    const privateScan = await context.request.post(base + "/api/scan", { headers: { Origin: base }, data: { url: "http://127.0.0.1/" } });
    check(privateScan.status() === 400, "Private target is denied after authentication");
    await page.setViewportSize({ width: 1440, height: 950 });
    await page.getByRole("button", { name: "Customize font", exact: true }).click();
    await page.locator("#metadata-files").setInputFiles(path.resolve("core/src/web/assets/geist-400.woff2"));
    await page.locator("#meta-family").waitFor();
    await page.locator("#meta-family").fill("Hosted Browser QA");
    await page.screenshot({ path: path.join(out, "hosted-metadata.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Authenticated metadata fits mobile viewport");
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#metadata-apply").click()]);
    const zipPath = path.join(out, "hosted-metadata.zip");
    await download.saveAs(zipPath);
    const zip = fs.readFileSync(zipPath);
    check(zip.length > 100 && zip.readUInt32LE() === 0x04034b50, "Authenticated browser downloads a real ZIP");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.locator("#fount-password").waitFor();
    check(await page.evaluate(() => !sessionStorage.getItem("fount-metadata-v1") && !sessionStorage.getItem("fount-web-session-v2")), "Logout clears sensitive tab state");
    check(!(await context.cookies()).some(c => c.name === "__Host-fount_session"), "Logout removes server cookie");
    await page.locator("#fount-password").fill(password);
    await page.locator("#fount-password").press("Enter");
    await page.locator("#url").waitFor();
    // Invalidate the real session on the server while keeping the app mounted.
    await context.request.post(base + "/api/auth/logout", { headers: { Origin: base } });
    await page.getByRole("button", { name: "Customize font", exact: true }).click();
    await page.locator("#metadata-files").setInputFiles(path.resolve("core/src/web/assets/geist-400.woff2"));
    await page.locator("#fount-password").waitFor();
    await page.getByText("Your session ended. Sign in again.").waitFor();
    check(true, "401 during upload returns to the login gate");
    check(errors.length === 0, `No browser exceptions: ${errors.join("; ")}`);
    fs.writeFileSync(path.join(out, "checks.json"), JSON.stringify({ base, checks }, null, 2));
    console.log(`${checks.length} hosted checks passed`);
  } catch (error) {
    if (activePage) {
      await activePage.screenshot({ path: path.join(out, "failure.png") });
      fs.writeFileSync(path.join(out, "failure.json"), JSON.stringify({ network, text: await activePage.locator("body").innerText() }, null, 2));
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(`${checks.length} checks passed before failure`, error); process.exit(1); });
