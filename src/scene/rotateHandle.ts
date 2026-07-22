// v2 spike (W-A, C1 follow-up — see spike-v2/OUTCOME.md): pure trig for the
// rotate-drag handle Viewport.tsx renders next to a selected item. Kept
// framework-free (same "pure algorithm, no THREE dependency" shape as
// collision.ts/snapping.ts) so it's unit-testable without a THREE.Scene and
// so the per-pointermove drag handler can call it with no THREE.Vector
// overhead.
//
// Convention matches collision.ts's itemFootprintAABB (verified there
// against THREE.Object3D's actual rotation.y behavior): a local offset of
// (0, r) along +Z rotates by yaw degrees to a world-space offset of
// (r*sin(yaw), r*cos(yaw)) from the item's center. The handle rests at that
// local +Z offset when yaw is 0, so "where is the handle" and "what yaw does
// pointing at X make" are inverses of the same rotation.

/** Yaw (degrees, normalized to [0,360)) that points the item's local +Z axis
 *  (where the rotate handle rests at yaw 0) at the given world-space pointer
 *  position, measured from the item's own center. Independent of how far the
 *  pointer is from the center — only the direction matters — so this is what
 *  a rotate-drag sets `group.rotation.y` to on every pointermove. */
export function yawDegFromPointer(centerX: number, centerZ: number, pointerX: number, pointerZ: number): number {
  const dx = pointerX - centerX;
  const dz = pointerZ - centerZ;
  const deg = (Math.atan2(dx, dz) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** Rounds a yaw (degrees) to the nearest multiple of `stepDeg`, normalized to
 *  [0, 360). PRD-v2 §11.4 (decided): a rotate-handle drag snaps to the same
 *  15deg steps as the `q`/`e` keyboard shortcut by default (Viewport.tsx frees
 *  it to continuous rotation while Shift is held), consistent with how
 *  translate-snapping is escapable. Kept here beside the other rotate trig so
 *  it's unit-testable without a THREE.Scene. */
export function snapYawDeg(yawDeg: number, stepDeg: number): number {
  const snapped = Math.round(yawDeg / stepDeg) * stepDeg;
  return ((snapped % 360) + 360) % 360;
}

/** World-space (x, z) for the rotate handle itself, given the item's center,
 *  its current yaw (degrees), and how far out along its local +Z the handle
 *  sits. The exact inverse of `yawDegFromPointer` — feeding this function's
 *  output back into that one returns the same yaw. */
export function rotateHandleWorldXZ(
  centerX: number,
  centerZ: number,
  yawDeg: number,
  offset: number,
): [number, number] {
  const rad = (yawDeg * Math.PI) / 180;
  return [centerX + offset * Math.sin(rad), centerZ + offset * Math.cos(rad)];
}
