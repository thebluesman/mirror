import { useEffect, useRef } from "react";
import * as THREE from "three";
import { applyCalibrationToMaterial, makeTexture, type ShellSurface } from "../scene/shellMaterials";
import type { SurfaceCalibration } from "../schema/scene";
import "./ShellTexturePreview3D.css";

// docs/proposals/shell-texture-preview.md §1.1 (improvements-minor-fixes.md
// §18, built 2026-07-22 as narrow-draft Option P-2 — see that proposal's
// front-matter for why P-2 overrides its own P-1 recommendation): an
// isolated preview of a newly-uploaded shell photo *before* it is written to
// OPFS (`putAsset`) or committed to the live room (`onChange`). SurfaceRow's
// `preview`/`committing` states render this instead of touching the real
// Viewport/shell meshes.
//
// Modeled directly on ObjectPreview3D.tsx's shape, for the same reasons its
// own header spells out: a deliberately tiny, self-contained Three.js build
// (its own WebGLRenderer/Scene/camera/light rig) rather than the real
// Viewport, so nothing threads a never-committed texture through the app's
// structural-rebuild machinery.
//
// P-2 scope (the review correction that narrowed this from the proposal's
// recommended P-1): `repeat`/`roughnessScale`/`tint` are the surface's
// CURRENT COMMITTED calibration (SurfaceRow's `liveCalib`), not an editable
// draft — this component never receives slider input, only the surface's
// existing numbers, so it renders "how would the new photo look at today's
// settings," not "let me tune settings against the new photo."
//
// Material built via shellMaterials.ts's own `makeTexture`/
// `applyCalibrationToMaterial` (not reimplemented here) so the preview stays
// faithful to what actually applies on Confirm — an explicit non-goal of the
// proposal is forking that calibration math.
//
// Fidelity caveat (proposal §1.1): the real shell scales repeat by each
// surface's real size-derived base (estimateWallRepeat/floorBaseRepeat,
// shellMaterials.ts). This preview plane has no real surface size, so
// `repeat` is applied directly as the texture's tiling — relative tiling
// behaviour ("will this tile cleanly / look right"), not the true per-wall
// tile count.
export function ShellTexturePreview3D({
  blob,
  surface,
  repeat,
  roughnessScale,
  tint,
}: {
  blob: Blob;
  surface: ShellSurface;
  repeat: [number, number];
  roughnessScale: number;
  tint: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Refs mirroring the latest calibration props so the structural effect
  // below (bound once per `blob`) can re-apply calibration imperatively
  // without re-decoding the bitmap — same "ref mirrors latest prop for an
  // imperative closure that only wants to rebind on a coarser dependency"
  // shape as ObjectPreview3D's dimsRef/rotationRef (see its header comment).
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;
  const repeatRef = useRef(repeat);
  repeatRef.current = repeat;
  const roughnessRef = useRef(roughnessScale);
  roughnessRef.current = roughnessScale;
  const tintRef = useRef(tint);
  tintRef.current = tint;
  // Set once the bitmap has decoded and the material/texture exist; called
  // by the second effect whenever a calibration prop changes. Not state —
  // calling it must never trigger a React re-render, only a Three.js
  // mutation (mirrors ObjectPreview3D's refitRef).
  const applyRef = useRef<(() => void) | null>(null);

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

    // Fixed, straight-on framing — reads tiling best (proposal §1.1/§1.3).
    // No OrbitControls like ObjectPreview3D: there's nothing to orbit around
    // on a flat plane, and straight-on is the point of the shot.
    const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
    camera.position.set(0, 0, 260);
    camera.lookAt(0, 0, 0);

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
      renderer.render(scene, camera);
    }
    animate();

    // Sized, at this camera distance/FOV, to show several tile repeats
    // across the plane at a 1x repeat (proposal §1.1) rather than a single
    // tile filling the frame.
    const geometry = new THREE.PlaneGeometry(220, 220);
    const material = new THREE.MeshStandardMaterial();
    const plane = new THREE.Mesh(geometry, material);
    scene.add(plane);

    let texture: THREE.Texture | null = null;

    function applyCalibration() {
      const calib: SurfaceCalibration = {
        tint: tintRef.current,
        repeat: repeatRef.current,
        roughnessScale: roughnessRef.current,
      };
      applyCalibrationToMaterial(material, surfaceRef.current, calib, texture != null);
      if (texture) {
        texture.repeat.set(repeatRef.current[0], repeatRef.current[1]);
        texture.needsUpdate = true;
      }
    }
    applyRef.current = applyCalibration;

    let cancelled = false;
    createImageBitmap(blob)
      .then((bitmap) => {
        if (cancelled) return;
        texture = makeTexture(bitmap, repeatRef.current);
        material.map = texture;
        applyCalibration();
      })
      .catch((err) => {
        console.error("[ShellTexturePreview3D] failed to decode preview bitmap", err);
      });

    return () => {
      cancelled = true;
      applyRef.current = null;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      renderer.dispose();
      geometry.dispose();
      material.dispose();
      texture?.dispose();
      // Same fix as Viewport.tsx's structural-rebuild teardown and
      // ObjectPreview3D's (2026-07-23, PR #28 review / follow-up): renderer.
      // dispose() doesn't synchronously release the underlying WebGL
      // context — deferred to GC. This component remounts a fresh
      // WebGLRenderer on every new preview `blob`, so repeated re-uploads in
      // one sitting could stack up contexts before GC catches up. Explicitly
      // losing the context here returns the slot to the browser immediately.
      renderer.getContext().getExtension("WEBGL_lose_context")?.loseContext();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `blob` should rebuild the renderer/re-decode the bitmap; surface/repeat/roughnessScale/tint are read live via refs (see applyCalibration)
  }, [blob]);

  // Re-apply calibration (not re-decode) whenever the live surface/repeat/
  // roughness/tint props change — cheap: no async/OPFS/decode work, mirrors
  // ObjectPreview3D's second dims/rotation effect.
  useEffect(() => {
    applyRef.current?.();
  }, [surface, repeat[0], repeat[1], roughnessScale, tint]);

  return <div ref={containerRef} className="shell-texture-preview-3d" />;
}
