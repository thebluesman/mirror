import { describe, expect, it } from "vitest";
import seedRaw from "../../seed/living-room.json";
import { parseScene, type SceneFile } from "../schema/scene";
import { applyFurnitureImport } from "./applyImport";

const seedScene = parseScene(seedRaw);

// A scene with a second, non-default layout snapshot made active — the case
// applyFurnitureImport's default-placement path was previously untested
// against (it only ever checked/wrote `scene.current`, which the seed's
// single layout made indistinguishable from "the default one").
function withActiveNonDefaultLayout(): SceneFile {
  const base = seedScene.layouts[0];
  const layoutB = {
    id: "layout-b",
    name: "Layout B",
    base: base.id,
    commands: base.commands.map((c) => ({ ...c })),
  };
  return { ...seedScene, layouts: [base, layoutB], current: "layout-b" };
}

describe("applyFurnitureImport", () => {
  it("attaches hashes/dims to an existing item and keeps its Figma-seeded placement", () => {
    const next = applyFurnitureImport(seedScene, {
      itemId: "swivel-chair",
      dimsCm: { w: 100, d: 91, h: 73 },
      sourcePhotoHash: "photo-hash",
      glbHash: "glb-hash",
    });

    const item = next.items.find((i) => i.id === "swivel-chair");
    expect(item?.dimsCm).toEqual({ w: 100, d: 91, h: 73 });
    expect(item?.sourcePhotoHash).toBe("photo-hash");
    expect(item?.glbHash).toBe("glb-hash");

    // placement command untouched (still exactly one, at its Figma-seeded position)
    const layout = next.layouts.find((l) => l.id === next.current)!;
    const commands = layout.commands.filter((c) => c.itemId === "swivel-chair");
    expect(commands).toHaveLength(1);
    expect(commands[0].position).toEqual([542, 0, 369]);

    // other items/commands untouched
    expect(next.items).toHaveLength(seedScene.items.length);
    expect(layout.commands).toHaveLength(
      seedScene.layouts.find((l) => l.id === seedScene.current)!.commands.length,
    );
  });

  it("creates a new item at a default position when it has no Figma footprint", () => {
    const next = applyFurnitureImport(seedScene, {
      itemId: "reading-chair",
      newItemName: "Reading chair",
      dimsCm: { w: 70, d: 70, h: 90 },
      sourcePhotoHash: "photo-hash-2",
      glbHash: "glb-hash-2",
    });

    const item = next.items.find((i) => i.id === "reading-chair");
    expect(item).toEqual({
      id: "reading-chair",
      name: "Reading chair",
      shape: "box",
      dimsCm: { w: 70, d: 70, h: 90 },
      sourcePhotoHash: "photo-hash-2",
      glbHash: "glb-hash-2",
    });

    const layout = next.layouts.find((l) => l.id === next.current)!;
    const command = layout.commands.find((c) => c.itemId === "reading-chair");
    expect(command).toEqual({ type: "place", itemId: "reading-chair", position: [0, 0, 0], rotationDeg: 0 });
  });

  it("re-importing an existing item replaces its modelRotationDeg (full replace, not merge)", () => {
    const corrected = applyFurnitureImport(seedScene, {
      itemId: "swivel-chair",
      dimsCm: { w: 100, d: 91, h: 73 },
      sourcePhotoHash: "photo-hash",
      glbHash: "glb-hash",
      modelRotationDeg: { x: 0, y: 180, z: 0 },
    });
    expect(corrected.items.find((i) => i.id === "swivel-chair")?.modelRotationDeg).toEqual({
      x: 0,
      y: 180,
      z: 0,
    });

    // a follow-up re-import with a fresh (correct) photo/model clears the
    // stale correction instead of carrying it onto the new model
    const reimported = applyFurnitureImport(corrected, {
      itemId: "swivel-chair",
      dimsCm: { w: 100, d: 91, h: 73 },
      sourcePhotoHash: "photo-hash-2",
      glbHash: "glb-hash-2",
    });
    expect(reimported.items.find((i) => i.id === "swivel-chair")?.modelRotationDeg).toBeUndefined();
  });

  it("places a genuinely new item in the active non-default layout, leaving other layouts untouched", () => {
    const scene = withActiveNonDefaultLayout();
    const next = applyFurnitureImport(scene, {
      itemId: "reading-chair",
      newItemName: "Reading chair",
      dimsCm: { w: 70, d: 70, h: 90 },
      sourcePhotoHash: "photo-hash-2",
      glbHash: "glb-hash-2",
    });

    // the command lands in the active layout (layout-b), NOT the default one
    const active = next.layouts.find((l) => l.id === "layout-b")!;
    const activeCmd = active.commands.find((c) => c.itemId === "reading-chair");
    expect(activeCmd).toEqual({ type: "place", itemId: "reading-chair", position: [0, 0, 0], rotationDeg: 0 });

    const other = next.layouts.find((l) => l.id === seedScene.layouts[0].id)!;
    expect(other.commands.some((c) => c.itemId === "reading-chair")).toBe(false);
    expect(other.commands).toEqual(seedScene.layouts[0].commands);
  });

  it("keeps an existing item's placement when re-imported while a non-default layout is active", () => {
    const scene = withActiveNonDefaultLayout();
    const before = scene.layouts.find((l) => l.id === "layout-b")!.commands.find((c) => c.itemId === "swivel-chair")!;

    const next = applyFurnitureImport(scene, {
      itemId: "swivel-chair",
      dimsCm: { w: 100, d: 91, h: 73 },
      sourcePhotoHash: "photo-hash",
      glbHash: "glb-hash",
    });

    const active = next.layouts.find((l) => l.id === "layout-b")!;
    const cmds = active.commands.filter((c) => c.itemId === "swivel-chair");
    expect(cmds).toHaveLength(1); // no duplicate command added
    expect(cmds[0].position).toEqual(before.position); // placement preserved
    // the item's asset hashes were still updated on the item itself
    expect(next.items.find((i) => i.id === "swivel-chair")?.glbHash).toBe("glb-hash");
  });

  it("does not mutate the input scene", () => {
    const before = JSON.parse(JSON.stringify(seedScene));
    applyFurnitureImport(seedScene, {
      itemId: "swivel-chair",
      dimsCm: { w: 100, d: 91, h: 73 },
      sourcePhotoHash: "x",
      glbHash: "y",
    });
    expect(seedScene).toEqual(before);
  });
});
