// Pure logic for Phase 5's named camera viewpoints (PRD §7 flow 4, plan-v1.md
// Phase 5 item 1: "save/recall"). Kept separate from Viewport/ViewportChrome's
// React+Three.js state so id/slug generation is unit-testable without a
// WebGL context in the loop — same split as import/applyImport.ts.

import type { CameraPosition } from "../schema/scene";

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "view";
}

function uniqueId(base: string, existingIds: Set<string>): string {
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Builds a new named CameraPosition from a live eye/lookAt/fov reading,
 *  deriving a unique id from the given name (same slug-then-number-suffix
 *  scheme as ImportPanel's item ids) so two views named e.g. "Couch" don't
 *  collide. Pure — caller appends the result to `sceneFile.cameras`. */
export function makeCameraPosition(
  name: string,
  eye: readonly [number, number, number],
  lookAt: readonly [number, number, number],
  fovDeg: number,
  existingCameras: readonly CameraPosition[],
): CameraPosition {
  const id = uniqueId(slugify(name), new Set(existingCameras.map((c) => c.id)));
  return {
    id,
    name: name.trim() || id,
    eye: [...eye],
    lookAt: [...lookAt],
    fovDeg,
  };
}
