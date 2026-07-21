// Live shell-texture application (Phase 3): applies a photo-derived texture
// + tint/repeat/roughnessScale calibration to the room shell materials
// buildScene() already created, targeting the material objects directly
// (Phase 3's own mesh/material-building code — no structural mesh-finding
// needed, unlike spike/textures/shell-textures.mjs, which had to rediscover
// meshes in scene2.html by material-reference-equality/geometry-type
// because it couldn't touch that file). Reimplements shell-textures.mjs's
// `applyMapsToMaterial` calibration math (tint multiply, repeat scaling,
// roughness scaling) against THREE.MeshStandardMaterial directly.
//
// Not unit-tested directly (three.js/WebGL-shaped, no meaningful behavior to
// assert without a renderer) — exercised in-browser (see Phase 3
// verification notes) and via the schema tests covering the calibration data
// it consumes.

import * as THREE from "three";
import { SHELL_BASE, type ShellMeshes } from "./buildScene";
import type { SurfaceCalibration } from "../schema/scene";
import { DEFAULT_SURFACE_CALIBRATION } from "../schema/scene";

export type ShellSurface = "wall" | "floor" | "ceiling";

/** A decoded texture image ready to become a THREE.Texture, plus the hash it
 *  came from (so callers can skip redundant reloads). */
export interface SurfaceTextureSource {
  assetHash: string;
  bitmap: ImageBitmap;
}

const wallRepeatDefault: [number, number] = [2, 2.4]; // sane default: ~2m tiling, ~2.4m (room height) tall

/** Meters-scale repeat estimate from a set of wall meshes' own BoxGeometry
 *  parameters — mirrors shell-textures.mjs's estimateWallRepeat, adapted to
 *  our BoxGeometry-based wall segments (width/depth = the wall-plane span,
 *  not the fixed 10cm thickness). */
function estimateWallRepeat(wallMeshes: THREE.Mesh[]): [number, number] {
  if (!wallMeshes.length) return [...wallRepeatDefault];
  let sumLen = 0;
  let sumH = 0;
  let n = 0;
  wallMeshes.forEach((m) => {
    const p = (m.geometry as THREE.BoxGeometry).parameters;
    if (!p) return;
    const longDim = Math.max(p.width ?? 0, p.depth ?? 0);
    sumLen += longDim;
    sumH += p.height ?? 0;
    n++;
  });
  if (!n) return [...wallRepeatDefault];
  return [Math.max(1, sumLen / n / 100), Math.max(1, sumH / n / 100)]; // cm -> m-scale repeat
}

/** cm-true 60cm-tile repeat for one floor mesh, from its own PlaneGeometry
 *  parameters (pre-rotation extents == the rect's [w, d] in cm). */
function floorBaseRepeat(mesh: THREE.Mesh): [number, number] {
  const p = (mesh.geometry as THREE.PlaneGeometry).parameters;
  return [p.width / 60, p.height / 60];
}

/** Meters-scale estimate for ceiling — same shared-material approach as
 *  wall, since ceiling meshes here share one material (see buildScene.ts). */
function estimateCeilingRepeat(ceilingMeshes: THREE.Mesh[]): [number, number] {
  if (!ceilingMeshes.length) return [2, 2];
  let sumW = 0;
  let sumD = 0;
  ceilingMeshes.forEach((m) => {
    const p = (m.geometry as THREE.PlaneGeometry).parameters;
    sumW += p.width ?? 0;
    sumD += p.height ?? 0;
  });
  const n = ceilingMeshes.length;
  return [Math.max(1, sumW / n / 100), Math.max(1, sumD / n / 100)];
}

function applyRepeatCalibration(base: [number, number], calib: SurfaceCalibration): [number, number] {
  return [base[0] * calib.repeat[0], base[1] * calib.repeat[1]];
}

/** Reset color/roughness to the surface's original untextured base, then
 *  apply tint/roughnessScale multiplicatively — idempotent across repeated
 *  calls (unlike naively multiplying into whatever the material currently
 *  holds, which would compound on every slider tick). */
function resetToBase(mat: THREE.MeshStandardMaterial, surface: ShellSurface, hasTexture: boolean) {
  const base = SHELL_BASE[surface];
  mat.color.setHex(hasTexture ? 0xffffff : base.color);
  mat.roughness = base.roughness;
}

function applyCalibrationToMaterial(
  mat: THREE.MeshStandardMaterial,
  surface: ShellSurface,
  calib: SurfaceCalibration,
  hasTexture: boolean,
) {
  resetToBase(mat, surface, hasTexture);
  if (calib.tint && calib.tint !== "#ffffff") {
    mat.color.multiply(new THREE.Color(calib.tint));
  }
  mat.roughness = Math.max(0, Math.min(1, mat.roughness * calib.roughnessScale));
  mat.needsUpdate = true;
}

function makeTexture(bitmap: ImageBitmap, repeat: [number, number]): THREE.Texture {
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.needsUpdate = true;
  return texture;
}

/**
 * Apply a surface's calibration (tint/repeat/roughnessScale) and, if
 * `textureSource` is provided, its photo-derived map to every mesh/material
 * for that surface. Returns any newly-created THREE.Texture instances so the
 * caller can track and dispose them on unmount/re-apply (avoids leaking a
 * texture per calibration change).
 */
export function applyShellSurface(
  shell: ShellMeshes,
  surface: ShellSurface,
  calib: SurfaceCalibration = DEFAULT_SURFACE_CALIBRATION,
  textureSource: SurfaceTextureSource | null,
): THREE.Texture[] {
  const created: THREE.Texture[] = [];
  const hasTexture = textureSource != null;

  if (surface === "wall") {
    const mat = shell.wallMaterial;
    applyCalibrationToMaterial(mat, "wall", calib, hasTexture);
    if (textureSource) {
      const repeat = applyRepeatCalibration(estimateWallRepeat(shell.wallMeshes), calib);
      const tex = makeTexture(textureSource.bitmap, repeat);
      mat.map = tex;
      created.push(tex);
    } else {
      mat.map = null;
    }
    mat.needsUpdate = true;
    return created;
  }

  if (surface === "ceiling") {
    const mat = shell.ceilingMaterial;
    applyCalibrationToMaterial(mat, "ceiling", calib, hasTexture);
    if (textureSource) {
      const repeat = applyRepeatCalibration(estimateCeilingRepeat(shell.ceilingMeshes), calib);
      const tex = makeTexture(textureSource.bitmap, repeat);
      mat.map = tex;
      created.push(tex);
    } else {
      mat.map = null;
    }
    mat.needsUpdate = true;
    return created;
  }

  // floor: per-rect cloned materials, each with its own cm-true repeat.
  shell.floorMeshes.forEach((mesh) => {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    applyCalibrationToMaterial(mat, "floor", calib, hasTexture);
    if (textureSource) {
      const repeat = applyRepeatCalibration(floorBaseRepeat(mesh), calib);
      const tex = makeTexture(textureSource.bitmap, repeat);
      mat.map = tex;
      created.push(tex);
    } else {
      mat.map = null;
    }
    mat.needsUpdate = true;
  });
  return created;
}

/**
 * Cheap path for a numeric-only calibration change (tint/repeat/
 * roughnessScale) on a surface whose texture (or lack of one) hasn't
 * changed: mutates the already-applied material(s)/texture(s) in place —
 * tint/roughness via applyCalibrationToMaterial, repeat via the existing
 * `THREE.Texture.repeat` vector — instead of decoding the photo again and
 * creating a new THREE.Texture. No async work, no ImageBitmap involved (the
 * bitmap behind the current texture may already be closed), so this is safe
 * to call synchronously and as often as calibration changes (e.g. once per
 * debounced slider tick — see Viewport.tsx's calibration effect).
 */
export function updateSurfaceCalibrationInPlace(
  shell: ShellMeshes,
  surface: ShellSurface,
  calib: SurfaceCalibration,
): void {
  function applyToMaterial(mat: THREE.MeshStandardMaterial, base: [number, number]) {
    const hasTexture = mat.map != null;
    applyCalibrationToMaterial(mat, surface, calib, hasTexture);
    if (mat.map) {
      const repeat = applyRepeatCalibration(base, calib);
      mat.map.repeat.set(repeat[0], repeat[1]);
      mat.map.needsUpdate = true;
    }
    mat.needsUpdate = true;
  }

  if (surface === "wall") {
    applyToMaterial(shell.wallMaterial, estimateWallRepeat(shell.wallMeshes));
    return;
  }
  if (surface === "ceiling") {
    applyToMaterial(shell.ceilingMaterial, estimateCeilingRepeat(shell.ceilingMeshes));
    return;
  }
  shell.floorMeshes.forEach((mesh) => {
    applyToMaterial(mesh.material as THREE.MeshStandardMaterial, floorBaseRepeat(mesh));
  });
}
