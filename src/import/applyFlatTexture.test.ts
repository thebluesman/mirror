import { describe, expect, it } from "vitest";
import seedRaw from "../../seed/living-room.json";
import { parseScene } from "../schema/scene";
import { applyFlatTexture } from "./applyFlatTexture";

const seedScene = parseScene(seedRaw);

describe("applyFlatTexture", () => {
  it("sets flatTextureHash on an existing box item", () => {
    const next = applyFlatTexture(seedScene, "sonderod-rug", "rug-photo-hash");
    const item = next.items.find((i) => i.id === "sonderod-rug");
    expect(item?.flatTextureHash).toBe("rug-photo-hash");

    // other items untouched
    expect(next.items).toHaveLength(seedScene.items.length);
    const swivelChair = next.items.find((i) => i.id === "swivel-chair");
    expect(swivelChair?.flatTextureHash).toBeUndefined();
  });

  it("replaces an existing flatTextureHash (re-upload), not merges", () => {
    const first = applyFlatTexture(seedScene, "sonderod-rug", "first-hash");
    const second = applyFlatTexture(first, "sonderod-rug", "second-hash");
    expect(second.items.find((i) => i.id === "sonderod-rug")?.flatTextureHash).toBe("second-hash");
  });

  it("does not touch placement, room, cameras, or layouts", () => {
    const next = applyFlatTexture(seedScene, "sonderod-rug", "rug-photo-hash");
    expect(next.room).toEqual(seedScene.room);
    expect(next.cameras).toEqual(seedScene.cameras);
    expect(next.layouts).toEqual(seedScene.layouts);
    expect(next.current).toEqual(seedScene.current);
  });

  it("does not mutate the input scene", () => {
    const before = JSON.parse(JSON.stringify(seedScene));
    applyFlatTexture(seedScene, "sonderod-rug", "rug-photo-hash");
    expect(seedScene).toEqual(before);
  });

  it("throws when the item id doesn't exist", () => {
    expect(() => applyFlatTexture(seedScene, "no-such-item", "hash")).toThrow(/no item with id/);
  });

  it("throws when the item is compound-sofa shaped, not box", () => {
    expect(() => applyFlatTexture(seedScene, "applaryd-sofa", "hash")).toThrow(/isn't box-shaped/);
  });
});
