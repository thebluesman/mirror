// v2 spike (W-A, C1 follow-up — see spike-v2/OUTCOME.md's "C1 follow-up —
// rotate UI handle" section): drives the running dev server with Playwright
// to capture evidence for the new drag-to-rotate handle. Not a test suite —
// a one-off capture script, same shape as spike-v2/w-a-drive.mjs and
// spike-v2/d2-collision-snap-drive.mjs. Run with the dev server already up:
//   node spike-v2/d1-followup-rotate-handle-drive.mjs <devServerPort>
//
// Screen coordinates are derived by projecting live THREE world positions
// through the actual camera/renderer (window.__mirrorDebug), same technique
// D2's script uses — robust to camera framing without hardcoded pixels.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const port = process.argv[2] ?? "5175";
const DEV_URL = `http://localhost:${port}/`;
const OUT = fileURLToPath(new URL("./d1-followup-rotate-handle-screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

// Seed dims (seed/living-room.json) needed to reproduce the handle's offset
// math (ROTATE_HANDLE_MARGIN_CM = 25, offset = dimsCm.d / 2 + 25) without a
// live query for it.
const DIMS = {
  "water-cooler": { w: 34, d: 30, h: 105 },
  "shoe-rack": { w: 79, d: 29, h: 148 },
};
const ROTATE_HANDLE_MARGIN_CM = 25;

function handleOffsetXZ(centerX, centerZ, yawDeg, offset) {
  const rad = (yawDeg * Math.PI) / 180;
  return [centerX + offset * Math.sin(rad), centerZ + offset * Math.cos(rad)];
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[browser console error]", msg.text());
});

async function resetToCleanSeed() {
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
}

await page.goto(DEV_URL);
await resetToCleanSeed();

const canvas = page.locator("canvas");
const box = await canvas.boundingBox();
if (!box) throw new Error("no canvas bounding box");

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

async function groupState(itemId) {
  return page.evaluate((itemId) => {
    const { scene, THREE } = window.__mirrorDebug;
    const g = scene.children
      .concat(scene.children.flatMap((c) => c.children))
      .find((o) => o.userData?.itemId === itemId);
    if (!g) return null;
    const yawDeg = ((THREE.MathUtils.radToDeg(g.rotation.y) % 360) + 360) % 360;
    return { position: [g.position.x, g.position.y, g.position.z], rotationDeg: yawDeg };
  }, itemId);
}

async function handleWorldPosition() {
  return page.evaluate(() => {
    const h = window.__mirrorDebug.scene.children.find((o) => o.userData?.isRotateHandle);
    return h ? [h.position.x, h.position.y, h.position.z] : null;
  });
}

async function clickAt(worldPos) {
  const pt = await screenPointFor(worldPos);
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.waitForTimeout(50);
  await page.mouse.up();
  await page.waitForTimeout(100);
}

/** Drags the rotate handle for `itemId` from its current yaw to
 *  `targetYawDeg`, screenshotting mid-drag via `onMid` before releasing. */
async function dragRotateHandle(itemId, targetYawDeg, { steps = 16, onMid } = {}) {
  const dims = DIMS[itemId];
  if (!dims) throw new Error(`no known dims for ${itemId} — add to DIMS map`);
  const offset = dims.d / 2 + ROTATE_HANDLE_MARGIN_CM;
  const before = await groupState(itemId);
  if (!before) throw new Error(`item ${itemId} not found in live scene`);
  const [cx, , cz] = before.position;

  const handlePos = await handleWorldPosition();
  if (!handlePos) throw new Error("rotate handle not found in scene — is the item selected?");
  const startScreen = await screenPointFor(handlePos);
  await page.mouse.move(startScreen.x, startScreen.y);
  await page.mouse.down();
  await page.waitForTimeout(100);

  const startYaw = before.rotationDeg;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const yaw = startYaw + (targetYawDeg - startYaw) * t;
    const [hx, hz] = handleOffsetXZ(cx, cz, yaw, offset);
    const pt = await screenPointFor([hx, handlePos[1], hz]);
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(25);
  }
  if (onMid) await onMid();
  await page.mouse.up();
  await page.waitForTimeout(150);
}

// --- Case 1: select shoe-rack, show the handle appears, drag it ~40deg,
// screenshot mid-drag and after release, confirm the rendered rotation
// matches.
console.log("Case 1: select shoe-rack, drag its rotate handle ~40deg");
await frameWorldPoint([1103.5, 0, 687.5]);
await clickAt([1103.5, 74, 687.5]); // click the item body (roughly mid-height) to select it
await page.waitForTimeout(200);
const preRotate = await groupState("shoe-rack");
console.log("shoe-rack before rotate-drag:", preRotate);
await page.screenshot({ path: OUT + "1-selected-handle-visible.png" });
console.log("captured 1-selected-handle-visible.png (expect cyan outline + handle sphere)");

const targetYaw1 = ((preRotate.rotationDeg + 40) % 360 + 360) % 360;
await dragRotateHandle("shoe-rack", targetYaw1, {
  onMid: async () => {
    await page.screenshot({ path: OUT + "2-mid-drag-40deg.png" });
    console.log("captured 2-mid-drag-40deg.png (item rotating live)");
  },
});
const postRotate = await groupState("shoe-rack");
console.log("shoe-rack after rotate-drag release:", postRotate);
await page.screenshot({ path: OUT + "3-after-release.png" });
console.log("captured 3-after-release.png");
console.log(
  Math.abs(((postRotate.rotationDeg - targetYaw1 + 540) % 360) - 180) < 3
    ? "ROTATE-HANDLE OK: final rendered rotation matches the drag target within tolerance"
    : `ROTATE-HANDLE MISMATCH: expected ~${targetYaw1}deg, got ${postRotate.rotationDeg}deg`,
);

// Reload to confirm the commit persisted through the same autosave path
// D1/D2/D3 already proved for translate/keyboard-rotate/layouts.
await page.reload();
await page.waitForSelector("canvas", { timeout: 15000 });
await page.waitForTimeout(1500);
const afterReload = await groupState("shoe-rack");
console.log("shoe-rack rotation after page reload:", afterReload?.rotationDeg);
console.log(
  afterReload && Math.abs(afterReload.rotationDeg - postRotate.rotationDeg) < 0.5
    ? "PERSISTENCE OK: rotate-handle commit survived reload"
    : "PERSISTENCE MISMATCH",
);

// --- Case 2: keyboard-step rotate regression check — still works unaffected
// by the new handle code.
console.log("\nCase 2: keyboard-step rotate regression check");
await frameWorldPoint([1103.5, 0, 687.5]);
await clickAt([1103.5, 74, 687.5]);
await page.waitForTimeout(200);
const beforeKey = await groupState("shoe-rack");
await page.keyboard.press("e");
await page.waitForTimeout(200);
const afterKey = await groupState("shoe-rack");
console.log("shoe-rack rotation before/after 'e' keypress:", beforeKey.rotationDeg, "->", afterKey.rotationDeg);
const expectedKeyYaw = ((beforeKey.rotationDeg + 15) % 360 + 360) % 360;
console.log(
  Math.abs(afterKey.rotationDeg - expectedKeyYaw) < 0.5
    ? "KEYBOARD ROTATE OK: still steps by 15deg exactly, unaffected by the handle"
    : "KEYBOARD ROTATE MISMATCH",
);

// --- Case 3: collision highlight stays live during a handle-drag. Rotate
// water-cooler (seed position [1113,0,339], 34x30) until its footprint
// swings into billy-hogadal-shelving (seed position [1009,0,339], 160x30) —
// at 0deg the two sit ~7cm apart (billy's east edge at x=1089, water-cooler's
// west edge at x=1096), so any noticeable yaw swings the water-cooler's
// footprint corner into the shelf.
console.log("\nCase 3: collision highlight live during a handle-drag");
await resetToCleanSeed();
await frameWorldPoint([1061, 0, 339]);
await clickAt([1113, 52, 339]);
await page.waitForTimeout(200);
await dragRotateHandle("water-cooler", 40, {
  onMid: async () => {
    await page.screenshot({ path: OUT + "4-collision-mid-handle-drag.png" });
    console.log("captured 4-collision-mid-handle-drag.png (expect red outline — footprint overlaps the shelf)");
  },
});
const waterCoolerAfter = await groupState("water-cooler");
console.log("water-cooler rotation after collision-inducing handle-drag:", waterCoolerAfter.rotationDeg);

await browser.close();
