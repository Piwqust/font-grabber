// Screenshots every direction at desktop and mobile, and reports console errors.
const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs");

const port = process.argv[2] || "8796";
const out = path.join(__dirname, "shots");
fs.mkdirSync(out, { recursive: true });
const directions = ["console", "specimen", "studio", "sheet"];

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  for (const size of [
    { name: "desktop", width: 1440, height: 950 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(size.name + " console: " + message.text());
    });
    page.on("pageerror", (error) => problems.push(size.name + " pageerror: " + error.message));

    for (const direction of directions) {
      await page.goto("http://127.0.0.1:" + port + "/?d=" + direction, {
        waitUntil: "networkidle",
      });
      await page.waitForSelector(".pf-write", { timeout: 20000 });
      await page.waitForTimeout(700);
      await page.screenshot({
        path: path.join(out, direction + "-" + size.name + ".png"),
        fullPage: size.name === "mobile" ? false : false,
      });
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        return { scrollW: doc.scrollWidth, clientW: doc.clientWidth };
      });
      if (overflow.scrollW > overflow.clientW + 2)
        problems.push(
          direction + " " + size.name + " overflows: " + overflow.scrollW + " > " + overflow.clientW,
        );
    }
    await context.close();
  }
  await browser.close();
  console.log(problems.length ? "PROBLEMS\n" + problems.join("\n") : "NO PROBLEMS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
