// v2 spike (W-A, D2): drives the running dev server with Playwright to
// capture evidence for the collision-flagging + wall/edge-snapping bar in
// v2-spike-plan.md §2. Not a test suite — a one-off capture script, same
// shape as spike-v2/w-a-drive.mjs (D1's evidence script), kept in
// spike-v2/ since it drives a live browser against real IndexedDB state,
// not pure functions. Run with the dev server already up:
//   node spike-v2/d2-collision-snap-drive.mjs
//
// Screen coordinates for a drag gesture are derived by projecting each
// item's live THREE.Group position through the actual camera/renderer (via
// the dev-only window.__mirrorDebug hook), rather than hardcoded pixel
// offsets tied to one specific camera framing — robust to the seed's
// current default view without needing to eyeball a screenshot first.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEV_URL = "http://127.0.0.1:5183/";
const OUT = fileURLToPath(new URL("./d2-screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[browser console error]", msg.text());
});

await page.goto(DEV_URL);
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
await page.waitForTimeout(1500);

const canvas = page.locator("canvas");
const box = await canvas.boundingBox();
if (!box) throw new Error("no canvas bounding box");

// The seed's default "couch-view" camera doesn't frame every item this
// script needs to drag (some sit well outside that view's frustum) — so
// this snaps the live camera to a framing centered on a given world point
// instead, via the same dev-only debug hook Viewport.tsx exposes. This only
// touches this script's Playwright-driven camera, not any persisted
// CameraPosition. Steep and near-overhead (camera pulled up close to the
// ceiling height, only a small horizontal offset from the target) rather
// than a waist-height shot: a shallow angle let other, taller furniture
// sitting between the camera and the target item block the raycast
// entirely (found while developing this script — the first attempt's
// "collision" screenshot turned out to be a much bigger neighboring item
// the ray hit first). A near-vertical ray mostly only crosses the target's
// own footprint.
async function frameWorldPoint([x, y, z]) {
  await page.evaluate(
    ({ x, y, z }) => {
      const { camera, controls } = window.__mirrorDebug;
      camera.position.set(x + 10, y + 220, z + 10);
      controls.target.set(x, y + 20, z);
      camera.updateProjectionMatrix();
      controls.update();
    },
    { x, y, z },
  );
}

// Projects a world position to page-space screen coordinates using the live
// camera/renderer the debug hook exposes.
async function screenPointFor(worldPos) {
  return page.evaluate(
    ({ worldPos, rectX, rectY }) => {
      const { camera, THREE } = window.__mirrorDebug;
      const v = new THREE.Vector3(...worldPos).project(camera);
      const canvasEl = document.querySelector("canvas");
      const w = canvasEl.clientWidth;
      const h = canvasEl.clientHeight;
      return { x: rectX + ((v.x + 1) / 2) * w, y: rectY + ((1 - v.y) / 2) * h };
    },
    { worldPos, rectX: box.x, rectY: box.y },
  );
}

async function groupPosition(itemId) {
  return page.evaluate((itemId) => {
    const g = window.__mirrorDebug.scene.children
      .concat(window.__mirrorDebug.scene.children.flatMap((c) => c.children))
      .find((o) => o.userData?.itemId === itemId);
    return g ? [g.position.x, g.position.y, g.position.z] : null;
  }, itemId);
}

async function dragItem(itemId, toWorldXZ, { shiftKey = false, steps = 12 } = {}) {
  const from = await groupPosition(itemId);
  if (!from) throw new Error(`item ${itemId} not found in live scene`);
  const start = await screenPointFor(from);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.waitForTimeout(100);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const worldX = from[0] + (toWorldXZ[0] - from[0]) * t;
    const worldZ = from[2] + (toWorldXZ[1] - from[2]) * t;
    const pt = await screenPointFor([worldX, from[1], worldZ]);
    if (shiftKey) await page.keyboard.down("Shift");
    await page.mouse.move(pt.x, pt.y);
    if (shiftKey) await page.keyboard.up("Shift");
    await page.waitForTimeout(25);
  }
  return () => page.mouse.up();
}

// --- Case 1: drag water-cooler onto billy-hogadal-shelving (item-vs-item
// collision). Seed positions: billy-hogadal-shelving [1009,0,339],
// water-cooler [1113,0,339] — 104cm apart on x, same z.
console.log("Case 1: item-vs-item collision (water-cooler -> billy-hogadal-shelving)");
await frameWorldPoint([1061, 0, 339]);
const release1 = await dragItem("water-cooler", [1009, 339]);
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + "1-item-collision-mid-drag.png" });
console.log("captured 1-item-collision-mid-drag.png (expect red outline on water-cooler)");
await release1();
await page.waitForTimeout(200);

// Reload to a clean seed for the next case (avoid case 1's overlap carrying
// over into case 2's baseline).
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
await page.waitForTimeout(1500);
await frameWorldPoint([483, 0, 684]);

// --- Case 2: drag floor-lamp to x=498 (west wall's inner face is at
// x=479; floor-lamp is 28cm wide, so a flush placement centers it at
// x=493 -- within the 8cm snap threshold of this raw target, so the
// snapped result should land at 493, not 498).
console.log("Case 2: wall snap + item-vs-wall collision (floor-lamp -> west wall)");
const release2 = await dragItem("floor-lamp", [498, 684]);
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + "2-wall-snap-mid-drag.png" });
console.log("captured 2-wall-snap-mid-drag.png (expect item flush against the wall, snapped)");
await release2();
await page.waitForTimeout(200);

const snappedPos = await groupPosition("floor-lamp");
console.log("floor-lamp position after wall-snap drag:", snappedPos);

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
await page.waitForTimeout(1500);
await frameWorldPoint([483, 0, 684]);

// --- Case 3: same drag, holding Shift throughout — the snap escape hatch.
// If snapping is correctly disabled, the final position should differ from
// case 2's snapped result and land near the raw target instead.
console.log("Case 3: Shift-held drag toward the same wall target (snap disabled)");
const release3 = await dragItem("floor-lamp", [498, 684], { shiftKey: true });
await page.waitForTimeout(150);
await page.screenshot({ path: OUT + "3-shift-no-snap-mid-drag.png" });
await release3();
await page.waitForTimeout(200);
const unsnappedPos = await groupPosition("floor-lamp");
console.log("floor-lamp position after Shift-held drag (snap disabled):", unsnappedPos);
console.log(
  Math.abs(unsnappedPos[0] - snappedPos[0]) > 1
    ? "SNAP ESCAPE OK: Shift-held drag landed at a different x than the snapped drag"
    : "SNAP ESCAPE MISMATCH: positions match — Shift did not disable snapping",
);

await browser.close();
