// v2 spike (W-C, D5): drives the render harness (render-harness.html/.ts)
// with Playwright to capture Meshy-vs-Hunyuan comparison screenshots under
// the app's own lighting — same one-off-Playwright-driver shape as
// spike-v2/w-a-drive.mjs and friends. Not a test suite.
//
// Run with the dev server already up (vite, default port from `npm run dev`
// or override DEV_URL below), then:
//   node spike-v2/d5-render-drive.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEV_URL = process.env.DEV_URL ?? "http://127.0.0.1:5199/";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const OUT_ROOT = HERE + "d5-render-screenshots/";

const ITEMS = [
  {
    name: "water-cooler",
    dims: { w: 34, d: 30, h: 105 },
    meshy: "existing-assets/water-cooler.glb",
    hunyuan: "generated/water-cooler-hunyuan.glb",
  },
  {
    name: "bookshelf",
    dims: { w: 40, d: 143.5, h: 72 },
    meshy: "existing-assets/bookshelf.glb",
    hunyuan: "generated/bookshelf-hunyuan.glb",
  },
  {
    name: "sonderod-rug",
    dims: { w: 240, d: 170, h: 2 },
    meshy: "existing-assets/sonderod-rug.glb",
    hunyuan: "generated/sonderod-rug-hunyuan.glb",
  },
  {
    // Table is Hunyuan-only (multi-view probe item, not part of the 3-item
    // Meshy-vs-Hunyuan comparison slate) — rendered for its own sake so
    // Shyam can eyeball the multi-view result, no Meshy counterpart exists.
    name: "table",
    dims: { w: 153, d: 92, h: 76 },
    meshy: null,
    hunyuan: "generated/table-hunyuan.glb",
  },
];

const VIEWS = ["view0", "view45", "view90", "view180", "top"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[browser console error]", msg.text());
});
page.on("pageerror", (err) => console.log("[browser page error]", err));

await page.goto(DEV_URL + "spike-v2/render-harness.html");
await page.waitForFunction(() => window.__harnessReady === true, { timeout: 15000 });
console.log("harness ready");

for (const item of ITEMS) {
  const outDir = OUT_ROOT + item.name + "/";
  mkdirSync(outDir, { recursive: true });

  await page.evaluate((dims) => window.harnessSetupScene(dims), item.dims);

  for (const [label, relPath] of [
    ["meshy", item.meshy],
    ["hunyuan", item.hunyuan],
  ]) {
    if (!relPath) continue;
    const url = DEV_URL + "spike-v2/d5-assets/" + relPath;
    console.log(`[${item.name}] loading ${label} from ${url}`);
    await page.evaluate((u) => window.harnessLoadModel(u), url);
    await page.waitForTimeout(200);
    for (const view of VIEWS) {
      await page.evaluate((v) => window.harnessSetView(v), view);
      await page.waitForTimeout(50);
      const outPath = outDir + `${label}-${view}.png`;
      await page.locator("canvas").screenshot({ path: outPath });
      console.log(`  captured ${outPath}`);
    }
  }
}

await browser.close();
console.log("done");
