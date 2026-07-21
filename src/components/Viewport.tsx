import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { addFurnitureBoxMeshes, buildScene, furnitureOverallDims, type BuiltScene } from "../scene/buildScene";
import { applyShellSurface, updateSurfaceCalibrationInPlace, type ShellSurface } from "../scene/shellMaterials";
import { loadShellTexture } from "../scene/loadShellTexture";
import { fitModelToDims, loadFurnitureModel } from "../scene/loadFurnitureModel";
import {
  DEFAULT_SURFACE_CALIBRATION,
  type CameraPosition,
  type ShellCalibration,
  type SurfaceCalibration,
} from "../schema/scene";
import type { SceneFile } from "../scene/types";
import "./Viewport.css";

// v2 spike (W-A, `v2/spike-arrange` — see spike-v2/OUTCOME.md): move + rotate
// + selection for a placed item, prototyped directly in the real viewport
// per v2-spike-plan.md §4. Spike-quality: the seam below is the thing being
// evaluated, not a finished feature (no collision/snap — D2 — or named
// layouts/replace — D3).

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

// Clamps how far OrbitControls can orbit vertically — without this, an
// unclamped orbit can pass under the floor or over the ceiling and show the
// scene background color through them (belt-and-suspenders alongside the
// shell materials' `side: THREE.DoubleSide`, a Phase 1/2 code-review
// deferred finding fixed here).
const MIN_POLAR_ANGLE = 0.1;
const MAX_POLAR_ANGLE = Math.PI - 0.1;

// W-A rotate control: keyboard step rather than a drag handle. Tradeoff
// (recorded for C1): a handle reads more "direct manipulation" and matches
// move's interaction model, but needs its own hit-testable geometry, an
// angle-from-drag calculation, and a way to keep it visible/clickable at any
// camera angle — real work for a spike whose core question is the floor-
// drag seam, not rotate UI polish. A keyboard step is a few lines, is
// trivially precise (exact 15deg increments fix the three known orientation
// bugs in seconds, per v2-spike-plan.md §3), and still round-trips through
// the identical commit-on-release path move uses. Coarser-grained by
// construction — no free-angle rotate — which is a real limitation if C1
// ever wants an in-between angle.
const ROTATE_STEP_DEG = 15;
const SELECTION_COLOR = 0x4fd1ff;

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
          fitModelToDims(model, furnitureOverallDims(item));
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

    function normalizeDeg(deg: number): number {
      return ((deg % 360) + 360) % 360;
    }

    function setPointerNdcFromEvent(evt: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
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
      controls.enabled = true;
    }

    function onPointerDown(evt: PointerEvent) {
      if (evt.button !== 0) return;
      setPointerNdcFromEvent(evt);
      raycaster.setFromCamera(pointerNdc, camera);
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
      controls.enabled = false; // gesture owns the pointer, not the orbit camera
      renderer.domElement.setPointerCapture(evt.pointerId);
    }

    function onPointerMove(evt: PointerEvent) {
      if (!drag) return;
      setPointerNdcFromEvent(evt);
      raycaster.setFromCamera(pointerNdc, camera);
      if (!raycaster.ray.intersectPlane(dragPlane, planeHit)) return; // camera edge case: ray parallel to the plane
      drag.group.position.x = planeHit.x + grabOffset.x;
      drag.group.position.z = planeHit.z + grabOffset.z;
    }

    function onPointerUp(evt: PointerEvent) {
      if (!drag) return;
      if (renderer.domElement.hasPointerCapture(evt.pointerId)) {
        renderer.domElement.releasePointerCapture(evt.pointerId);
      }
      commitDrag();
    }

    // Rough edge (spike, recorded for C1): a pointercancel (e.g. the browser
    // stealing the gesture) commits wherever the item currently sits rather
    // than reverting to its pre-drag position. Acceptable for a prototype —
    // a real build would want an explicit revert-on-cancel path.
    function onPointerCancel(evt: PointerEvent) {
      onPointerUp(evt);
    }

    // Keyboard rotate step (see ROTATE_STEP_DEG's tradeoff comment above).
    // Window-level so focus doesn't have to be on the canvas — but that
    // means it has to get out of the way of ordinary typing in the Shell/
    // Import/Settings panel's own inputs.
    function onKeyDown(evt: KeyboardEvent) {
      const active = document.activeElement;
      if (active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName)) return;
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
      onCommitPlacementRef.current?.(itemId, [group.position.x, group.position.y, group.position.z], rotationDeg);
    }

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);

    function resize() {
      if (!container) return;
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
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
      if (!group) return; // item not in this build (e.g. mid-rebuild) — the next structural build will place it correctly
      group.position.set(cmd.position[0], cmd.position[1], cmd.position[2]);
      group.rotation.y = THREE.MathUtils.degToRad(cmd.rotationDeg);
    });
    selectionHelperRef.current?.update(); // outline may now be stale (item moved) — resync its AABB too
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
  }, [selectedItemId, buildVersion]);

  return <div ref={containerRef} className="viewport" />;
});
