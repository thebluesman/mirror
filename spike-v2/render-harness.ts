// v2 spike (W-C, D5): in-app render harness. Per OUTCOME-3's "viewer
// flattery" rule (repeated in v2-spike-plan.md §2/§6), nothing about a
// generated GLB's quality counts until it renders under this app's own
// lighting, not a fal/Hunyuan preview viewer. This page reuses the real
// `buildScene()` (src/scene/buildScene.ts — same sun/hemisphere lights and
// shell materials the app's Viewport.tsx builds every scene from) and the
// real `fitModelToDims()` (src/scene/loadFurnitureModel.ts — the same
// rescale/floor-snap/recenter transform every Meshy import already gets at
// load time) rather than hand-rolling a separate Three.js scene. The
// renderer/tonemap/PMREM setup below mirrors Viewport.tsx's structural-build
// effect line for line (see that file for the canonical copy).
//
// Not app code — lives in spike-v2/ per v2-spike-plan.md §4, driven by
// spike-v2/d5-render-drive.mjs (Playwright), not part of the running app.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildScene } from "../src/scene/buildScene";
import { fitModelToDims } from "../src/scene/loadFurnitureModel";
import type { SceneFile, Dims } from "../src/scene/types";

const HUMAN_FOV = 38; // matches Viewport.tsx's HUMAN_FOV (~35mm-equivalent)

// A minimal but schema-valid generic room (not Shyam's real room — this
// harness only needs *a* floor/walls for the shell materials/lighting to
// have something to bounce off of; the real room's exact geometry doesn't
// matter for a single-object comparison shot).
function makeHarnessSceneFile(dims: Dims): SceneFile {
  return {
    meta: { source: "spike-v2/d5-render-harness", units: "cm", schemaVersion: "v1" },
    // Room sized generously (4000x4000cm) relative to any single furniture
    // item so the camera — placed a few multiples of the item's own size
    // away for framing — always stays inside the shell, never outside a
    // wall looking back through it (found the hard way: a 600x600 room put
    // the camera beyond the wall for the rug's 240cm width, producing a
    // blank grey frame — the wall's own back face filling the screen).
    // Tall ceiling (not 270cm like a real room) — the "top" view's camera
    // sits well above head height to look down at a flat item (the rug);
    // found the hard way, a real-height ceiling put the camera *above* the
    // opaque ceiling mesh, which then blocked the entire view straight down
    // (same failure signature as the earlier out-of-bounds-wall bug: a
    // uniform blank grey frame, no error).
    room: {
      ceilingHeightCm: 1500,
      floor: [{ name: "harness-floor", x: 0, z: 0, w: 4000, d: 4000 }],
      walls: [
        { name: "n", from: [0, 0], to: [4000, 0] },
        { name: "e", from: [4000, 0], to: [4000, 4000] },
        { name: "s", from: [4000, 4000], to: [0, 4000] },
        { name: "w", from: [0, 4000], to: [0, 0] },
      ],
    },
    items: [
      {
        id: "subject",
        name: "subject",
        shape: "box",
        dimsCm: dims,
        // Truthy glbHash so buildScene's addFurniture skips the box
        // placeholder and leaves the group empty for us to load a real
        // model into by hand (this harness bypasses the OPFS asset store
        // entirely — GLBs are fetched directly by URL below).
        glbHash: "harness-external",
      },
    ],
    cameras: [],
    layouts: [{ id: "current", name: "current", base: null, commands: [{ type: "place", itemId: "subject", position: [2000, 0, 2000], rotationDeg: 0 }] }],
    current: "current",
  };
}

let renderer: THREE.WebGLRenderer;
let camera: THREE.PerspectiveCamera;
let scene: THREE.Scene;
let subjectGroup: THREE.Group | null = null;
let currentModel: THREE.Object3D | null = null;
let currentDims: Dims | null = null;
const SUBJECT_CENTER = new THREE.Vector3(2000, 0, 2000);

function setupRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(1000, 750);
  document.body.appendChild(renderer.domElement);

  camera = new THREE.PerspectiveCamera(HUMAN_FOV, 1000 / 750, 5, 3000);
}

// Rebuilds the harness scene for a new item's real dims (buildScene's
// lights/shell materials, room geometry doesn't matter for this comparison).
function setupScene(dimsCm: Dims) {
  currentDims = dimsCm;
  const sceneFile = makeHarnessSceneFile(dimsCm);
  const built = buildScene(sceneFile);
  scene = built.scene;
  subjectGroup = built.furnitureGroups.get("subject") ?? null;

  // Same PMREM/RoomEnvironment IBL setup as Viewport.tsx's structural effect.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  currentModel = null;
}

async function loadModel(url: string): Promise<void> {
  if (!subjectGroup || !currentDims) throw new Error("call setupScene(dims) first");
  if (currentModel) {
    subjectGroup.remove(currentModel);
    currentModel = null;
  }
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const model = gltf.scene;
  fitModelToDims(model, currentDims);
  subjectGroup.add(model);
  currentModel = model;
}

// azimuthDeg=0 is an arbitrary reference direction (a freshly generated GLB
// has no established "front" convention — see spike-v2/OUTCOME.md D5 for why
// these views are labeled by camera azimuth, not by the model's actual
// front/back, since that's exactly what's being compared, not assumed).
// 180 is directly opposite 0 and stands in for OUTCOME-3 C1's "back-view"
// convention.
const VIEWS: Record<string, { azimuthDeg: number; elevDeg: number }> = {
  view0: { azimuthDeg: 0, elevDeg: 12 },
  view45: { azimuthDeg: 45, elevDeg: 12 },
  view90: { azimuthDeg: 90, elevDeg: 12 },
  view180: { azimuthDeg: 180, elevDeg: 12 },
  // Steep down-look — mostly for the rug, whose 2cm height makes every
  // eye-level view a grazing edge-on sliver; a near-top-down angle is where
  // a flat item's actual surface quality is legible. Applied uniformly to
  // every item for a fair identical-views comparison, not special-cased.
  top: { azimuthDeg: 0, elevDeg: 75 },
};

function setView(viewName: string): void {
  if (!currentDims) throw new Error("call setupScene(dims) first");
  const v = VIEWS[viewName];
  if (!v) throw new Error(`unknown view ${viewName}`);
  const maxDim = Math.max(currentDims.w, currentDims.d, currentDims.h);
  const dist = maxDim * 2.2 + 120;
  const azRad = THREE.MathUtils.degToRad(v.azimuthDeg);
  const elevRad = THREE.MathUtils.degToRad(v.elevDeg);
  const horizR = dist * Math.cos(elevRad);
  const eyeY = currentDims.h / 2 + dist * Math.sin(elevRad);
  camera.position.set(
    SUBJECT_CENTER.x + horizR * Math.sin(azRad),
    eyeY,
    SUBJECT_CENTER.z + horizR * Math.cos(azRad),
  );
  // Object3D.lookAt degenerates when the view direction is nearly parallel
  // to `camera.up` (world +Y) — found via the "top" view (elevDeg 75), which
  // rendered a totally blank frame with no error: the near-straight-down
  // look direction left `up x direction` ~ zero, so the resulting camera
  // basis was degenerate and nothing rasterized. A steep look needs a
  // horizontal `up` reference instead.
  camera.up.set(0, v.elevDeg > 60 ? 0 : 1, v.elevDeg > 60 ? -1 : 0);
  camera.lookAt(SUBJECT_CENTER.x, currentDims.h * 0.4, SUBJECT_CENTER.z);
  camera.updateProjectionMatrix();
  (window as any).__debugCamPos = camera.position.toArray();
  (window as any).__debugCamTarget = [SUBJECT_CENTER.x, currentDims.h * 0.4, SUBJECT_CENTER.z];
  renderer.render(scene, camera);
}

declare global {
  interface Window {
    __harnessReady: boolean;
    harnessSetupScene: (dims: Dims) => void;
    harnessLoadModel: (url: string) => Promise<void>;
    harnessSetView: (viewName: string) => void;
  }
}

setupRenderer();
window.harnessSetupScene = setupScene;
window.harnessLoadModel = loadModel;
window.harnessSetView = setView;
window.__harnessReady = true;
