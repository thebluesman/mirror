#!/usr/bin/env node
/*
 * Headless capture for spike/scene2.html (PoC 2 renders).
 * Serves the spike/ directory over a local static server (ES module imports
 * don't load over file://), loads both camera presets in headless Chromium
 * via Playwright, and screenshots the 1024x768 canvas.
 *
 * Usage: node spike/capture.mjs [--mode 1] [--out spike/out2]
 * Requires: playwright (globally installed) + vendored three at spike/vendor.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch {
  const fallbacks = [
    "/opt/node22/lib/node_modules/playwright",           // cloud session env
    process.env.PLAYWRIGHT_DIR                            // local override
  ].filter(Boolean);
  let loaded = null;
  for (const p of fallbacks) { try { loaded = require(p); break; } catch {} }
  if (!loaded) throw new Error("playwright not found; npm install it or set PLAYWRIGHT_DIR");
  playwright = loaded;
}

const SPIKE_DIR = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function argOf(flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : dflt;
}
const MODE = argOf("--mode", "1");
const OUT_DIR = path.resolve(argOf("--out", path.join(SPIKE_DIR, "out2")));
fs.mkdirSync(OUT_DIR, { recursive: true });

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".json": "application/json", ".png": "image/png", ".css": "text/css"
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(SPIKE_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(SPIKE_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const browser = await playwright.chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.on("pageerror", e => console.error("[pageerror]", e.message));
page.on("console", m => { if (m.type() === "error") console.error("[console]", m.text()); });

const SHOTS = [
  { cam: "0", file: "scene2-couch.png" },
  { cam: "9", file: "scene2-reverse.png" },
  { cam: "8", file: "scene2-dining.png" },
  { cam: "7", file: "scene2-overview.png" }
];

for (const shot of SHOTS) {
  const url = `http://127.0.0.1:${port}/scene2.html?mode=${MODE}&cam=${shot.cam}&clean`;
  await page.goto(url, { waitUntil: "load" });
  // 60s: sceneReady now also waits on the import-GLB and shell-texture probes,
  // which run serially and are slow under SwiftShader.
  await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 60000 });
  await page.waitForTimeout(400); // let shadows/env settle a few frames
  const out = path.join(OUT_DIR, shot.file);
  await page.screenshot({ path: out });
  console.log("wrote", out);
}

await browser.close();
server.close();
