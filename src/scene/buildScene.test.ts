import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildScene, addFurnitureBoxMeshes } from "./buildScene";
import type { SceneFile } from "./types";

// v2 spike D4 (W-B, rug fix ladder lever 2 — see spike-v2/OUTCOME.md):
// covers buildScene's new flat-textured-plane path for a box item carrying
// `flatTextureHash` instead of `glbHash` — the SONDEROD rug's case. Pure
// geometry/material-graph assertions only (no WebGL context needed to
// construct THREE objects), same "exercise the real builder function"
// approach collision.test.ts/loadFurnitureModel.test.ts already use.

function sceneFileWithItem(item: SceneFile["items"][number]): SceneFile {
  return {
    meta: { source: "test", units: "cm", schemaVersion: "v1" },
    room: {
      ceilingHeightCm: 260,
      floor: [{ name: "main", x: 0, z: 0, w: 500, d: 500 }],
      walls: [],
    },
    items: [item],
    cameras: [],
    layouts: [{ id: "default", name: "Default", base: null, commands: [{ type: "place", itemId: item.id, position: [100, 0, 100], rotationDeg: 0 }] }],
    current: "default",
  };
}

const rugItem = {
  id: "sonderod-rug",
  name: "SONDEROD Rug",
  shape: "box" as const,
  dimsCm: { w: 240, d: 170, h: 2 },
  flatTextureHash: "deadbeef",
};

describe("buildScene — flat-textured furniture (v2 spike D4)", () => {
  it("renders a flat-texture item as a box sized to its dimsCm, not a GLB placeholder", () => {
    const built = buildScene(sceneFileWithItem(rugItem));
    const group = built.furnitureGroups.get("sonderod-rug");
    expect(group).toBeDefined();
    expect(group!.children).toHaveLength(1);
    const mesh = group!.children[0] as THREE.Mesh;
    const geo = mesh.geometry as THREE.BoxGeometry;
    expect(geo.parameters.width).toBe(240);
    expect(geo.parameters.height).toBe(2);
    expect(geo.parameters.depth).toBe(170);
  });

  it("registers the item in pendingFlatTextures with a distinct top-face material, not a shared one", () => {
    const built = buildScene(sceneFileWithItem(rugItem));
    expect(built.pendingFlatTextures).toHaveLength(1);
    expect(built.pendingModels).toHaveLength(0); // no glbHash -> not a pending GLB load

    const { item, material } = built.pendingFlatTextures[0];
    expect(item.id).toBe("sonderod-rug");
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(material.map).toBeNull(); // buildScene is synchronous; Viewport fills this in async

    const group = built.furnitureGroups.get("sonderod-rug")!;
    const mesh = group.children[0] as THREE.Mesh;
    const materials = mesh.material as THREE.Material[];
    expect(materials).toHaveLength(6);
    expect(materials[2]).toBe(material); // index 2 = +Y (top face), per BoxGeometry's group order
    // The other five faces share one material instance between them (and
    // across every other box-shape furniture item) — only the top face is
    // per-item.
    const others = [0, 1, 3, 4, 5].map((i) => materials[i]);
    expect(new Set(others).size).toBe(1);
    expect(others[0]).not.toBe(material);
  });

  it("a second flat-texture item gets its own top-face material instance (not shared with the first)", () => {
    const second = { ...rugItem, id: "second-rug", flatTextureHash: "cafef00d" };
    const sceneFile: SceneFile = {
      ...sceneFileWithItem(rugItem),
      items: [rugItem, second],
      layouts: [
        {
          id: "default",
          name: "Default",
          base: null,
          commands: [
            { type: "place", itemId: rugItem.id, position: [100, 0, 100], rotationDeg: 0 },
            { type: "place", itemId: second.id, position: [300, 0, 300], rotationDeg: 0 },
          ],
        },
      ],
    };
    const built = buildScene(sceneFile);
    expect(built.pendingFlatTextures).toHaveLength(2);
    expect(built.pendingFlatTextures[0].material).not.toBe(built.pendingFlatTextures[1].material);
  });

  it("an item with glbHash takes the GLB-pending path even if flatTextureHash is also set", () => {
    const both = { ...rugItem, glbHash: "somehash" };
    const built = buildScene(sceneFileWithItem(both));
    expect(built.pendingModels).toHaveLength(1);
    expect(built.pendingFlatTextures).toHaveLength(0);
    // glbHash wins: buildScene leaves the group empty for Viewport to fill
    // (see buildScene.ts's addFurniture) rather than adding any placeholder.
    const group = built.furnitureGroups.get(both.id)!;
    expect(group.children).toHaveLength(0);
  });

  it("a plain box item with neither hash still gets the ordinary flat-color placeholder", () => {
    const plain = { id: "plain-box", name: "Plain", shape: "box" as const, dimsCm: { w: 50, d: 50, h: 50 } };
    const built = buildScene(sceneFileWithItem(plain));
    expect(built.pendingFlatTextures).toHaveLength(0);
    expect(built.pendingModels).toHaveLength(0);
    const group = built.furnitureGroups.get("plain-box")!;
    expect(group.children).toHaveLength(1);
    const mesh = group.children[0] as THREE.Mesh;
    expect(mesh.material).not.toBeInstanceOf(Array); // shared single MAT.furniture, not a per-face array
  });
});

// improvements-v2.2 §5: per-object material tint. Compares two items built
// in the same buildScene() call (rather than just asserting materials
// differ) so the "shared instance for untinted items" behavior is also
// pinned — not just "a tinted item gets its own material."
describe("buildScene — furniture tint (improvements-v2.2 §5)", () => {
  const plainA = { id: "plain-a", name: "Plain A", shape: "box" as const, dimsCm: { w: 50, d: 50, h: 50 } };
  const plainB = { id: "plain-b", name: "Plain B", shape: "box" as const, dimsCm: { w: 50, d: 50, h: 50 } };
  const tinted = { ...plainA, id: "tinted", tintColor: "#ff0000" };

  function sceneFileWithItems(items: SceneFile["items"]): SceneFile {
    return {
      meta: { source: "test", units: "cm", schemaVersion: "v1" },
      room: {
        ceilingHeightCm: 260,
        floor: [{ name: "main", x: 0, z: 0, w: 500, d: 500 }],
        walls: [],
      },
      items,
      cameras: [],
      layouts: [
        {
          id: "default",
          name: "Default",
          base: null,
          commands: items.map((item, i) => ({
            type: "place" as const,
            itemId: item.id,
            position: [100 * (i + 1), 0, 100 * (i + 1)] as [number, number, number],
            rotationDeg: 0,
          })),
        },
      ],
      current: "default",
    };
  }

  it("an untinted item's mesh uses the shared MAT.furniture instance", () => {
    const built = buildScene(sceneFileWithItems([plainA, plainB]));
    const meshA = built.furnitureGroups.get("plain-a")!.children[0] as THREE.Mesh;
    const meshB = built.furnitureGroups.get("plain-b")!.children[0] as THREE.Mesh;
    expect(meshA.material).toBe(meshB.material); // same shared instance across untinted items
  });

  it("a tinted item's mesh gets its own material, distinct from the shared instance", () => {
    const built = buildScene(sceneFileWithItems([plainA, tinted]));
    const meshPlain = built.furnitureGroups.get("plain-a")!.children[0] as THREE.Mesh;
    const meshTinted = built.furnitureGroups.get("tinted")!.children[0] as THREE.Mesh;
    expect(meshTinted.material).not.toBe(meshPlain.material);
    const tintedMat = meshTinted.material as THREE.MeshStandardMaterial;
    const plainMat = meshPlain.material as THREE.MeshStandardMaterial;
    // Tint multiplies over the base furniture color, so the tinted mesh's
    // color must differ from the untinted base rather than just being "a
    // different object with the same color."
    expect(tintedMat.color.getHexString()).not.toBe(plainMat.color.getHexString());
  });

  it("a compound-sofa's main+chaise sub-meshes share one per-item tinted material, not two", () => {
    const sofa = {
      id: "sofa",
      name: "Sofa",
      shape: "compound-sofa" as const,
      main: { w: 200, d: 90 },
      chaise: { w: 90, d: 150 },
      tintColor: "#0000ff",
    };
    const group = new THREE.Group();
    addFurnitureBoxMeshes(group, sofa);
    expect(group.children).toHaveLength(2);
    const [main, chaise] = group.children as THREE.Mesh[];
    expect(main.material).toBe(chaise.material);
  });
});
