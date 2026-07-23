import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { fitModelToDims, downscaleModelTextures } from "../scene/loadFurnitureModel";
import type { Dims, ModelRotation } from "../schema/scene";
import "./ObjectPreview3D.css";

// improvements-v2.2 §6, high priority: ImportPanel's confirm-dims stage
// today applies W/D/H and orientation-correction "blind" — plain number
// inputs, no rendering at all — before the item ever gets placed in the
// real room. Real money is spent per fal.ai generation and there's
// currently no way to fix a bad import after confirming, so this renders
// the just-generated GLB in isolation (its own small orbit-able viewport,
// NOT dropped into the real room — placement isn't finalized at this
// stage) and re-fits it live as the caller's dims/rotation state changes.
//
// Deliberately its own tiny Three.js build rather than reusing Viewport.tsx:
// no gestures, no room shell, no selection/collision — just one mesh, one
// light rig, and an orbit camera. Reusing Viewport here would mean threading
// a fake SceneFile through the app's real structural-rebuild machinery for
// a mesh that was never placed and has no PlaceCommand.
export function ObjectPreview3D({
  glbBlob,
  dims,
  modelRotationDeg,
}: {
  glbBlob: Blob;
  dims: Dims;
  modelRotationDeg: ModelRotation;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Refs so the structural effect below (bound once per glbBlob) always
  // re-fits against the *latest* dims/rotation without re-running the GLB
  // decode on every field edit — same "ref mirrors the latest prop for an
  // imperative closure that only wants to rebind on a coarser dependency"
  // shape Viewport.tsx uses throughout (e.g. onCommitPlacementRef).
  const dimsRef = useRef(dims);
  dimsRef.current = dims;
  const rotationRef = useRef(modelRotationDeg);
  rotationRef.current = modelRotationDeg;
  // Set by the structural effect once the GLB has decoded; called by the
  // second effect below whenever dims/rotation change. Not state — calling
  // it must never trigger a React re-render, only a Three.js scene mutation.
  const refitRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xd8d4c8);

    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(150, 260, 200);
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8c887c, 1.1));

    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);

    function resize() {
      if (!container) return;
      const { clientWidth: w, clientHeight: h } = container;
      if (w === 0 || h === 0) return;
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

    let pristine: THREE.Object3D | null = null;
    let instance: THREE.Object3D | null = null;

    // Re-fits a fresh clone of the pristine (never-mutated) loaded model to
    // the latest dims/rotation and swaps it into the scene. A clone every
    // time, not a repeated fit on the same object: fitModelToDims wraps a
    // model's existing children into a fresh correction-rotation group each
    // call (see its own doc comment), so calling it twice on the same
    // instance would double-wrap instead of re-fitting cleanly.
    function refit() {
      if (!pristine) return;
      if (instance) scene.remove(instance);
      instance = pristine.clone(true);
      fitModelToDims(instance, dimsRef.current, rotationRef.current);
      scene.add(instance);

      // Frame the camera to comfortably fit whatever the current dims are —
      // this preview has to work for a tiny lamp and a large sofa alike, in
      // a fixed-size box, so the framing distance scales with the item
      // rather than assuming one fixed shot.
      const radius = Math.max(dimsRef.current.w, dimsRef.current.d, dimsRef.current.h, 10);
      const dist = radius * 2.2;
      const lookY = radius * 0.3;
      camera.position.set(dist * 0.6, dist * 0.55 + lookY, dist * 0.6);
      controls.target.set(0, lookY, 0);
      controls.update();
    }
    refitRef.current = refit;

    let cancelled = false;
    const url = URL.createObjectURL(glbBlob);
    new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        if (cancelled) return;
        // This preview decodes its own GLB independently of
        // loadFurnitureModel.ts (an isolated confirm-dims-only scene, not
        // routed through OPFS/getAsset) — see downscaleModelTextures'
        // comment: this is specifically the stage a large uploaded/
        // generated .glb's oversized PBR textures overran VRAM and force-
        // lost the WebGL context (recurring report, 2026-07-23).
        downscaleModelTextures(gltf.scene);
        pristine = gltf.scene;
        refit();
      })
      .catch((err) => {
        console.error("[ObjectPreview3D] failed to load preview GLB", err);
      })
      .finally(() => URL.revokeObjectURL(url));

    return () => {
      cancelled = true;
      refitRef.current = null;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      // Same fix as Viewport.tsx's structural-rebuild teardown (2026-07-23,
      // PR #28 review): renderer.dispose() doesn't synchronously release the
      // underlying WebGL context — that's deferred to GC. This component
      // remounts a fresh WebGLRenderer every time confirm-dims is entered
      // (ImportPanel's Stage), and the "Upload .glb…" path (no fal.ai wait
      // between imports) makes it trivial to cycle through several of those
      // in quick succession — enough to hit Chrome's ~16-live-context cap
      // before GC catches up, at which point the browser force-loses the
      // oldest context with no recovery handler anywhere in the app: reads
      // as "the whole screen goes white, needs a refresh." Explicitly losing
      // the context here returns the slot to the browser immediately instead
      // of waiting on GC.
      renderer.getContext().getExtension("WEBGL_lose_context")?.loseContext();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only glbBlob should rebuild the renderer/re-decode the GLB; dims/rotation are read live via refs (see refit)
  }, [glbBlob]);

  // Re-fit (not re-decode) whenever the live dims/rotation change — cheap:
  // clone + rescale + reposition, no network/OPFS/decode work.
  useEffect(() => {
    refitRef.current?.();
  }, [dims.w, dims.d, dims.h, modelRotationDeg.x, modelRotationDeg.y, modelRotationDeg.z]);

  return <div ref={containerRef} className="object-preview-3d" />;
}
