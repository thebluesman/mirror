import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildScene, addFurnitureBoxMeshes, resolveSunLighting } from "./buildScene";
import type { SceneFile } from "./types";
import type { Lighting, LightingMode, Location } from "../schema/scene";

// v2 spike D4 (W-B, rug fix ladder lever 2 — see spike-v2/OUTCOME.md):
// covers buildScene's new flat-textured-plane path for a box item carrying
// `flatTextureHash` instead of `glbHash` — the SONDEROD rug's case. Pure
// geometry/material-graph assertions only (no WebGL context needed to
// construct THREE objects), same "exercise the real builder function"
// approach collision.test.ts/loadFurnitureModel.test.ts already use.

function sceneFileWithItem(
  item: SceneFile["items"][number],
  lighting?: Lighting,
  lightingMode?: LightingMode,
  location?: Location,
): SceneFile {
  return {
    meta: { source: "test", units: "cm", schemaVersion: "v1" },
    room: {
      ceilingHeightCm: 260,
      floor: [{ name: "main", x: 0, z: 0, w: 500, d: 500 }],
      walls: [],
      lighting,
      lightingMode,
      location,
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

  // improvements-minor-fixes §10: furnitureMaterialFor dispatches on
  // item.tintBlendMode (via the shared applyTintBlend/blendTint helpers in
  // tintBlend.ts), defaulting to "multiply" when unset — pinned here against
  // the actual buildScene() entrypoint, not just the blend-math unit tests
  // in tintBlend.test.ts.
  it("tintBlendMode 'screen' produces a different (lighter) color than the default multiply", () => {
    const screenTinted = { ...plainA, id: "screen-tinted", tintColor: "#ff0000", tintBlendMode: "screen" as const };
    const built = buildScene(sceneFileWithItems([tinted, screenTinted]));
    const multiplyMat = (built.furnitureGroups.get("tinted")!.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    const screenMat = (built.furnitureGroups.get("screen-tinted")!.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(screenMat.color.getHexString()).not.toBe(multiplyMat.color.getHexString());
    // Screen only ever lightens or holds a channel steady relative to the
    // untinted base (base <= result, since (1-base)*(1-tint) <= (1-base));
    // multiply only ever darkens or holds steady. With a non-white,
    // non-black tint on a non-white, non-black base, they diverge, and
    // screen's result must be >= the base furniture color on every channel.
    const baseColor = new THREE.Color(0xb9ac8f);
    expect(screenMat.color.r).toBeGreaterThanOrEqual(baseColor.r - 1e-6);
    expect(screenMat.color.g).toBeGreaterThanOrEqual(baseColor.g - 1e-6);
    expect(screenMat.color.b).toBeGreaterThanOrEqual(baseColor.b - 1e-6);
  });

  it("an explicit tintBlendMode: 'multiply' matches the default (unset) behavior exactly", () => {
    const explicitMultiply = { ...plainA, id: "explicit-multiply", tintColor: "#ff0000", tintBlendMode: "multiply" as const };
    const built = buildScene(sceneFileWithItems([tinted, explicitMultiply]));
    const defaultMat = (built.furnitureGroups.get("tinted")!.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    const explicitMat = (built.furnitureGroups.get("explicit-multiply")!.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(explicitMat.color.getHexString()).toBe(defaultMat.color.getHexString());
  });

  it("an unimplemented tintBlendMode (e.g. 'darken') falls back to multiply rather than throwing", () => {
    const darkenTinted = { ...plainA, id: "darken-tinted", tintColor: "#ff0000", tintBlendMode: "darken" as const };
    const built = buildScene(sceneFileWithItems([tinted, darkenTinted]));
    const multiplyMat = (built.furnitureGroups.get("tinted")!.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    const darkenMat = (built.furnitureGroups.get("darken-tinted")!.children[0] as THREE.Mesh)
      .material as THREE.MeshStandardMaterial;
    expect(darkenMat.color.getHexString()).toBe(multiplyMat.color.getHexString());
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

// improvements-v2.2 §4a: real-time lighting controls. buildScene previously
// hardcoded the sun/hemisphere; these confirm the schema-driven path
// reproduces that exact old look by default, and applies custom values when
// `room.lighting` is set.
describe("buildScene — lighting (improvements-v2.2 §4a)", () => {
  const plainItem = { id: "plain-box", name: "Plain", shape: "box" as const, dimsCm: { w: 50, d: 50, h: 50 } };

  it("with no room.lighting, reproduces the old hardcoded sun position/intensity and hemisphere intensity", () => {
    const built = buildScene(sceneFileWithItem(plainItem));
    const { sun, hemisphere } = built.lighting;

    expect(sun.intensity).toBeCloseTo(2.6, 10);
    expect(hemisphere.intensity).toBeCloseTo(1.05, 10);
    // Target is unconditionally fixed at (820, 0, 560) (distance/target are
    // out of scope for this feature — see schema/scene.ts).
    expect(sun.target.position.toArray()).toEqual([820, 0, 560]);
    // Position reconstructed from the derived default azimuth/elevation/
    // radius must round-trip back to the original hardcoded (60, 330, 420)
    // to floating-point precision.
    expect(sun.position.x).toBeCloseTo(60, 6);
    expect(sun.position.y).toBeCloseTo(330, 6);
    expect(sun.position.z).toBeCloseTo(420, 6);
  });

  it("applies custom room.lighting values instead of the hardcoded defaults", () => {
    const lighting: Lighting = {
      sunIntensity: 4,
      sunAzimuthDeg: 90,
      sunElevationDeg: 45,
      hemisphereIntensity: 0.2,
    };
    const built = buildScene(sceneFileWithItem(plainItem, lighting));
    const { sun, hemisphere } = built.lighting;

    expect(sun.intensity).toBe(4);
    expect(hemisphere.intensity).toBe(0.2);
    expect(sun.target.position.toArray()).toEqual([820, 0, 560]); // target still fixed
    // A different azimuth/elevation must move the sun off its default spot.
    expect(sun.position.toArray()).not.toEqual([60, 330, 420]);
  });
});

// improvements-minor-fixes §9: location-driven sun. resolveSunLighting is
// the single seam buildScene's initial build and Viewport's live effect both
// go through — these exercise it directly, plus a couple of buildScene
// integration checks.
describe("resolveSunLighting (improvements-minor-fixes §9)", () => {
  const manual: Lighting = { sunIntensity: 3, sunAzimuthDeg: 200, sunElevationDeg: 40, hemisphereIntensity: 0.5 };

  it("with no lightingMode, resolves manual angles/intensity unchanged (back-compat default)", () => {
    const resolved = resolveSunLighting({ lighting: manual, lightingMode: undefined, location: undefined });
    expect(resolved).toEqual({
      sunAzimuthDeg: 200,
      sunElevationDeg: 40,
      sunIntensity: 3,
      hemisphereIntensity: 0.5,
    });
  });

  it('with lightingMode "location" but no room.location, falls back to manual (UI-guarded state, not an error)', () => {
    const resolved = resolveSunLighting({ lighting: manual, lightingMode: "location", location: undefined });
    expect(resolved.sunAzimuthDeg).toBe(200);
    expect(resolved.sunElevationDeg).toBe(40);
  });

  it("in location mode, computes azimuth/elevation from location and leaves the manual sliders it read untouched", () => {
    const location: Location = {
      latitudeDeg: 40.7128,
      longitudeDeg: -74.006,
      orientationDeg: 180, // +Z faces south
      timeOfDayHour: 12,
      date: "2023-06-21", // June solstice, ~solar noon
    };
    const resolved = resolveSunLighting({ lighting: manual, lightingMode: "location", location });

    // Solar noon, +Z faces south -> sun lands near the scene's +Z side
    // (sceneAzimuthDeg ~= 0) — see solarPosition.test.ts's sign pin-down.
    expect(resolved.sunAzimuthDeg).toBeLessThan(2);
    // High summer-noon elevation for this latitude (~72.7deg), within the
    // 5-85deg clamp so it passes through unchanged.
    expect(resolved.sunElevationDeg).toBeCloseTo(72.7, 0);
    // hemisphereIntensity is untouched by location mode either way.
    expect(resolved.hemisphereIntensity).toBe(0.5);
    // Input `manual` object itself is never mutated.
    expect(manual.sunAzimuthDeg).toBe(200);
  });

  it("fades sunIntensity toward zero as the computed elevation drops through the horizon (night)", () => {
    const nightLocation: Location = {
      latitudeDeg: 40.7128,
      longitudeDeg: -74.006,
      orientationDeg: 0,
      timeOfDayHour: 2, // 2am — well below the horizon in June
      date: "2023-06-21",
    };
    const resolved = resolveSunLighting({ lighting: manual, lightingMode: "location", location: nightLocation });

    expect(resolved.sunIntensity).toBe(0); // fully faded
    // Shadow-driving elevation still clamps to the 5deg floor even though
    // the true sun is below the horizon — shadows don't break, they just
    // render at (near) zero brightness.
    expect(resolved.sunElevationDeg).toBe(5);
  });

  it("buildScene wires resolveSunLighting's output into the actual THREE lights in location mode", () => {
    const plainItem = { id: "plain-box", name: "Plain", shape: "box" as const, dimsCm: { w: 50, d: 50, h: 50 } };
    const location: Location = {
      latitudeDeg: 40.7128,
      longitudeDeg: -74.006,
      orientationDeg: 180,
      timeOfDayHour: 12,
      date: "2023-06-21",
    };
    const built = buildScene(sceneFileWithItem(plainItem, manual, "location", location));
    const { sun } = built.lighting;

    // Sun offset from target should sit close to the scene's +Z axis (small
    // x, large positive z) per the same solar-noon/+Z-faces-south check
    // above — sceneAzimuthDeg is a couple of degrees off exact 0 (clock
    // noon isn't exact solar noon), so assert the offset is z-dominant
    // rather than pinning x to ~0.
    const target = sun.target.position;
    const dx = sun.position.x - target.x;
    const dz = sun.position.z - target.z;
    expect(dz).toBeGreaterThan(0);
    expect(Math.abs(dx)).toBeLessThan(dz * 0.1);
  });
});
