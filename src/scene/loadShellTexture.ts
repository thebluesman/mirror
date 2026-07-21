// Bridges Phase 2's OPFS asset store to Phase 3's live shell materials:
// given a stored asset hash, decode it into an ImageBitmap ready for
// applyShellSurface (src/scene/shellMaterials.ts). Kept as its own tiny
// module so shellMaterials.ts stays free of storage-layer imports.

import { getAsset } from "../storage/assets";
import type { SurfaceTextureSource } from "./shellMaterials";

export async function loadShellTexture(assetHash: string): Promise<SurfaceTextureSource | null> {
  const blob = await getAsset(assetHash);
  if (!blob) return null;
  const bitmap = await createImageBitmap(blob);
  return { assetHash, bitmap };
}
