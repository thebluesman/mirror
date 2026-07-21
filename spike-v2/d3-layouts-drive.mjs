// v2 spike (W-A, D3): drives the running dev server with Playwright to
// capture evidence for the "multi-layout" bar in v2-spike-plan.md §2 —
// save a second named layout, switch between the two, both surviving a
// reload. Same one-off-capture shape as spike-v2/w-a-drive.mjs /
// d2-collision-snap-drive.mjs, not a test suite. Run with the dev server
// already up:
//   node spike-v2/d3-layouts-drive.mjs
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEV_URL = "http://127.0.0.1:5183/";
const OUT = fileURLToPath(new URL("./d3-screenshots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[browser console error]", msg.text());
});

async function resetDb() {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.deleteDatabase("mirror");
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      }),
  );
}

async function readProject() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
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
      }),
  );
}

await page.goto(DEV_URL);
await resetDb();
await page.reload();
await page.waitForSelector("canvas", { timeout: 15000 });
await page.waitForTimeout(1500);

await page.screenshot({ path: OUT + "0-initial-single-layout.png" });
console.log("captured 0-initial-single-layout.png (one layout pill expected: 'current')");

// Save a second layout from the current one.
await page.getByText("+ Save layout").click();
await page.getByPlaceholder("Layout name").fill("Weekend");
await page.getByText("Save as new").click();
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "1-after-save-second-layout.png" });
console.log("captured 1-after-save-second-layout.png (two pills: 'current', 'Weekend' -- Weekend active)");

const afterSave = await readProject();
console.log(
  "layouts after save:",
  afterSave.layouts.map((l) => ({ id: l.id, name: l.name, base: l.base, commandCount: l.commands.length })),
);
console.log("current after save:", afterSave.current);

// Switch back to the original layout.
await page.getByText("current", { exact: true }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: OUT + "2-switched-back-to-current.png" });
console.log("captured 2-switched-back-to-current.png ('current' pill now active)");

const afterSwitch = await readProject();
console.log("current after switching back:", afterSwitch.current);

// Reload — both layouts and the active selection should survive.
await page.reload();
await page.waitForSelector("canvas", { timeout: 15000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + "3-after-reload.png" });
console.log("captured 3-after-reload.png (both pills still present, 'current' still active)");

const afterReload = await readProject();
console.log(
  "layouts after reload:",
  afterReload.layouts.map((l) => l.id),
);
console.log("current after reload:", afterReload.current);

const layoutsMatch = JSON.stringify(afterSwitch.layouts) === JSON.stringify(afterReload.layouts);
const currentMatches = afterSwitch.current === afterReload.current;
console.log(
  layoutsMatch && currentMatches
    ? "PERSISTENCE OK: layouts + current survive reload"
    : "PERSISTENCE MISMATCH",
);

await browser.close();
