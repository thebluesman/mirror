import { describe, expect, it } from "vitest";
import { makeLayout } from "./layouts";
import type { Layout } from "../schema/scene";

const source: Layout = {
  id: "current",
  name: "Current",
  base: null,
  commands: [{ type: "place", itemId: "sofa", position: [1, 0, 2], rotationDeg: 90 }],
};

describe("makeLayout", () => {
  it("copies the source layout's commands, not a reference", () => {
    const copy = makeLayout("Weekend arrangement", source, [source]);
    expect(copy.commands).toEqual(source.commands);
    expect(copy.commands).not.toBe(source.commands);
    expect(copy.commands[0]).not.toBe(source.commands[0]);
  });

  it("records the source layout as base", () => {
    const copy = makeLayout("Weekend arrangement", source, [source]);
    expect(copy.base).toBe("current");
  });

  it("slugifies the name into an id, de-duplicating against existing layouts", () => {
    const first = makeLayout("Weekend", source, [source]);
    expect(first.id).toBe("weekend");
    const second = makeLayout("Weekend", source, [source, first]);
    expect(second.id).toBe("weekend-2");
  });

  it("falls back to the generated id as the name when given a blank name", () => {
    const copy = makeLayout("   ", source, [source]);
    expect(copy.name).toBe(copy.id);
  });
});
