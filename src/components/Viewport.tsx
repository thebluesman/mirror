import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { addFurnitureBoxMeshes, buildScene, furnitureOverallDims, type BuiltScene } from "../scene/buildScene";
import { applyShellSurface, updateSurfaceCalibrationInPlace, type ShellSurface } from "../scene/shellMaterials";
import { loadShellTexture } from "../scene/loadShellTexture";
import { fitModelToDims, loadFurnitureModel } from "../scene/loadFurnitureModel";
import { computeFlatTextureFit, FULL_CONTENT_BOX, type ContentBox } from "../scene/flatItemTexture";
import { checkCollisions, itemFootprintAABB, wallFootprintAABBs, type AABB } from "../scene/collision";
import { snapPosition } from "../scene/snapping";
import { rotateHandleWorldXZ, snapYawDeg, yawDegFromPointer } from "../scene/rotateHandle";
import {
  DEFAULT_SURFACE_CALIBRATION,
  type CameraPosition,
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

// C1 follow-up (see spike-v2/OUTCOME.md's "C1 follow-up — rotate UI handle"
// section): Shyam's hands-on C1 pass cleared the plan's "handle *or*
// keyboard step" bar via the keyboard step alone, but asked for a visible
// drag handle too, additive to (not a replacement for) the above. How far
// out along the item's local +Z the handle sits, and how big its hit-target
// sphere is — both in cm, same unit as the rest of the scene graph.
const ROTATE_HANDLE_MARGIN_CM = 25;
const ROTATE_HANDLE_RADIUS_CM = 6;

// Camera-relative grab-target sizing (PRD-v2 §7.1 polish): a fixed world-space
// radius reads as a tiny dot when the camera is zoomed out and a boulder when
// zoomed in. The handle mesh (and therefore its raycast hit target, which
// scales with it) is instead sized by camera distance / this reference so it
// holds a roughly constant on-screen size, clamped so it never vanishes or
// dominates. ROTATE_HANDLE_RADIUS_CM is the authored size at the reference
// distance.
const ROTATE_HANDLE_REF_DISTANCE_CM = 500;
const ROTATE_HANDLE_MIN_SCALE = 0.5;
const ROTATE_HANDLE_MAX_SCALE = 4;

const SELECTION_COLOR = 0x4fd1ff;
// The rotate handle brightens to this while hovered, so it reads as a grabbable
// affordance (paired with a `cursor: grab` on the canvas — see updateHover).
const ROTATE_HANDLE_HOVER_COLOR = 0xd6f5ff;
// D2: the selection outline recolors to this when the selected item's
// footprint currently overlaps another item or a wall — the plan's
// "decision support, not physics" bar means we flag, we don't block.
const COLLISION_COLOR = 0xff5c5c;

/** World-space position for the rotate handle, given the item's live group
 *  and its definition (for overall dims). Not parented under the group (see
 *  the selection-outline effect for why) — called from three call sites that
 *  all want the handle to track a group that may have just been mutated
 *  imperatively: the handle's own creation, the placement-reconciliation
 *  effect (a committed layout change can move/rotate the selected item from
 *  outside this component's own drag code), and every animate() frame (so a
 *  live drag — translate or rotate — keeps the handle glued to the item
 *  without waiting for a React re-render). */
function positionRotateHandle(
  handle: THREE.Mesh,
  group: THREE.Group,
  item: FurnitureItem,
  camera: THREE.PerspectiveCamera,
) {
  const yawDeg = ((THREE.MathUtils.radToDeg(group.rotation.y) % 360) + 360) % 360;
  const dims = furnitureOverallDims(item);
  const offset = dims.d / 2 + ROTATE_HANDLE_MARGIN_CM;
  const [hx, hz] = rotateHandleWorldXZ(group.position.x, group.position.z, yawDeg, offset);
  handle.position.set(hx, group.position.y + dims.h / 2, hz);
  // Camera-relative grab-target sizing — scale the handle so it holds a
  // roughly constant on-screen size regardless of orbit distance/zoom.
  const dist = camera.position.distanceTo(handle.position);
  const scale = THREE.MathUtils.clamp(
    dist / ROTATE_HANDLE_REF_DISTANCE_CM,
    ROTATE_HANDLE_MIN_SCALE,
    ROTATE_HANDLE_MAX_SCALE,
  );
  handle.scale.setScalar(scale);
}

export const Viewport = forwardRef<
  ViewportHandle,
  {
    sceneFile: SceneFile;
    /** Live calibration, applied without rebuilding the scene/renderer — see
     *  the shell-update effect below. Defaults to sceneFile.room.shell. */
    shellCalibration?: ShellCalibration;
    /** v2 spike (W-A): fired once per gesture — on drag-release for a move,
     *  or per keypress for a rotate step — with the item's final position/
     *  rotation. Never fired per-frame mid-drag; see the pointer-handler
     *  effect below for the mutate-during-gesture seam this reconciles. */
    onCommitPlacement?: (itemId: string, position: [number, number, number], rotationDeg: number) => void;
  }
>(function Viewport({ sceneFile, shellCalibration, onCommitPlacement }, handleRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const builtRef = useRef<BuiltScene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  // Latest onCommitPlacement in a ref so the pointer/keyboard effect (which
  // only wants to run once per structural build) doesn't have to re-bind its
  // DOM listeners every time App.tsx passes a new closure.
  const onCommitPlacementRef = useRef(onCommitPlacement);
  onCommitPlacementRef.current = onCommitPlacement;

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
  const selectionHelperRef = useRef<THREE.BoxHelper | null>(null);
  // C1 follow-up: the rotate-drag handle mesh — a small sphere, lifecycle
  // paired with selectionHelperRef (created/destroyed alongside it in the
  // selection-outline effect below), but tracked separately since it needs
  // its own raycast target and its own per-frame reposition math.
  const rotateHandleRef = useRef<THREE.Mesh | null>(null);

  // D2: wall AABBs and the item-id -> definition lookup only change when a
  // structural rebuild happens (room/items are structuralSceneFile deps), so
  // they're computed once per build and read from every drag/rotate/select
  // collision check rather than recomputed per pointer event.
  const wallAABBsRef = useRef<AABB[]>([]);
  const itemsByIdRef = useRef<Map<string, FurnitureItem>>(new Map());

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
    (helper.material as THREE.LineBasicMaterial).color.set(colliding ? COLLISION_COLOR : SELECTION_COLOR);
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
  // `sceneFile` that only changes when a *non-shell* top-level field
  // changes — NOT on `sceneFile` directly. That distinction matters beyond
  // "skip the work": an effect's cleanup always runs before its next
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
    // Dev-only console diagnostic (never ships to a production build): lets
    // Shyam dump live scene-graph info (positions/materials/geometry) from
    // devtools without a rebuild, for one-off "why does this look wrong"
    // investigations. See scratch console snippets in troubleshooting notes.
    if (import.meta.env.DEV) {
      // @ts-expect-error dev-only debug global, intentionally untyped
      window.__mirrorDebug = { camera, controls, scene: built.scene, THREE };
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
    // C1 follow-up: a second, mutually-exclusive gesture — dragging the
    // rotate handle sets group.rotation.y directly from the pointer's angle
    // around the item's center, rather than moving group.position like
    // `drag` above. Only one of `drag`/`rotateDrag` is ever set at a time
    // (onPointerDown picks one based on what the ray hit first).
    let rotateDrag: { itemId: string; group: THREE.Group } | null = null;
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
      const active = drag ?? rotateDrag;
      if (active && gestureStart) {
        active.group.position.copy(gestureStart.position);
        active.group.rotation.y = gestureStart.rotationY;
        updateCollisionHighlight(active.itemId, active.group);
      }
      drag = null;
      rotateDrag = null;
      endGesture();
    }

    // Rotate handle brightens while hovered — its own material, so this never
    // touches the shared furniture material.
    function setHandleHovered(hovered: boolean) {
      const handleMesh = rotateHandleRef.current;
      if (!handleMesh) return;
      (handleMesh.material as THREE.MeshBasicMaterial).color.set(hovered ? ROTATE_HANDLE_HOVER_COLOR : SELECTION_COLOR);
    }

    // Idle-hover affordances (not during a drag): `cursor: grab` over the
    // rotate handle or a selectable item, and the handle's hover highlight.
    // O(items) per move, same order as the drag-path collision recompute the
    // plan accepts at ~13 items.
    function updateHover(evt: PointerEvent) {
      const dom = renderer.domElement;
      setPointerNdcFromEvent(evt);
      raycaster.setFromCamera(pointerNdc, camera);
      const handleMesh = rotateHandleRef.current;
      const overHandle = handleMesh ? raycaster.intersectObject(handleMesh, false).length > 0 : false;
      setHandleHovered(overHandle);
      if (overHandle) {
        dom.style.cursor = "grab";
        return;
      }
      const hit = raycaster.intersectObjects(scene.children, true)[0];
      const overItem = hit ? findItemGroup(hit.object) !== null : false;
      dom.style.cursor = overItem ? "grab" : "";
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

    function onPointerDown(evt: PointerEvent) {
      if (evt.button !== 0) return;
      // Give the viewport keyboard focus so its shortcuts (q/e, Escape) are
      // focus-scoped to it — see onKeyDown's focus-ownership note.
      renderer.domElement.focus();
      setPointerNdcFromEvent(evt);
      raycaster.setFromCamera(pointerNdc, camera);

      // C1 follow-up: the rotate handle is its own raycast target, checked
      // first and in isolation (not part of the scene.children walk below,
      // and not parented under the item's group) — a hit here starts a
      // rotate-drag and returns before the item-vs-empty-space logic below
      // ever runs, so clicking the handle can never be mistaken for a
      // translate-drag on the item it's attached to.
      const handleMesh = rotateHandleRef.current;
      if (handleMesh) {
        const handleHit = raycaster.intersectObject(handleMesh, false)[0];
        if (handleHit) {
          const itemId = selectedItemIdRef.current;
          const group = itemId ? built.furnitureGroups.get(itemId) : undefined;
          if (itemId && group) {
            dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), group.position);
            rotateDrag = { itemId, group };
            gestureStart = { position: group.position.clone(), rotationY: group.rotation.y };
            controls.enabled = false; // gesture owns the pointer, not the orbit camera
            renderer.domElement.style.cursor = "grabbing";
            renderer.domElement.setPointerCapture(evt.pointerId);
            return;
          }
        }
      }

      const hit = raycaster.intersectObjects(scene.children, true)[0];
      const hitGroup = hit ? findItemGroup(hit.object) : null;
      if (!hitGroup) {
        selectItem(null);
        return;
      }
      selectItem(hitGroup.userData.itemId as string);

      // Floor-plane drag, not screen-space: a horizontal plane through the
      // item's current height, so the item tracks where the cursor ray
      // actually crosses the floor (or the item's own elevation, for a
      // shelved/mounted item) rather than a naive screen-delta, which would
      // jump/jitter as the camera orbits.
      dragPlane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), hitGroup.position);
      if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return;
      grabOffset.set(hitGroup.position.x - planeHit.x, 0, hitGroup.position.z - planeHit.z);
      drag = { itemId: hitGroup.userData.itemId as string, group: hitGroup };
      gestureStart = { position: hitGroup.position.clone(), rotationY: hitGroup.rotation.y };
      controls.enabled = false; // gesture owns the pointer, not the orbit camera
      renderer.domElement.style.cursor = "grabbing";
      renderer.domElement.setPointerCapture(evt.pointerId);
    }

    function onPointerMove(evt: PointerEvent) {
      // C1 follow-up: rotate-drag branch — angle between the item's center
      // and the pointer's current floor-plane hit, same raycast-against-
      // dragPlane technique translate-drag uses below, feeding the pure
      // yawDegFromPointer helper (src/scene/rotateHandle.ts) instead of a
      // position delta.
      if (rotateDrag) {
        setPointerNdcFromEvent(evt);
        raycaster.setFromCamera(pointerNdc, camera);
        if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return; // camera edge case: ray parallel to the plane
        const { group, itemId } = rotateDrag;
        let yawDeg = yawDegFromPointer(group.position.x, group.position.z, planeHit.x, planeHit.z);
        // PRD-v2 §11.4 (decided): handle-drag snaps to the same 15deg steps as
        // the q/e keyboard shortcut by default; Shift held frees it to
        // continuous rotation, mirroring translate-snapping's Shift escape.
        if (!evt.shiftKey) yawDeg = snapYawDeg(yawDeg, ROTATE_STEP_DEG);
        group.rotation.y = THREE.MathUtils.degToRad(yawDeg);
        updateCollisionHighlight(itemId, group);
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
      if (rotateDrag) {
        if (renderer.domElement.hasPointerCapture(evt.pointerId)) {
          renderer.domElement.releasePointerCapture(evt.pointerId);
        }
        commitRotateDrag();
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
        if (drag || rotateDrag) {
          evt.preventDefault();
          revertGesture();
        }
        return;
      }
      const itemId = selectedItemIdRef.current;
      if (!itemId) return;
      const group = builtRef.current?.furnitureGroups.get(itemId);
      if (!group) return;
      let stepDeg = 0;
      if (evt.key === "q" || evt.key === "Q" || evt.key === "[") stepDeg = -ROTATE_STEP_DEG;
      else if (evt.key === "e" || evt.key === "E" || evt.key === "]") stepDeg = ROTATE_STEP_DEG;
      else return;
      evt.preventDefault();
      group.rotation.y += THREE.MathUtils.degToRad(stepDeg);
      const rotationDeg = normalizeDeg(THREE.MathUtils.radToDeg(group.rotation.y));
      updateCollisionHighlight(itemId, group);
      onCommitPlacementRef.current?.(itemId, [group.position.x, group.position.y, group.position.z], rotationDeg);
    }

    // Keyboard-focus ownership (see onKeyDown): make the canvas focusable and
    // suppress the focus ring (it's a viewport, not a form control), so its
    // shortcuts are scoped to it rather than living on `window`.
    renderer.domElement.tabIndex = 0;
    renderer.domElement.style.outline = "none";
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
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
      controls.update();
      // v2 spike (W-A): the selection outline's bounding box has to track
      // whatever the drag/rotate handlers above just mutated the group to —
      // recomputed every frame (selectionHelperRef is null when nothing is
      // selected, so this is a no-op cost the rest of the time).
      selectionHelperRef.current?.update();
      // C1 follow-up: same idea for the rotate handle — it isn't parented
      // under the item's group (see positionRotateHandle's comment), so its
      // world position has to be re-derived every frame from wherever the
      // group currently is, whether that's from a translate-drag, a
      // rotate-drag, or a keyboard step.
      const handle = rotateHandleRef.current;
      const selId = selectedItemIdRef.current;
      if (handle && selId) {
        const group = built.furnitureGroups.get(selId);
        const item = itemsByIdRef.current.get(selId);
        if (group && item) positionRotateHandle(handle, group, item, camera);
      }
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelled = true;
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
      commitRotateDrag(); // C1 follow-up: same "commit wherever it is" treatment for a mid-rotate-drag interruption
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      renderer.domElement.removeEventListener("keydown", onKeyDown);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      builtRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      // A structural rebuild invalidates any selection helper's target group
      // (new BuiltScene, new groups) — the selection-outline effect further
      // down owns disposing the helper itself (keyed off buildVersion), but
      // the selection *state* has to drop too, or a stale itemId would leave
      // the app thinking something's selected with nothing to show for it.
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
      getCurrentView() {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera || !controls) return null;
        return {
          eye: [camera.position.x, camera.position.y, camera.position.z],
          lookAt: [controls.target.x, controls.target.y, controls.target.z],
          fovDeg: camera.fov,
        };
      },
      flyTo(preset) {
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!camera || !controls) return;
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
    // C1 follow-up: a committed layout change (e.g. a future undo, or a
    // programmatic edit) can move/rotate the selected item from outside this
    // component's own drag code too — resync the handle's world position
    // here for the same reason the outline resyncs above. Also a no-op the
    // frame after this component's own drag/rotate-handle commit, since
    // animate() already kept it current live.
    const handle = rotateHandleRef.current;
    if (handle && selectedItemIdRef.current) {
      const group = built.furnitureGroups.get(selectedItemIdRef.current);
      const item = itemsByIdRef.current.get(selectedItemIdRef.current);
      const cam = cameraRef.current;
      if (group && item && cam) positionRotateHandle(handle, group, item, cam);
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
    // C1 follow-up: rotate handle shares the outline's lifecycle — torn down
    // on every selection change/rebuild alongside it, recreated below only
    // if something's still selected.
    const prevHandle = rotateHandleRef.current;
    if (prevHandle) {
      prevHandle.parent?.remove(prevHandle);
      prevHandle.geometry.dispose();
      (prevHandle.material as THREE.Material).dispose();
      rotateHandleRef.current = null;
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

    // C1 follow-up: rotate handle — a small sphere reusing SELECTION_COLOR
    // (so it reads as part of the same selection affordance, not a new
    // unrelated UI element), offset along the item's local +Z per
    // positionRotateHandle. Not parented under the item's group: a
    // translate-drag mutates group.position directly (see onPointerMove),
    // and re-parenting/reading a child's world position every pointermove
    // would need its own matrix-world update bookkeeping for no benefit over
    // just recomputing the handle's world (x,z) from the group's own
    // position/rotation, which animate() already does every frame. Same
    // depth-test-disabled/late-renderOrder overlay treatment as the outline,
    // for the same reason: a selection affordance should never be occluded
    // by the furniture it's pointing at, and it doubles as this handle's own
    // raycast target (onPointerDown checks it before anything else).
    const item = itemsByIdRef.current.get(selectedItemId);
    if (item) {
      const handleGeo = new THREE.SphereGeometry(ROTATE_HANDLE_RADIUS_CM, 16, 16);
      const handleMat = new THREE.MeshBasicMaterial({ color: SELECTION_COLOR, depthTest: false });
      const handle = new THREE.Mesh(handleGeo, handleMat);
      handle.renderOrder = 999;
      handle.userData.isRotateHandle = true;
      const cam = cameraRef.current;
      if (cam) positionRotateHandle(handle, group, item, cam);
      built.scene.add(handle);
      rotateHandleRef.current = handle;
    }
  }, [selectedItemId, buildVersion]);

  return <div ref={containerRef} className="viewport" />;
});
