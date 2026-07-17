#!/usr/bin/env node
/*
 * Spike 3 driver — one command that looks at what's in spike/inputs/, runs every
 * step that has its input available, and reports exactly what's still missing.
 * Safe to re-run any time (idempotent: existing outputs are skipped, so a re-run
 * never re-spends fal.ai credits).
 *
 * Usage (from the repo root or spike/):
 *   node spike/run-spike3.mjs             # do everything possible, report the rest
 *   node spike/run-spike3.mjs --cc0       # also fetch CC0 sets for surfaces without a photo
 *   node spike/run-spike3.mjs --status    # report only, run nothing
 *   FAL_KEY=... node spike/run-spike3.mjs # required only for the generation step
 *
 * Input layout (drop files here, names must match):
 *   spike/inputs/items/swivel-chair.jpg|png|webp   product photo per item
 *   spike/inputs/items/shoe-cabinet.jpg|png|webp   (ids come from import/items.json)
 *   spike/inputs/items/bookshelf.jpg|png|webp
 *   spike/inputs/surfaces/wall.jpg|png             straight-on surface photos
 *   spike/inputs/surfaces/floor.jpg|png            (optional if using --cc0 instead)
 *   spike/inputs/surfaces/ceiling.jpg|png
 *   spike/inputs/reference/couch.jpg|png           room photos from the two camera
 *   spike/inputs/reference/reverse.jpg|png         views (mandatory for C2 judging)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPIKE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const STATUS_ONLY = args.includes("--status");
const FETCH_CC0 = args.includes("--cc0");
const EXTS = [".jpg", ".jpeg", ".png", ".webp"];

const ok = [], todo = [], skipped = [];
const say = (s) => console.log(s);

function findInput(dir, base) {
  for (const e of EXTS) {
    const p = path.join(SPIKE, "inputs", dir, base + e);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function run(cmd, argv, env = {}) {
  say(`  $ ${cmd} ${argv.join(" ")}`);
  execFileSync(cmd, argv, { stdio: "inherit", cwd: path.dirname(SPIKE), env: { ...process.env, ...env } });
}
function ensureDeps(dir) {
  if (!fs.existsSync(path.join(SPIKE, dir, "node_modules"))) {
    say(`[deps] installing npm packages in spike/${dir}/ (first run only)…`);
    execFileSync("npm", ["install", "--no-audit", "--no-fund"], { stdio: "inherit", cwd: path.join(SPIKE, dir) });
  }
}

// ---------------------------------------------------------------- W-A items
const manifest = JSON.parse(fs.readFileSync(path.join(SPIKE, "import", "items.json"), "utf8"));
say("\n=== W-A: furniture items (import/items.json) ===");
for (const item of manifest.items) {
  const raw = path.join(path.dirname(SPIKE), item.glb);
  const processed = path.join(path.dirname(SPIKE), item.processedGlb);
  const image = findInput("items", item.id);
  const dims = `${item.dims.w}x${item.dims.d}x${item.dims.h}`;

  if (fs.existsSync(processed)) { ok.push(`${item.id}: processed GLB ready (${item.processedGlb})`); continue; }
  if (STATUS_ONLY) {
    todo.push(fs.existsSync(raw) ? `${item.id}: raw GLB present — run without --status to process it`
      : image ? `${item.id}: input image present — run with FAL_KEY set to generate (~$0.80)`
      : `${item.id}: drop a photo at spike/inputs/items/${item.id}.jpg (see items.json notes for the preferred shot)`);
    continue;
  }
  if (!fs.existsSync(raw)) {
    if (!image) { todo.push(`${item.id}: no input image — drop one at spike/inputs/items/${item.id}.jpg (notes in items.json)`); continue; }
    if (!process.env.FAL_KEY) { todo.push(`${item.id}: image found (${path.relative(process.cwd(), image)}) but FAL_KEY is not set — re-run with FAL_KEY=... to generate (~$0.80)`); continue; }
    say(`[${item.id}] generating via fal.ai Meshy 6 from ${path.basename(image)}…`);
    run("python3", [path.join(SPIKE, "import", "generate-item.py"), "--image", image, "--item", item.id]);
  }
  ensureDeps("import");
  say(`[${item.id}] processing GLB → true cm ${dims}, floor-snap…`);
  run("node", [path.join(SPIKE, "import", "process-glb.mjs"), raw, "--dims", dims, "--out", processed]);
  ok.push(`${item.id}: generated + processed`);
}

// -------------------------------------------------------------- W-B surfaces
say("\n=== W-B: shell surfaces (textures/) ===");
for (const surface of ["wall", "floor", "ceiling"]) {
  const albedo = path.join(SPIKE, "textures", surface, "albedo.jpg");
  const photo = findInput("surfaces", surface);
  if (fs.existsSync(albedo)) { ok.push(`${surface}: texture set ready (spike/textures/${surface}/)`); continue; }
  if (STATUS_ONLY) {
    todo.push(photo ? `${surface}: photo present — run without --status to make it tileable`
      : `${surface}: add spike/inputs/surfaces/${surface}.jpg, or use --cc0 for a stock set`);
    continue;
  }
  if (photo) {
    ensureDeps("textures");
    say(`[${surface}] making tileable texture from ${path.basename(photo)}…`);
    run("node", [path.join(SPIKE, "textures", "make-tileable.mjs"), "--input", photo, "--surface", surface]);
    ok.push(`${surface}: tileable texture built from your photo`);
  } else if (FETCH_CC0) {
    ensureDeps("textures");
    say(`[${surface}] no photo — fetching CC0 candidates (fetch-textures.mjs covers all missing surfaces at once)…`);
    run("node", [path.join(SPIKE, "textures", "fetch-textures.mjs")]);
    if (fs.existsSync(albedo)) ok.push(`${surface}: CC0 set fetched`);
    else todo.push(`${surface}: CC0 fetch didn't produce a set (see its READY/MISSING report) — add a photo instead`);
  } else {
    todo.push(`${surface}: no photo at spike/inputs/surfaces/${surface}.* — add one, or re-run with --cc0`);
  }
}

// ------------------------------------------------------------- reference photos
say("\n=== Reference photos (mandatory for the C2 whole-room judgment) ===");
const refs = {};
for (const view of ["couch", "reverse"]) {
  refs[view] = findInput("reference", view);
  (refs[view] ? ok : todo).push(refs[view]
    ? `reference/${view}: found`
    : `reference/${view}: add spike/inputs/reference/${view}.jpg (photo of the room from the ${view}-view camera position)`);
}

// ---------------------------------------------------------------- captures
const anyItem = manifest.items.some(i => fs.existsSync(path.join(path.dirname(SPIKE), i.processedGlb)));
const anySurface = ["wall", "floor", "ceiling"].some(s => fs.existsSync(path.join(SPIKE, "textures", s, "albedo.jpg")));
if (!STATUS_ONLY && (anyItem || anySurface)) {
  say("\n=== Rendering contact-sheet captures → spike/out3/ ===");
  try {
    run("node", [path.join(SPIKE, "capture.mjs"), "--out", path.join(SPIKE, "out3")]);
    const rows = ["couch", "reverse"].map(view => `
  <h2 style="font-size:16px;color:#aaa;">${view} view — render vs reference</h2>
  <div style="display:flex;flex-wrap:wrap;">
    <div style="margin:4px;"><div style="font-size:12px;color:#999;">scene2 (imports+shell as available)</div>
      <img src="scene2-${view}.png" style="width:480px;border:1px solid #444;"/></div>
    <div style="margin:4px;"><div style="font-size:12px;color:#999;">reference photo</div>
      ${refs[view] ? `<img src="../inputs/reference/${path.basename(refs[view])}" style="width:480px;border:1px solid #444;"/>`
                   : `<div style="width:480px;color:#c66;border:1px dashed #644;padding:40px;">missing — add spike/inputs/reference/${view}.jpg</div>`}</div>
  </div>`).join("\n");
    fs.writeFileSync(path.join(SPIKE, "out3", "contact-sheet.html"),
      `<!doctype html><html><head><meta charset="utf-8"/><title>PoC 3 — C2 contact sheet</title></head>
<body style="background:#111;color:#eee;font-family:sans-serif;padding:24px;">
<h1 style="font-size:20px;">PoC 3 — whole-room similarity (judge per poc3-plan.md §2)</h1>
<p style="font-size:13px;color:#999;">C1 gate: open <code>scene2.html?imports=side</code> and orbit each generated item, including its back.
C2 bar: the side-by-sides below — "that's my room," without caveats.</p>${rows}</body></html>`);
    ok.push("captures + spike/out3/contact-sheet.html written");
  } catch (e) { todo.push(`capture step failed: ${e.message}`); }
} else if (!STATUS_ONLY) {
  skipped.push("captures: nothing generated yet (no processed GLBs, no textures) — baseline renders already exist in spike/out2/");
}

// ---------------------------------------------------------------- summary
say("\n================ SPIKE 3 STATUS ================");
if (ok.length) { say("\nDone / ready:"); ok.forEach(s => say("  ✓ " + s)); }
if (skipped.length) { say("\nSkipped:"); skipped.forEach(s => say("  - " + s)); }
if (todo.length) { say("\nStill needed from you:"); todo.forEach(s => say("  → " + s)); }
else say("\nAll inputs satisfied. Judge per poc3-plan.md §2:");
say(`
Next steps:
  1. C1 gate:  cd spike && python3 -m http.server 8000
               open http://localhost:8000/scene2.html?imports=side  (orbit; check backs)
  2. C2 bar:   open spike/out3/contact-sheet.html  (render vs reference, both views)
  3. Record:   spike/OUTCOME-3.md  (go / qualified go / no-go, poc3-plan.md §2)
`);
