import { describe, expect, it } from "vitest";
import seedRaw from "../../seed/living-room.json";
import { parseScene } from "../schema/scene";
import { applyFurnitureImport } from "./applyImport";

const seedScene = parseScene(seedRaw);

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
