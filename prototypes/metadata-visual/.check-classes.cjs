// Development helper: reports class names used in a direction's JSX but never
// styled, and rules in its stylesheet that no longer match any markup.
const fs = require("node:fs");
const path = require("node:path");

const dir = __dirname;
const pairs = [
  ["directions/Console.jsx", "styles/console.css", "cn"],
  ["directions/Specimen.jsx", "styles/specimen.css", "sp"],
  ["directions/Studio.jsx", "styles/studio.css", "st"],
  ["directions/Sheet.jsx", "styles/sheet.css", "sh"],
];

let problems = 0;
for (const [jsxFile, cssFile, prefix] of pairs) {
  const jsx = fs.readFileSync(path.join(dir, jsxFile), "utf8");
  const css = fs.readFileSync(path.join(dir, cssFile), "utf8");

  const used = new Set();
  for (const match of jsx.matchAll(/class=(?:"([^"]*)"|\{"([^"]*)")/g)) {
    const value = match[1] || match[2] || "";
    for (const name of value.split(/\s+/))
      if (name.startsWith(prefix + "-")) used.add(name);
  }

  const styled = new Set();
  for (const match of css.matchAll(/\.([a-z0-9-]+)/g))
    if (match[1].startsWith(prefix + "-")) styled.add(match[1]);

  const unstyled = [...used].filter((name) => !styled.has(name));
  const dead = [...styled].filter((name) => !used.has(name));

  console.log("== " + prefix + " ==");
  if (unstyled.length) {
    problems += unstyled.length;
    console.log("  in JSX, no CSS: " + unstyled.join(", "));
  }
  if (dead.length) console.log("  in CSS, no JSX: " + dead.join(", "));
  if (!unstyled.length && !dead.length) console.log("  matched");
}
process.exit(problems ? 1 : 0);
