import { describe, expect, it } from "vitest";
import {
  KEYS_CANCEL_GESTURE,
  KEYS_CROUCH,
  KEYS_ELEVATE_DOWN,
  KEYS_ELEVATE_UP,
  KEYS_LOCK,
  KEYS_MODE_TOGGLE,
  KEYS_ROTATE_CCW,
  KEYS_ROTATE_CW,
  KEYS_WALK_BACK,
  KEYS_WALK_FORWARD,
  KEYS_WALK_LEFT,
  KEYS_WALK_RIGHT,
  SHORTCUTS,
} from "./shortcuts";

// v2 spike (W-A / proposal §1's own survey) established there are no real
// collisions today because the walk-mode branch in onKeyDown returns before
// the item-shortcut keys are reached — these two "layers" never compete for
// the same keypress despite living in the same function. These tests pin
// that invariant at the data level so a future shortcut addition that
// violates it fails here instead of silently shadowing an existing binding.
describe("shortcut key groups don't collide with each other", () => {
  const itemManipulationGroups: Record<string, string[]> = {
    KEYS_ROTATE_CCW,
    KEYS_ROTATE_CW,
    KEYS_ELEVATE_UP,
    KEYS_ELEVATE_DOWN,
    KEYS_LOCK,
  };
  const walkMovementGroups: Record<string, string[]> = {
    KEYS_WALK_FORWARD,
    KEYS_WALK_BACK,
    KEYS_WALK_LEFT,
    KEYS_WALK_RIGHT,
    KEYS_CROUCH,
  };

  it("has no overlap between any two item-manipulation key groups (Q/E/PgUp/PgDn/L)", () => {
    const names = Object.keys(itemManipulationGroups);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = itemManipulationGroups[names[i]];
        const b = itemManipulationGroups[names[j]];
        const overlap = a.filter((k) => b.includes(k));
        expect(overlap, `${names[i]} and ${names[j]} share key(s): ${overlap.join(", ")}`).toEqual([]);
      }
    }
  });

  it("has no overlap between any two walk-movement key groups (WASD + crouch)", () => {
    const names = Object.keys(walkMovementGroups);
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const a = walkMovementGroups[names[i]];
        const b = walkMovementGroups[names[j]];
        const overlap = a.filter((k) => b.includes(k));
        expect(overlap, `${names[i]} and ${names[j]} share key(s): ${overlap.join(", ")}`).toEqual([]);
      }
    }
  });

  it("KEYS_MODE_TOGGLE (V) doesn't collide with any walk-movement key — it must fire in both modes", () => {
    for (const group of Object.values(walkMovementGroups)) {
      const overlap = KEYS_MODE_TOGGLE.filter((k) => group.includes(k));
      expect(overlap).toEqual([]);
    }
  });

  it("KEYS_MODE_TOGGLE (V) doesn't collide with any item-manipulation key", () => {
    for (const group of Object.values(itemManipulationGroups)) {
      const overlap = KEYS_MODE_TOGGLE.filter((k) => group.includes(k));
      expect(overlap).toEqual([]);
    }
  });

  it("KEYS_CANCEL_GESTURE (Escape) doesn't collide with any other group", () => {
    const allOtherGroups = [...Object.values(itemManipulationGroups), ...Object.values(walkMovementGroups), KEYS_MODE_TOGGLE];
    for (const group of allOtherGroups) {
      const overlap = KEYS_CANCEL_GESTURE.filter((k) => group.includes(k));
      expect(overlap).toEqual([]);
    }
  });
});

describe("SHORTCUTS table", () => {
  it("every entry has a non-empty display and label", () => {
    for (const entry of SHORTCUTS) {
      expect(entry.display.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a valid context", () => {
    const validContexts = new Set(["selection", "walk", "global"]);
    for (const entry of SHORTCUTS) {
      expect(validContexts.has(entry.context)).toBe(true);
    }
  });

  it("includes the mode-toggle row and it reads V, not M", () => {
    const modeToggleRow = SHORTCUTS.find((s) => s.label.toLowerCase().includes("walk / orbit"));
    expect(modeToggleRow?.display).toBe("V");
  });

  it("has no duplicate (display, context) rows", () => {
    const seen = new Set<string>();
    for (const entry of SHORTCUTS) {
      const key = `${entry.display}::${entry.context}`;
      expect(seen.has(key), `duplicate row: ${key}`).toBe(false);
      seen.add(key);
    }
  });
});
