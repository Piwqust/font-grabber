// Rendered acceptance checks for the supplied Fount references.
// node scripts/check-reference-redesign.cjs [base URL]
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "output", "reference-redesign");
const base = process.argv[2] || "http://127.0.0.1:8787";
const axePath = path.join(root, "output/playwright/ux-service/axe.min.js");
const checks = [];
const errors = [];
function check(value, description) {
  assert.ok(value, description);
  checks.push(description);
}
async function accessibility(page, name) {
  assert.ok(fs.existsSync(axePath), "Local Axe source is available");
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
    path.join(output, `axe-${name}.json`),
    JSON.stringify(violations, null, 2),
  );
  check(
    !violations.length,
    `${name}: zero Axe violations ${JSON.stringify(violations)}`,
  );
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1505, height: 1045 },
      acceptDownloads: true,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(900);
    check(
      (await page.title()).startsWith("Fount"),
      "Correct local application",
    );
    check(
      await page.locator(".product-tabs [aria-disabled=true]").isVisible(),
      "Metadata position remains explicitly unavailable",
    );
    const ids = await page
      .locator("[id]")
      .evaluateAll((nodes) => nodes.map((n) => n.id));
    check(new Set(ids).size === ids.length, "Unique element IDs");
    check(
      (await page.locator(".floating-card").count()) === 4,
      "Four independent example objects",
    );
    await page.screenshot({
      path: path.join(output, "home-desktop.png"),
      fullPage: true,
    });
    await accessibility(page, "home-desktop");
    await page.locator(".open-app").click();
    check(
      await page.locator("#url").evaluate((e) => e === document.activeElement),
      "Open app focuses the website field",
    );
    await page
      .locator('.example-sites [data-example="https://vercel.com"]')
      .click();
    check(
      (await page.locator("#url").inputValue()) === "https://vercel.com",
      "Example fills the real scan input",
    );
    await page.locator("[data-mode=render]").click();
    check(
      (await page.locator("#mode").inputValue()) === "render",
      "Browser segment changes the actual scan mode",
    );
    await page.locator("[data-mode=auto]").click();
    const card = page.locator(".browser-card");
    const glyph = card.locator(".floating-glyph");
    await card.focus();
    const before = await glyph.innerText();
    await page.keyboard.press("Enter");
    check(
      (await glyph.innerText()) !== before,
      "Example card has a keyboard alternative",
    );
    await page.mouse.move(800, 760);
    await page.waitForTimeout(450);
    const rect = await card.boundingBox();
    const valueBeforeDrag = await glyph.innerText();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      rect.x + rect.width / 2 + 140,
      rect.y + rect.height / 2 + 110,
      { steps: 10 },
    );
    check(
      await card.evaluate((e) => {
        const m = new DOMMatrix(getComputedStyle(e).transform);
        return (
          e.classList.contains("dragging") &&
          Math.abs(m.e) <= 35 &&
          Math.abs(m.f) <= 56 &&
          Math.abs(m.e) > 5
        );
      }),
      "Pointer dragging is bounded",
    );
    await page.mouse.up();
    await page.mouse.move(800, 760);
    await page.waitForTimeout(550);
    check(
      (await glyph.innerText()) === valueBeforeDrag,
      "Dragging does not accidentally activate the card",
    );
    check(
      await card.evaluate((e) => {
        const m = new DOMMatrix(getComputedStyle(e).transform);
        return Math.abs(m.e) < 1 && Math.abs(m.f) < 1;
      }),
      "Dragged card returns to its designed position",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await page.evaluate(() => document.fonts.ready);
    check(
      await page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "running")
            .length === 0,
      ),
      "Reduced motion suppresses entrance animations",
    );
    const reducedTransform = await card.evaluate(
      (e) => getComputedStyle(e).transform,
    );
    await card.hover();
    await page.waitForTimeout(250);
    check(
      (await card.evaluate((e) => getComputedStyle(e).transform)) ===
        reducedTransform,
      "Reduced motion suppresses pointer tilt",
    );
    const reducedGlyph = await glyph.innerText();
    await card.click();
    check(
      (await glyph.innerText()) !== reducedGlyph,
      "Reduced motion preserves click functionality",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const width of [320, 390, 640, 768, 1024, 1280, 1505]) {
      await page.setViewportSize({ width, height: 900 });
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `Home has no horizontal overflow at ${width}px`,
      );
      const input = await page.locator("#url").boundingBox();
      const button = await page.locator("#scan-btn").boundingBox();
      check(
        input.x + input.width <= button.x + 1,
        `Search input and action do not overlap at ${width}px`,
      );
      check(
        await page.evaluate(() => {
          const anchors = [
            ...document.querySelectorAll(
              "#page-title, #scan-form, .example-sites",
            ),
          ].map((e) => e.getBoundingClientRect());
          return [...document.querySelectorAll(".floating-card")]
            .filter((e) => e.getClientRects().length)
            .every((e) => {
              const box = e.getBoundingClientRect();
              return anchors.every(
                (a) =>
                  box.right <= a.left ||
                  box.left >= a.right ||
                  box.bottom <= a.top ||
                  box.top >= a.bottom,
              );
            });
        }),
        `Floating examples do not cover the heading or search at ${width}px`,
      );
      if ([390, 768, 1024].includes(width))
        await page.screenshot({
          path: path.join(output, `home-${width}.png`),
          fullPage: true,
        });
      if (width === 390) await accessibility(page, "home-mobile");
    }
    await page.locator("#try-demo").click();
    await page.locator(".family-group").first().waitFor();
    check(
      (await page
        .locator("[data-mode=static]")
        .getAttribute("aria-pressed")) === "true",
      "Demo synchronizes the visible Quick segment",
    );
    check(
      (await page.locator("#page-title").innerText()) ===
        `Fonts found on ${new URL(base).host}`,
      "Results headline uses the real scanned host",
    );
    check(
      await page.locator("#grab-tools").isVisible(),
      "Empty selection has a visible recovery panel",
    );
    check(
      await page.locator("#grab-btn").isDisabled(),
      "Empty selection cannot export",
    );
    const family = page
      .locator(".family-group")
      .filter({ has: page.locator(".family-name", { hasText: /^Geist$/ }) });
    await family.locator(".family-toggle").click();
    await family.locator(".pick input").nth(0).check();
    await family.locator(".pick input").nth(1).check();
    check(
      (await page.locator(".selected-file").count()) === 2,
      "Selected-file panel reflects actual face selection",
    );
    await page.locator(".remove-selected").first().click();
    check(
      (await page.locator(".selected-file").count()) === 1 &&
        !(await family.locator(".pick input").nth(0).isChecked()),
      "Removing a selected file updates its catalogue checkbox",
    );
    check(
      await page.evaluate(() =>
        document.activeElement.classList.contains("remove-selected"),
      ),
      "Removing a file preserves keyboard focus",
    );
    await family.locator(".pick input").nth(0).check();
    await page.screenshot({
      path: path.join(output, "results-desktop.png"),
      fullPage: true,
    });
    await accessibility(page, "results-desktop");
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#grab-btn").click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, "reference-selection.zip"));
    check(
      (await download.failure()) === null,
      "New selection panel downloads a real ZIP",
    );
    await page.locator("#grab-btn").isEnabled();
    for (const width of [320, 390, 640, 768, 1024, 1280, 1505]) {
      await page.setViewportSize({ width, height: 900 });
      check(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        `Results have no horizontal overflow at ${width}px`,
      );
      await page.locator("#save-settings").click();
      const box = await page.locator("#save-popover").boundingBox();
      check(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= 901,
        `Export settings fit at ${width}px`,
      );
      await page.keyboard.press("Escape");
      if (width === 390) {
        check(
          (await page.locator("#grab-tools").boundingBox()).height < 120,
          "Mobile export remains compact",
        );
        await page.screenshot({
          path: path.join(output, "results-mobile.png"),
          fullPage: true,
        });
        await accessibility(page, "results-mobile");
      }
    }
    await page.locator("#recent-sites summary").click();
    await page.locator(".history-pick").first().click();
    check(
      (await page
        .locator("[data-mode=static]")
        .getAttribute("aria-pressed")) === "true",
      "History synchronizes the visible mode",
    );
    await page.reload();
    check(
      (await page.locator(".selected-file").count()) === 2,
      "Selection panel survives reload",
    );
    check(
      (await page
        .locator("[data-mode=static]")
        .getAttribute("aria-pressed")) === "true",
      "Restored mode matches the visible segment",
    );
    await page.locator(".wordmark").click();
    check(
      (await page.locator("#getting-started").isVisible()) &&
        (await page.locator("#results").isHidden()),
      "Brand navigation returns to the home composition",
    );
    await page.locator("#try-demo").click();
    await page.locator(".family-group").first().waitFor();
    check(
      (await page.locator(".selected-file").count()) === 2,
      "Returning home preserves selection for a rescan of the same site",
    );
    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const touchPage = await touchContext.newPage();
    touchPage.on("pageerror", (error) => errors.push(error.message));
    await touchPage.goto(base);
    await touchPage.evaluate(() => document.fonts.ready);
    await touchPage.waitForTimeout(750);
    const touchCard = touchPage.locator(".browser-card");
    await touchCard.scrollIntoViewIfNeeded();
    const touchBox = await touchCard.boundingBox();
    const initialScroll = await touchPage.evaluate(() => scrollY);
    const session = await touchContext.newCDPSession(touchPage);
    const touchX = touchBox.x + touchBox.width / 2;
    const touchY = touchBox.y + touchBox.height / 2;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: touchX, y: touchY }],
    });
    for (let step = 1; step <= 6; step++) {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: touchX, y: touchY - step * 30 }],
      });
      await touchPage.waitForTimeout(18);
    }
    await session.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await touchPage.waitForTimeout(180);
    check(
      (await touchPage.evaluate(() => scrollY)) > initialScroll + 30,
      "Touch swiping over a specimen still scrolls the page",
    );
    check(
      !(await touchCard.evaluate((e) => e.classList.contains("dragging"))),
      "Cancelled touch drag leaves no stuck dragging state",
    );
    await touchContext.close();
    for (const name of ["fount-mark", "fount-mark-mono", "fount-logo"]) {
      const response = await context.request.get(`${base}/assets/${name}.svg`);
      const svg = await response.text();
      check(
        response.ok() &&
          !/<(?:image|text)\b/.test(svg) &&
          svg.includes("<path"),
        `${name} is served as a self-contained outlined vector`,
      );
    }
    const brand = await context.newPage();
    await brand.setViewportSize({ width: 1100, height: 850 });
    await brand.setContent(
      `<html><body style="margin:0;background:#faf9f6;font-family:Georgia"><main style="display:flex;align-items:center;justify-content:center;gap:90px;height:850px"><img src="${base}/assets/fount-logo.svg" width="390" height="495" alt="Fount logo"><div style="display:grid;gap:50px;text-align:center"><img src="${base}/assets/fount-mark.svg" width="190" height="190" alt="Color mark"><img src="${base}/assets/fount-mark-mono.svg" width="100" height="100" style="margin:auto" alt="Monochrome mark"><div>FOUNT · VECTOR MASTER</div></div></main></body></html>`,
    );
    await brand
      .locator("img")
      .evaluateAll(async (imgs) =>
        Promise.all(imgs.map((img) => img.decode())),
      );
    await brand.screenshot({ path: path.join(output, "brand-proof.png") });
    check(errors.length === 0, `No JavaScript errors: ${errors.join("; ")}`);
    fs.writeFileSync(
      path.join(output, "checks.json"),
      JSON.stringify(checks, null, 2),
    );
    console.log(
      `${checks.length} reference-redesign checks passed. Artifacts: ${output}`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
