import { describe, expect, it } from "vitest";
import type { PlaceCommand, SceneFile } from "../schema/scene";
import { commitToActiveLayout, setPlaceCommand } from "./commit";

const cmd = (itemId: string, x: number, rotationDeg = 0): PlaceCommand => ({
  type: "place",
  itemId,
  position: [x, 0, 0],
  rotationDeg,
});

function scene(): SceneFile {
  return {
    meta: { source: "test", units: "cm", schemaVersion: "v1" },
    room: { ceilingHeightCm: 250, floor: [], walls: [] },
    items: [],
    cameras: [],
    layouts: [
      { id: "a", name: "A", base: null, commands: [cmd("x", 1), cmd("y", 2)] },
      { id: "b", name: "B", base: "a", commands: [cmd("x", 10)] },
    ],
    current: "b",
  } as SceneFile;
}

describe("commitToActiveLayout", () => {
  it("writes only to the active layout, leaving others untouched", () => {
    const s = scene();
    const next = commitToActiveLayout(s, (commands) => [...commands, cmd("z", 99)]);
    expect(next.layouts.find((l) => l.id === "b")!.commands.map((c) => c.itemId)).toEqual(["x", "z"]);
    // the non-active layout's commands are the same reference (untouched)
    expect(next.layouts.find((l) => l.id === "a")).toBe(s.layouts[0]);
  });

  it("is pure — does not mutate the input", () => {
    const s = scene();
    const before = JSON.parse(JSON.stringify(s));
    commitToActiveLayout(s, (commands) => [...commands, cmd("z", 99)]);
    expect(s).toEqual(before);
  });

  it("returns the input unchanged when current does not resolve to a layout", () => {
    const s = { ...scene(), current: "nonexistent" };
    const next = commitToActiveLayout(s, (commands) => [...commands, cmd("z", 99)]);
    expect(next).toBe(s);
  });
});

describe("setPlaceCommand", () => {
  it("replaces an existing item's command in place", () => {
    const result = setPlaceCommand([cmd("x", 1), cmd("y", 2)], "x", [5, 0, 0], 90);
    expect(result).toEqual([cmd("x", 5, 90), cmd("y", 2)]);
  });

  it("appends a new command when the item has none yet", () => {
    const result = setPlaceCommand([cmd("x", 1)], "z", [7, 0, 0], 0);
    expect(result).toEqual([cmd("x", 1), cmd("z", 7)]);
  });
});
