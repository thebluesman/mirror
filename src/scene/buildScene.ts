import * as THREE from "three";
import type { CameraPosition, FurnitureItem, SceneFile, WallDef } from "./types";

const WALL_THICKNESS = 10;

// Base (untextured) shell colors/roughness — Phase 3's calibration module
// (src/scene/shellMaterials.ts) resets to these before multiplying in tint/
// roughnessScale, so repeated calibration changes don't compound.
export const SHELL_BASE = {
  wall: { color: 0xf0e9dc, roughness: 0.92 },
  ceiling: { color: 0xf5f1e9, roughness: 0.95 },
  floor: { color: 0xd9d4c9, roughness: 0.35 },
} as const;

// Shell materials (Phase 1 flat colors; Phase 3 layers photo-derived maps +
// calibration on top via applyShellMaterials/applyShellCalibration — see
// src/scene/shellMaterials.ts). `side: DoubleSide` so orbiting under the
// floor or over the ceiling shows the underside instead of the scene
// background bleeding through (Phase 1/2 code-review deferred finding).
const MAT = {
  wall: new THREE.MeshStandardMaterial({ color: SHELL_BASE.wall.color, roughness: SHELL_BASE.wall.roughness }),
  ceiling: new THREE.MeshStandardMaterial({
    color: SHELL_BASE.ceiling.color,
    roughness: SHELL_BASE.ceiling.roughness,
    side: THREE.DoubleSide,
  }),
  floor: new THREE.MeshStandardMaterial({
    color: SHELL_BASE.floor.color,
    roughness: SHELL_BASE.floor.roughness,
    side: THREE.DoubleSide,
  }),
  doorLeaf: new THREE.MeshStandardMaterial({ color: 0xefeae0, roughness: 0.6 }),
  frame: new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.45, metalness: 0.65 }),
  furniture: new THREE.MeshStandardMaterial({ color: 0xb9ac8f, roughness: 0.7 }),
};

const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.05,
  metalness: 0,
  transmission: 0.92,
  thickness: 0.5,
  transparent: true,
});

// Floor gets a per-rect cloned material (not the shared MAT.floor instance)
// so each rect can carry its own cm-true texture repeat — the room's floor
// rects (e.g. living-room + entrance-hallway in the seed) differ in size, so
// a single shared repeat would tile inconsistently across them. Ceiling
// stays a single shared material: PRD only asks for a "reasonable
// meters-scale estimate" there, not cm-truth, and it's rarely in view.
function addFloor(scene: THREE.Scene, rect: { x: number; z: number; w: number; d: number }): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(rect.w, rect.d);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, MAT.floor.clone());
  mesh.position.set(rect.x + rect.w / 2, 0, rect.z + rect.d / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function addCeiling(scene: THREE.Scene, rect: { x: number; z: number; w: number; d: number }, height: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(rect.w, rect.d);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, MAT.ceiling);
  mesh.position.set(rect.x + rect.w / 2, height, rect.z + rect.d / 2);
  scene.add(mesh);
  return mesh;
}

// Cuts door/window openings into a wall run, reusing spike/scene2.html's
// segment-and-opening logic (proven in the R&D spikes), generalized to any
// wall direction instead of that file's bespoke per-wall calls.
function addWall(scene: THREE.Scene, wallDef: WallDef, wallHeight: number): THREE.Mesh[] {
  const wallMeshes: THREE.Mesh[] = [];
  const [x0, z0] = wallDef.from;
  const [x1, z1] = wallDef.to;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const horizontal = Math.abs(dx) >= Math.abs(dz);
  const length = horizontal ? Math.abs(dx) : Math.abs(dz);
  const s0 = horizontal ? Math.min(x0, x1) : Math.min(z0, z1);

  const openings = (wallDef.openings ?? [])
    .map((o) => ({
      start: o.start - s0,
      end: o.start + o.size - s0,
      type: o.type,
      sillHeightCm: o.sillHeightCm,
      headHeightCm: o.headHeightCm,
    }))
    .sort((a, b) => a.start - b.start);

  let cursor = 0;
  const solidSegments: Array<{ a: number; b: number }> = [];
  openings.forEach((o) => {
    if (o.start > cursor) solidSegments.push({ a: cursor, b: o.start });
    cursor = Math.max(cursor, o.end);
  });
  if (cursor < length) solidSegments.push({ a: cursor, b: length });

  function place(mesh: THREE.Mesh, aLocal: number, bLocal: number, yBottom: number, h: number) {
    const midLocal = (aLocal + bLocal) / 2;
    const cx = horizontal ? s0 + midLocal : x0;
    const cz = horizontal ? z0 : s0 + midLocal;
    mesh.position.set(cx, yBottom + h / 2, cz);
    return mesh;
  }

  function addSegment(aLocal: number, bLocal: number, yBottom: number, yTop: number, mat = MAT.wall) {
    const segLen = bLocal - aLocal;
    // Mirrors addInWallSlab's guard: a lintel/lower-fill span whose yTop has
    // collapsed to (or below) yBottom — e.g. headHeightCm >= wallHeight —
    // must no-op instead of handing BoxGeometry a non-positive height (code
    // review finding: this guard existed on addInWallSlab but not here).
    if (segLen <= 0.001 || yTop - yBottom <= 0.001) return;
    const h = yTop - yBottom;
    const geo = horizontal
      ? new THREE.BoxGeometry(segLen, h, WALL_THICKNESS)
      : new THREE.BoxGeometry(WALL_THICKNESS, h, segLen);
    const mesh = place(new THREE.Mesh(geo, mat), aLocal, bLocal, yBottom, h);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (mat === MAT.wall) wallMeshes.push(mesh);
  }

  function addInWallSlab(
    aLocal: number,
    bLocal: number,
    yBottom: number,
    yTop: number,
    thickness: number,
    mat: THREE.Material,
    isGlass = false,
  ) {
    const segLen = bLocal - aLocal;
    if (segLen <= 0.001 || yTop - yBottom <= 0.001) return;
    const h = yTop - yBottom;
    const geo = horizontal
      ? new THREE.BoxGeometry(segLen, h, thickness)
      : new THREE.BoxGeometry(thickness, h, segLen);
    const mesh = place(new THREE.Mesh(geo, mat), aLocal, bLocal, yBottom, h);
    if (!isGlass) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    scene.add(mesh);
  }

  solidSegments.forEach((seg) => addSegment(seg.a, seg.b, 0, wallHeight));

  openings.forEach((o) => {
    const F = 6; // frame bar width
    if (o.type === "door" || o.type === "glass-door") {
      // Phase 3 fix: honor the opening's own sillHeightCm/headHeightCm
      // (schema has carried them since Phase 2) instead of the hardcoded
      // 210/208 that ignored them — a Phase 1/2 code-review deferred
      // finding. Falls back to the same 0/210 defaults an unset door
      // implied before, so ordinary doors render unchanged.
      // glass-door also gets real glazing now (glassMat instead of the
      // opaque doorLeaf) — Phase 2 only guaranteed the type reached here.
      const sill = o.sillHeightCm ?? 0;
      const head = o.headHeightCm ?? 210;
      const leafTop = Math.max(sill, head - 2); // small gap below the lintel
      const leafMat = o.type === "glass-door" ? glassMat : MAT.doorLeaf;
      addSegment(o.start, o.end, 0, sill); // solid wall below a raised sill (no-ops when sill <= 0)
      addSegment(o.start, o.end, head, wallHeight); // lintel above head height
      addInWallSlab(o.start + 2, o.end - 2, sill, leafTop, 4, leafMat, o.type === "glass-door");
    } else if (o.type === "window") {
      const sill = o.sillHeightCm ?? 90;
      const head = o.headHeightCm ?? 210;
      const paneTop = head - F;
      const paneBottom = sill + F;
      addSegment(o.start, o.end, 0, sill); // sill wall below
      addSegment(o.start, o.end, head, wallHeight); // lintel above
      addInWallSlab(o.start, o.start + F, sill, head, 8, MAT.frame);
      addInWallSlab(o.end - F, o.end, sill, head, 8, MAT.frame);
      addInWallSlab(o.start + F, o.end - F, sill, paneBottom, 8, MAT.frame);
      addInWallSlab(o.start + F, o.end - F, paneTop, head, 8, MAT.frame);
      const mid = (o.start + o.end) / 2;
      addInWallSlab(mid - 2, mid + 2, paneBottom, paneTop, 8, MAT.frame);
      addInWallSlab(o.start + F, mid - 2, paneBottom, paneTop, 2, glassMat, true);
      addInWallSlab(mid + 2, o.end - F, paneBottom, paneTop, 2, glassMat, true);
    }
  });

  return wallMeshes;
}

function furnitureFootprint(item: FurnitureItem): Array<{ w: number; d: number; h: number; offsetX: number; offsetZ: number }> {
  // Dispatch on the `shape` discriminant the Phase 2 schema added, not on the
  // presence of `main`/`chaise` (Phase 1 code-review finding). The union
  // guarantees a box item has `dimsCm` and a compound sofa has `main`/`chaise`,
  // so neither branch needs an unguarded fallback.
  if (item.shape === "compound-sofa") {
    // Compound sofa: main + chaise sub-footprints, chaise on the west end.
    const { main, chaise } = item;
    const h = item.dimsCm?.h ?? item.backHeightCm ?? 80;
    // item.position is main's center (per seed authoring convention, same as
    // every plain-box item's position = its own center), so main's own
    // offset is 0. The chaise shares main's west edge rather than sitting
    // further west of it (confirmed against Figma: the drawn main and
    // chaise rects share the same west x-coordinate) - the L-shape comes
    // from the chaise's greater depth (protruding into the room), not from
    // extending the footprint sideways. offsetX = (chaise.w - main.w) / 2
    // centers the chaise on that shared west edge.
    return [
      { w: main.w, d: main.d, h, offsetX: 0, offsetZ: 0 },
      { w: chaise.w, d: chaise.d, h, offsetX: (chaise.w - main.w) / 2, offsetZ: (main.d - chaise.d) / 2 },
    ];
  }
  return [{ w: item.dimsCm.w, d: item.dimsCm.d, h: item.dimsCm.h, offsetX: 0, offsetZ: 0 }];
}

/** Overall bounding dims (cm) for an item — what a generated GLB is fit to
 *  (src/scene/loadFurnitureModel.ts's fitModelToDims). A plain box item's
 *  `dimsCm` already is this; a compound sofa's bounding box is derived from
 *  its main+chaise sub-footprints (or `dimsCm` if authored explicitly). */
export function furnitureOverallDims(item: FurnitureItem): { w: number; d: number; h: number } {
  if (item.shape === "compound-sofa") {
    if (item.dimsCm) return item.dimsCm;
  } else if (item.dimsCm) {
    return item.dimsCm;
  }
  const parts = furnitureFootprint(item);
  const minX = Math.min(...parts.map((p) => p.offsetX - p.w / 2));
  const maxX = Math.max(...parts.map((p) => p.offsetX + p.w / 2));
  const minZ = Math.min(...parts.map((p) => p.offsetZ - p.d / 2));
  const maxZ = Math.max(...parts.map((p) => p.offsetZ + p.d / 2));
  const h = Math.max(...parts.map((p) => p.h));
  return { w: maxX - minX, d: maxZ - minZ, h };
}

// Elevation is already baked into a placement command's position[1] (see
// e.g. table-lamp/tv-samsung-frame in seed/living-room.json) — don't add
// item.elevationCm again here, or items with both end up floating 2x high.
// Shared by addFurniture's synchronous placeholder path and Viewport's
// GLB-load-failure fallback (src/components/Viewport.tsx) — an item must
// never end up permanently invisible just because its Meshy mesh failed to
// decode from OPFS (code-review finding, Phase 4).
export function addFurnitureBoxMeshes(group: THREE.Group, item: FurnitureItem): void {
  furnitureFootprint(item).forEach((part) => {
    const geo = new THREE.BoxGeometry(part.w, part.h, part.d);
    const mesh = new THREE.Mesh(geo, MAT.furniture);
    mesh.position.set(part.offsetX, part.h / 2, part.offsetZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });
}

function addFurniture(
  scene: THREE.Scene,
  item: FurnitureItem,
  position: [number, number, number],
  rotationDeg: number,
): THREE.Group {
  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);
  group.rotation.y = THREE.MathUtils.degToRad(rotationDeg);

  // Phase 4: an item with a completed Meshy import (glbHash set) renders its
  // real generated mesh instead of the box placeholder — but that's an async
  // decode from OPFS (see src/scene/loadFurnitureModel.ts), so buildScene
  // itself (synchronous) leaves the group empty here and returns it via
  // BuiltScene.furnitureGroups; Viewport's structural effect loads the model
  // into it after the synchronous scene graph is up, the same async-after-
  // build pattern Phase 3 established for shell textures. If that load fails,
  // Viewport falls back to addFurnitureBoxMeshes so the item never just
  // vanishes.
  if (!item.glbHash) {
    addFurnitureBoxMeshes(group, item);
  }

  scene.add(group);
  return group;
}

/** Shell mesh/material handles Phase 3's live calibration (src/scene/
 *  shellMaterials.ts) needs — kept separate from the returned THREE.Scene so
 *  that module doesn't have to re-derive them by traversing/matching (the
 *  spike's structural mesh-finding trick, unnecessary here since we own the
 *  mesh-building code — see PRD notes on this file). */
export interface ShellMeshes {
  wallMaterial: THREE.MeshStandardMaterial;
  wallMeshes: THREE.Mesh[];
  ceilingMaterial: THREE.MeshStandardMaterial;
  ceilingMeshes: THREE.Mesh[];
  /** One cloned material per floor rect, in `room.floor` order — each mesh
   *  can carry its own cm-true repeat. */
  floorMeshes: THREE.Mesh[];
}

/** An item awaiting its generated GLB (Phase 4) — the placeholder group is
 *  already in the scene at the right position/rotation; Viewport loads and
 *  attaches the model into it asynchronously (see loadFurnitureModel.ts). */
export interface PendingFurnitureModel {
  item: FurnitureItem;
  group: THREE.Group;
}

export interface BuiltScene {
  scene: THREE.Scene;
  cameras: CameraPosition[];
  shell: ShellMeshes;
  pendingModels: PendingFurnitureModel[];
}

export function buildScene(sceneFile: SceneFile): BuiltScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfccd6);

  const sun = new THREE.DirectionalLight(0xffdcae, 2.6);
  sun.position.set(60, 330, 420);
  sun.target.position.set(820, 0, 560);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 2500;
  sun.shadow.camera.left = -700;
  sun.shadow.camera.right = 700;
  sun.shadow.camera.top = 500;
  sun.shadow.camera.bottom = -500;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 2.5;
  scene.add(sun, sun.target);

  const bounce = new THREE.HemisphereLight(0xcfd8e0, 0xece6da, 1.05);
  scene.add(bounce);

  const floorMeshes: THREE.Mesh[] = [];
  const ceilingMeshes: THREE.Mesh[] = [];
  const wallMeshes: THREE.Mesh[] = [];

  sceneFile.room.floor.forEach((rect) => {
    floorMeshes.push(addFloor(scene, rect));
    ceilingMeshes.push(addCeiling(scene, rect, sceneFile.room.ceilingHeightCm));
  });
  sceneFile.room.walls.forEach((wall) => {
    wallMeshes.push(...addWall(scene, wall, sceneFile.room.ceilingHeightCm));
  });

  const currentLayout = sceneFile.layouts.find((l) => l.id === sceneFile.current);
  const itemsById = new Map(sceneFile.items.map((item) => [item.id, item]));
  const pendingModels: PendingFurnitureModel[] = [];
  currentLayout?.commands.forEach((cmd) => {
    const item = itemsById.get(cmd.itemId);
    if (!item) return;
    const group = addFurniture(scene, item, cmd.position, cmd.rotationDeg);
    if (item.glbHash) pendingModels.push({ item, group });
  });

  const shell: ShellMeshes = {
    wallMaterial: MAT.wall,
    wallMeshes,
    ceilingMaterial: MAT.ceiling,
    ceilingMeshes,
    floorMeshes,
  };

  return { scene, cameras: sceneFile.cameras, shell, pendingModels };
}
