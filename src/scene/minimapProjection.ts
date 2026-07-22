// improvements-minor-fixes.md §13: top-down HUD minimap — pure world-cm ->
// canvas-px math, factored out the same "framework-free, unit-testable"
// shape as rotateHandle.ts/elevation.ts/walkCamera.ts, so Minimap.tsx's
// per-frame draw() calls carry no test-only overhead and the coordinate math
// isn't only exercisable through a canvas element. Scene X maps to canvas X
// (right) and scene Z maps to canvas Y (down) — a direct top-down
// projection, no room rotation to account for (per the doc's own note that
// this is simpler than anything Three.js already does here).

import type { RoomBoundsCm } from "./cameraBounds";

export interface MinimapProjection {
  /** Canvas px per scene cm, uniform on both axes so a room never stretches. */
  scale: number;
  offsetXPx: number;
  offsetYPx: number;
}

/** Fits `bounds` into a canvasWidth x canvasHeight box with `paddingPx` clear
 *  on every side, preserving the room's aspect ratio (so a long/narrow room
 *  doesn't stretch to fill a square canvas) and centering it within whichever
 *  axis has leftover space. A zero-sized room (e.g. computeRoomBoundsCm's own
 *  no-floor-data fallback) degenerates to scale=1 centered on the canvas
 *  rather than dividing by zero. */
export function computeMinimapProjection(
  bounds: RoomBoundsCm,
  canvasWidthPx: number,
  canvasHeightPx: number,
  paddingPx: number,
): MinimapProjection {
  const roomW = bounds.maxX - bounds.minX;
  const roomD = bounds.maxZ - bounds.minZ;
  if (roomW <= 0 || roomD <= 0) {
    return { scale: 1, offsetXPx: canvasWidthPx / 2, offsetYPx: canvasHeightPx / 2 };
  }
  const availW = Math.max(canvasWidthPx - paddingPx * 2, 1);
  const availH = Math.max(canvasHeightPx - paddingPx * 2, 1);
  const scale = Math.min(availW / roomW, availH / roomD);
  const projectedW = roomW * scale;
  const projectedD = roomD * scale;
  return {
    scale,
    offsetXPx: (canvasWidthPx - projectedW) / 2 - bounds.minX * scale,
    offsetYPx: (canvasHeightPx - projectedD) / 2 - bounds.minZ * scale,
  };
}

/** World (x, z) cm -> canvas px, per computeMinimapProjection's mapping. */
export function worldToMinimapPx(xCm: number, zCm: number, projection: MinimapProjection): [number, number] {
  return [xCm * projection.scale + projection.offsetXPx, zCm * projection.scale + projection.offsetYPx];
}

/** Normalizes a (possibly non-unit, possibly zero) XZ direction to a unit
 *  vector for the minimap's facing wedge. A near-zero input — the orbit
 *  target sitting almost on top of the camera — falls back to a fixed
 *  default direction rather than dividing by ~0 and drawing a degenerate
 *  wedge. */
export function normalizeXZ(dx: number, dz: number): [number, number] {
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return [0, -1]; // arbitrary default facing when the direction is degenerate
  return [dx / len, dz / len];
}
