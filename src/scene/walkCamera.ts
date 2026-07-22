// improvements-v2.1 §5: walk-around camera mode — pure math for WASD-relative
// movement and for deriving a synthetic lookAt point from PointerLockControls'
// camera-quaternion-only orientation. Kept framework-free (same "pure
// algorithm, no THREE dependency" shape as rotateHandle.ts/elevation.ts) so
// both pieces are unit-testable without a WebGL context, and so Viewport.tsx's
// per-frame call sites don't pay for any THREE.Vector allocation beyond what
// PointerLockControls itself already needs.

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
