// Pure logic for Phase 5's named camera viewpoints (PRD §7 flow 4, plan-v1.md
// Phase 5 item 1: "save/recall"). Kept separate from Viewport/ViewportChrome's
// React+Three.js state so id/slug generation is unit-testable without a
// WebGL context in the loop — same split as import/applyImport.ts.

import type { CameraPosition } from "../schema/scene";
import { slugify, uniqueId } from "../util/slug";
import { deriveSyntheticLookAt, SYNTHETIC_LOOKAT_DISTANCE_CM } from "./walkCamera";

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

/** Reads a live eye/lookAt/fov framing off a camera, mode-aware the same way
 *  ViewportHandle.getCurrentView() is: OrbitControls' `target` IS the lookAt
 *  point by construction, but walk mode (PointerLockControls) has no
 *  equivalent — its lookAt has to be synthesized by walking a fixed distance
 *  out from the eye along the camera's forward direction
 *  (`deriveSyntheticLookAt`). Pure (plain number tuples in, no THREE
 *  dependency), so both getCurrentView() and Viewport.tsx's structural-
 *  rebuild cleanup (which stashes this reading so the *next* build restores
 *  the user's actual view instead of resetting to `cameras[0]` — see
 *  improvements-minor-fixes.md §15) can share one derivation instead of
 *  hand-rolling the walk-mode branch twice. */
export function deriveLiveCameraReading(
  eye: readonly [number, number, number],
  fovDeg: number,
  mode: "orbit" | "walk",
  orbitTarget: readonly [number, number, number],
  walkForwardDirection: readonly [number, number, number],
): CameraPosition {
  const lookAt =
    mode === "walk"
      ? deriveSyntheticLookAt(eye, walkForwardDirection, SYNTHETIC_LOOKAT_DISTANCE_CM)
      : [...orbitTarget];
  return {
    id: "__live-camera-reading__",
    name: "__live-camera-reading__",
    eye: [...eye],
    lookAt: lookAt as [number, number, number],
    fovDeg,
  };
}

/** Picks which CameraPosition a structural scene rebuild should start the
 *  camera/controls from (improvements-minor-fixes.md §15). `liveRestore` is
 *  Viewport.tsx's stash of the *previous* build's live camera framing
 *  (`pendingCameraRestoreRef`, captured via `deriveLiveCameraReading` in that
 *  build's cleanup) — null only before the very first build has ever run a
 *  cleanup. `cameras[0]`, the scene's first saved viewpoint, is exclusively
 *  the initial-mount fallback: every later rebuild — triggered by ANY
 *  `structuralSceneFile` dependency change, not just a camera-unrelated one
 *  like a furniture-item tint/flat-texture-upload/lock edit — must restore
 *  wherever the user was actually looking, not silently snap back to
 *  `cameras[0]` (the bug: it did, unconditionally, every time). Pure —
 *  Viewport.tsx applies the result to a fresh camera/controls pair. */
export function resolveStructuralBuildCameraPreset(
  liveRestore: CameraPosition | null,
  cameras: readonly CameraPosition[],
): CameraPosition | null {
  return liveRestore ?? cameras[0] ?? null;
}
