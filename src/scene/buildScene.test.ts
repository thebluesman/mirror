import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildScene } from "./buildScene";
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
