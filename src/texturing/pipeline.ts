// Browser-only glue around ./tileable.ts's pure algorithm: gets an uploaded
// photo (File/Blob) into a square RgbaImage, runs it through makeTileable,
// and encodes the result back to a Blob for storage in the OPFS asset store
// (src/storage/assets.ts). Uses OffscreenCanvas/ImageBitmap — no DOM element
// needs to be attached, so this works from any context (component, worker).
//
// Not unit-tested directly (OffscreenCanvas/createImageBitmap aren't
// available under vitest's node environment) — the algorithm it wraps is
// unit-tested in tileable.test.ts, and this thin layer is exercised
// end-to-end in-browser (see the Phase 3 verification notes).

import { makeTileable, type RgbaImage } from "./tileable";

export interface TileableOptions {
  /** Working square size in px. Spike default 1024. */
  size?: number;
  /** Cross-fade band half-width in px. Spike default 96 (at size 1024). */
  blendPx?: number;
  /** JPEG encode quality, 0..1. */
  quality?: number;
}

const DEFAULTS: Required<TileableOptions> = { size: 1024, blendPx: 96, quality: 0.92 };

async function loadBitmap(source: Blob): Promise<ImageBitmap> {
  return createImageBitmap(source);
}

/** Center-crop `bitmap` to a square and resize to `size`x`size`, returning it
 *  as a plain RgbaImage the pure algorithm can consume. */
function bitmapToSquareRgba(bitmap: ImageBitmap, size: number): RgbaImage {
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);

  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("pipeline: 2d context unavailable");
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  const imageData = ctx.getImageData(0, 0, size, size);
  return { width: size, height: size, data: imageData.data };
}

async function rgbaToJpegBlob(img: RgbaImage, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("pipeline: 2d context unavailable");
  const imageData = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
  ctx.putImageData(imageData, 0, 0);
  return canvas.convertToBlob({ type: "image/jpeg", quality });
}

/** Full pipeline: uploaded photo -> tileable albedo JPEG blob, ready for
 *  storage.putAsset(). Mirrors make-tileable.mjs end to end (crop-to-square,
 *  resize, quadrant-swap, cross-fade), just on Canvas instead of sharp. */
export async function photoToTileableBlob(input: Blob, opts: TileableOptions = {}): Promise<Blob> {
  const { size, blendPx, quality } = { ...DEFAULTS, ...opts };
  const bitmap = await loadBitmap(input);
  try {
    const square = bitmapToSquareRgba(bitmap, size);
    const tiled = makeTileable(square, blendPx);
    return await rgbaToJpegBlob(tiled, quality);
  } finally {
    bitmap.close();
  }
}
