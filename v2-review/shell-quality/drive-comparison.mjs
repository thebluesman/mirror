// Phase 5 (PRD-v2 §7.5) — before/after evidence for the shell-texture lever-1
// swap. Not a test suite — a one-off capture script, same pattern as
// spike-v2/w-a-drive.mjs and friends: drives the real running dev server with
// Playwright, through the actual ShellPanel.tsx upload + calibration UI (no
// shortcuts into internal state), and screenshots the project's two standard
// views (couch-view / reverse-view — see spike/scene2.html's key 0 / key 9
// presets and spike/OUTCOME-3.md's "both required views (couch, reverse)").
//
// "Before" = Shyam's own real surface photos (spike/inputs/surfaces/*.JPG)
// through the pipeline at default (no-op) calibration — the most honest,
// reproducible stand-in for the acceptance-run's complained-about state,
// since his actual tuned calibration only ever lived in his own browser's
// IndexedDB/OPFS, never in this repo.
// "After" = the Phase 5 lever-1 source textures (src/scene/defaultShellTextures.ts)
// through the same upload control, calibrated per that file's starting
// tint/repeat/roughnessScale.
//
// Each phase (before/after) runs in its own fresh browser launch — three
// full-resolution photo uploads in a row through headless SwiftShader
// software rendering is heavy enough (~15-50s each — see uploadSurfacePhoto)
// that running both phases in one long-lived page risked the tab wedging
// under memory pressure (observed: second phase's reload never produced a
// canvas). A clean process per phase sidesteps that entirely.
//
// Run with the dev server already up:
//   node v2-review/shell-quality/drive-comparison.mjs [devServerUrl]
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEV_URL = process.argv[2] ?? "http://127.0.0.1:5190/";
const ROOT = fileURLToPath(new URL("../../", import.meta.url)); // repo root
const OUT = fileURLToPath(new URL("./screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const defaults = JSON.parse(readFileSync(ROOT + "src/scene/defaultShellTextures.json", "utf8"));

const BEFORE_PHOTOS = {
  floor: ROOT + "spike/inputs/surfaces/floor.JPG",
  wall: ROOT + "spike/inputs/surfaces/wall.JPG",
  ceiling: ROOT + "spike/inputs/surfaces/ceiling.JPG",
};

function rowFor(page, surfaceLabel) {
  return page.locator(".shell-row").filter({ has: page.locator(".shell-row-title", { hasText: surfaceLabel }) });
}

/** Sets a controlled React input's value via the native value setter (so
 *  React's own onChange still fires) and dispatches input+change. Needed
 *  because Playwright's .fill()/.selectOption() don't reliably drive
 *  type=color / type=range on React-controlled inputs. */
async function setControlledValue(locator, value) {
  await locator.evaluate((el, v) => {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
    setter.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function uploadSurfacePhoto(page, surfaceLabel, filePath) {
  const row = rowFor(page, surfaceLabel);
  await row.locator('input[type="file"]').setInputFiles(filePath);
  // photoToTileableBlob first decodes the full-resolution source (Shyam's raw
  // phone photos run 3-4MB/12MP) before cropping to its 1024x1024 working
  // size — under headless SwiftShader software rendering that decode+crop step
  // alone measured ~12-50s in this sandbox, so this needs real headroom, not
  // the "quick" budget a GPU-accelerated run would need.
  await row.locator(".shell-row-status--photo").waitFor({ timeout: 90000 });
}

async function calibrateSurface(page, surfaceLabel, calib) {
  const row = rowFor(page, surfaceLabel);
  await setControlledValue(row.locator('input[type="color"]'), calib.tint);
  const ranges = row.locator('input[type="range"]');
  await setControlledValue(ranges.nth(0), String(calib.repeat[0]));
  await setControlledValue(ranges.nth(1), String(calib.repeat[1]));
  await setControlledValue(ranges.nth(2), String(calib.roughnessScale));
  // SLIDER_DEBOUNCE_MS is 120ms in ShellPanel.tsx; give it comfortable room
  // to flush through Viewport's calibration effect (texture reload + material
  // update) before the next surface or the screenshot.
  await page.waitForTimeout(500);
}

async function captureStandardViews(page, prefix) {
  // "Shell" tab is the app's default landing tab, but be explicit.
  await page.getByRole("button", { name: "Shell", exact: true }).click();
  await page.waitForTimeout(200);

  await page.getByRole("button", { name: "couch-view", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${prefix}-couch-view.png` });
  console.log(`captured ${prefix}-couch-view.png`);

  await page.getByRole("button", { name: "reverse-view", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${prefix}-reverse-view.png` });
  console.log(`captured ${prefix}-reverse-view.png`);
}

async function runPhase(label, uploads, calibrations) {
  console.log(`--- phase: ${label} ---`);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[browser console error]", msg.text());
  });
  page.on("crash", () => console.log("[page crashed]"));

  await page.goto(DEV_URL);
  // Clean IndexedDB so this phase starts from the committed seed, not
  // whatever a previous manual session (or this script's own prior run) left
  // behind (same pattern as spike-v2/w-a-drive.mjs).
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
  // A cold Vite dev server (no module transform cache yet — e.g. this
  // script's very first run against a freshly-started server) measured ~23s
  // to first paint in this sandbox, well past a "should be instant" budget;
  // once warm, subsequent loads are fast. Generous timeout, not a sign
  // anything's wrong.
  await page.waitForSelector("canvas", { timeout: 60000 });
  await page.waitForTimeout(1500); // structural build + first GLB loads settle

  for (const [surfaceLabel, filePath] of uploads) {
    await uploadSurfacePhoto(page, surfaceLabel, filePath);
    if (calibrations?.[surfaceLabel]) {
      await calibrateSurface(page, surfaceLabel, calibrations[surfaceLabel]);
    }
  }
  await captureStandardViews(page, label);

  await browser.close();
}

// ---- BEFORE: Shyam's own raw surface photos, default (no-op) calibration ----
await runPhase("before", [
  ["Floor", BEFORE_PHOTOS.floor],
  ["Wall", BEFORE_PHOTOS.wall],
  ["Ceiling", BEFORE_PHOTOS.ceiling],
]);

// ---- AFTER: Phase 5 lever-1 source textures, calibrated ----
await runPhase(
  "after",
  [
    ["Floor", ROOT + defaults.surfaces.floor.sourceFile],
    ["Wall", ROOT + defaults.surfaces.wall.sourceFile],
    ["Ceiling", ROOT + defaults.surfaces.ceiling.sourceFile],
  ],
  {
    Floor: defaults.surfaces.floor.calibration,
    Wall: defaults.surfaces.wall.calibration,
    Ceiling: defaults.surfaces.ceiling.calibration,
  },
);

console.log("done — see v2-review/shell-quality/screenshots/");
