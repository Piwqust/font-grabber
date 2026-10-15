// Builds the Linux binary in Docker on this machine (the VPS runs out of memory
// compiling the Chromium bindings) and assembles a release the server installs
// with deploy/install-release.sh.
//   npm run build:ui && node scripts/build-linux-release.cjs 2026-10-15-1
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const version = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}-\d+$/.test(version || ""))
  throw new Error("Usage: node scripts/build-linux-release.cjs YYYY-MM-DD-N");

const out = path.join(root, "output", `release-${version}`);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const run = (cmd, args, options = {}) => {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.error || result.status !== 0)
    throw result.error || new Error(`${cmd} ${args[0]} failed`);
};

// Same toolchain and Debian release as the runtime image, so glibc matches.
// Named volumes keep the registry and target cache between releases.
const build = [
  "set -e",
  "mkdir -p /build/core /build/extension",
  "rm -rf /build/core/src",
  "cp /src/core/Cargo.toml /src/core/Cargo.lock /build/core/",
  "cp -r /src/core/src /build/core/src",
  "cp /src/extension/capture.js /src/extension/discover.js /build/extension/",
  "cd /build/core && cargo build --release --locked",
  "cp target/release/font-grabber /out/font-grabber",
  "/out/font-grabber --version",
].join(" && ");
run("docker", [
  "run", "--rm",
  "-v", "fount-cargo-registry:/usr/local/cargo/registry",
  "-v", "fount-linux-target:/build/core/target",
  "-v", `${root}:/src:ro`,
  "-v", `${out}:/out`,
  "rust:1.94-bookworm", "sh", "-c", build,
], { env: { ...process.env, MSYS_NO_PATHCONV: "1" } });

run(process.execPath, [path.join(root, "scripts/package-deploy.cjs")]);
fs.copyFileSync(path.join(root, "output/hosted-preparation/fount-source.tar.gz"), path.join(out, "fount-source.tar.gz"));
fs.copyFileSync(path.join(root, "deploy/runtime.Dockerfile"), path.join(out, "Dockerfile"));
// The installer must keep LF endings to run under bash.
fs.writeFileSync(path.join(out, "install-release.sh"),
  fs.readFileSync(path.join(root, "deploy/install-release.sh"), "utf8").replace(/\r\n/g, "\n"));
fs.writeFileSync(path.join(out, "VERSION"), version + "\n");

const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
fs.writeFileSync(path.join(out, "APPJS_SHA256"), sha(path.join(root, "core/src/web/assets/app.js")) + "\n");
const files = ["font-grabber", "Dockerfile", "install-release.sh", "fount-source.tar.gz", "VERSION", "APPJS_SHA256"];
fs.writeFileSync(path.join(out, "SHA256SUMS"),
  files.map((name) => `${sha(path.join(out, name))}  ${name}\n`).join(""));
console.log(`Release ${version}: ${out}`);
