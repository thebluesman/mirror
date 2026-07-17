#!/usr/bin/env node
/**
 * make-tileable.mjs — turn one of Shyam's straight-on surface photos into a
 * tileable albedo map, written into the same spike/textures/<surface>/ layout
 * that fetch-textures.mjs produces (poc3-plan.md §4 W-B, "make tileable
 * textures directly from his photos" path).
 *
 * Algorithm (deliberately simple — this is a spike helper, not a texture-
 * synthesis tool):
 *   1. Center-crop the input to a square, resize to --size (default 1024).
 *   2. Quadrant-swap ("offset by 50%,50% with wraparound"): this is the
 *      standard trick that makes the new left/right and top/bottom EDGES
 *      match automatically (they become adjacent original pixels), at the
 *      cost of moving the original seam to a cross through the CENTER of the
 *      image.
 *   3. Cross-fade that center seam: blend in a mirrored copy of the image
 *      (flopped for the vertical seam, flipped for the horizontal seam)
 *      inside a soft band around the center lines, using a generated alpha
 *      mask. Mirrored content is continuous with itself at the fold, so this
 *      hides the hard edge without any content-aware inpainting.
 *   4. Write <textures-root>/<surface>/albedo.jpg.
 *
 * Usage:
 *   node make-tileable.mjs --input photo.jpg --surface wall [--size 1024] [--blend 96]
 *
 * Requires: sharp (declared in spike/textures/package.json — `npm install` once).
 */

import sharp from "sharp";
import path from "node:path";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { size: 1024, blend: 96 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") out.input = argv[++i];
    else if (a === "--surface") out.surface = argv[++i];
    else if (a === "--size") out.size = Number(argv[++i]);
    else if (a === "--blend") out.blend = Number(argv[++i]);
    else if (a === "--out") out.out = argv[++i]; // override output path (used by self-test)
  }
  return out;
}

/** Smoothstep-falloff band mask as a raw RGBA buffer: alpha=255 at `center`,
 * fading to 0 by `center ± halfWidth`, varying along `axis` ('x' or 'y') and
 * constant along the other axis. */
function bandMaskBuffer(size, axis, center, halfWidth) {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coord = axis === "x" ? x : y;
      const d = Math.abs(coord - center);
      const t = Math.max(0, Math.min(1, 1 - d / halfWidth));
      const alpha = Math.round(t * t * (3 - 2 * t) * 255); // smoothstep
      const idx = (y * size + x) * 4;
      data[idx] = 255; data[idx + 1] = 255; data[idx + 2] = 255; data[idx + 3] = alpha;
    }
  }
  return data;
}

/** Composite `topRgb` over `baseRgb` (both size x size RGB buffers), gated by
 * an alpha band mask, returning a new size x size RGB buffer. */
async function blendWithMask(baseRgbBuf, topRgbBuf, size, maskBuf) {
  const topWithAlpha = await sharp(topRgbBuf, { raw: { width: size, height: size, channels: 3 } })
    .ensureAlpha()
    .composite([{ input: maskBuf, raw: { width: size, height: size, channels: 4 }, blend: "dest-in" }])
    .raw()
    .toBuffer();

  const merged = await sharp(baseRgbBuf, { raw: { width: size, height: size, channels: 3 } })
    .composite([{ input: topWithAlpha, raw: { width: size, height: size, channels: 4 }, blend: "over" }])
    .removeAlpha()
    .raw()
    .toBuffer();

  return merged;
}

/** Wraparound offset by size/2 in both axes via quadrant swap. */
async function quadrantSwap(rgbBuf, size) {
  const half = size / 2;
  const img = sharp(rgbBuf, { raw: { width: size, height: size, channels: 3 } });
  const q = {
    tl: await img.clone().extract({ left: 0, top: 0, width: half, height: half }).raw().toBuffer(),
    tr: await img.clone().extract({ left: half, top: 0, width: half, height: half }).raw().toBuffer(),
    bl: await img.clone().extract({ left: 0, top: half, width: half, height: half }).raw().toBuffer(),
    br: await img.clone().extract({ left: half, top: half, width: half, height: half }).raw().toBuffer(),
  };
  // Diagonal swap: TL<->BR, TR<->BL puts each quadrant's opposite-corner
  // neighbor where it can meet edge-continuous content.
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite([
      { input: q.br, raw: { width: half, height: half, channels: 3 }, left: 0, top: 0 },
      { input: q.bl, raw: { width: half, height: half, channels: 3 }, left: half, top: 0 },
      { input: q.tr, raw: { width: half, height: half, channels: 3 }, left: 0, top: half },
      { input: q.tl, raw: { width: half, height: half, channels: 3 }, left: half, top: half },
    ])
    .raw()
    .toBuffer();
}

export async function makeTileable({ input, size = 1024, blend = 96 }) {
  const meta = await sharp(input).metadata();
  const side = Math.min(meta.width, meta.height);
  const left = Math.floor((meta.width - side) / 2);
  const top = Math.floor((meta.height - side) / 2);

  const croppedRgb = await sharp(input)
    .extract({ left, top, width: side, height: side })
    .resize(size, size)
    .removeAlpha()
    .toColorspace("srgb")
    .raw()
    .toBuffer();

  const swapped = await quadrantSwap(croppedRgb, size);

  // Vertical seam (runs along x = size/2, full height): blend in a
  // horizontally-mirrored ("flopped") copy.
  const mirrorH = await sharp(swapped, { raw: { width: size, height: size, channels: 3 } })
    .flop()
    .raw()
    .toBuffer();
  const maskV = bandMaskBuffer(size, "x", size / 2, blend);
  const afterVertical = await blendWithMask(swapped, mirrorH, size, maskV);

  // Horizontal seam (runs along y = size/2, full width): blend in a
  // vertically-mirrored ("flipped") copy of the result so far.
  const mirrorV = await sharp(afterVertical, { raw: { width: size, height: size, channels: 3 } })
    .flip()
    .raw()
    .toBuffer();
  const maskH = bandMaskBuffer(size, "y", size / 2, blend);
  const final = await blendWithMask(afterVertical, mirrorV, size, maskH);

  return sharp(final, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 92 });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.input || !opts.surface) {
    console.error("Usage: node make-tileable.mjs --input <photo.jpg> --surface <wall|floor|ceiling> [--size 1024] [--blend 96]");
    process.exitCode = 1;
    return;
  }
  const outDir = opts.out ? path.dirname(opts.out) : path.join(__dirname, opts.surface);
  const outFile = opts.out || path.join(outDir, "albedo.jpg");
  await fsp.mkdir(outDir, { recursive: true });

  const pipeline = await makeTileable(opts);
  await pipeline.toFile(outFile);

  await fsp.writeFile(
    path.join(outDir, "SOURCE.txt"),
    `surface: ${opts.surface}\nsource: photo (make-tileable.mjs)\ninput: ${path.resolve(opts.input)}\nsize: ${opts.size}\nblend: ${opts.blend}px\ngenerated: ${new Date().toISOString()}\n`
  );

  console.log(`[make-tileable] wrote ${outFile}`);
}

// Only run the CLI when invoked directly (so shell-textures.mjs / tests can
// import { makeTileable } without side effects).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[make-tileable] FATAL", err);
    process.exitCode = 1;
  });
}
