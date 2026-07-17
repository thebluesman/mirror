#!/usr/bin/env node
/*
 * Headless runner for spike/pathtrace.html (PoC 2 rung 4 stills).
 * Serves spike/ locally, renders progressive path-traced samples in headless
 * Chromium, screenshots at checkpoint sample counts so an early frame is
 * banked even if the run is killed (D3 memo §4).
 *
 * Usage: node spike/pathtrace-run.mjs [--cam 0] [--samples 300] [--timebox-min 60]
 *        [--scale 1] [--out spike/out2]
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
    "/opt/node22/lib/node_modules/playwright",
    process.env.PLAYWRIGHT_DIR
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
const CAM = argOf("--cam", "0");
const TARGET = Number(argOf("--samples", "300"));
const TIMEBOX_MS = Number(argOf("--timebox-min", "60")) * 60 * 1000;
const SCALE = argOf("--scale", "1");
const OUT_DIR = path.resolve(argOf("--out", path.join(SPIKE_DIR, "out2")));
const CHECKPOINTS = [50, 100, 200, 300, 500, 800].filter(c => c <= TARGET);
if (!CHECKPOINTS.includes(TARGET)) CHECKPOINTS.push(TARGET);
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

const browser = await playwright.chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
page.on("pageerror", e => console.error("[pageerror]", e.message));
page.on("console", m => { if (m.type() === "error") console.error("[console]", m.text()); });

const url = `http://127.0.0.1:${port}/pathtrace.html?cam=${CAM}&scale=${SCALE}`;
console.log("loading", url);
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 120000 });
console.log("GPU:", await page.evaluate(() => window.__pt.glInfo()));

const t0 = Date.now();
let done = 0;
while (done < CHECKPOINTS.length && Date.now() - t0 < TIMEBOX_MS) {
  const samples = await page.evaluate(() => window.__pt.samples());
  while (done < CHECKPOINTS.length && samples >= CHECKPOINTS[done]) {
    const cp = CHECKPOINTS[done];
    const out = path.join(OUT_DIR, `pt-cam${CAM}-s${cp}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1024, height: 768 } });
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`checkpoint ${cp} samples at ${mins} min -> ${out}`);
    done++;
  }
  await new Promise(r => setTimeout(r, 2000));
}
if (done < CHECKPOINTS.length) {
  const samples = await page.evaluate(() => window.__pt.samples());
  const out = path.join(OUT_DIR, `pt-cam${CAM}-s${Math.floor(samples)}-timeboxed.png`);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1024, height: 768 } });
  console.log(`timebox hit at ${samples.toFixed(0)} samples -> ${out}`);
}

await browser.close();
server.close();
