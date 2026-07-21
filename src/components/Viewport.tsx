import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildScene, furnitureOverallDims, type BuiltScene } from "../scene/buildScene";
import { applyShellSurface, updateSurfaceCalibrationInPlace, type ShellSurface } from "../scene/shellMaterials";
import { loadShellTexture } from "../scene/loadShellTexture";
import { fitModelToDims, loadFurnitureModel } from "../scene/loadFurnitureModel";
import { DEFAULT_SURFACE_CALIBRATION, type ShellCalibration, type SurfaceCalibration } from "../schema/scene";
import type { SceneFile } from "../scene/types";
import "./Viewport.css";

const HUMAN_FOV = 38; // ~35mm-equivalent, per spike 2's C2 feedback
const SHELL_SURFACES: ShellSurface[] = ["wall", "floor", "ceiling"];

// Clamps how far OrbitControls can orbit vertically — without this, an
// unclamped orbit can pass under the floor or over the ceiling and show the
// scene background color through them (belt-and-suspenders alongside the
// shell materials' `side: THREE.DoubleSide`, a Phase 1/2 code-review
// deferred finding fixed here).
const MIN_POLAR_ANGLE = 0.1;
const MAX_POLAR_ANGLE = Math.PI - 0.1;

export function Viewport({
  sceneFile,
  shellCalibration,
}: {
  sceneFile: SceneFile;
  /** Live calibration, applied without rebuilding the scene/renderer — see
   *  the shell-update effect below. Defaults to sceneFile.room.shell. */
  shellCalibration?: ShellCalibration;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const builtRef = useRef<BuiltScene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

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
  const structuralSceneFile = useMemo(
    () => sceneFile,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: this is the memo's whole purpose, see comment above
    [
      sceneFile.room.ceilingHeightCm,
      sceneFile.room.floor,
      sceneFile.room.walls,
      sceneFile.items,
      sceneFile.cameras,
      sceneFile.layouts,
      sceneFile.current,
    ],
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
        });
    });
    setBuildVersion((v) => v + 1);
    const { scene, cameras } = built;

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(HUMAN_FOV, 1, 5, 3000);
    const preset = cameras[0];
    if (preset) {
      camera.position.set(...preset.eye);
      camera.fov = preset.fovDeg ?? HUMAN_FOV;
      camera.updateProjectionMatrix();
    } else {
      camera.position.set(0, 300, 600);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = true;
    controls.minPolarAngle = MIN_POLAR_ANGLE;
    controls.maxPolarAngle = MAX_POLAR_ANGLE;
    if (preset) {
      controls.target.set(...preset.lookAt);
    }
    controls.update();

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
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      builtRef.current = null;
      rendererRef.current = null;
      // Any texture the calibration effect had applied belonged to this
      // build's materials — dispose them all now rather than leak.
      Object.values(appliedTexturesRef.current).forEach((textures) => textures?.forEach((t) => t.dispose()));
      appliedTexturesRef.current = {};
    };
  }, [structuralSceneFile]);

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

  return <div ref={containerRef} className="viewport" />;
}
