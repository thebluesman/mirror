#!/usr/bin/env node
/*
 * process-glb.mjs - PoC 3 / W-A (D1): inspect + rescale + floor-snap + recenter
 * a generated GLB to known cm dimensions.
 *
 * Uses @gltf-transform/{core,functions,extensions} from npm (registry.npmjs.org
 * is reachable from this environment; unpkg/jsDelivr are not, so this script
 * never fetches anything at runtime beyond reading the local input file).
 *
 * What it does to <in.glb>:
 *   1. Inspect: polycount (triangle count across all mesh primitives), texture
 *      count + pixel sizes, and the current bounding-box size (in the file's
 *      native units, assumed meters per glTF convention).
 *   2. Rescale: wraps the whole scene in one new root node and scales it,
 *      per-axis, so its bounding box matches --dims WxDxH (cm, converted to
 *      meters /100 to match glTF's meter convention).
 *   3. Floor-snap: translates so the new bounding box's min-Y is exactly 0.
 *   4. Recenter: translates so the new bounding box is centered on X and Z
 *      (i.e. bbox center X/Z -> 0/0), matching how scene2.html positions
 *      furniture by its footprint center.
 *   5. Writes <item>.processed.glb (or --out).
 *
 * CLI:
 *   node process-glb.mjs <in.glb> --dims WxDxH --out <out.glb>
 *   node process-glb.mjs <in.glb> --dims 98x90x76 --out glb/swivel-chair.processed.glb
 *
 * Install (once): cd spike/import && npm install
 * (package.json in this directory lists the three @gltf-transform packages
 * as dependencies; node_modules/ is not committed -- see spike/import/README.md.)
 */
import fs from "node:fs";
import path from "node:path";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dims") args.dims = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
    else args._.push(a);
  }
  return args;
}

function usage() {
  console.log(
    `Usage: node process-glb.mjs <in.glb> --dims WxDxH --out <out.glb>\n\n` +
    `  <in.glb>     path to the source GLB (e.g. from generate-item.py)\n` +
    `  --dims WxDxH target dimensions in CM, e.g. 98x90x76 (W=x, D=z, H=y)\n` +
    `  --out FILE   output path for the processed GLB\n`
  );
}

function parseDims(s) {
  const m = /^([\d.]+)x([\d.]+)x([\d.]+)$/i.exec((s || "").trim());
  if (!m) {
    throw new Error(
      `--dims must be WxDxH in cm (e.g. 98x90x76), got ${JSON.stringify(s)}`
    );
  }
  const [, w, d, h] = m;
  return { w: Number(w), d: Number(d), h: Number(h) };
}

function fmtVec(v) {
  return `[${v.map((n) => n.toFixed(4)).join(", ")}]`;
}

async function countTriangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices();
      if (indices) {
        tris += indices.getCount() / 3;
      } else {
        const pos = prim.getAttribute("POSITION");
        if (pos) tris += pos.getCount() / 3;
      }
    }
  }
  return Math.round(tris);
}

function inspectTextures(doc) {
  return doc.getRoot().listTextures().map((tex, i) => {
    let size = null;
    try {
      size = tex.getSize(); // [width, height] or null if undecodable
    } catch {
      size = null;
    }
    return {
      index: i,
      name: tex.getName() || null,
      mimeType: tex.getMimeType() || null,
      size,
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args._.length === 0 || !args.dims || !args.out) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const inPath = path.resolve(args._[0]);
  const outPath = path.resolve(args.out);
  const targetCm = parseDims(args.dims);
  const target = { w: targetCm.w / 100, d: targetCm.d / 100, h: targetCm.h / 100 }; // cm -> m

  if (!fs.existsSync(inPath)) {
    console.error(`Input GLB not found: ${inPath}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(inPath);

  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  if (!scene) {
    console.error("GLB has no scene to process.");
    process.exit(1);
  }

  // --- Inspect (before) ------------------------------------------------
  const triCountBefore = await countTriangles(doc);
  const textures = inspectTextures(doc);
  const boundsBefore = getBounds(scene);
  const sizeBefore = [
    boundsBefore.max[0] - boundsBefore.min[0],
    boundsBefore.max[1] - boundsBefore.min[1],
    boundsBefore.max[2] - boundsBefore.min[2],
  ];

  console.log(`Input: ${inPath}`);
  console.log(`  Triangles: ${triCountBefore}`);
  console.log(`  Textures: ${textures.length}`);
  for (const t of textures) {
    console.log(
      `    [${t.index}] ${t.name || "(unnamed)"} ${t.mimeType || "?"} ` +
      `${t.size ? t.size[0] + "x" + t.size[1] : "(size unknown)"}`
    );
  }
  console.log(`  Bounds (m): min ${fmtVec(boundsBefore.min)} max ${fmtVec(boundsBefore.max)}`);
  console.log(`  Size (m):   ${fmtVec(sizeBefore)}`);

  for (const [axis, i] of [["w/x", 0], ["h/y", 1], ["d/z", 2]]) {
    if (sizeBefore[i] <= 1e-9) {
      console.warn(
        `  WARNING: source bounds are ~zero on axis ${axis}; scale factor for ` +
        `that axis will be forced to 1 to avoid divide-by-zero / infinite scale.`
      );
    }
  }

  // --- Rescale: wrap in one new root node, scale per-axis --------------
  const targetSize = [target.w, target.h, target.d]; // note axis order x,y,z
  const scaleFactors = targetSize.map((t, i) =>
    sizeBefore[i] > 1e-9 ? t / sizeBefore[i] : 1
  );

  const originalChildren = scene.listChildren();
  const wrapper = doc.createNode("processed-root").setScale(scaleFactors);
  for (const child of originalChildren) {
    scene.removeChild(child);
    wrapper.addChild(child);
  }
  scene.addChild(wrapper);

  // --- Floor-snap + recenter X/Z ----------------------------------------
  // getBounds() reads current node transforms, so this reflects the scale
  // applied above (translation is still zero on the wrapper at this point).
  const boundsScaled = getBounds(scene);
  const centerX = (boundsScaled.min[0] + boundsScaled.max[0]) / 2;
  const minY = boundsScaled.min[1];
  const centerZ = (boundsScaled.min[2] + boundsScaled.max[2]) / 2;

  wrapper.setTranslation([-centerX, -minY, -centerZ]);

  const boundsAfter = getBounds(scene);
  const sizeAfter = [
    boundsAfter.max[0] - boundsAfter.min[0],
    boundsAfter.max[1] - boundsAfter.min[1],
    boundsAfter.max[2] - boundsAfter.min[2],
  ];

  console.log(`\nTarget dims (cm): W=${targetCm.w} D=${targetCm.d} H=${targetCm.h}`);
  console.log(`Scale factors (x,y,z): ${fmtVec(scaleFactors)}`);
  console.log(`Bounds after (m): min ${fmtVec(boundsAfter.min)} max ${fmtVec(boundsAfter.max)}`);
  console.log(`Size after (m):   ${fmtVec(sizeAfter)}  (cm: ${sizeAfter.map(s => (s * 100).toFixed(2)).join(", ")})`);
  console.log(`Floor (min-Y): ${boundsAfter.min[1].toFixed(6)} (should be ~0)`);
  console.log(
    `XZ center: (${((boundsAfter.min[0] + boundsAfter.max[0]) / 2).toFixed(6)}, ` +
    `${((boundsAfter.min[2] + boundsAfter.max[2]) / 2).toFixed(6)}) (should be ~0, ~0)`
  );

  await io.write(outPath, doc);
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
