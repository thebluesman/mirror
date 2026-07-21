// v2 spike (W-A, D1): drives the running dev server with Playwright to
// capture evidence for the move/rotate/persist bar in v2-spike-plan.md §2.
// Not a test suite — a one-off capture script, kept here (spike-v2/) rather
// than in src/test/ since it's driving a live browser + IndexedDB, not
// exercising pure functions. Run with the dev server already up:
//   node spike-v2/w-a-drive.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEV_URL = "http://127.0.0.1:5183/";
const OUT = fileURLToPath(new URL("./w-a-screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[browser console error]", msg.text());
});

await page.goto(DEV_URL);
// Start from a clean seed each run (a prior run's committed drag/rotate
// would otherwise persist across this script's own re-runs and make the
// screenshots misleading about what this run actually did).
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const req = indexedDB.deleteDatabase("mirror");
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    }),
);
await page.reload();
await page.waitForSelector("canvas", { timeout: 15000 });
// Let the structural build + first GLB loads settle.
await page.waitForTimeout(1500);

const canvas = page.locator("canvas");
const box = await canvas.boundingBox();
if (!box) throw new Error("no canvas bounding box");

await page.screenshot({ path: OUT + "0-initial.png" });
console.log("captured 0-initial.png");

// A furniture placeholder box clearly in view in the seed's default
// "couch-view" camera (confirmed against 0-initial.png) — click there to
// select it.
const clickX = box.x + 150;
const clickY = box.y + 590;

await page.mouse.move(clickX, clickY);
await page.mouse.down();
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + "0b-selected.png" });
console.log("captured 0b-selected.png (selection outline, before any drag movement)");
// Drag across the floor plane — several intermediate moves so the pointer
// path exercises the same per-move raycast the real gesture does, not a
// single teleport.
const dragSteps = 12;
const dx = 90;
const dy = 70;
for (let i = 1; i <= dragSteps; i++) {
  await page.mouse.move(clickX + (dx * i) / dragSteps, clickY + (dy * i) / dragSteps);
  await page.waitForTimeout(30);
}
await page.screenshot({ path: OUT + "1-mid-drag.png" });
console.log("captured 1-mid-drag.png (item mid-drag, before release)");
await page.mouse.up();
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "2-after-drop.png" });
console.log("captured 2-after-drop.png (after commit)");

// Rotate the still-selected item via the keyboard step.
await page.keyboard.press("e");
await page.waitForTimeout(150);
await page.keyboard.press("e");
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + "3-after-rotate.png" });
console.log("captured 3-after-rotate.png (two 15deg steps = 30deg)");

// Read back the persisted IndexedDB state before reloading, for a
// machine-readable record alongside the screenshots.
const persisted = await page.evaluate(async () => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("mirror");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("project", "readonly");
      const store = tx.objectStore("project");
      const getReq = store.get("current");
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.error);
    };
  });
});
const layout = persisted.layouts.find((l) => l.id === persisted.current);
console.log("persisted commands (post drag+rotate, pre-reload):", JSON.stringify(layout.commands, null, 2));

// Reload — if the seam works, the moved/rotated item comes back exactly
// where it was left, proving the commit actually persisted through
// autosave, not just live in the THREE.Scene.
await page.reload();
await page.waitForSelector("canvas", { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + "4-after-reload.png" });
console.log("captured 4-after-reload.png (evidence of persistence)");

const persistedAfterReload = await page.evaluate(async () => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("mirror");
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("project", "readonly");
      const store = tx.objectStore("project");
      const getReq = store.get("current");
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.error);
    };
  });
});
const layoutAfterReload = persistedAfterReload.layouts.find((l) => l.id === persistedAfterReload.current);
console.log("persisted commands (post reload):", JSON.stringify(layoutAfterReload.commands, null, 2));

const matches = JSON.stringify(layout.commands) === JSON.stringify(layoutAfterReload.commands);
console.log(matches ? "PERSISTENCE OK: pre-reload and post-reload commands match" : "PERSISTENCE MISMATCH");

await browser.close();
