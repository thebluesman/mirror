// v2 spike (W-C, D5): Hunyuan3D generation script — parallels
// spike/import/generate-item.py's shape (standalone script, not app code,
// per v2-spike-plan.md §4 "W-C is scripted"). Per R1's recommendation, this
// is a small sibling module rather than a generalization of
// src/import/falClient.ts.
//
// Endpoint confirmed live (not guessed) against fal's own OpenAPI schema and
// a real 422-validation probe before any paid call was made:
//   fal-ai/hunyuan-3d/v3.1/pro/image-to-3d
// Corrections to R1-hunyuan-memo.md's inferred schema, found via this probe:
//   - Input field is `input_image_url`, not `image_url`.
//   - Output GLB lives at `model_glb.url`, not `model_mesh.url` (memo's
//     guess) — falClient.ts's GLB_URL_KEY_CANDIDATES already lists
//     "model_glb.url" as its #2 candidate, so no extraction-logic change is
//     needed either way, just noting the correction for the record.
//   - This one endpoint IS the multi-view endpoint — up to 8 named
//     view-angle fields (back_image_url, left_image_url, right_image_url,
//     top_image_url, bottom_image_url, left_front_image_url,
//     right_front_image_url) are all optional inputs on the *same*
//     image-to-3d call, not a separate `/multi-view` endpoint the way the
//     v2 family works. Confirmed via `curl` against fal's public
//     `/api/openapi/queue/openapi.json?endpoint_id=...` endpoint (no auth
//     needed, no cost) plus a $0-cost 422 probe (empty input) that listed
//     `input_image_url` as the only required field.
// Pricing confirmed live (curl against the model's public page, no auth):
//   base $0.375/generation; +$0.15 enable_pbr; +$0.15 multi-view images;
//   +$0.15 custom face_count. This replaces R1's triangulated table for
//   this endpoint with real numbers — see spike-v2/OUTCOME.md D5.
//
// Usage (FAL_KEY must be set in the environment, never hardcoded/committed):
//   node spike-v2/d5-generate.mjs single water-cooler
//   node spike-v2/d5-generate.mjs single bookshelf
//   node spike-v2/d5-generate.mjs single sonderod-rug
//   node spike-v2/d5-generate.mjs multiview table
//
// Downloads the GLB to spike-v2/d5-assets/generated/<name>-hunyuan.glb and
// appends a result record (endpoint, input shape, elapsed ms, request id —
// NOT the key) to spike-v2/d5-generation-log.json for the OUTCOME writeup.

import { fal } from "@fal-ai/client";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ASSETS = HERE + "d5-assets/";
const GENERATED_DIR = ASSETS + "generated/";
const LOG_PATH = HERE + "d5-generation-log.json";
const ENDPOINT = "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d";

const SINGLE_IMAGE_ITEMS = {
  "water-cooler": ASSETS + "existing-assets/water-cooler-source.png",
  bookshelf: ASSETS + "existing-assets/bookshelf-source.png",
  "sonderod-rug": ASSETS + "existing-assets/sonderod-rug-source.webp",
};

// angle-1.png: straight front-on shot. angle-3.png: 3/4 perspective showing
// the table's right end + front face — mapped to `right_front_image_url`
// (the closest of the 8 named fields to what that photo actually shows).
// No genuine back/side/left photo exists in the staged inputs (angle-2 is a
// near-duplicate of angle-1, angle-4 a low-res duplicate) — see
// spike-v2/OUTCOME.md D5 for the honest coverage caveat this implies.
const MULTIVIEW_ITEMS = {
  table: {
    input_image_url: ASSETS + "table-angles/angle-1.png",
    right_front_image_url: ASSETS + "table-angles/angle-3.png",
  },
};

function log(...args) {
  console.log(...args);
}

function loadLog() {
  if (!existsSync(LOG_PATH)) return [];
  return JSON.parse(readFileSync(LOG_PATH, "utf8"));
}

function saveLog(entries) {
  writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2) + "\n");
}

async function uploadPath(path) {
  const bytes = readFileSync(path);
  const ext = path.split(".").pop().toLowerCase();
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  const file = new File([bytes], path.split("/").pop(), { type: mime });
  return await fal.storage.upload(file);
}

async function run(name, input) {
  const key = process.env.FAL_KEY;
  if (!key) {
    console.error("FAL_KEY not set in environment. Refusing to run (never hardcode it).");
    process.exit(1);
  }
  fal.config({ credentials: key });

  mkdirSync(GENERATED_DIR, { recursive: true });

  log(`[${name}] submitting to ${ENDPOINT} ...`);
  const t0 = Date.now();
  const { data, requestId } = await fal.subscribe(ENDPOINT, {
    input,
    logs: true,
    onQueueUpdate: (status) => {
      if (status.status === "IN_PROGRESS") {
        const last = status.logs?.[status.logs.length - 1];
        if (last?.message) log(`  [${name}] ${last.message}`);
      } else {
        log(`  [${name}] ${status.status}`);
      }
    },
  });
  const elapsedMs = Date.now() - t0;

  const glbUrl = data?.model_glb?.url ?? data?.model_urls?.glb?.url;
  if (!glbUrl) {
    console.error(`[${name}] no GLB url found in response:`, JSON.stringify(data, null, 2));
    process.exit(1);
  }

  const res = await fetch(glbUrl);
  if (!res.ok) throw new Error(`GLB download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const outPath = GENERATED_DIR + `${name}-hunyuan.glb`;
  writeFileSync(outPath, buf);

  log(`[${name}] done in ${elapsedMs}ms, GLB ${buf.length} bytes -> ${outPath}`);

  const entries = loadLog();
  entries.push({
    name,
    endpoint: ENDPOINT,
    requestId,
    inputFieldsUsed: Object.keys(input),
    elapsedMs,
    glbBytes: buf.length,
    seed: data?.seed ?? null,
    ranAt: new Date().toISOString(),
  });
  saveLog(entries);
}

const [, , mode, itemName] = process.argv;

if (mode === "single") {
  const photoPath = SINGLE_IMAGE_ITEMS[itemName];
  if (!photoPath) {
    console.error(`Unknown single-image item "${itemName}". Options: ${Object.keys(SINGLE_IMAGE_ITEMS).join(", ")}`);
    process.exit(1);
  }
  const uploadedUrl = await uploadPath(photoPath);
  await run(itemName, { input_image_url: uploadedUrl, enable_pbr: true });
} else if (mode === "multiview") {
  const spec = MULTIVIEW_ITEMS[itemName];
  if (!spec) {
    console.error(`Unknown multi-view item "${itemName}". Options: ${Object.keys(MULTIVIEW_ITEMS).join(", ")}`);
    process.exit(1);
  }
  const input = { enable_pbr: true };
  for (const [field, path] of Object.entries(spec)) {
    input[field] = await uploadPath(path);
  }
  await run(itemName, input);
} else {
  console.error("Usage: node d5-generate.mjs <single|multiview> <item-name>");
  process.exit(1);
}
