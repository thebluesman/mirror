import * as THREE from "three";
import type { CameraPosition, FurnitureItem, SceneFile, WallDef } from "./types";

const WALL_THICKNESS = 10;

// Untextured-shell materials (Phase 1). Phase 3 replaces these with photo-
// derived materials from the texturing pipeline; furniture stays generic
// boxes until Phase 4 imports real GLBs.
const MAT = {
  wall: new THREE.MeshStandardMaterial({ color: 0xf0e9dc, roughness: 0.92 }),
  ceiling: new THREE.MeshStandardMaterial({ color: 0xf5f1e9, roughness: 0.95 }),
  floor: new THREE.MeshStandardMaterial({ color: 0xd9d4c9, roughness: 0.35 }),
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

function addFloor(scene: THREE.Scene, rect: { x: number; z: number; w: number; d: number }) {
  const geo = new THREE.PlaneGeometry(rect.w, rect.d);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, MAT.floor);
  mesh.position.set(rect.x + rect.w / 2, 0, rect.z + rect.d / 2);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addCeiling(scene: THREE.Scene, rect: { x: number; z: number; w: number; d: number }, height: number) {
  const geo = new THREE.PlaneGeometry(rect.w, rect.d);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, MAT.ceiling);
  mesh.position.set(rect.x + rect.w / 2, height, rect.z + rect.d / 2);
  scene.add(mesh);
}

// Cuts door/window openings into a wall run, reusing spike/scene2.html's
// segment-and-opening logic (proven in the R&D spikes), generalized to any
// wall direction instead of that file's bespoke per-wall calls.
function addWall(scene: THREE.Scene, wallDef: WallDef, wallHeight: number) {
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
    if (segLen <= 0.001) return;
    const h = yTop - yBottom;
    const geo = horizontal
      ? new THREE.BoxGeometry(segLen, h, WALL_THICKNESS)
      : new THREE.BoxGeometry(WALL_THICKNESS, h, segLen);
    const mesh = place(new THREE.Mesh(geo, mat), aLocal, bLocal, yBottom, h);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
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
    if (o.type === "door") {
      addSegment(o.start, o.end, 210, wallHeight); // lintel
      addInWallSlab(o.start + 2, o.end - 2, 0, 208, 4, MAT.doorLeaf);
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
}

function furnitureFootprint(item: FurnitureItem): Array<{ w: number; d: number; h: number; offsetX: number; offsetZ: number }> {
  const main = item.main as { w: number; d: number } | undefined;
  const chaise = item.chaise as { w: number; d: number } | undefined;
  if (main && chaise) {
    // Compound sofa: main + chaise sub-footprints, chaise on the west end.
    const h = item.dimsCm?.h ?? (item.backHeightCm as number) ?? 80;
    return [
      { w: main.w, d: main.d, h, offsetX: main.w / 2, offsetZ: 0 },
      { w: chaise.w, d: chaise.d, h, offsetX: -(main.w / 2) - chaise.w / 2, offsetZ: (main.d - chaise.d) / 2 },
    ];
  }
  return [{ w: item.dimsCm.w, d: item.dimsCm.d, h: item.dimsCm.h, offsetX: 0, offsetZ: 0 }];
}

function addFurniture(
  scene: THREE.Scene,
  item: FurnitureItem,
  position: [number, number, number],
  rotationDeg: number,
) {
  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);
  group.rotation.y = THREE.MathUtils.degToRad(rotationDeg);

  // Elevation is already baked into `position[1]` by the layout command (see
  // e.g. table-lamp/tv-samsung-frame in seed/living-room.json) — don't add
  // item.elevationCm again here, or items with both end up floating 2x high.
  furnitureFootprint(item).forEach((part) => {
    const geo = new THREE.BoxGeometry(part.w, part.h, part.d);
    const mesh = new THREE.Mesh(geo, MAT.furniture);
    mesh.position.set(part.offsetX, part.h / 2, part.offsetZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  });

  scene.add(group);
}

export interface BuiltScene {
  scene: THREE.Scene;
  cameras: CameraPosition[];
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

  sceneFile.room.floor.forEach((rect) => {
    addFloor(scene, rect);
    addCeiling(scene, rect, sceneFile.room.ceilingHeightCm);
  });
  sceneFile.room.walls.forEach((wall) => addWall(scene, wall, sceneFile.room.ceilingHeightCm));

  const currentLayout = sceneFile.layouts.find((l) => l.id === sceneFile.current);
  const itemsById = new Map(sceneFile.items.map((item) => [item.id, item]));
  currentLayout?.commands.forEach((cmd) => {
    const item = itemsById.get(cmd.itemId);
    if (!item) return;
    addFurniture(scene, item, cmd.position, cmd.rotationDeg);
  });

  return { scene, cameras: sceneFile.cameras };
}
