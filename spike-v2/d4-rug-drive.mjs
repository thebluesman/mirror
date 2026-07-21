// v2 spike (W-B, D4 — rug fix ladder lever 2, see spike-v2/OUTCOME.md and
// v2-spike-plan.md §2's W-B bar): drives the running dev server with
// Playwright to capture before/after evidence for the SONDEROD rug's
// flat-textured-plane fallback, same one-off-capture-script shape as
// w-a-drive.mjs/d2-collision-snap-drive.mjs/d3-layouts-drive.mjs.
//
// Important caveats (recorded here and in OUTCOME.md's D4 section):
// 1. This sandbox has no access to Shyam's real browser profile, where the
//    rug item's actual completed Meshy import (glbHash + GLB asset) already
//    lives in OPFS/IndexedDB — that's the real "before" the plan's rug-fix
//    ladder is judging against. The committed seed JSON
//    (seed/living-room.json) never carries binary hashes (those only exist
//    in a live project's storage, not the hand-authored seed), so "before"
//    here is the seed's own current fallback for a glbHash-less item: the
//    flat-color placeholder box addFurnitureBoxMeshes renders. This script
//    demonstrates the mechanism (photo -> flat textured plane, replacing
//    whatever placeholder an unphotographed/un-generated box item would
//    otherwise show) end to end; it is not a faithful "bad Meshy mesh" vs.
//    "flat plane" comparison — that comparison is Shyam's to make at C2 in
//    his own session, per plan §2 and this task's brief.
// 2. The seed's one shipped camera ("couch-view") is a waist-height,
//    coffee-table-blocked view of the rug (the coffee table sits at
//    [713,0,561.5], between the camera and the rug at [683,0,540] — the
//    same occlusion risk D2's OUTCOME entry already flagged for evidence
//    capture). Rather than fight OrbitControls via synthetic mouse drags
//    (which risks re-selecting/dragging a furniture item instead of
//    orbiting — the exact trap D2 hit), this script injects one extra
//    evidence-only camera ("rug-eval-view", steep-angle, unobstructed) as
//    `cameras[0]` directly into the persisted IndexedDB record — it's not
//    added to the committed seed file, purely a runtime patch for this
//    capture.
//
// Run with the dev server already up:
//   node spike-v2/d4-rug-drive.mjs
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEV_URL = "http://localhost:5183/";
const OUT = fileURLToPath(new URL("./d4-screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const photoPath = fileURLToPath(new URL("./assets/sonderod-rug-photo.png", import.meta.url));
const photoBase64 = readFileSync(photoPath).toString("base64");

async function getRecord(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("mirror");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("project", "readonly");
          const getReq = tx.objectStore("project").get("current");
          getReq.onsuccess = () => resolve(getReq.result);
          getReq.onerror = () => reject(getReq.error);
        };
      }),
  );
}

async function putRecord(page, record) {
  await page.evaluate(
    (rec) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("mirror");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("project", "readwrite");
          const putReq = tx.objectStore("project").put(rec, "current");
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        };
      }),
    record,
  );
}

const RUG_EVAL_CAMERA = {
  id: "rug-eval-view",
  name: "rug-eval-view",
  // Steep, near-overhead angle centered on the rug's own placement
  // ([683, 0, 540] per seed/living-room.json), high enough to clear the
  // 240cm ceiling headroom and inside the living-room floor rect
  // (x:[474,1130], z:[324,702]) so the camera never pokes through a wall —
  // chosen purely so this evidence capture isn't occluded by the coffee
  // table the way the seed's "couch-view" is (v2-spike-plan.md D2's
  // documented evidence-framing trap). Not part of the committed seed.
  eye: [683, 220, 620],
  lookAt: [683, 0, 540],
  fovDeg: 45,
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[browser console error]", msg.text());
});

await page.goto(DEV_URL);
// Clean seed, same as the other D-scripts, so this run's screenshots aren't
// polluted by a prior run's OPFS/IndexedDB state.
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

// Inject the evidence-only camera as cameras[0] (Viewport.tsx's structural
// effect frames on `cameras[0]` at first build) and reload once so "before"
// and "after" are shot from the identical, unobstructed angle.
let record = await getRecord(page);
record.cameras = [RUG_EVAL_CAMERA, ...record.cameras];
await putRecord(page, record);
await page.reload();
await page.waitForSelector("canvas", { timeout: 15000 });
await page.waitForTimeout(1500);

await page.screenshot({ path: OUT + "0-before-placeholder.png" });
console.log("captured 0-before-placeholder.png (rug as today's seed renders it: flat-color placeholder box)");

// Also capture the seed's own shipped "couch-view" camera, for completeness
// against the plan's "judged ... at the two standard views" framing — the
// rug is mostly hidden behind the coffee table from this angle either way
// (see the module header caveat), so this mainly confirms the change
// doesn't regress the one camera Shyam's seed actually ships.
await page.getByRole("button", { name: "couch-view", exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "0b-before-couch-view.png" });
console.log("captured 0b-before-couch-view.png (seed's shipped camera, rug occluded by coffee table either way)");
await page.getByRole("button", { name: "rug-eval-view", exact: true }).click();
await page.waitForTimeout(300);

// Store the rug photo into the app's own OPFS asset store (content-addressed
// by SHA-256, exactly matching src/storage/assets.ts's putAsset), then patch
// the persisted IndexedDB project record so the rug item carries
// `flatTextureHash` pointing at it — the same shape a real import flow would
// leave behind, without going through any UI (there's no rug-specific import
// UI; that's out of scope per the task brief, network-generation levers
// aside).
const flatTextureHash = await page.evaluate(async (base64) => {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "image/png" });
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("assets", { create: true });
  const fileHandle = await dir.getFileHandle(hash, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  return hash;
}, photoBase64);
console.log("stored rug photo in OPFS, hash:", flatTextureHash);

record = await getRecord(page);
record.items = record.items.map((item) =>
  item.id === "sonderod-rug" ? { ...item, flatTextureHash } : item,
);
await putRecord(page, record);
console.log("patched persisted project record: sonderod-rug now carries flatTextureHash");

await page.reload();
await page.waitForSelector("canvas", { timeout: 15000 });
// Extra settle time beyond the other scripts' 1500ms: the flat-texture load
// is one more async OPFS round-trip (getAsset + createImageBitmap) on top of
// the structural build.
await page.waitForTimeout(2000);

const postReloadRecord = await getRecord(page);
const postRug = postReloadRecord.items.find((i) => i.id === "sonderod-rug");
console.log("post-reload rug item:", JSON.stringify(postRug));

await page.screenshot({ path: OUT + "1-after-flat-texture.png" });
console.log("captured 1-after-flat-texture.png (rug rendered as a flat box with the photo mapped onto its top face)");

await page.getByRole("button", { name: "couch-view", exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "1b-after-couch-view.png" });
console.log("captured 1b-after-couch-view.png (seed's shipped camera, after the fix)");

await browser.close();
