const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { build } = require("esbuild");

const root = path.resolve(__dirname, "../..");
const web = path.join(root, "core/src/web");
const types = { ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const allowedAssets = new Set(fs.readdirSync(path.join(web, "assets")).filter(name => /\.(woff2|svg)$/.test(name)));
const apiPath = /^\/api\/(metadata\/(inspect|apply)|export\/[^/]+)$/;
let backend;

async function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address().port);
    });
  });
}

async function main() {
  const bundle = await build({ entryPoints: [path.join(__dirname, "app.jsx")], bundle: true, write: false, format: "iife", jsx: "automatic", jsxImportSource: "preact", target: "es2022", sourcemap: "inline" });
  const reservation = http.createServer();
  const backendPort = await listen(reservation, 0);
  await new Promise(resolve => reservation.close(resolve));
  const executable = path.join(root, "core/target/release", process.platform === "win32" ? "font-grabber.exe" : "font-grabber");
  if (!fs.existsSync(executable)) throw new Error("Build the existing Fount release binary first.");
  backend = spawn(executable, ["serve", "--host", "127.0.0.1", "--port", String(backendPort), "--no-open"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  backend.stdout.pipe(process.stdout);
  backend.stderr.pipe(process.stderr);
  backend.on("error", error => { console.error(error); process.exit(1); });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (backend.exitCode !== null) throw new Error("Fount backend exited before it became ready.");
    try { const response = await fetch(`http://127.0.0.1:${backendPort}/`, { signal: AbortSignal.timeout(1000) }); ready = response.ok && (await response.text()).includes("Fount"); } catch {}
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  if (!ready) throw new Error("Fount backend did not start.");
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("Cache-Control", "no-store");
    if (apiPath.test(url.pathname)) {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { res.writeHead(403); return res.end(); }
      const proxy = http.request({ host: "127.0.0.1", port: backendPort, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${backendPort}` } }, upstream => {
        res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
      });
      proxy.on("error", () => { if (!res.headersSent) res.writeHead(502, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: "Fount is unavailable. Restart the prototype server." })); });
      req.on("aborted", () => proxy.destroy());
      req.pipe(proxy);
      return;
    }
    if (url.pathname === "/prototype.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(bundle.outputFiles[0].contents); }
    let file;
    if (["/", "/prototypes/metadata", "/prototypes/metadata/"].includes(url.pathname)) file = path.join(__dirname, "index.html");
    else if (["/styles.css", "/picker.css"].includes(url.pathname)) file = path.join(__dirname, url.pathname.slice(1));
    else if (url.pathname === "/fonts.css") file = path.join(web, "styles/fonts-web.css");
    else if (url.pathname.startsWith("/assets/") && allowedAssets.has(url.pathname.slice(8))) file = path.join(web, "assets", url.pathname.slice(8));
    if (!file) { res.writeHead(404); return res.end("Not found"); }
    res.setHeader("Content-Type", types[path.extname(file)] || "text/html; charset=utf-8");
    fs.createReadStream(file).pipe(res);
  });
  let port = Number(process.argv[2] || 8795);
  for (;;) { try { await listen(server, port); break; } catch (error) { if (error.code !== "EADDRINUSE") throw error; port++; } }
  console.log(`PROTOTYPE_READY http://127.0.0.1:${port}/prototypes/metadata/`);
  const stop = () => { server.close(); backend.kill(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  backend.on("exit", () => { server.close(); process.exit(1); });
}
process.on("exit", () => backend?.kill());
main().catch(error => { console.error(error); process.exit(1); });
