// Explicit allowlist: no fonts, secrets, local output or browser state enter delivery.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const files = ["package.json", "package-lock.json", "LICENSE", "README.md", ".dockerignore",
  "core/Cargo.toml", "core/Cargo.lock", "core/src", "wasm/Cargo.toml", "wasm/Cargo.lock", "wasm/src",
  "scripts/build-ui.cjs", "scripts/check-hosted.cjs", "scripts/check-metadata-editor.cjs",
  "scripts/package-deploy.cjs", "scripts/build-linux-release.cjs", "scripts/check-catalogue.cjs",
  "scripts/check-families.mjs", "scripts/check-metadata-ui.cjs", "scripts/check-previews.cjs", "docs/HOSTED-API.md",
  "deploy/runtime.Dockerfile", "deploy/install-release.sh", "deploy/CATALOGUE-FIX-VERIFIED.md",
  "deploy/Dockerfile", "deploy/compose.yaml", "deploy/Caddyfile", "deploy/.env.example",
  "deploy/README.md", "deploy/egress.sh", "deploy/fount.service",
  "deploy/compose.existing-caddy.yaml", "deploy/Caddyfile.existing", "deploy/fount-existing-caddy.service",
  "deploy/fount-egress.service", "deploy/fount-egress-check.service", "deploy/fount-egress-check.timer",
  "extension/manifest.json", "extension/popup.html", "extension/popup.bundle.js", "extension/popup.css",
  "extension/popup.src.css", "extension/convert.js", "extension/convert.wasm", "extension/zip.js",
  "extension/capture.js", "extension/discover.js", "extension/background.js", "extension/src",
  "extension/icons", "extension/ui-LICENSES.txt", "extension/README.md"];
for (const file of files) if (!fs.existsSync(path.join(root, file))) throw new Error("Missing build input: " + file);
const out = path.join(root, "output", "hosted-preparation", "fount-source.tar.gz");
fs.mkdirSync(path.dirname(out), { recursive: true });
// Relative paths: GNU tar from Git Bash reads "C:\..." as a remote host.
const result = spawnSync("tar", ["-czf", path.relative(root, out).split(path.sep).join("/"), ...files],
  { cwd: root, stdio: "inherit" });
if (result.error || result.status !== 0) throw result.error || new Error("Source packaging failed");
const hash = crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex");
fs.writeFileSync(out + ".sha256", hash + "  fount-source.tar.gz" + String.fromCharCode(10));
console.log("Created " + out + String.fromCharCode(10) + "SHA-256 " + hash);
