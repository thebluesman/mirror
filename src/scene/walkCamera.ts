// improvements-v2.1 §5: walk-around camera mode — pure math for WASD-relative
// movement and for deriving a synthetic lookAt point from PointerLockControls'
// camera-quaternion-only orientation. Kept framework-free (same "pure
// algorithm, no THREE dependency" shape as rotateHandle.ts/elevation.ts) so
// both pieces are unit-testable without a WebGL context, and so Viewport.tsx's
// per-frame call sites don't pay for any THREE.Vector allocation beyond what
// PointerLockControls itself already needs.
//
// improvements-minor-fixes.md §4/§12: crouch eye height and the hard-stop
// collision check below extend the same file rather than starting a new one
// — both are still "camera math with no THREE dependency," and §12 reuses
// collision.ts's own AABB type/overlap test rather than duplicating it.
//
// improvements-minor-fixes.md §12 (revisited, 2026-07-22): the v1 hard-stop
// response (whole-frame XZ revert on any overlap) and the fact that rugs
// were themselves colliding both turned out to be real navigation problems,
// not polish — see resolveWalkCollision and isWalkCollidableItem below.
import { aabbOverlap, type AABB } from "./collision";
import type { FurnitureItem } from "./types";

/** Which WASD keys are currently held, keyed by intent rather than physical
 *  key (w/a/s/d) so Viewport.tsx's keydown/keyup handlers are the only place
 *  that knows which literal keys map to "forward" etc. */
export interface WalkInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

/** Fixed eye height (cm) walk mode holds the camera at. WASD movement never
 *  touches Y (see computeWalkStep's comment on PointerLockControls.moveForward
 *  /moveRight already being horizontal-only), so this is the one place camera
 *  height gets set for walk mode — applied once, on entering the mode, not
 *  re-applied every frame. A plausible human eye height in the scene's cm
 *  units; not measured against Shyam's actual room — the PRD scopes this as
 *  walk-around navigation, not a precise avatar/collision simulation.
 */
export const WALK_EYE_HEIGHT_CM = 160;

/** improvements-minor-fixes.md §4: seated/crouched eye height (cm), swapped
 *  in for WALK_EYE_HEIGHT_CM by Viewport.tsx's "C" toggle while walk mode is
 *  active. An instant snap, not an eased transition, the same "drag-free,
 *  instant-toggle" shape as the existing "L" lock feature — computeWalkStep's
 *  velocity integration has nothing to hook an eye-height tween into without
 *  adding a whole separate animation-state machine for one cosmetic axis, so
 *  this stays a plain constant swap rather than a per-frame interpolation.
 *  ~120cm approximates a seated/crouched human eye height, sibling to
 *  WALK_EYE_HEIGHT_CM's own "plausible, not measured" standing figure. */
export const WALK_CROUCH_EYE_HEIGHT_CM = 120;

/** Constant walk speed (cm/sec) — no acceleration or momentum, per the PRD's
 *  "simple constant-speed walk, no physics" scope. ~1.5 m/s is an unhurried
 *  indoor walking pace, chosen so crossing a typical room takes a few
 *  deliberate seconds rather than an instant teleport or a crawl. */
export const WALK_SPEED_CM_PER_SEC = 150;

/** How far ahead (cm) of the camera the synthetic lookAt point sits — see
 *  deriveSyntheticLookAt. Arbitrary but consistent: only the *direction* from
 *  eye to lookAt is ever read back out (getCurrentView's consumers reconstruct
 *  a look direction from the two points), so the exact distance doesn't
 *  matter as long as it's a fixed, nonzero constant every caller shares. */
export const SYNTHETIC_LOOKAT_DISTANCE_CM = 200;

/** Forward/right movement distances for one animate() frame, given which
 *  WASD keys are held and how much time (seconds) elapsed since the last
 *  frame. Diagonal input (e.g. W+D held together) is normalized to the same
 *  total speed as a single key — without this, pressing two keys at once
 *  would move at sqrt(2)x speed, a classic FPS-movement bug. The result feeds
 *  directly into PointerLockControls.moveForward/moveRight, which already
 *  project onto the horizontal (X/Z) plane regardless of camera pitch (its
 *  moveForward crosses camera.up against the camera's own local X axis, and
 *  moveRight uses that local X axis directly — neither ever has a Y
 *  component), so this function never has to touch elevation itself: walk
 *  mode's "WASD is strictly horizontal, mouselook is free" split falls out of
 *  composing this with the library's own movement methods, not from any
 *  extra clamping here. */
export function computeWalkStep(
  input: WalkInput,
  speedCmPerSec: number,
  deltaSec: number,
): { forward: number; right: number } {
  const f = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
  const r = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (f === 0 && r === 0) return { forward: 0, right: 0 };
  const mag = Math.hypot(f, r);
  const dist = speedCmPerSec * deltaSec;
  return { forward: (f / mag) * dist, right: (r / mag) * dist };
}

/** Synthetic lookAt point for ViewportHandle.getCurrentView() while walk mode
 *  is active. PointerLockControls has no `target` the way OrbitControls does
 *  — it derives look direction purely from the camera's own quaternion (see
 *  Viewport.tsx's getCurrentView for the full eye/lookAt compatibility
 *  reasoning) — so there's nothing to read a lookAt point off of directly.
 *  The caller gets a forward *direction* out of THREE (PointerLockControls
 *  .getDirection(), a unit vector derived from camera.quaternion) and passes
 *  its components here as a plain [x,y,z] tuple; this function is just "walk
 *  `distance` cm out from eye along that direction," kept pure/testable
 *  rather than inlined as one more ad hoc THREE.Vector3 call. */
export function deriveSyntheticLookAt(
  eye: readonly [number, number, number],
  forwardDirection: readonly [number, number, number],
  distance: number,
): [number, number, number] {
  return [
    eye[0] + forwardDirection[0] * distance,
    eye[1] + forwardDirection[1] * distance,
    eye[2] + forwardDirection[2] * distance,
  ];
}

/** improvements-minor-fixes.md §12: half-width (cm) of the square footprint
 *  walk mode's hard-stop check uses in place of the camera's true (zero-
 *  radius) point position — without a buffer, the hard stop would only
 *  trigger once the eye point itself is already inside a wall/item AABB,
 *  reading as the view clipping flush into the surface before movement
 *  actually stops. ~30cm is a shoulder-width-ish personal-space buffer, in
 *  the same "plausible, not measured" spirit as WALK_EYE_HEIGHT_CM — not
 *  meant to model a real body's girth. */
export const WALK_COLLISION_RADIUS_CM = 30;

/** World-space AABB for the walk-mode hard-stop check: a `radius`-cm square
 *  centered on the camera's XZ position. Deliberately a square, not a true
 *  circle — collision.ts's aabbOverlap only knows AABBs, and a slight
 *  over-estimate at the corners is the same "conservative, not wrong" trade
 *  itemFootprintAABB's own header comment already accepts for rotated
 *  furniture footprints. */
export function walkCameraFootprintAABB(x: number, z: number, radius: number): AABB {
  return { minX: x - radius, maxX: x + radius, minZ: z - radius, maxZ: z + radius };
}

/** True if the given XZ position, expanded to a WALK_COLLISION_RADIUS_CM
 *  footprint, overlaps any item or wall AABB. Originally written to check
 *  only the camera's *current* (post-full-step) position for the v1 whole-
 *  frame hard stop; kept as the single-position primitive both that v1 shape
 *  and §12's revisited per-axis resolveWalkCollision below build on — it just
 *  answers "is this one XZ spot clear," not which axis a caller should
 *  attribute a collision to. Pure/testable without a WebGL context, same
 *  shape as collision.ts's own checkCollisions. */
export function walkStepCollides(
  x: number,
  z: number,
  radius: number,
  items: readonly AABB[],
  walls: readonly AABB[],
): boolean {
  const footprint = walkCameraFootprintAABB(x, z, radius);
  return items.some((aabb) => aabbOverlap(footprint, aabb)) || walls.some((aabb) => aabbOverlap(footprint, aabb));
}

/** improvements-minor-fixes.md §12 (revisited): axis-independent "slide
 *  along the surface" collision response, replacing the v1 whole-frame hard
 *  revert. The v1 shape applied a frame's full moveForward/moveRight step
 *  and then reverted the *entire* XZ move back to (prevX, prevZ) if the
 *  resulting spot collided — which meant brushing a wall or item on one axis
 *  (e.g. strafing into a wall on X while also moving cleanly along Z) froze
 *  movement on the other axis too, the confirmed "tight spaces are nearly
 *  unnavigable" problem.
 *
 *  This instead treats the X and Z deltas independently: does moving to
 *  `nextX` (holding Z at its pre-step value) collide? If not, keep it, else
 *  fall back to `prevX`. Separately, does moving to `nextZ` (holding X at
 *  its pre-step value) collide? If not, keep it, else fall back to `prevZ`.
 *  Both checks are against the *pre-step* position on the other axis, not
 *  chained off each other's result — deliberately "two independent
 *  candidates," matching how a standard FPS slide response is scoped
 *  (compute (x+dx, z) and (x, z+dz) as two separate candidates), not a
 *  three-way combined/ordered resolution that would make the outcome depend
 *  on which axis happens to be checked first. Viewport.tsx's animate loop
 *  calls this once per frame after speculatively applying moveForward/
 *  moveRight (PointerLockControls mutates camera.position in place; there's
 *  no "propose a position" API to check beforehand), passing in the pre-step
 *  position and the post-step position it just read back off the camera. */
export function resolveWalkCollision(
  prevX: number,
  prevZ: number,
  nextX: number,
  nextZ: number,
  radius: number,
  items: readonly AABB[],
  walls: readonly AABB[],
): { x: number; z: number } {
  const x = walkStepCollides(nextX, prevZ, radius, items, walls) ? prevX : nextX;
  const z = walkStepCollides(prevX, nextZ, radius, items, walls) ? prevZ : nextZ;
  return { x, z };
}

/** improvements-minor-fixes.md §12 (revisited): true for any item that
 *  should still block walk-mode movement. Flat floor coverings (rugs) don't
 *  block walking in real life — `sonderod-rug`'s `category: "rug"` tag
 *  (object-categories.md) is the signal Viewport.tsx's
 *  allItemFootprintAABBs() filters on before handing the AABB list to
 *  resolveWalkCollision/walkStepCollides, so a rug never enters the
 *  walk-collision list at all rather than being excluded deeper in the AABB
 *  math. Room-shell walls are untouched by this — wallFootprintAABBs stays a
 *  separate, fully-collidable list. */
export function isWalkCollidableItem(item: Pick<FurnitureItem, "category">): boolean {
  return item.category !== "rug";
}
