import { describe, expect, it } from "vitest";
import { makeLayout, renameLayout } from "./layouts";
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

describe("renameLayout", () => {
  it("updates the name, leaving id, base, and commands untouched", () => {
    const renamed = renameLayout(source, "Weekend arrangement");
    expect(renamed.name).toBe("Weekend arrangement");
    expect(renamed.id).toBe(source.id);
    expect(renamed.base).toBe(source.base);
    expect(renamed.commands).toBe(source.commands);
  });

  it("falls back to the existing id when given a blank name", () => {
    const renamed = renameLayout(source, "   ");
    expect(renamed.name).toBe(source.id);
  });

  it("trims surrounding whitespace", () => {
    const renamed = renameLayout(source, "  Weeknights  ");
    expect(renamed.name).toBe("Weeknights");
  });

  it("does not mutate the input layout", () => {
    const before = JSON.parse(JSON.stringify(source));
    renameLayout(source, "Weekend arrangement");
    expect(source).toEqual(before);
  });
});
