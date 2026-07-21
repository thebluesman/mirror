import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildScene, type BuiltScene } from "../scene/buildScene";
import { applyShellSurface, type ShellSurface } from "../scene/shellMaterials";
import { loadShellTexture } from "../scene/loadShellTexture";
import { DEFAULT_SURFACE_CALIBRATION, type ShellCalibration } from "../schema/scene";
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

  // Structural build: renderer, lighting, room shell geometry, furniture,
  // camera, controls. Runs once per mount from the sceneFile the component
  // was mounted with (captured via ref, not a dependency) — v1 has no
  // in-app room/furniture editing (arrangement is v2), so the only thing
  // that legitimately changes live is shell calibration, handled by the
  // second effect below without tearing down the WebGL context.
  const initialSceneFile = useRef(sceneFile).current;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const built = buildScene(initialSceneFile);
    builtRef.current = built;
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
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      builtRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see comment above
  }, []);

  // Live shell-texture/calibration updates: mutates the materials the
  // structural effect already created, in place — no renderer/camera churn,
  // so dragging a calibration slider doesn't flicker or reset the view.
  const calibration = shellCalibration ?? sceneFile.room.shell;
  useEffect(() => {
    const built = builtRef.current;
    if (!built) return;
    let cancelled = false;
    const createdTextures: THREE.Texture[] = [];

    (async () => {
      for (const surface of SHELL_SURFACES) {
        const calib = calibration?.[surface] ?? DEFAULT_SURFACE_CALIBRATION;
        const textureSource = calib.assetHash ? await loadShellTexture(calib.assetHash) : null;
        if (cancelled) {
          if (textureSource) textureSource.bitmap.close();
          return;
        }
        const textures = applyShellSurface(built.shell, surface, calib, textureSource);
        createdTextures.push(...textures);
      }
    })();

    return () => {
      cancelled = true;
      createdTextures.forEach((t) => t.dispose());
    };
  }, [calibration]);

  return <div ref={containerRef} className="viewport" />;
}
