import { describe, expect, it } from "vitest";
import { allItemsLocked } from "./lockState";

describe("allItemsLocked", () => {
  it("is false for an empty item list (vacuously-true would be misleading)", () => {
    expect(allItemsLocked([])).toBe(false);
  });

  it("is true when every item is locked", () => {
    expect(allItemsLocked([{ locked: true }, { locked: true }])).toBe(true);
  });

  it("is false when at least one item is unlocked", () => {
    expect(allItemsLocked([{ locked: true }, { locked: false }])).toBe(false);
  });

  it("is false when an item's locked flag is undefined (default-unlocked)", () => {
    expect(allItemsLocked([{ locked: true }, {}])).toBe(false);
  });

  it("is false for a single unlocked item", () => {
    expect(allItemsLocked([{}])).toBe(false);
  });

  it("is true for a single locked item", () => {
    expect(allItemsLocked([{ locked: true }])).toBe(true);
  });
});
