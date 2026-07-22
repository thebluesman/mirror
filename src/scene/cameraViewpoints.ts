// Pure logic for Phase 5's named camera viewpoints (PRD §7 flow 4, plan-v1.md
// Phase 5 item 1: "save/recall"). Kept separate from Viewport/ViewportChrome's
// React+Three.js state so id/slug generation is unit-testable without a
// WebGL context in the loop — same split as import/applyImport.ts.

import type { CameraPosition } from "../schema/scene";
import { slugify, uniqueId } from "../util/slug";

/** Builds a new named CameraPosition from a live eye/lookAt/fov reading,
 *  deriving a unique id from the given name (same slug-then-number-suffix
 *  scheme as ImportPanel's item ids — see util/slug.ts) so two views named
 *  e.g. "Couch" don't collide. Pure — caller appends the result to
 *  `sceneFile.cameras`. */
export function makeCameraPosition(
  name: string,
  eye: readonly [number, number, number],
  lookAt: readonly [number, number, number],
  fovDeg: number,
  existingCameras: readonly CameraPosition[],
): CameraPosition {
  const id = uniqueId(slugify(name, "view"), new Set(existingCameras.map((c) => c.id)));
  return {
    id,
    name: name.trim() || id,
    eye: [...eye],
    lookAt: [...lookAt],
    fovDeg,
  };
}

/** In-place rename (PRD-v2 §7.2): updates a saved viewpoint's display `name`
 *  only — `id`, `eye`, `lookAt`, and `fovDeg` are untouched, so recall and any
 *  other reference to this viewpoint's id keep working unchanged. Same
 *  blank-name fallback `makeCameraPosition` uses (trim, fall back to the
 *  stable id) rather than re-slugifying — the id was already minted at
 *  creation. Pure — caller replaces the matching entry in
 *  `sceneFile.cameras`. */
export function renameCameraPosition(camera: CameraPosition, name: string): CameraPosition {
  return { ...camera, name: name.trim() || camera.id };
}
