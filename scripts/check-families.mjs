// Regression checks for catalogue aliases, independent of a foundry's network.
// Run: node scripts/check-families.mjs
import assert from "node:assert/strict";
import {
  collectionLabel, faceStyle, faceWeight, familyGroups, familyKey,
  matchesFilter, prepareCatalogFonts, styleLabel,
} from "../core/src/web/src/lib/fonts.js";

function face(family, extra = {}) {
  return { id: family, family, weight: "400", style: "normal",
    sources: [{ url: `https://example.com/${family}.woff2`, format: "woff2" }],
    ...extra };
}

// Real Grilli Type CSS pattern: every face declares 400/normal.
const weights = ["Thin", "Light", "Regular", "Medium", "Bold", "Heavy", "Black"];
const original = ["Mono", "Semi", "Poly"].flatMap((subfamily) =>
  weights.flatMap((weight) => ["", "-Oblique"].map((slant) =>
    face(`GT-Mechanik-${subfamily}-${weight}${slant}`))),
);
const fonts = prepareCatalogFonts(original.slice().reverse());
const groups = familyGroups(fonts);
assert.equal(groups.length, 3);
assert.equal(collectionLabel(fonts), "3 families · 42 faces");
for (const subfamily of ["Mono", "Semi", "Poly"]) {
  const group = groups.find((g) => g.name === `GT Mechanik ${subfamily}`);
  assert.equal(group.fonts.length, 14);
  assert.deepEqual(group.fonts.map(styleLabel), weights.flatMap((w) => [w, `${w} Oblique`]));
  assert.deepEqual(group.fonts.map(faceWeight), [100,100,300,300,400,400,500,500,700,700,800,800,900,900]);
  const representative = group.fonts.find((f) => faceWeight(f) === 400 && faceStyle(f) === "normal");
  assert.equal(styleLabel(representative), "Regular");
}

// A filtered subset must keep its whole-family identity for selection/export.
const filtered = fonts.filter((f) => matchesFilter(f, "semi bold"));
assert.equal(filtered.length, 2);
const key = familyGroups(filtered)[0].key;
assert.equal(fonts.filter((f) => familyKey(f) === key).length, 14);
assert.equal(fonts.filter((f) => matchesFilter(f, "gt mechanik mono")).length, 14);
assert.equal(fonts.filter((f) => matchesFilter(f, "oblique")).length, 21);

// Original IDs, sources and CSS descriptors stay usable by the server.
assert.deepEqual(fonts.map((f) => f.id), original.slice().reverse().map((f) => f.id));
for (const font of fonts) {
  const source = original.find((f) => f.id === font.id);
  assert.equal(font.family, source.family);
  assert.equal(font.weight, source.weight);
  assert.equal(font.style, source.style);
  assert.equal(font.sources, source.sources);
}
assert.ok(original.every((f) => !f.catalog));
assert.deepEqual(prepareCatalogFonts(fonts), fonts); // restored sessions

// Preserve width/optical families; prefer true compound weights when supported.
const other = prepareCatalogFonts([
  face("Acme-Display-ExtraLight"), face("Acme-Display-Semi-Bold-Italic"),
  face("Acme-Display-Bold"), face("Acme-Display-Extra-Bold"),
  face("Acme-Text-Regular"), face("Acme-Text-Bold"),
  face("Acme-Condensed-Regular"), face("Acme-Condensed-Bold"),
]);
assert.deepEqual(new Set(familyGroups(other).map((g) => g.name)),
  new Set(["Acme Display", "Acme Text", "Acme Condensed"]));
assert.equal(styleLabel(other[1]), "Semi Bold Italic");
assert.equal(styleLabel(other[3]), "Extra Bold");

const singletons = prepareCatalogFonts([face("Arial Black"), face("Arial"), face("Book"), face("Black")]);
assert.deepEqual(singletons.map((f) => f.family), ["Arial Black", "Arial", "Book", "Black"]);
assert.ok(singletons.every((f) => !f.catalog));
assert.equal(familyGroups(singletons).length, 4);
assert.equal(styleLabel(face("ExtraBold")), "Regular"); // no base family to strip
const camelAliases = prepareCatalogFonts([
  face("AcmeSansRegular"), face("AcmeSansBold"), face("AcmeSansExtraBold"),
]);
assert.equal(familyGroups(camelAliases).length, 1);
assert.deepEqual(camelAliases.map(styleLabel), ["Regular", "Bold", "Extra Bold"]);
assert.equal(styleLabel(face("Spectralight")), "Regular"); // suffix inside a word

const variable = prepareCatalogFonts([
  face("Acme-Variable", { variable: true, weight: "100 900" }),
  face("Acme-Regular"), face("Acme-Bold"),
]);
assert.equal(familyGroups(variable).length, 1);
assert.equal(styleLabel(variable[0]), "Variable");
const cssStyles = prepareCatalogFonts([
  face("ACME_Regular", { style: "italic" }), face("ACME_Bold", { style: "italic" }),
]);
assert.equal(styleLabel(cssStyles[0]), "Regular Italic");
assert.equal(faceStyle(cssStyles[1]), "italic");
assert.equal(familyGroups(prepareCatalogFonts([
  face("(Unknown)", { id: "unknown-a" }), face("(Unknown)", { id: "unknown-b" }),
])).length, 2); // no evidence that anonymous files share a family
assert.equal(familyGroups(prepareCatalogFonts([
  face("Cafe\u0301-Regular"), face("Café-Bold"),
])).length, 1);
assert.equal(familyGroups([face("Known", { style: undefined }), face("Known", { id: "known-bold", weight: "700" })]).length, 1);
// The typeface named by the scanned page comes before the foundry's other families.
const catalogue = prepareCatalogFonts([face("Alp-Con-Bold"), face("Alp-Con-Light"), ...original]);
const ranked = familyGroups(catalogue, "https://www.grillitype.com/typeface/gt-mechanik");
assert.deepEqual(ranked.slice(0, 3).map((g) => g.onPage), [true, true, true]);
assert.ok(ranked.slice(0, 3).every((g) => g.name.startsWith("GT Mechanik")));
assert.equal(ranked.at(-1).name, "Alp Con");
assert.equal(familyGroups(catalogue, "https://www.grillitype.com/")[0].name, "Alp Con");
assert.equal(familyGroups(catalogue, "not a url")[0].onPage, false);

// Roman reads before italic at the same weight.
const romanFirst = familyGroups([
  face("Serif", { id: "i", style: "italic" }), face("Serif", { id: "r" }),
])[0].fonts.map((f) => f.id);
assert.deepEqual(romanFirst, ["r", "i"]);
console.log("Catalogue regression checks passed: 42 Mechanik faces, compound weights, subfamilies, filtering, identity, restored sessions, page ranking and roman-first order.");
