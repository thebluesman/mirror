import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Footprints, Orbit as OrbitIcon } from "lucide-react";
import {
  addFurnitureBoxMeshes,
  buildScene,
  furnitureOverallDims,
  sunPositionFromAngles,
  type BuiltScene,
} from "../scene/buildScene";
import { applyShellSurface, updateSurfaceCalibrationInPlace, type ShellSurface } from "../scene/shellMaterials";
import { loadShellTexture } from "../scene/loadShellTexture";
import { fitModelToDims, loadFurnitureModel } from "../scene/loadFurnitureModel";
import { computeFlatTextureFit, FULL_CONTENT_BOX, type ContentBox } from "../scene/flatItemTexture";
import { checkCollisions, itemFootprintAABB, wallFootprintAABBs, type AABB } from "../scene/collision";
import { snapPosition } from "../scene/snapping";
import { relativeYawDeg, rotateHandleWorldXZ, snapYawDeg, yawDegFromPointer } from "../scene/rotateHandle";
import { clampElevationCm, ELEVATION_STEP_CM, stepElevationCm } from "../scene/elevation";
import {
  computeWalkStep,
  deriveSyntheticLookAt,
  SYNTHETIC_LOOKAT_DISTANCE_CM,
  WALK_EYE_HEIGHT_CM,
  WALK_SPEED_CM_PER_SEC,
  type WalkInput,
} from "../scene/walkCamera";
import {
  DEFAULT_LIGHTING,
  DEFAULT_SURFACE_CALIBRATION,
  type CameraPosition,
  type Lighting,
  type ShellCalibration,
  type SurfaceCalibration,
} from "../schema/scene";
import type { FurnitureItem, SceneFile } from "../scene/types";
import "./Viewport.css";

// v2 spike (W-A, `v2/spike-arrange` — see spike-v2/OUTCOME.md): move + rotate
// + selection for a placed item, prototyped directly in the real viewport
// per v2-spike-plan.md §4. Spike-quality: the seam below is the thing being
// evaluated, not a finished feature. D1 built move/rotate/select; D2 (this
// pass) adds footprint collision flagging + wall/edge snapping on top of the
// same seam; named layouts/replace (D3) still isn't here.

/** Imperative handle for Phase 5's named-viewpoint save/recall (ViewportChrome
 *  drives this) — the live camera/controls only exist inside this component's
 *  Three.js build, so reading/setting them has to go through a ref rather
 *  than props. */
export interface ViewportHandle {
  /** Current eye/lookAt/fov, or null before the first structural build. */
  getCurrentView(): { eye: [number, number, number]; lookAt: [number, number, number]; fovDeg: number } | null;
  /** Snaps the live camera/controls to a saved viewpoint. No-op before the
   *  first structural build. */
  flyTo(preset: CameraPosition): void;
}

const HUMAN_FOV = 38; // ~35mm-equivalent, per spike 2's C2 feedback
const SHELL_SURFACES: ShellSurface[] = ["wall", "floor", "ceiling"];

// improvements-v2.1 §5: walk-around camera mode, additive to orbit (default
// stays "orbit" — nothing about existing behavior changes unless the user
// opts in via the HUD toggle). "orbit"/"walk" name the two mutually-exclusive
// control schemes below, not just a label — exactly one of OrbitControls/
// PointerLockControls is ever the thing actually moving the camera at a time
// (see applyCameraMode).
type CameraMode = "orbit" | "walk";

/** Applies a saved/seed CameraPosition to a live camera+controls pair —
 *  shared by the structural effect's initial-mount framing and
 *  ViewportHandle.flyTo's recall, so the two never drift apart. */
function applyCameraPreset(camera: THREE.PerspectiveCamera, controls: OrbitControls, preset: CameraPosition) {
  camera.position.set(...preset.eye);
  camera.fov = preset.fovDeg ?? HUMAN_FOV;
  camera.updateProjectionMatrix();
  controls.target.set(...preset.lookAt);
  controls.update();
}

// v2 spike D4 orientation-bug follow-up (see spike-v2/OUTCOME.md's D4
// addendum): the SONDEROD rug photo's raw pixel dimensions are an exactly
// square 1400x1400 canvas — a product-photography convention that pads a
// portrait or landscape photo out to a square tile — so `bitmap.width /
// bitmap.height` reports 1:1 no matter which way the actual rug pattern
// runs in-frame, and can't feed `needsOrientationRotation` a useful answer.
// This samples the bitmap down to a small canvas and finds the bounding box
// of non-background (near-white) pixels, returning that box (fractions of
// the bitmap's own width/height, image pixel-space convention — Y=0 top)
// so the caller can both derive an orientation-check aspect ratio from it
// AND crop the rendered texture to it (round 2 only did the former,
// discarding the box's coordinates — the padding stayed visible; this pass
// crops it out, see spike-v2/OUTCOME.md's D4 crop-fix addendum). Falls back
// to the full bitmap (`FULL_CONTENT_BOX`) if no content is found (e.g. a
// genuinely blank photo) so a detection miss can't throw or crop to
// nothing — same safety the old aspect-only fallback had.
const CONTENT_BOX_SAMPLE = 64;
const CONTENT_BG_THRESHOLD = 245; // near-white; product photos shoot on white/light backgrounds
function detectContentBox(bitmap: ImageBitmap): ContentBox {
  const canvas = document.createElement("canvas");
  canvas.width = CONTENT_BOX_SAMPLE;
  canvas.height = CONTENT_BOX_SAMPLE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return FULL_CONTENT_BOX;
  ctx.drawImage(bitmap, 0, 0, CONTENT_BOX_SAMPLE, CONTENT_BOX_SAMPLE);
  const { data } = ctx.getImageData(0, 0, CONTENT_BOX_SAMPLE, CONTENT_BOX_SAMPLE);
  let minX = CONTENT_BOX_SAMPLE;
  let maxX = -1;
  let minY = CONTENT_BOX_SAMPLE;
  let maxY = -1;
  for (let y = 0; y < CONTENT_BOX_SAMPLE; y++) {
    for (let x = 0; x < CONTENT_BOX_SAMPLE; x++) {
      const i = (y * CONTENT_BOX_SAMPLE + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r < CONTENT_BG_THRESHOLD || g < CONTENT_BG_THRESHOLD || b < CONTENT_BG_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return FULL_CONTENT_BOX; // no non-background pixels found
  // +0/+1 sample-index -> fraction-of-bitmap: the bounding box is inclusive
  // of the maxX/maxY sample, so its right/bottom edge fraction is (max+1)/N.
  return {
    minXFrac: minX / CONTENT_BOX_SAMPLE,
    maxXFrac: (maxX + 1) / CONTENT_BOX_SAMPLE,
    minYFrac: minY / CONTENT_BOX_SAMPLE,
    maxYFrac: (maxY + 1) / CONTENT_BOX_SAMPLE,
  };
}

// Clamps how far OrbitControls can orbit vertically — without this, an
// unclamped orbit can pass under the floor or over the ceiling and show the
// scene background color through them (belt-and-suspenders alongside the
// shell materials' `side: THREE.DoubleSide`, a Phase 1/2 code-review
// deferred finding fixed here).
const MIN_POLAR_ANGLE = 0.1;
const MAX_POLAR_ANGLE = Math.PI - 0.1;

// W-A rotate control: keyboard step, kept as-is. Tradeoff (recorded at D1,
// C1): a handle reads more "direct manipulation" and matches move's
// interaction model, but needs its own hit-testable geometry, an angle-from-
// drag calculation, and a way to keep it visible/clickable at any camera
// angle — real work for a spike whose core question was the floor-drag seam,
// not rotate UI polish. A keyboard step is a few lines, is trivially precise
// (exact 15deg increments fix the three known orientation bugs in seconds,
// per v2-spike-plan.md §3), and still round-trips through the identical
// commit-on-release path move uses.
const ROTATE_STEP_DEG = 15;

// v2 Phase 3 (PRD-v2 §7.8 / §11.1, decided 2026-07-22): elevation control,
// same "keyboard step, commit-on-keypress" shape as rotate above — a minimal
// control on the selected item, not free vertical dragging (no drag-plane,
// no pointer gesture at all). PageUp/PageDown were picked over a `+`/`-` pair
// because they read unambiguously as "up/down" rather than "more/less of
// whatever's selected," and neither collides with anything onKeyDown already
// binds (q/Q/[ and e/E/] for rotate, Escape for gesture-cancel) or with any
// browser chrome shortcut worth worrying about in an already-focused canvas.
// ELEVATION_STEP_CM (5) is the vertical analog of ROTATE_STEP_DEG (15) —
// factored into src/scene/elevation.ts alongside the floor clamp so it's
// unit-testable the same way rotateHandle.ts's snapYawDeg is.
const ELEVATION_KEY_UP = "PageUp";
const ELEVATION_KEY_DOWN = "PageDown";

// §3 (improvements-v2.1) manipulation-handle redesign — supersedes the C1
// follow-up's bare rotate sphere. Research pass (see this file's git commit
// body): browser room planners (IKEA Home Planner, Planner5D, RoomSketcher,
// Modsy) converge on the same two-part idiom — floor-plane drag-to-move for
// horizontal translation, plus a *ring around the footprint* for rotation —
// while three.js's TransformControls / Blender's per-axis gizmos are a poorer
// fit here (mode-switching, an unwanted scale gizmo, and their own raycast/
// state that would fight this component's mutate-during-gesture seam). We keep
// the existing body-drag as the horizontal gesture (it already snaps and
// flags collisions — a redundant translate handle would earn nothing), swap
// the sphere for a footprint rotation ring + grip knob, and add the one
// genuinely-missing affordance: a vertical drag handle for elevation, which
// until now had only PageUp/PageDown and no drag gesture at all.

// --- Rotation ring + knob (replaces the sphere) ---
// Gap between the footprint's outer radius and the ring, the ring's line
// thickness, and the grip-knob radius — all cm, same unit as the scene graph.
const ROTATE_RING_MARGIN_CM = 12;
const ROTATE_RING_TUBE_CM = 2.5;
const ROTATE_KNOB_RADIUS_CM = 6;
// Lift the ring a hair above the base plane so its flat torus doesn't z-fight
// the floor/rug it sits on.
const ROTATE_HANDLE_LIFT_CM = 1;

// --- Elevation (vertical) drag handle (net-new affordance) ---
// A vertical double-arrow floating above the item's top face. Gap above the
// top, stem (shaft) length, arrowhead length, and the two radii — cm.
const ELEVATION_HANDLE_GAP_CM = 18;
const ELEVATION_HANDLE_STEM_CM = 24;
const ELEVATION_HANDLE_CONE_CM = 9;
const ELEVATION_HANDLE_SHAFT_R_CM = 1.6;
const ELEVATION_HANDLE_CONE_R_CM = 4;

// Camera-relative grab-target sizing (PRD-v2 §7.1 polish): a fixed world-space
// size reads as a tiny dot when the camera is zoomed out and a boulder when
// zoomed in. Meshes sized this way hold a roughly constant on-screen size,
// clamped so they never vanish or dominate. Shared by the rotate *knob* and
// the whole elevation gizmo — the rotation *ring* is deliberately exempt (see
// positionRotateHandle: a footprint ring's radius has to track the footprint,
// not the camera, or it stops being a footprint ring).
const HANDLE_REF_DISTANCE_CM = 500;
const HANDLE_MIN_SCALE = 0.5;
const HANDLE_MAX_SCALE = 4;

const SELECTION_COLOR = 0x4fd1ff;
// A handle brightens to this while hovered, so it reads as a grabbable
// affordance (paired with a `cursor: grab` on the canvas — see updateHover).
// Name kept from the C1 sphere era; it's now the shared handle-hover color.
const ROTATE_HANDLE_HOVER_COLOR = 0xd6f5ff;
// D2: the selection outline recolors to this when the selected item's
// footprint currently overlaps another item or a wall — the plan's
// "decision support, not physics" bar means we flag, we don't block.
const COLLISION_COLOR = 0xff5c5c;
// improvements-v2.1 §4: the selection outline (and rotate handle) recolor to
// this when the selected item is locked — its own `locked` flag or the
// global "lock all" toggle, either counts (see isPlacementLocked) — and NOT
// currently flagged as colliding. Amber, distinct from both the cyan
// selection default and the red collision flag, so "locked" reads as its own
// state rather than a shade of either. Collision still wins when both are
// true (see updateCollisionHighlight's color composition): a physical
// overlap is worth surfacing even on a locked item, since locking only
// guards against accidental drags, not against another item having already
// been placed on top of it before the lock was set.
const LOCKED_COLOR = 0xffc94f;

/** Clamped camera-distance scale factor for a handle at `worldPos` — the
 *  shared "hold a constant on-screen size" math for the rotate knob and the
 *  elevation gizmo. */
function cameraRelativeScale(camera: THREE.PerspectiveCamera, worldPos: THREE.Vector3): number {
  const dist = camera.position.distanceTo(worldPos);
  return THREE.MathUtils.clamp(dist / HANDLE_REF_DISTANCE_CM, HANDLE_MIN_SCALE, HANDLE_MAX_SCALE);
}

/** Recolors every mesh under a handle (ring+knob, or the elevation double-
 *  arrow's stem+cones) — a handle is a THREE.Group of a few basic meshes, so
 *  hover/idle color swaps traverse it rather than poking one material. */
function setHandleColor(handle: THREE.Object3D, color: number) {
  handle.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) (mesh.material as THREE.MeshBasicMaterial).color.set(color);
  });
}

/** Disposes a handle's geometries/materials and detaches it — handles are
 *  multi-mesh groups now, so this traverses rather than disposing a single
 *  geometry/material pair the way the old sphere teardown did. */
function disposeHandle(handle: THREE.Object3D) {
  handle.parent?.remove(handle);
  handle.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
}

/** Builds the rotation handle: a flat ring encircling the item's footprint
 *  plus a grip knob riding the ring at the item's front (+Z). The whole group
 *  is the rotate-drag's raycast target (grab the ring *or* the knob). The ring
 *  radius — world-locked to the footprint — is stashed on the group so
 *  positionRotateHandle can place the knob on it every frame. Both meshes use
 *  the standard depthTest-off / late-renderOrder overlay treatment so the
 *  affordance is never occluded by the furniture it points at. */
function createRotateHandle(item: FurnitureItem): THREE.Group {
  const dims = furnitureOverallDims(item);
  // Half the footprint's diagonal (not max(w,d)/2 — a 45deg-rotated rectangle
  // would poke out of that) plus a margin, so the ring encloses the item at
  // any yaw.
  const ringRadius = Math.hypot(dims.w, dims.d) / 2 + ROTATE_RING_MARGIN_CM;
  const group = new THREE.Group();
  group.userData.ringRadius = ringRadius;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius, ROTATE_RING_TUBE_CM, 12, 64),
    new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, depthTest: false }),
  );
  ring.rotation.x = Math.PI / 2; // lay the torus flat on the floor plane
  ring.position.y = ROTATE_HANDLE_LIFT_CM;
  ring.renderOrder = 999;
  group.add(ring);

  const knob = new THREE.Mesh(
    new THREE.SphereGeometry(ROTATE_KNOB_RADIUS_CM, 16, 16),
    new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, depthTest: false }),
  );
  knob.renderOrder = 999;
  group.add(knob);
  group.userData.knob = knob;
  return group;
}

/** Builds the elevation handle: a vertical double-arrow (stem capped by an
 *  up-cone and a down-cone) that floats above the item's top face. The
 *  double-arrow reads unambiguously as "drag me up/down" — distinct from the
 *  floor-hugging rotation ring — and is the raycast target that starts a
 *  vertical drag. Same overlay treatment (depthTest off, late renderOrder). */
function createElevationHandle(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, depthTest: false });
  const capOffset = ELEVATION_HANDLE_STEM_CM / 2 + ELEVATION_HANDLE_CONE_CM / 2;

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(ELEVATION_HANDLE_SHAFT_R_CM, ELEVATION_HANDLE_SHAFT_R_CM, ELEVATION_HANDLE_STEM_CM, 12),
    mat,
  );
  stem.renderOrder = 999;
  group.add(stem);

  const up = new THREE.Mesh(new THREE.ConeGeometry(ELEVATION_HANDLE_CONE_R_CM, ELEVATION_HANDLE_CONE_CM, 16), mat);
  up.position.y = capOffset;
  up.renderOrder = 999;
  group.add(up);

  const down = new THREE.Mesh(new THREE.ConeGeometry(ELEVATION_HANDLE_CONE_R_CM, ELEVATION_HANDLE_CONE_CM, 16), mat);
  down.rotation.x = Math.PI; // flip to point down
  down.position.y = -capOffset;
  down.renderOrder = 999;
  group.add(down);
  return group;
}

/** World-space placement for the rotation handle — the ring tracks the item's
 *  center; the knob rides the ring at the item's front. Not parented under the
 *  item's group (see the selection-outline effect for why): called from the
 *  handle's own creation, the placement-reconciliation effect (a committed
 *  layout change can move/rotate the selected item from outside this
 *  component's drag code), and every animate() frame (so a live translate/
 *  rotate keeps the handle glued to the item without a React re-render). */
function positionRotateHandle(
  handle: THREE.Group,
  group: THREE.Group,
  _item: FurnitureItem,
  camera: THREE.PerspectiveCamera,
) {
  handle.position.set(group.position.x, group.position.y, group.position.z);
  const ringRadius = handle.userData.ringRadius as number;
  const knob = handle.userData.knob as THREE.Mesh;
  const yawDeg = ((THREE.MathUtils.radToDeg(group.rotation.y) % 360) + 360) % 360;
  // The ring is rotationally symmetric, so the parent group stays unrotated
  // and the knob is placed at the front by yaw instead. rotateHandleWorldXZ
  // from center (0,0) gives the knob's local offset on the ring.
  const [kx, kz] = rotateHandleWorldXZ(0, 0, yawDeg, ringRadius);
  knob.position.set(kx, ROTATE_HANDLE_LIFT_CM, kz);
  // Camera-relative sizing applies to the knob only — the ring's radius is
  // world-locked to the footprint (scaling it would break that), while the
  // knob keeps the old sphere's constant-on-screen grab-target sizing. The
  // parent group has no rotation/scale, so knob world pos = handle + knob.
  const knobWorld = handle.position.clone().add(knob.position);
  knob.scale.setScalar(cameraRelativeScale(camera, knobWorld));
}

/** World-space placement for the elevation handle — floats a camera-scaled gap
 *  above the item's top face, centered over its footprint. Same three call
 *  sites as positionRotateHandle. */
function positionElevationHandle(
  handle: THREE.Group,
  group: THREE.Group,
  item: FurnitureItem,
  camera: THREE.PerspectiveCamera,
) {
  const dims = furnitureOverallDims(item);
  const topY = group.position.y + dims.h; // item's top face = base + height
  const scale = cameraRelativeScale(camera, new THREE.Vector3(group.position.x, topY, group.position.z));
  handle.scale.setScalar(scale);
  // Sit the double-arrow's lower tip a scaled gap above the top face (half the
  // arrow's own extent clears the surface). Scaling the gap too keeps the
  // on-screen standoff constant, matching the gizmo's own constant size.
  const halfArrow = (ELEVATION_HANDLE_STEM_CM / 2 + ELEVATION_HANDLE_CONE_CM) * scale;
  handle.position.set(
    group.position.x,
    topY + ELEVATION_HANDLE_GAP_CM * scale + halfArrow,
    group.position.z,
  );
}

export const Viewport = forwardRef<
  ViewportHandle,
  {
    sceneFile: SceneFile;
    /** Live calibration, applied without rebuilding the scene/renderer — see
     *  the shell-update effect below. Defaults to sceneFile.room.shell. */
    shellCalibration?: ShellCalibration;
    /** improvements-v2.2 §4a: live sun/hemisphere params, applied without
     *  rebuilding the scene/renderer — see the lighting-update effect below.
     *  Defaults to sceneFile.room.lighting (then DEFAULT_LIGHTING). */
    lighting?: Lighting;
    /** v2 spike (W-A): fired once per gesture — on drag-release for a move,
     *  or per keypress for a rotate step — with the item's final position/
     *  rotation. Never fired per-frame mid-drag; see the pointer-handler
     *  effect below for the mutate-during-gesture seam this reconciles. */
    onCommitPlacement?: (itemId: string, position: [number, number, number], rotationDeg: number) => void;
    /** improvements-v2.1 §4: fired once per "L" keypress on the selected
     *  item — a discrete metadata edit (App.tsx's handleToggleLock), same
     *  "fire on the discrete moment, not per-frame" shape as
     *  onCommitPlacement, just without a live gesture behind it. */
    onToggleLock?: (itemId: string) => void;
    /** improvements-v2.1 §4: "lock all" safety toggle — ephemeral view state
     *  owned by App.tsx (like undoSlot), NOT part of sceneFile. When true, no
     *  item can be dragged/rotated/elevated regardless of its own `locked`
     *  flag. Defaults to false so existing callers/tests that don't pass it
     *  see today's unlocked behavior. */
    globalLock?: boolean;
  }
>(function Viewport({ sceneFile, shellCalibration, lighting, onCommitPlacement, onToggleLock, globalLock }, handleRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const builtRef = useRef<BuiltScene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  // improvements-v2.1 §5: the walk-mode counterpart to controlsRef, plus the
  // mode flag and a way to flip it from outside the structural effect (the
  // HUD toggle button and ViewportHandle.flyTo both live outside it — see
  // applyModeRef below). Mirrors the selectedItemId state/ref split already
  // used for selection: `cameraMode` drives the toggle button's label/icon
  // (needs a re-render), `cameraModeRef` is what every imperative pointer/
  // keyboard/animate() closure actually reads (never wants to wait for a
  // render).
  const walkControlsRef = useRef<PointerLockControls | null>(null);
  const [cameraMode, setCameraModeState] = useState<CameraMode>("orbit");
  const cameraModeRef = useRef<CameraMode>("orbit");
  cameraModeRef.current = cameraMode;
  // Set inside the structural effect to the real mode-switch function (which
  // needs the effect's local camera/controls/walkControls closures) — the
  // toggle button and ViewportHandle.flyTo call through this ref rather than
  // duplicating that logic or forcing it to live outside the effect.
  const applyModeRef = useRef<((mode: CameraMode) => void) | null>(null);
  // Latest onCommitPlacement in a ref so the pointer/keyboard effect (which
  // only wants to run once per structural build) doesn't have to re-bind its
  // DOM listeners every time App.tsx passes a new closure.
  const onCommitPlacementRef = useRef(onCommitPlacement);
  onCommitPlacementRef.current = onCommitPlacement;
  // improvements-v2.1 §4: same "ref so the once-bound pointer/keyboard
  // effect always sees the latest closure/value" treatment as
  // onCommitPlacementRef above — onToggleLock is a new callback prop,
  // globalLock is a new plain value prop, but both are read from inside
  // onPointerDown/onKeyDown, which only rebind on a structural rebuild.
  const onToggleLockRef = useRef(onToggleLock);
  onToggleLockRef.current = onToggleLock;
  const globalLockRef = useRef(globalLock ?? false);
  globalLockRef.current = globalLock ?? false;

  // W-A selection: which placed item (by itemId) is currently selected, plus
  // a BoxHelper wireframe outline (cheapest indicator per the plan — a plain
  // scene child, not parented under the item's group, so it's never
  // mistaken for a raycast hit on the item itself and doesn't fight the
  // item's own material/hierarchy). Kept in a ref rather than state: it's
  // driven from imperative pointer handlers and read every animation frame,
  // not from render props.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedItemIdRef = useRef<string | null>(null);
  selectedItemIdRef.current = selectedItemId;
  // improvements-v2.1 §4: a structural rebuild (see structuralSceneFile's
  // comment) unconditionally drops the current selection in its cleanup
  // below — fine when the rebuild is triggered by something unrelated to
  // the selected item (nothing was usually selected during an import), but
  // toggling an item's own `locked` flag *is* an items-array mutation that
  // targets the currently-selected item on purpose. Without this, pressing
  // "L" would lock the item and simultaneously deselect it, defeating the
  // "stays selectable so you can see it's locked / toggle it back off"
  // requirement. Captured in cleanup (before it nulls the live selection)
  // and consumed once by the next setup run, which re-selects the same item
  // if it still exists post-rebuild — a no-op for any rebuild that isn't
  // "the same item, mutated," e.g. one where the item was actually removed.
  const pendingReselectRef = useRef<string | null>(null);
  // improvements-v2.1 §4: paired with pendingReselectRef above — whether the
  // canvas actually had keyboard focus right before a structural rebuild
  // tore it down, so the next setup run knows whether to restore it (see
  // that effect's focus-restore comment for why this matters now that "L"
  // can trigger a rebuild from a keyboard shortcut).
  const pendingRefocusRef = useRef(false);
  const selectionHelperRef = useRef<THREE.BoxHelper | null>(null);
  // §3: the rotate-drag handle — now a THREE.Group (footprint ring + grip
  // knob, was a bare sphere), lifecycle paired with selectionHelperRef
  // (created/destroyed alongside it in the selection-outline effect below),
  // but tracked separately since it needs its own raycast target and its own
  // per-frame reposition math.
  const rotateHandleRef = useRef<THREE.Group | null>(null);
  // §3: the elevation-drag handle — a vertical double-arrow above the item,
  // the net-new affordance for vertical translation (elevation previously had
  // only the PageUp/PageDown keyboard step). Same lifecycle/reposition shape
  // as the rotate handle, its own raycast target and vertical-drag gesture.
  const elevationHandleRef = useRef<THREE.Group | null>(null);

  // D2: wall AABBs and the item-id -> definition lookup only change when a
  // structural rebuild happens (room/items are structuralSceneFile deps), so
  // they're computed once per build and read from every drag/rotate/select
  // collision check rather than recomputed per pointer event.
  const wallAABBsRef = useRef<AABB[]>([]);
  const itemsByIdRef = useRef<Map<string, FurnitureItem>>(new Map());

  // improvements-v2.1 §4: whether a gesture/keystep targeting `itemId`
  // should be blocked — either the item's own persisted `locked` flag or the
  // ephemeral global "lock all" toggle. Centralized here (rather than
  // inlined at each of onPointerDown's two gesture-start sites and
  // onKeyDown's rotate/elevation branch) so the two ways an item can end up
  // locked can't drift out of sync with each other.
  function isPlacementLocked(itemId: string): boolean {
    if (globalLockRef.current) return true;
    return itemsByIdRef.current.get(itemId)?.locked === true;
  }

  // Code-review fix: whether the selected item's footprint is *currently*
  // flagged as colliding — set by updateCollisionHighlight (the only place
  // that actually runs the AABB check) and read by every handle-coloring
  // site below so the rotate ring/knob and elevation handle agree with the
  // selection outline instead of only ever branching on lock state. Handles
  // only ever exist for the selected item, so one flag (not a per-item map)
  // is enough — updateCollisionHighlight is in practice only ever called
  // with the currently-selected item's id (a drag/rotate/elevate gesture can
  // only target what's selected).
  const selectedCollidingRef = useRef(false);

  // improvements-v2.1 §4, code-review fix: the shared color composition —
  // collision (a physical fact) outranks lock (a safety-toggle fact), which
  // outranks plain selection. Used by both the selection outline
  // (updateCollisionHighlight) and every handle-coloring site (hover,
  // initial creation, global-lock resync) so they can't drift apart the way
  // the handles did before this fix (locked-and-colliding read as amber
  // instead of red on the handles, contradicting the outline).
  function gestureAffordanceColor(itemId: string, colliding: boolean): number {
    if (colliding) return COLLISION_COLOR;
    if (isPlacementLocked(itemId)) return LOCKED_COLOR;
    return SELECTION_COLOR;
  }

  // D2: recolors the selection outline to flag footprint overlap — called
  // after any live mutation (drag move, rotate step, a committed layout
  // change affecting the selected item, or first selecting an already-
  // overlapping item) so the highlight never lags behind what's on screen.
  function updateCollisionHighlight(itemId: string, group: THREE.Group) {
    const helper = selectionHelperRef.current;
    const item = itemsByIdRef.current.get(itemId);
    const built = builtRef.current;
    if (!helper || !item || !built) return;
    const rotationDeg = ((THREE.MathUtils.radToDeg(group.rotation.y) % 360) + 360) % 360;
    const aabb = itemFootprintAABB(item, [group.position.x, group.position.y, group.position.z], rotationDeg);
    const others: Array<{ itemId: string; aabb: AABB }> = [];
    built.furnitureGroups.forEach((otherGroup, otherId) => {
      if (otherId === itemId) return;
      const otherItem = itemsByIdRef.current.get(otherId);
      if (!otherItem) return;
      const otherRotationDeg = ((THREE.MathUtils.radToDeg(otherGroup.rotation.y) % 360) + 360) % 360;
      others.push({
        itemId: otherId,
        aabb: itemFootprintAABB(
          otherItem,
          [otherGroup.position.x, otherGroup.position.y, otherGroup.position.z],
          otherRotationDeg,
        ),
      });
    });
    const { itemIds, wall } = checkCollisions(aabb, others, wallAABBsRef.current);
    const colliding = itemIds.length > 0 || wall;
    selectedCollidingRef.current = colliding;
    (helper.material as THREE.LineBasicMaterial).color.set(gestureAffordanceColor(itemId, colliding));
  }

  // Per-surface tracking for the calibration effect below: the last
  // calibration actually applied (so it can diff and skip no-op work) and
  // the live THREE.Texture instances currently referenced by a material (so
  // they can be disposed exactly once, right when superseded — see the
  // calibration effect for why this can't just live in that effect's own
  // per-run closure). Reset whenever the structural effect rebuilds the
  // scene, since a rebuild gets fresh materials (at least for the floor,
  // which is cloned per-rect in buildScene.ts) that haven't had any
  // calibration applied yet.
  const lastAppliedCalibRef = useRef<Partial<Record<ShellSurface, SurfaceCalibration>>>({});
  const appliedTexturesRef = useRef<Partial<Record<ShellSurface, THREE.Texture[]>>>({});
  const [buildVersion, setBuildVersion] = useState(0);

  // Structural build: renderer, lighting, room shell geometry, furniture,
  // camera, controls. Previously ran once per mount only (sceneFile
  // captured via useRef at mount) — restored here to react to structural
  // sceneFile changes (code review finding: any future structural mutation,
  // e.g. furniture/walls/camera edits, silently stopped rebuilding).
  //
  // The effect depends on `structuralSceneFile`, a useMemo'd reference to
  // `sceneFile` that only changes when a *non-shell, non-lighting* top-level
  // field changes — NOT on `sceneFile` directly. That distinction matters
  // beyond "skip the work": an effect's cleanup always runs before its next
  // invocation whenever its dependency changes, full stop, regardless of
  // what the new invocation's body decides to do — so gating the rebuild
  // with an early-return *inside* an effect keyed on raw `sceneFile` would
  // still tear down the renderer/canvas on every shell-only calibration
  // change (App.tsx's updateShellSurface creates a new sceneFile object per
  // slider commit) and then not rebuild it, blanking the viewport. Keying
  // on the memoized value instead means the effect doesn't re-run at all
  // for a shell-only change, so no cleanup fires and the WebGL context is
  // left alone — exactly the "shell changes don't churn the renderer"
  // guarantee this component has always made, just now correctly combined
  // with reacting to everything else.
  // `cameras` deliberately isn't a dep: saved viewpoints are recall-only
  // metadata (ViewportChrome's flyTo), not scene geometry. Rebuilding on
  // every save (Phase 5) would tear down the live camera/controls the user
  // just framed a shot with and reset it to cameras[0] — the opposite of
  // "save your current view." Only the initial mount reads `cameras[0]` as
  // a starting position; later additions/deletions don't need to touch it.
  //
  // v2 spike (W-A): `sceneFile.layouts` is deliberately NOT a dep either,
  // for the exact same reason cameras isn't — this is the mutate-during-
  // gesture/commit-on-drop seam the plan calls out as the hard part. A
  // move/rotate commit calls setSceneFile with a new `layouts` array (a new
  // PlaceCommand.position/rotationDeg for one item); if that fed this memo,
  // every drag-drop would tear down and rebuild the entire renderer/scene/
  // camera/controls — including snapping the camera back to `cameras[0]`,
  // the same regression Phase 5 had to carve camera recall out of the
  // rebuild path to avoid. Instead, the placement-reconciliation effect
  // further down reads `sceneFile.layouts` directly (not memoized) and
  // updates each already-built THREE.Group's transform in place via
  // `built.furnitureGroups`, so a commit updates React/schema state without
  // ever touching the WebGL context. `sceneFile.current` stays a dep on
  // purpose: switching to a *different saved layout* (D3, not this task) is
  // a structural change — a different command set, possibly different
  // items in view — and should get a real rebuild, unlike an in-place edit
  // to the current layout's commands.
  const structuralSceneFile = useMemo(
    () => sceneFile,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: this is the memo's whole purpose, see comment above
    [sceneFile.room.ceilingHeightCm, sceneFile.room.floor, sceneFile.room.walls, sceneFile.items, sceneFile.current],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const built = buildScene(structuralSceneFile);
    builtRef.current = built;
    rendererRef.current = renderer;
    // Fresh materials (floor, at least) need every surface reapplied —
    // dropping stale per-surface state forces the calibration effect to
    // treat this as a first-ever apply for all three surfaces.
    lastAppliedCalibRef.current = {};
    appliedTexturesRef.current = {};
    // D2: wall geometry and item definitions are structural too — recomputed
    // here alongside `built` so a collision check during this build's
    // lifetime never reads stale walls/items from a previous room.
    wallAABBsRef.current = wallFootprintAABBs(structuralSceneFile.room);
    itemsByIdRef.current = new Map(structuralSceneFile.items.map((item) => [item.id, item]));

    // improvements-v2.1 §4: restore the selection the previous run's cleanup
    // stashed (see pendingReselectRef's comment) if that item is still
    // present post-rebuild — e.g. a lock toggle mutated it in place rather
    // than removing it. `selectItem` is a hoisted function declaration
    // (defined further down in this same effect body), safe to call here.
    if (pendingReselectRef.current && itemsByIdRef.current.has(pendingReselectRef.current)) {
      selectItem(pendingReselectRef.current);
    }
    pendingReselectRef.current = null;

    // Phase 4: items with a completed Meshy import get their real GLB loaded
    // and fit into the placeholder group buildScene already positioned —
    // async, same pattern as the shell-texture load below, so a slow OPFS
    // read doesn't block the first frame. `cancelled` guards against
    // attaching a model after this effect's cleanup has already torn the
    // scene down (fast structural rebuild, or unmount, while a load is
    // in flight).
    let cancelled = false;
    built.pendingModels.forEach(({ item, group }) => {
      if (!item.glbHash) return;
      const glbHash = item.glbHash;
      loadFurnitureModel(glbHash)
        .then((model) => {
          if (cancelled) return;
          fitModelToDims(model, furnitureOverallDims(item), item.modelRotationDeg);
          group.add(model);
        })
        .catch((err) => {
          console.error(`[Viewport] failed to load furniture GLB for "${item.id}"`, err);
          // Code-review finding: a load failure used to leave the item's
          // group permanently empty (no box, no signal) — fall back to the
          // same placeholder box an item without a GLB gets, so a missing/
          // corrupted OPFS asset degrades to "looks unimported" instead of
          // "invisible."
          if (!cancelled) addFurnitureBoxMeshes(group, item);
        });
    });

    // v2 spike D4 (W-B, rug fix ladder lever 2 — see spike-v2/OUTCOME.md):
    // an item with `flatTextureHash` gets its photo-derived texture loaded
    // from OPFS here and dropped onto the top-face material buildScene
    // already created and put in the scene — same async-after-build shape
    // as the GLB load above, just filling in a `.map` instead of attaching
    // a decoded model. `computeFlatTextureFit` (pure math, unit-tested)
    // crops out any product-photo padding, corrects for a photo shot in the
    // "wrong" orientation relative to the item's real footprint, and fits
    // the result to the item's real w:d footprint without stretching — all
    // three folded into one repeat/offset/rotation, the same way CSS
    // `background-size: cover` fits a photo to a differently-shaped box.
    built.pendingFlatTextures.forEach(({ item, material }) => {
      const hash = item.flatTextureHash;
      if (!hash) return;
      loadShellTexture(hash)
        .then((source) => {
          if (cancelled || !source) return;
          const dims = item.dimsCm;
          if (!dims) return;
          const targetAspect = dims.w / dims.d;
          const rawImageAspect = source.bitmap.width / source.bitmap.height;
          // D4 crop-fix (see spike-v2/OUTCOME.md's D4 crop-fix addendum):
          // round 2 only used the content bounding box to decide whether to
          // rotate, discarding the box's own coordinates — the product-photo
          // padding stayed visible in the render. This detects the box AND
          // feeds its actual coordinates to computeFlatTextureFit so the
          // padding is cropped out, not just accounted for.
          const contentBox = detectContentBox(source.bitmap);
          const { repeat, offset, rotation } = computeFlatTextureFit(contentBox, rawImageAspect, targetAspect);
          const texture = new THREE.Texture(source.bitmap);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
          // computeFlatTextureFit's scheme always pairs with center left at
          // THREE.Texture's default (0, 0) — the rotation pivot is folded
          // into `offset` instead, so no texture.center.set() call needed.
          texture.rotation = rotation;
          texture.repeat.set(repeat[0], repeat[1]);
          texture.offset.set(offset[0], offset[1]);
          texture.needsUpdate = true;
          material.map = texture;
          material.needsUpdate = true;
        })
        .catch((err) => {
          // No box-mesh fallback needed here (unlike the GLB path above) —
          // buildScene already put a plain-color box in the scene as this
          // material's mesh; a failed texture load just leaves it that
          // flat color instead of vanishing.
          console.error(`[Viewport] failed to load flat texture for "${item.id}"`, err);
        });
    });

    setBuildVersion((v) => v + 1);
    const { scene, cameras } = built;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(HUMAN_FOV, 1, 5, 3000);
    const preset = cameras[0];
    if (!preset) camera.position.set(0, 300, 600);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = true;
    controls.minPolarAngle = MIN_POLAR_ANGLE;
    controls.maxPolarAngle = MAX_POLAR_ANGLE;
    if (preset) {
      applyCameraPreset(camera, controls, preset);
    } else {
      controls.update();
    }
    cameraRef.current = camera;
    controlsRef.current = controls;

    // improvements-v2.1 §5: walk-around camera mode. PointerLockControls is
    // constructed alongside OrbitControls (both live for this structural
    // build's whole lifetime) rather than lazily on first mode-switch — it's
    // cheap (an EventDispatcher plus a few listeners, see the library source)
    // and creating it once means switching modes back and forth never
    // reattaches/detaches its mousemove/pointerlockchange listeners, only
    // toggles which one is doing anything (see applyCameraMode below).
    const walkControls = new PointerLockControls(camera, renderer.domElement);
    walkControlsRef.current = walkControls;
    // Held-WASD state for animate()'s per-frame integration — a plain mutable
    // object (not React state) for the same reason `drag`/`rotateDrag` above
    // are: read every frame, written every keydown/keyup, no render involved.
    const walkKeys: WalkInput = { forward: false, back: false, left: false, right: false };
    let lastFrameTime = performance.now();
    // Code-review fix: the orbit camera's Y before entering walk mode,
    // restored on the way back out. Without this, applyCameraMode's "walk"
    // branch below permanently snaps the camera to WALK_EYE_HEIGHT_CM even
    // after returning to orbit — PointerLockControls has no "restore" of its
    // own, and nothing else remembered the pre-walk height.
    let preWalkEyeY: number | null = null;

    // Single source of truth for "which control scheme is live right now" —
    // both the HUD toggle button (via applyModeRef, since the button lives
    // outside this effect) and ViewportHandle.flyTo call through this, and it
    // also runs from the walkControls "unlock" listener below when the
    // browser exits pointer lock on its own (Escape, losing focus, etc.), so
    // the mode flag can never drift out of sync with which controls object is
    // actually driving the camera.
    function applyCameraMode(mode: CameraMode) {
      if (cameraModeRef.current === mode) return;
      cameraModeRef.current = mode;
      setCameraModeState(mode);
      if (mode === "walk") {
        controls.enabled = false;
        // Keep the camera's current XZ position/facing (don't teleport
        // across the room on mode-switch) but snap to the fixed walking eye
        // height — PointerLockControls has no notion of "orbit target" to
        // carry over, and WASD never touches Y once in walk mode (see
        // walkCamera.ts's computeWalkStep), so this is the one place height
        // gets set. Stash the pre-walk Y first so returning to orbit can put
        // it back (code-review fix — see preWalkEyeY's declaration).
        preWalkEyeY = camera.position.y;
        camera.position.y = WALK_EYE_HEIGHT_CM;
      } else {
        // Reverse of the above: hand the pointer back (browser no-ops if
        // it's already unlocked, e.g. when this runs because the browser
        // itself just exited lock) and drop any held-WASD state so a mode
        // switch mid-keypress can't leave a phantom "still walking"
        // direction the next time walk mode is entered.
        walkControls.unlock();
        walkKeys.forward = walkKeys.back = walkKeys.left = walkKeys.right = false;
        controls.enabled = true;
        // Restore the pre-walk height before recentering the target below,
        // so the target is computed around the restored eye position, not
        // the walking height.
        if (preWalkEyeY !== null) {
          camera.position.y = preWalkEyeY;
          preWalkEyeY = null;
        }
        // OrbitControls.target is wherever it was left before walk mode —
        // possibly now behind the camera after mouselook turned it around.
        // Recenter it in front of the camera's current facing so the next
        // controls.update() doesn't snap/orbit around a stale point.
        const forward = walkControls.getDirection(new THREE.Vector3());
        controls.target.copy(camera.position).addScaledVector(forward, SYNTHETIC_LOOKAT_DISTANCE_CM);
        controls.update();
      }
    }
    applyModeRef.current = applyCameraMode;

    // Browser-driven pointer-lock exit (Escape, alt-tab, etc.) fires this the
    // same as our own walkControls.unlock() call above — the isLocked-vs-
    // cameraModeRef guard inside applyCameraMode (early-return when already
    // in the target mode) is what stops that self-triggered case from
    // recursing, since applyCameraMode's own orbit branch already set
    // cameraModeRef to "orbit" *before* calling unlock().
    function onWalkControlsUnlock() {
      if (cameraModeRef.current === "walk") applyCameraMode("orbit");
    }
    walkControls.addEventListener("unlock", onWalkControlsUnlock);

    // Click-to-lock: standard Pointer Lock UX, only armed in walk mode so an
    // orbit-mode click doesn't unexpectedly capture the pointer.
    function onCanvasClickForWalkLock() {
      if (cameraModeRef.current === "walk" && !walkControls.isLocked) walkControls.lock();
    }
    renderer.domElement.addEventListener("click", onCanvasClickForWalkLock);

    // Dev-only console diagnostic (never ships to a production build): lets
    // Shyam dump live scene-graph info (positions/materials/geometry) from
    // devtools without a rebuild, for one-off "why does this look wrong"
    // investigations. See scratch console snippets in troubleshooting notes.
    if (import.meta.env.DEV) {
      // @ts-expect-error dev-only debug global, intentionally untyped
      window.__mirrorDebug = { camera, controls, walkControls, scene: built.scene, THREE };
    }

    // v2 spike (W-A) — selection + floor-plane drag + keyboard rotate.
    // This is the mutate-during-gesture seam: every pointermove/keydown here
    // mutates a live THREE.Group's `.position`/`.rotation.y` directly and
    // renders it via the existing animate() loop below — no React state
    // touched, no buildScene() call, no renderer/camera churn. Only on
    // pointerup (move) or on each keydown (rotate, already a discrete step)
    // does `onCommitPlacementRef.current` get called, which is App.tsx's cue
    // to fold the result into `sceneFile.layouts` and persist it — the
    // "reconcile back into SceneFile/React state only on commit" half of the
    // seam. The placement-reconciliation effect further down is what applies
    // that committed state back onto the live groups (a no-op here since we
    // already moved them, but the path that matters for anything that
    // changes placement *without* going through this drag code, e.g. a
    // future undo).
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const dragPlane = new THREE.Plane();
    const planeHit = new THREE.Vector3();
    const grabOffset = new THREE.Vector3();
    let drag: { itemId: string; group: THREE.Group } | null = null;
    // §3: a second, mutually-exclusive gesture — dragging the rotate ring/knob
    // turns group.rotation.y by the angle the pointer has swept around the
    // item's center since grab, rather than moving group.position like `drag`
    // above. `startYawDeg`/`grabAngleDeg` are the anchors captured on
    // pointerdown that make the rotation *relative* (see relativeYawDeg's
    // comment: the ring is grabbable anywhere, so an absolute angle-to-pointer
    // mapping would jump the item on grab). Only one of the three gestures is
    // ever set at a time (onPointerDown picks one based on what the ray hit).
    let rotateDrag: { itemId: string; group: THREE.Group; startYawDeg: number; grabAngleDeg: number } | null = null;
    // §3: the third gesture — dragging the elevation double-arrow moves
    // group.position.y along a camera-facing vertical plane through the item.
    // `grabOffsetY` is the gap between the item's Y and the plane-hit's Y at
    // grab time, so the item tracks the pointer without snapping to it on the
    // first move (the vertical analog of `grabOffset` for the horizontal drag).
    let elevationDrag: { itemId: string; group: THREE.Group; grabOffsetY: number } | null = null;
    // Hot-loop cleanup (PRD-v2 §7.1): the canvas rect, cached once and reused
    // by every pointermove — drag, rotate-drag, and idle hover alike — instead
    // of forcing a layout read (getBoundingClientRect) on every single move.
    // The canvas doesn't move under a captured pointer, and resize() below
    // keeps this fresh on any actual size change (kept in sync unconditionally,
    // not just mid-gesture, since hover needs it live just as much as drag).
    let viewportRect: DOMRect = renderer.domElement.getBoundingClientRect();
    // Pre-gesture transform, captured on pointerdown, so an interrupted gesture
    // (browser-stolen pointercancel, or Escape) can revert to it rather than
    // commit a partial mid-drag state (PRD-v2 §7.1: "explicit revert on
    // pointer-cancel").
    let gestureStart: { position: THREE.Vector3; rotationY: number } | null = null;

    function normalizeDeg(deg: number): number {
      return ((deg % 360) + 360) % 360;
    }

    function setPointerNdcFromEvent(evt: PointerEvent) {
      pointerNdc.x = ((evt.clientX - viewportRect.left) / viewportRect.width) * 2 - 1;
      pointerNdc.y = -((evt.clientY - viewportRect.top) / viewportRect.height) * 2 + 1;
    }

    // §3: orient `dragPlane` as a *vertical* plane through `at` whose normal is
    // horizontal and points at the camera — the drag surface for the elevation
    // handle, so screen-vertical pointer motion resolves cleanly to world Y
    // (a horizontal floor plane, which translate/rotate use, can't: its ray
    // intersection barely moves in Y as the pointer slides down the screen).
    const verticalNormal = new THREE.Vector3();
    function setVerticalDragPlane(at: THREE.Vector3) {
      verticalNormal.subVectors(camera.position, at);
      verticalNormal.y = 0; // horizontal facing direction only — the plane stays vertical
      // Degenerate only if the camera is directly overhead; any vertical plane
      // works there, so fall back to a fixed one rather than a zero normal.
      if (verticalNormal.lengthSq() < 1e-6) verticalNormal.set(0, 0, 1);
      verticalNormal.normalize();
      dragPlane.setFromNormalAndCoplanarPoint(verticalNormal, at);
    }

    // Shared teardown for the end of any gesture (commit or revert): drop the
    // pre-gesture snapshot, hand the pointer back to the orbit camera, and
    // reset the cursor. The next hover move recomputes the cursor.
    function endGesture() {
      gestureStart = null;
      controls.enabled = true;
      renderer.domElement.style.cursor = "";
    }

    // Reverts an in-progress gesture to the transform captured at pointerdown
    // and drops it WITHOUT committing — the explicit cancel path for a
    // browser-stolen gesture or an Escape press.
    function revertGesture() {
      const active = drag ?? rotateDrag ?? elevationDrag;
      if (active && gestureStart) {
        active.group.position.copy(gestureStart.position);
        active.group.rotation.y = gestureStart.rotationY;
        updateCollisionHighlight(active.itemId, active.group);
      }
      drag = null;
      rotateDrag = null;
      elevationDrag = null;
      endGesture();
    }

    // A handle (rotate ring/knob or elevation arrow) brightens while hovered —
    // its own materials, so this never touches the shared furniture material.
    // improvements-v2.1 §4 / code-review fix: the un-hovered base color is
    // both collision- and lock-aware (gestureAffordanceColor) rather than a
    // fixed SELECTION_COLOR, so a handle itself signals overlap/lock state
    // even before a click swallows the gesture, and agrees with the
    // selection outline instead of only ever reflecting lock.
    function setHandleHovered(handle: THREE.Object3D | null, hovered: boolean) {
      if (!handle) return;
      const itemId = selectedItemIdRef.current;
      const baseColor = itemId ? gestureAffordanceColor(itemId, selectedCollidingRef.current) : SELECTION_COLOR;
      setHandleColor(handle, hovered ? ROTATE_HANDLE_HOVER_COLOR : baseColor);
    }

    // True if the ray currently hits any mesh under `handle` — recursive,
    // since a handle is a multi-mesh group (ring+knob, stem+two cones) now.
    function rayHitsHandle(handle: THREE.Object3D | null): boolean {
      return handle ? raycaster.intersectObject(handle, true).length > 0 : false;
    }

    // Idle-hover affordances (not during a drag): `cursor: grab` over either
    // handle or a selectable item, plus the hovered handle's highlight.
    // O(items) per move, same order as the drag-path collision recompute the
    // plan accepts at ~13 items. improvements-v2.1 §4: the cursor now reads
    // "not-allowed" instead of "grab" over anything gesture-locked (the
    // handle or an item's body) — a locked item is still selectable, but a
    // "grab" cursor over something that can't actually be grabbed is a worse
    // affordance than none.
    function updateHover(evt: PointerEvent) {
      const dom = renderer.domElement;
      setPointerNdcFromEvent(evt);
      raycaster.setFromCamera(pointerNdc, camera);
      const rotateHandle = rotateHandleRef.current;
      const elevationHandle = elevationHandleRef.current;
      const overRotate = rayHitsHandle(rotateHandle);
      // Only one handle reads as hovered at a time; the rotate ring wins a tie
      // (checked first), matching onPointerDown's precedence.
      const overElevation = !overRotate && rayHitsHandle(elevationHandle);
      setHandleHovered(rotateHandle, overRotate);
      setHandleHovered(elevationHandle, overElevation);
      if (overRotate || overElevation) {
        // improvements-v2.1 §4: a locked item's handles still hover/highlight
        // (so lock state stays visible), but the cursor reads "not-allowed"
        // rather than "grab" — a click on either handle is inert (see
        // onPointerDown's lock guard on both handle branches).
        const selId = selectedItemIdRef.current;
        dom.style.cursor = selId && isPlacementLocked(selId) ? "not-allowed" : "grab";
        return;
      }
      const hit = raycaster.intersectObjects(scene.children, true)[0];
      const hitGroup = hit ? findItemGroup(hit.object) : null;
      const hitItemId = hitGroup ? (hitGroup.userData.itemId as string) : null;
      dom.style.cursor = hitItemId ? (isPlacementLocked(hitItemId) ? "not-allowed" : "grab") : "";
    }

    // Walks up from a raycast hit to the placed item's THREE.Group — every
    // furniture group is tagged with userData.itemId (buildScene.ts); a hit
    // on the shell (walls/floor/ceiling) or nothing at all has no such
    // ancestor and is treated as "empty space."
    function findItemGroup(obj: THREE.Object3D | null): THREE.Group | null {
      for (let cur = obj; cur; cur = cur.parent) {
        if (typeof cur.userData?.itemId === "string") return cur as THREE.Group;
      }
      return null;
    }

    function selectItem(itemId: string | null) {
      selectedItemIdRef.current = itemId;
      setSelectedItemId(itemId);
    }

    function commitDrag() {
      if (!drag) return;
      const { itemId, group } = drag;
      onCommitPlacementRef.current?.(
        itemId,
        [group.position.x, group.position.y, group.position.z],
        normalizeDeg(THREE.MathUtils.radToDeg(group.rotation.y)),
      );
      drag = null;
      endGesture();
    }

    // C1 follow-up: same commit shape as commitDrag (final position/rotation
    // through the identical onCommitPlacementRef path move and keyboard-step
    // rotate already use) — only the gesture that produced the live mutation
    // differs.
    function commitRotateDrag() {
      if (!rotateDrag) return;
      const { itemId, group } = rotateDrag;
      onCommitPlacementRef.current?.(
        itemId,
        [group.position.x, group.position.y, group.position.z],
        normalizeDeg(THREE.MathUtils.radToDeg(group.rotation.y)),
      );
      rotateDrag = null;
      endGesture();
    }

    // §3: same commit shape again — the elevation drag mutated group.position.y
    // live; on release we fold the final position/rotation back through the
    // identical onCommitPlacementRef path. A PlaceCommand's position[1] *is*
    // the item's elevation (see elevation.ts / buildScene.ts), so this needs
    // no new command type — it's the drag analog of the PageUp/PageDown step.
    function commitElevationDrag() {
      if (!elevationDrag) return;
      const { itemId, group } = elevationDrag;
      onCommitPlacementRef.current?.(
        itemId,
        [group.position.x, group.position.y, group.position.z],
        normalizeDeg(THREE.MathUtils.radToDeg(group.rotation.y)),
      );
      elevationDrag = null;
      endGesture();
    }

    function onPointerDown(evt: PointerEvent) {
      if (evt.button !== 0) return;
      // Give the viewport keyboard focus so its shortcuts (q/e, PageUp/
      // PageDown, Escape, and walk mode's WASD) are focus-scoped to it — see
      // onKeyDown's focus-ownership note. Always focus first, even in walk
      // mode (where the rest of this handler is inert below) — the WASD
      // keydown/keyup listeners live on this same element and need it
      // focused to fire at all.
      renderer.domElement.focus();
      // improvements-v2.1 §5: item selection/drag is orbit-only. Walk mode's
      // click instead starts a pointer-lock request (onCanvasClickForWalkLock,
      // a separate 'click' listener) — raycasting mouse coordinates that
      // freeze the instant the pointer locks wouldn't select anything
      // meaningful anyway. Bailing here also guarantees drag/rotateDrag can
      // never be set while walking, which is what keeps onKeyDown's existing
      // Escape-cancels-a-gesture branch correctly inert during walk mode
      // (nothing to cancel) rather than racing the browser's own
      // Escape-exits-pointer-lock behavior.
      if (cameraModeRef.current === "walk") return;
      setPointerNdcFromEvent(evt);
      raycaster.setFromCamera(pointerNdc, camera);

      // §3: the manipulation handles are their own raycast targets, checked
      // first and in isolation (not part of the scene.children walk below, not
      // parented under the item's group) — a hit here starts the matching drag
      // and returns before the item-vs-empty-space logic runs, so grabbing a
      // handle can never be mistaken for a translate-drag on its item. Rotate
      // is checked before elevation (fixed precedence, mirrored in updateHover).
      const selectedId = selectedItemIdRef.current;
      const selectedGroup = selectedId ? built.furnitureGroups.get(selectedId) : undefined;

      const rotateHandle = rotateHandleRef.current;
      if (selectedId && selectedGroup && rotateHandle && raycaster.intersectObject(rotateHandle, true).length > 0) {
        // improvements-v2.1 §4: a locked item's handle is still visible and
        // still hit-tests (so it keeps signaling lock state via color/cursor
        // — see setHandleHovered/updateHover), but a click on it must not
        // start a rotate-drag. Return here rather than falling through to the
        // body hit-test below, which would otherwise treat this click as if
        // it landed on empty space (handles aren't part of `scene.children`'s
        // raycast walk) and deselect.
        if (isPlacementLocked(selectedId)) return;
        // Rotate on the same horizontal plane through the item's center that
        // translate uses, so the pointer's angle-around-center is well-defined.
        // Capture the item's yaw and the pointer's angle at grab time so the
        // drag is *relative* (see relativeYawDeg): grabbing the ring anywhere
        // rotates from there instead of snapping the front to the cursor.
        dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), selectedGroup.position);
        if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
          const grabAngleDeg = yawDegFromPointer(
            selectedGroup.position.x,
            selectedGroup.position.z,
            planeHit.x,
            planeHit.z,
          );
          const startYawDeg = normalizeDeg(THREE.MathUtils.radToDeg(selectedGroup.rotation.y));
          rotateDrag = { itemId: selectedId, group: selectedGroup, startYawDeg, grabAngleDeg };
          gestureStart = { position: selectedGroup.position.clone(), rotationY: selectedGroup.rotation.y };
          controls.enabled = false; // gesture owns the pointer, not the orbit camera
          renderer.domElement.style.cursor = "grabbing";
          renderer.domElement.setPointerCapture(evt.pointerId);
        }
        // Code-review fix: return unconditionally once the raycast has
        // confirmed a handle hit, even if the plane-intersect just above
        // failed (ray parallel to the plane — near-impossible given the
        // orbit polar-angle clamps, but not impossible). Previously the
        // `return` only lived inside that `if`, so a failed intersect fell
        // through into the body hit-test below and could start an ordinary
        // translate-drag instead of the intended (aborted) handle gesture.
        return;
      }

      const elevationHandle = elevationHandleRef.current;
      if (selectedId && selectedGroup && elevationHandle && raycaster.intersectObject(elevationHandle, true).length > 0) {
        // improvements-v2.1 §4: same lock guard as the rotate-handle branch
        // above — selectable/visible, not draggable.
        if (isPlacementLocked(selectedId)) return;
        // Vertical drag on a camera-facing vertical plane through the item.
        // grabOffsetY keeps the item from jumping to the pointer on the first
        // move (vertical analog of the horizontal drag's grabOffset).
        setVerticalDragPlane(selectedGroup.position);
        if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
          elevationDrag = { itemId: selectedId, group: selectedGroup, grabOffsetY: selectedGroup.position.y - planeHit.y };
          gestureStart = { position: selectedGroup.position.clone(), rotationY: selectedGroup.rotation.y };
          controls.enabled = false; // gesture owns the pointer, not the orbit camera
          renderer.domElement.style.cursor = "grabbing";
          renderer.domElement.setPointerCapture(evt.pointerId);
        }
        // Code-review fix: same unconditional return as the rotate-handle
        // branch above, for the same reason.
        return;
      }

      const hit = raycaster.intersectObjects(scene.children, true)[0];
      const hitGroup = hit ? findItemGroup(hit.object) : null;
      if (!hitGroup) {
        selectItem(null);
        return;
      }
      const hitItemId = hitGroup.userData.itemId as string;
      selectItem(hitItemId);
      // improvements-v2.1 §4: selection always happens (above) so a locked
      // item can still be inspected/unlocked — only the drag gesture itself
      // is gated here, after selection, so this reads as "selectable but not
      // draggable" rather than "not clickable at all."
      if (isPlacementLocked(hitItemId)) return;

      // Floor-plane drag, not screen-space: a horizontal plane through the
      // item's current height, so the item tracks where the cursor ray
      // actually crosses the floor (or the item's own elevation, for a
      // shelved/mounted item) rather than a naive screen-delta, which would
      // jump/jitter as the camera orbits.
      dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hitGroup.position);
      if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
      grabOffset.set(hitGroup.position.x - planeHit.x, 0, hitGroup.position.z - planeHit.z);
      drag = { itemId: hitItemId, group: hitGroup };
      gestureStart = { position: hitGroup.position.clone(), rotationY: hitGroup.rotation.y };
      controls.enabled = false; // gesture owns the pointer, not the orbit camera
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture(evt.pointerId);
    }

    function onPointerMove(evt: PointerEvent) {
      // improvements-v2.1 §5: mouselook is PointerLockControls' own mousemove
      // listener (added in its constructor, active whenever it's locked,
      // independent of this handler) — nothing below is reachable in walk
      // mode anyway since onPointerDown can't set drag/rotateDrag while
      // walking, but bailing early also skips the hover raycast for free
      // (pointless once the pointer is locked: clientX/Y freeze at the lock
      // point instead of tracking the actual look direction).
      if (cameraModeRef.current === "walk") return;
      // §3: rotate-drag branch — the pointer's angle around the item's center
      // on the floor plane (same raycast-against-dragPlane technique translate-
      // drag uses below), turned into a *relative* sweep from the grab anchors
      // via relativeYawDeg, instead of a position delta.
      if (rotateDrag) {
        setPointerNdcFromEvent(evt);
        raycaster.setFromCamera(pointerNdc, camera);
        if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return; // camera edge case: ray parallel to the plane
        const { group, itemId, startYawDeg, grabAngleDeg } = rotateDrag;
        const currentAngleDeg = yawDegFromPointer(group.position.x, group.position.z, planeHit.x, planeHit.z);
        let yawDeg = relativeYawDeg(startYawDeg, grabAngleDeg, currentAngleDeg);
        // PRD-v2 §11.4 (decided): handle-drag snaps to the same 15deg steps as
        // the q/e keyboard shortcut by default; Shift held frees it to
        // continuous rotation, mirroring translate-snapping's Shift escape.
        if (!evt.shiftKey) yawDeg = snapYawDeg(yawDeg, ROTATE_STEP_DEG);
        group.rotation.y = THREE.MathUtils.degToRad(yawDeg);
        updateCollisionHighlight(itemId, group);
        return;
      }
      // §3: elevation-drag branch — resolve the pointer on the camera-facing
      // vertical plane set at grab time and map its Y (plus grabOffsetY) to the
      // item's elevation, clamped at the floor. Footprint (x/z) is untouched,
      // so the collision highlight — a footprint-overlap check that ignores Y
      // entirely — can't change; we deliberately skip recomputing it here
      // (unlike translate/rotate), rather than pay for a no-op.
      if (elevationDrag) {
        setPointerNdcFromEvent(evt);
        raycaster.setFromCamera(pointerNdc, camera);
        if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return; // ray parallel to the plane
        elevationDrag.group.position.y = clampElevationCm(planeHit.y + elevationDrag.grabOffsetY);
        return;
      }
      if (!drag) {
        updateHover(evt);
        return;
      }
      setPointerNdcFromEvent(evt);
      raycaster.setFromCamera(pointerNdc, camera);
      if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return; // camera edge case: ray parallel to the plane
      const { group, itemId } = drag;
      const rawX = planeHit.x + grabOffset.x;
      const rawZ = planeHit.z + grabOffset.z;
      const item = itemsByIdRef.current.get(itemId);

      // D2: snap the candidate position against walls/other items unless the
      // gesture is holding Shift — the plan's "must be escapable (hold-to-
      // disable)" bar. Snap uses the same AABB the collision check below
      // does, so a snapped-flush placement doesn't immediately re-flag as
      // colliding with the very wall/item it just snapped to (collision.ts's
      // EPSILON exists for exactly that).
      let x = rawX;
      let z = rawZ;
      if (item && !evt.shiftKey) {
        const rotationDeg = ((THREE.MathUtils.radToDeg(group.rotation.y) % 360) + 360) % 360;
        const rawAABB = itemFootprintAABB(item, [rawX, group.position.y, rawZ], rotationDeg);
        const others: AABB[] = [];
        builtRef.current?.furnitureGroups.forEach((otherGroup, otherId) => {
          if (otherId === itemId) return;
          const otherItem = itemsByIdRef.current.get(otherId);
          if (!otherItem) return;
          const otherRotationDeg = ((THREE.MathUtils.radToDeg(otherGroup.rotation.y) % 360) + 360) % 360;
          others.push(
            itemFootprintAABB(
              otherItem,
              [otherGroup.position.x, otherGroup.position.y, otherGroup.position.z],
              otherRotationDeg,
            ),
          );
        });
        const snapped = snapPosition(rawAABB, [rawX, group.position.y, rawZ], wallAABBsRef.current, others);
        x = snapped.position[0];
        z = snapped.position[2];
      }

      group.position.x = x;
      group.position.z = z;
      updateCollisionHighlight(itemId, group);
    }

    function onPointerUp(evt: PointerEvent) {
      // improvements-v2.1 §5: no explicit walk-mode gate needed here — unlike
      // onPointerDown/onPointerMove, this one's already inert while walking:
      // onPointerDown's own walk-mode bail (above) means drag/rotateDrag can
      // never be non-null to begin with, so both branches below fall through
      // to a no-op.
      if (rotateDrag) {
        if (renderer.domElement.hasPointerCapture(evt.pointerId)) {
          renderer.domElement.releasePointerCapture(evt.pointerId);
        }
        commitRotateDrag();
        return;
      }
      if (elevationDrag) {
        if (renderer.domElement.hasPointerCapture(evt.pointerId)) {
          renderer.domElement.releasePointerCapture(evt.pointerId);
        }
        commitElevationDrag();
        return;
      }
      if (!drag) return;
      if (renderer.domElement.hasPointerCapture(evt.pointerId)) {
        renderer.domElement.releasePointerCapture(evt.pointerId);
      }
      commitDrag();
    }

    // PRD-v2 §7.1: an involuntarily-interrupted gesture (the browser stealing
    // the pointer — a touch canceled, the element losing capture) reverts to
    // the pre-gesture transform rather than committing wherever the item
    // happened to be mid-drag. This is the explicit revert-on-cancel path the
    // spike flagged as a rough edge; a normal pointerup still commits.
    function onPointerCancel(evt: PointerEvent) {
      if (renderer.domElement.hasPointerCapture(evt.pointerId)) {
        renderer.domElement.releasePointerCapture(evt.pointerId);
      }
      revertGesture();
    }

    // Keyboard-focus ownership model (PRD-v2 §7.1): viewport shortcuts fire
    // only when the viewport owns focus, not globally on the document. The
    // listener lives on the canvas (which is made focusable via tabIndex, and
    // focused on pointerdown) rather than on `window`, so typing in the Shell/
    // Import/Settings panel inputs can't reach it — the previous window-level
    // handler had to special-case INPUT/TEXTAREA/SELECT to stay out of the way;
    // scoping focus to the canvas makes that ownership explicit instead of a
    // tag denylist.
    function onKeyDown(evt: KeyboardEvent) {
      // Code-review finding: without this, OS keyboard auto-repeat on a held
      // rotate key fired a full commit + immediate IndexedDB write on every
      // repeat tick (browsers commonly repeat at 20-30/sec), not once per
      // step — the opposite of the "discrete step" semantics this control is
      // meant to have. Auto-repeat keydowns set `evt.repeat`; ignoring them
      // makes a held key a no-op past the first step rather than a flood.
      if (evt.repeat) return;
      // Escape cancels an in-progress gesture (explicit revert), matching
      // pointercancel — handled before the selection/rotate logic so it works
      // whether or not an item is "still" selected mid-drag.
      if (evt.key === "Escape") {
        if (drag || rotateDrag || elevationDrag) {
          evt.preventDefault();
          revertGesture();
        }
        // No explicit pointer-lock-unlock call needed here: Escape is one of
        // the browser's own built-in pointer-lock-exit gestures, so walk mode
        // is already headed for onWalkControlsUnlock -> applyCameraMode
        // ("orbit") on its own. drag/rotateDrag are always null in walk mode
        // (onPointerDown's walk-mode bail — see above), so the revert branch
        // above is a guaranteed no-op here too, not a conflict.
        return;
      }
      // improvements-v2.1 §5: walk-mode WASD — held-key state, not a discrete
      // step like q/e/PageUp/PageDown below. animate() reads walkKeys every
      // frame via computeWalkStep; this just flips the bit and consumes the
      // keydown so it doesn't fall through to the item-shortcut logic below
      // (harmless either way, since w/a/s/d don't collide with q/e/[/]/
      // PageUp/PageDown, but explicit is clearer than relying on that).
      // Gated on walk mode so w/a/s/d are inert — no preventDefault, no state
      // — while orbiting, the same "only acts in the mode it applies to"
      // shape PointerLockControls' own mousemove listener already has via
      // its isLocked check.
      if (cameraModeRef.current === "walk") {
        const key = evt.key.toLowerCase();
        if (key === "w" || key === "a" || key === "s" || key === "d") {
          evt.preventDefault();
          if (key === "w") walkKeys.forward = true;
          else if (key === "s") walkKeys.back = true;
          else if (key === "a") walkKeys.left = true;
          else walkKeys.right = true;
          return;
        }
        // Code-review fix: every other key below this point is item
        // manipulation (L, q/e/[/], PageUp/PageDown) — mirrors
        // onPointerDown's walk-mode bail for pointer-driven selection/drag,
        // which this fell through past before. Without this, a previously-
        // selected item would silently rotate/elevate/(un)lock under the
        // user while they're just trying to walk around.
        return;
      }
      const itemId = selectedItemIdRef.current;
      if (!itemId) return;

      // improvements-v2.1 §4: "L" toggles the selected item's own lock flag
      // — deliberately checked before any lock gate below, and deliberately
      // ignores both the current lock state and the global toggle, since it
      // has to be able to unlock an item, not just lock one. Follows the
      // same "keyboard step on the selected item" pattern as q/e/PageUp/
      // PageDown below (own key, no existing binding — see the constants'
      // comments), just editing scene data (through App.tsx's commit) rather
      // than mutating a live THREE.Group.
      if (evt.key === "l" || evt.key === "L") {
        evt.preventDefault();
        onToggleLockRef.current?.(itemId);
        return;
      }

      const group = builtRef.current?.furnitureGroups.get(itemId);
      if (!group) return;
      let stepDeg = 0;
      let elevationDir: 1 | -1 | null = null;
      if (evt.key === "q" || evt.key === "Q" || evt.key === "[") stepDeg = -ROTATE_STEP_DEG;
      else if (evt.key === "e" || evt.key === "E" || evt.key === "]") stepDeg = ROTATE_STEP_DEG;
      else if (evt.key === ELEVATION_KEY_UP) elevationDir = 1;
      else if (evt.key === ELEVATION_KEY_DOWN) elevationDir = -1;
      else return;
      evt.preventDefault();
      // improvements-v2.1 §4: swallow the keypress either way (consistent
      // with every other recognized key above always calling preventDefault)
      // but skip the actual step — a locked item (own flag or the global
      // toggle) ignores rotate/elevation keys the same way onPointerDown
      // ignores a drag/rotate-drag gesture on it.
      if (isPlacementLocked(itemId)) return;
      if (stepDeg !== 0) {
        group.rotation.y += THREE.MathUtils.degToRad(stepDeg);
      } else if (elevationDir !== null) {
        group.position.y = stepElevationCm(group.position.y, elevationDir, ELEVATION_STEP_CM);
      }
      const rotationDeg = normalizeDeg(THREE.MathUtils.radToDeg(group.rotation.y));
      updateCollisionHighlight(itemId, group);
      onCommitPlacementRef.current?.(itemId, [group.position.x, group.position.y, group.position.z], rotationDeg);
    }

    // improvements-v2.1 §5: releases a held WASD key regardless of mode —
    // unconditional (not gated on cameraModeRef like onKeyDown's press side)
    // so a key released after a mode-switch-away-from-walk, or a keyup that
    // arrives a tick after the mode flips, can never leave a stale `true` in
    // walkKeys (applyCameraMode also clears all four on any mode switch —
    // this is the ongoing steady-state complement to that one-time reset).
    function onKeyUp(evt: KeyboardEvent) {
      const key = evt.key.toLowerCase();
      if (key === "w") walkKeys.forward = false;
      else if (key === "s") walkKeys.back = false;
      else if (key === "a") walkKeys.left = false;
      else if (key === "d") walkKeys.right = false;
    }

    // Keyboard-focus ownership (see onKeyDown): make the canvas focusable and
    // suppress the focus ring (it's a viewport, not a form control), so its
    // shortcuts are scoped to it rather than living on `window`.
    renderer.domElement.tabIndex = 0;
    renderer.domElement.style.outline = "none";
    // improvements-v2.1 §4: a structural rebuild tears down and recreates
    // the canvas DOM node (see the cleanup below), which drops browser focus
    // entirely — the new node was never focused. Previously harmless (only
    // import mutated `items`, and nothing chained a keyboard shortcut right
    // after it), but the new "L" lock toggle does exactly that: mutating
    // `items` via the keyboard, from a handler that's only reachable because
    // the canvas already had focus. Without this, locking/unlocking via "L"
    // works once, then silently strands every subsequent q/e/PageUp/L press
    // — the rebuilt canvas is present but unfocused, so onKeyDown never
    // fires. Restores focus only when the *previous* canvas actually had it
    // (see the cleanup's pendingRefocusRef capture), not unconditionally, so
    // this doesn't steal focus from, say, a sidebar input mid-edit when an
    // unrelated import happens to land.
    if (pendingRefocusRef.current) {
      renderer.domElement.focus();
      pendingRefocusRef.current = false;
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    renderer.domElement.addEventListener("keyup", onKeyUp);
    renderer.domElement.addEventListener("keydown", onKeyDown);

    function resize() {
      if (!container) return;
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // Keep the cached rect fresh on any real size change, gesture or not.
      viewportRect = renderer.domElement.getBoundingClientRect();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let frameId: number;
    function animate() {
      frameId = requestAnimationFrame(animate);
      const now = performance.now();
      // Frame-to-frame delta (seconds) for walk mode's constant-speed WASD
      // integration below — OrbitControls.update() doesn't need this (it's
      // not damped: no `controls.enableDamping` set anywhere in this file),
      // so this clock only exists for walk mode's sake.
      const deltaSec = (now - lastFrameTime) / 1000;
      lastFrameTime = now;
      // improvements-v2.1 §5: mutually exclusive per frame, matching
      // applyCameraMode's enable/disable split. Critically, OrbitControls
      // .update() recomputes camera.position from its own internal spherical
      // coordinates *unconditionally* — `controls.enabled` only gates its
      // input listeners, not update() — so calling it while walk mode is
      // live would silently snap the camera back every single frame,
      // undoing WASD/mouselook. Skipping it here (rather than trusting
      // `enabled`) is what actually makes the two modes exclusive at the
      // render level, not just at the input level.
      if (cameraModeRef.current === "walk") {
        if (walkControls.isLocked) {
          const step = computeWalkStep(walkKeys, WALK_SPEED_CM_PER_SEC, deltaSec);
          if (step.forward !== 0) walkControls.moveForward(step.forward);
          if (step.right !== 0) walkControls.moveRight(step.right);
        }
      } else {
        controls.update();
      }
      // v2 spike (W-A): the selection outline's bounding box has to track
      // whatever the drag/rotate handlers above just mutated the group to —
      // recomputed every frame (selectionHelperRef is null when nothing is
      // selected, so this is a no-op cost the rest of the time).
      selectionHelperRef.current?.update();
      // §3: same idea for both manipulation handles — neither is parented
      // under the item's group (see positionRotateHandle's comment), so each
      // handle's world transform has to be re-derived every frame from wherever
      // the group currently is, whether that's from a translate-drag, a
      // rotate-drag, an elevation-drag, or a keyboard step.
      const rotateHandle = rotateHandleRef.current;
      const elevationHandle = elevationHandleRef.current;
      const selId = selectedItemIdRef.current;
      if ((rotateHandle || elevationHandle) && selId) {
        const group = built.furnitureGroups.get(selId);
        const item = itemsByIdRef.current.get(selId);
        if (group && item) {
          if (rotateHandle) positionRotateHandle(rotateHandle, group, item, camera);
          if (elevationHandle) positionElevationHandle(elevationHandle, group, item, camera);
        }
      }
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelled = true;
      // improvements-v2.1 §4: capture focus ownership before anything below
      // tears the canvas down — see pendingRefocusRef's declaration and the
      // setup-side comment for why this matters now.
      pendingRefocusRef.current = document.activeElement === renderer.domElement;
      // Code-review finding: a structural rebuild can land mid-drag — e.g. an
      // unrelated background import completing changes `sceneFile.items`,
      // which this effect depends on (via `structuralSceneFile`) independent
      // of anything the drag itself did. Previously the drag's live position
      // was silently lost: the canvas/listeners this gesture depended on get
      // torn down below, `commitDrag()` never fires, and the next build
      // re-derives the item's position from its last-*committed* placement,
      // snapping it back with no explanation. Committing here first means an
      // interrupted drag/rotate lands wherever it currently sits — same
      // "commit wherever it is" behavior `onPointerCancel` already accepts
      // for a browser-stolen gesture — rather than vanishing.
      commitDrag();
      commitRotateDrag(); // §3: same "commit wherever it is" treatment for a mid-rotate-drag interruption
      commitElevationDrag(); // §3: and for a mid-elevation-drag interruption
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("keyup", onKeyUp);
      renderer.domElement.removeEventListener("keydown", onKeyDown);
      renderer.domElement.removeEventListener("click", onCanvasClickForWalkLock);
      // improvements-v2.1 §5: walkControls.dispose() removes its own
      // mousemove/pointerlockchange/pointerlockerror document-level listeners
      // (see PointerLockControls.disconnect()) — without this they'd outlive
      // this structural build and stack up across rebuilds. unlock() first so
      // a rebuild mid-walk hands the pointer back rather than leaving the OS
      // cursor captured to a canvas element that's about to be removed.
      walkControls.removeEventListener("unlock", onWalkControlsUnlock);
      walkControls.unlock();
      walkControls.dispose();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      builtRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      walkControlsRef.current = null;
      applyModeRef.current = null;
      // A structural rebuild tears down and recreates both controls objects
      // above, so any "walk" mode from before this rebuild refers to nothing
      // live anymore — reset to the default before the next build's fresh
      // OrbitControls takes over, same "drop stale state on rebuild" reason
      // selectItem(null) below exists for selection.
      cameraModeRef.current = "orbit";
      setCameraModeState("orbit");
      // A structural rebuild invalidates any selection helper's target group
      // (new BuiltScene, new groups) — the selection-outline effect further
      // down owns disposing the helper itself (keyed off buildVersion), but
      // the selection *state* has to drop too, or a stale itemId would leave
      // the app thinking something's selected with nothing to show for it.
      // improvements-v2.1 §4: stash it first so the next setup run can
      // restore it if the item survived the rebuild (see pendingReselectRef).
      pendingReselectRef.current = selectedItemIdRef.current;
      selectItem(null);
      // Any texture the calibration effect had applied belonged to this
      // build's materials — dispose them all now rather than leak.
      Object.values(appliedTexturesRef.current).forEach((textures) => textures?.forEach((t) => t.dispose()));
      appliedTexturesRef.current = {};
    };
  }, [structuralSceneFile]);

  useImperativeHandle(
    handleRef,
    (): ViewportHandle => ({
      // improvements-v2.1 §5 (camera-viewpoint compatibility — the PRD
      // explicitly flags this): OrbitControls.target IS the lookAt point by
      // construction, but PointerLockControls has no equivalent concept — it
      // only ever derives look direction from the camera's own quaternion
      // (see its getDirection()/moveForward()). So in walk mode there's no
      // "target" to read; one has to be synthesized by walking a fixed
      // distance out from the eye along that quaternion-derived forward
      // direction (deriveSyntheticLookAt, src/scene/walkCamera.ts). This
      // keeps getCurrentView()'s contract — "eye/lookAt/fov, whatever mode's
      // active" — identical for both callers (ViewportChrome's save-view
      // button doesn't need to know or care which control scheme produced
      // the reading).
      getCurrentView() {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera || !controls) return null;
        const eye: [number, number, number] = [camera.position.x, camera.position.y, camera.position.z];
        if (cameraModeRef.current === "walk" && walkControlsRef.current) {
          const forward = walkControlsRef.current.getDirection(new THREE.Vector3());
          return {
            eye,
            lookAt: deriveSyntheticLookAt(eye, [forward.x, forward.y, forward.z], SYNTHETIC_LOOKAT_DISTANCE_CM),
            fovDeg: camera.fov,
          };
        }
        return {
          eye,
          lookAt: [controls.target.x, controls.target.y, controls.target.z],
          fovDeg: camera.fov,
        };
      },
      // improvements-v2.1 §5 (camera-viewpoint compatibility, other half):
      // every saved CameraPosition was captured as an orbit-style eye+target
      // framing (either from orbit mode directly, or synthesized above from
      // walk mode) — there's no meaningfully different "walk-mode preset" to
      // recall, and applying a canned eye/lookAt/fov to a still-locked
      // PointerLockControls wouldn't even work (it never reads camera
      // .position/.quaternion from outside itself the way OrbitControls
      // .update() reads .target). Simplest correct behavior: recalling a
      // saved viewpoint always switches back to orbit mode first (unlocking
      // the pointer if walk mode had it locked), then applies the preset
      // exactly as before — so "Save view" / "Recall view" keep working
      // unchanged regardless of which mode the user happened to be in when
      // they clicked flyTo, and the recalled view is always a "camera on
      // rails around a target" shot, matching what saved viewpoints have
      // always meant in this app.
      flyTo(preset) {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera || !controls) return;
        applyModeRef.current?.("orbit");
        applyCameraPreset(camera, controls, preset);
      },
    }),
    [],
  );

  // Live shell-texture/calibration updates: mutates the materials the
  // structural effect already created, in place — no renderer/camera churn,
  // so dragging a calibration slider doesn't flicker or reset the view.
  //
  // Per-surface, this diffs against the last-applied calibration (code
  // review findings 2-4): a numeric-only change (tint/repeat/roughnessScale)
  // mutates the existing material/texture in place via
  // updateSurfaceCalibrationInPlace — no decode, no new THREE.Texture, no
  // race. Only an assetHash change (or a surface's first-ever apply after a
  // rebuild) takes the async decode-and-replace path, and that path uses a
  // per-run generation token (`runIdRef`) so a superseded run — the effect
  // re-running before a previous run's `await` resolves, e.g. from rapid
  // recalibration — aborts instead of ever mutating a material with a stale
  // result. The replaced texture is only disposed *after* the material has
  // been repointed at its replacement (inside the same synchronous
  // continuation), so `.map` never points at an already-disposed texture.
  const calibration = shellCalibration ?? sceneFile.room.shell;
  const runIdRef = useRef(0);

  useEffect(() => {
    const built = builtRef.current;
    if (!built) return;
    const myRun = ++runIdRef.current;

    (async () => {
      for (const surface of SHELL_SURFACES) {
        if (runIdRef.current !== myRun) return; // superseded by a newer run — abandon remaining surfaces too

        const calib = calibration?.[surface] ?? DEFAULT_SURFACE_CALIBRATION;
        const prevCalib = lastAppliedCalibRef.current[surface];
        const sameTexture = prevCalib !== undefined && prevCalib.assetHash === calib.assetHash;
        const sameNumeric =
          prevCalib !== undefined &&
          prevCalib.tint === calib.tint &&
          prevCalib.repeat[0] === calib.repeat[0] &&
          prevCalib.repeat[1] === calib.repeat[1] &&
          prevCalib.roughnessScale === calib.roughnessScale;

        if (sameTexture && sameNumeric) continue; // nothing changed for this surface

        if (sameTexture) {
          // Numeric-only change: mutate the already-applied material/texture
          // in place. No async work, so no cancellation window at all.
          updateSurfaceCalibrationInPlace(built.shell, surface, calib);
          lastAppliedCalibRef.current[surface] = calib;
          continue;
        }

        // Texture-affecting change (assetHash changed, or first apply for
        // this surface since the last rebuild): decode + apply + swap.
        const textureSource = calib.assetHash ? await loadShellTexture(calib.assetHash) : null;
        if (runIdRef.current !== myRun) {
          textureSource?.bitmap.close();
          return;
        }

        const oldTextures = appliedTexturesRef.current[surface] ?? [];
        const newTextures = applyShellSurface(built.shell, surface, calib, textureSource);

        if (textureSource) {
          // Force the GPU upload now, synchronously, so it's safe to close
          // the ImageBitmap right after — three.js otherwise only uploads
          // lazily on the next render() call, and closing the bitmap before
          // that upload happens would hand the renderer a dead source.
          // Without this the bitmap leaked (~4MB/surface/run): it was only
          // ever closed on the cancelled branch, never on success.
          newTextures.forEach((t) => rendererRef.current?.initTexture(t));
          textureSource.bitmap.close();
        }
        // The material already points at newTextures (applyShellSurface set
        // .map synchronously above) — safe to dispose the old ones now.
        oldTextures.forEach((t) => t.dispose());
        appliedTexturesRef.current[surface] = newTextures;
        lastAppliedCalibRef.current[surface] = calib;
      }
    })();

    return () => {
      // Invalidate this run's generation token — an in-flight `await` above
      // will see the mismatch and bail without touching any material,
      // whether this cleanup fired because the effect is re-running or
      // because the component is unmounting.
      runIdRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildVersion is a signal (rebuild happened), not a value read in the effect
  }, [calibration, buildVersion]);

  // Live sun/hemisphere updates (improvements-v2.2 §4a): same "mutate the
  // structural effect's already-created objects in place, no renderer/camera
  // churn" shape as the calibration effect above, just simpler — lighting is
  // plain numbers (no async texture decode/dispose), so there's only ever
  // the "cheap path" and no diffing against a previously-applied value is
  // needed; recomputing is trivial and idempotent.
  const lightingSettings = lighting ?? sceneFile.room.lighting ?? DEFAULT_LIGHTING;

  useEffect(() => {
    const built = builtRef.current;
    if (!built) return;
    const { sun, hemisphere } = built.lighting;
    hemisphere.intensity = lightingSettings.hemisphereIntensity;
    sun.intensity = lightingSettings.sunIntensity;
    sun.position.copy(
      sunPositionFromAngles(lightingSettings.sunAzimuthDeg, lightingSettings.sunElevationDeg, sun.target.position),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildVersion is a signal (rebuild happened), not a value read in the effect
  }, [lightingSettings, buildVersion]);

  // v2 spike (W-A) — placement reconciliation: the other half of the
  // mutate-during-gesture/commit-on-drop seam (the drag/rotate handlers in
  // the structural effect above are the first half). This effect reads
  // `sceneFile.layouts`/`sceneFile.current` directly (NOT the memoized
  // `structuralSceneFile` those handlers are gated on) and pushes each
  // command's position/rotationDeg onto the matching already-built
  // THREE.Group — in place, no buildScene() call, no renderer/camera churn.
  // It fires whenever `layouts` changes for *any* reason, not just this
  // component's own drags: a commit from here is one such reason (making
  // this call a no-op, since the group was already moved live during the
  // gesture), but so would be a future undo or a programmatic layout edit
  // (D2/D3) — this is the seam those can hang off without re-deriving their
  // own "push a placement into the live scene" logic.
  useEffect(() => {
    const built = builtRef.current;
    if (!built) return;
    const layout = sceneFile.layouts.find((l) => l.id === sceneFile.current);
    layout?.commands.forEach((cmd) => {
      const group = built.furnitureGroups.get(cmd.itemId);
      if (!group) {
        // A command with no built group. When import was the only
        // layout-mutating path this was assumed transient ("the next
        // structural build will place it") — but that's only true while the
        // item still exists in `items`: buildScene builds a group for every
        // command whose item is present, so a group missing *here* means the
        // command is orphaned — it references an item no longer in
        // `sceneFile.items`. No path deletes items today, but now that
        // layout-mutating paths exist beyond import (a future undo,
        // programmatic edits — the paths this reconciliation effect also
        // serves), one could produce an orphan; a rebuild would never place
        // it, so surface it in dev rather than skipping silently. An item
        // that IS present but not yet grouped is the benign mid-rebuild race
        // and stays quiet.
        if (import.meta.env.DEV && !itemsByIdRef.current.has(cmd.itemId)) {
          console.warn(
            `[Viewport] layout command references unknown item "${cmd.itemId}" — orphaned placement, skipping`,
          );
        }
        return;
      }
      group.position.set(cmd.position[0], cmd.position[1], cmd.position[2]);
      group.rotation.y = THREE.MathUtils.degToRad(cmd.rotationDeg);
    });
    selectionHelperRef.current?.update(); // outline may now be stale (item moved) — resync its AABB too
    // D2: any layout change can move the *other* items a selected one's
    // collision state depends on (not just the selected item itself), so
    // re-derive the highlight here too rather than only from this
    // component's own drag/rotate handlers.
    if (selectedItemIdRef.current) {
      const group = built.furnitureGroups.get(selectedItemIdRef.current);
      if (group) updateCollisionHighlight(selectedItemIdRef.current, group);
    }
    // §3: a committed layout change (e.g. a future undo, or a programmatic
    // edit) can move/rotate/elevate the selected item from outside this
    // component's own drag code too — resync both handles' world transforms
    // here for the same reason the outline resyncs above. Also a no-op the
    // frame after this component's own handle commit, since animate() already
    // kept them current live.
    const rotateHandle = rotateHandleRef.current;
    const elevationHandle = elevationHandleRef.current;
    if ((rotateHandle || elevationHandle) && selectedItemIdRef.current) {
      const group = built.furnitureGroups.get(selectedItemIdRef.current);
      const item = itemsByIdRef.current.get(selectedItemIdRef.current);
      const cam = cameraRef.current;
      if (group && item && cam) {
        if (rotateHandle) positionRotateHandle(rotateHandle, group, item, cam);
        if (elevationHandle) positionElevationHandle(elevationHandle, group, item, cam);
      }
    }
  }, [sceneFile.layouts, sceneFile.current, buildVersion]);

  // v2 spike (W-A) — selection-outline lifecycle: a THREE.BoxHelper
  // (cheapest indicator per the plan's "outline, highlight material swap,
  // whatever's cheapest") added directly to the scene, not parented under
  // the item's group, so it's never itself a raycast hit (also disabled via
  // `.raycast = () => {}` below, belt-and-suspenders) and so swapping it
  // doesn't touch the item's own material (shared across every box-shape
  // item — see buildScene.ts's MAT.furniture — so mutating a material
  // in place would highlight every plain box at once, not just the
  // selected one). Runs on selection change and on every rebuild
  // (buildVersion): a rebuild's fresh furnitureGroups map means the old
  // helper's target group reference is dead, so it's always torn down and,
  // if still selected, recreated against the new group.
  useEffect(() => {
    const prevHelper = selectionHelperRef.current;
    if (prevHelper) {
      prevHelper.parent?.remove(prevHelper);
      prevHelper.dispose();
      selectionHelperRef.current = null;
    }
    // §3: both manipulation handles share the outline's lifecycle — torn down
    // on every selection change/rebuild alongside it, recreated below only if
    // something's still selected. disposeHandle traverses each group (multi-
    // mesh now), unlike the old single-sphere geometry/material dispose.
    const prevRotate = rotateHandleRef.current;
    if (prevRotate) {
      disposeHandle(prevRotate);
      rotateHandleRef.current = null;
    }
    const prevElevation = elevationHandleRef.current;
    if (prevElevation) {
      disposeHandle(prevElevation);
      elevationHandleRef.current = null;
    }
    const built = builtRef.current;
    if (!built || !selectedItemId) return;
    const group = built.furnitureGroups.get(selectedItemId);
    if (!group) return;
    const helper = new THREE.BoxHelper(group, SELECTION_COLOR);
    helper.raycast = () => {};
    // The helper's wireframe sits exactly on the wrapped item's own surface —
    // same depth as the mesh it outlines, which z-fights and mostly loses
    // against a filled box/GLB mesh (found while capturing W-A evidence: the
    // outline was computed correctly but essentially invisible on screen).
    // Rendering it depth-test-disabled and after everything else (a fixed,
    // late renderOrder) is the standard "always-on-top overlay" fix for
    // exactly this — cheap, and correct for a selection indicator, which
    // should never be occluded by the thing it's pointing at.
    (helper.material as THREE.LineBasicMaterial).depthTest = false;
    helper.renderOrder = 999;
    built.scene.add(helper);
    selectionHelperRef.current = helper;
    // D2: color the outline correctly from the moment of selection — an
    // item that's already overlapping something shouldn't need a drag
    // before the flag shows up.
    updateCollisionHighlight(selectedItemId, group);

    // §3: both handles reuse SELECTION_COLOR (so they read as part of the same
    // selection affordance, not new unrelated UI). Neither is parented under
    // the item's group: a translate-drag mutates group.position directly (see
    // onPointerMove), and re-parenting/reading a child's world position every
    // pointermove would need its own matrix-world bookkeeping for no benefit
    // over recomputing each handle's transform from the group's own
    // position/rotation, which animate() already does every frame. Both use
    // the same depth-test-disabled/late-renderOrder overlay treatment as the
    // outline, for the same reason: a selection affordance should never be
    // occluded by the furniture it points at, and each doubles as its own
    // raycast target (onPointerDown checks them before anything else).
    const item = itemsByIdRef.current.get(selectedItemId);
    if (item) {
      const cam = cameraRef.current;
      // Rotation handle: footprint ring + grip knob (replaces the C1 sphere).
      const rotateHandle = createRotateHandle(item);
      if (cam) positionRotateHandle(rotateHandle, group, item, cam);
      built.scene.add(rotateHandle);
      rotateHandleRef.current = rotateHandle;
      // Elevation handle: vertical double-arrow above the item (net-new).
      const elevationHandle = createElevationHandle();
      if (cam) positionElevationHandle(elevationHandle, group, item, cam);
      built.scene.add(elevationHandle);
      elevationHandleRef.current = elevationHandle;
      // improvements-v2.1 §4 / code-review fix: collision- and lock-aware
      // initial color on both handles, the same gestureAffordanceColor
      // composition setHandleHovered uses — a freshly-selected item that's
      // already colliding or locked should read that way on its handles from
      // the first frame, not just after the first hover. updateCollisionHighlight
      // above already refreshed selectedCollidingRef for this exact item.
      const initialColor = gestureAffordanceColor(selectedItemId, selectedCollidingRef.current);
      if (initialColor !== SELECTION_COLOR) {
        setHandleColor(rotateHandle, initialColor);
        setHandleColor(elevationHandle, initialColor);
      }
    }
  }, [selectedItemId, buildVersion]);

  // improvements-v2.1 §4: globalLock is ephemeral App.tsx state, not part of
  // `sceneFile` — it's deliberately NOT one of structuralSceneFile's deps
  // (toggling it must not tear down/rebuild the renderer, same reasoning as
  // every other view-only piece of state this component keeps out of that
  // memo). That means flipping it doesn't fire a structural rebuild, so
  // nothing else here would otherwise re-sync the already-live selection
  // outline/handle color to the new lock state until the next unrelated
  // mutation. This is that seam: re-runs the same color composition
  // updateCollisionHighlight/handle-creation already use, purely to catch
  // "toggled global lock while something was already selected."
  useEffect(() => {
    const built = builtRef.current;
    const selId = selectedItemIdRef.current;
    if (!built || !selId) return;
    const group = built.furnitureGroups.get(selId);
    if (group) updateCollisionHighlight(selId, group); // refreshes selectedCollidingRef too
    // §3: both handles are multi-mesh THREE.Group instances (ring+knob,
    // stem+cones) now, not a single Mesh with a top-level `.material` —
    // setHandleColor traverses and recolors every mesh underneath.
    // Code-review fix: collision- and lock-aware (gestureAffordanceColor),
    // not lock-only — a locked-and-colliding item's handles should stay red,
    // matching the outline, not fall back to amber.
    const color = gestureAffordanceColor(selId, selectedCollidingRef.current);
    const rotateHandle = rotateHandleRef.current;
    if (rotateHandle) setHandleColor(rotateHandle, color);
    const elevationHandle = elevationHandleRef.current;
    if (elevationHandle) setHandleColor(elevationHandle, color);
  }, [globalLock]);

  // improvements-v2.1 §5: mode-toggle pill, self-contained to this component
  // (rather than threaded through ViewportChrome/App.tsx) since the camera
  // mode it controls only exists as live state inside this component's own
  // Three.js build — reusing ViewportChrome's `.viewport-chrome-pill` visual
  // language (see Viewport.css) without adopting its file, so this stays a
  // single localized diff and doesn't collide with LayoutChrome (top-center)
  // or ViewportChrome (bottom-center) for screen real estate. Rendered as a
  // sibling of the canvas div (both direct children of App.tsx's
  // position:relative `.app-viewport`), same pattern those two chromes use.
  return (
    <>
      <div ref={containerRef} className="viewport" />
      <div className="viewport-mode-toggle">
        <button
          type="button"
          className="viewport-mode-toggle-pill"
          onClick={() => applyModeRef.current?.(cameraMode === "orbit" ? "walk" : "orbit")}
          aria-label={cameraMode === "orbit" ? "Switch to walk-around camera" : "Switch to orbit camera"}
          title={cameraMode === "orbit" ? "Switch to walk-around camera" : "Switch to orbit camera"}
        >
          {cameraMode === "orbit" ? (
            <Footprints size={14} aria-hidden="true" />
          ) : (
            <OrbitIcon size={14} aria-hidden="true" />
          )}
          {cameraMode === "orbit" ? "Walk" : "Orbit"}
        </button>
        {cameraMode === "walk" && (
          <p className="viewport-mode-hint">Click to look around · WASD to move · Esc to exit</p>
        )}
      </div>
    </>
  );
});
