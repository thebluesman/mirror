import { describe, expect, it } from "vitest";
import { applyUndo, recordUndo, type UndoSlot } from "./undo";
import type { SceneFile } from "../schema/scene";

// A minimal-but-valid-shaped SceneFile stand-in; undo treats it as an opaque
// snapshot (it never inspects the contents), so structural fidelity beyond
// "distinct object references" isn't needed for these tests.
function scene(current: string): SceneFile {
  return {
    version: 2,
    room: { shell: {} },
    items: [],
    layouts: [{ id: current, name: current, base: null, commands: [] }],
    current,
    cameras: [],
  } as unknown as SceneFile;
}

describe("recordUndo", () => {
  it("stores the given (pre-action) scene as the slot to restore", () => {
    const before = scene("a");
    expect(recordUndo(before)).toBe(before);
  });

  it("replaces the prior slot rather than accumulating (single-step, not a stack)", () => {
    const first = scene("a");
    const second = scene("b");
    let slot: UndoSlot = recordUndo(first);
    slot = recordUndo(second);
    // Only the most recent pre-action state is retained — the first is gone,
    // there is no history depth to reach it.
    expect(slot).toBe(second);
    expect(slot).not.toBe(first);
  });
});

describe("applyUndo", () => {
  it("returns null when there's nothing to undo", () => {
    expect(applyUndo(null)).toBeNull();
  });

  it("returns the snapshot to restore and clears the slot", () => {
    const before = scene("a");
    const result = applyUndo(recordUndo(before));
    expect(result).not.toBeNull();
    expect(result?.restored).toBe(before);
    expect(result?.next).toBeNull();
  });

  it("is single-step with no redo: a second undo after consuming the slot is a no-op", () => {
    const before = scene("a");
    const first = applyUndo(recordUndo(before));
    expect(first?.restored).toBe(before);
    // Feeding the (now-empty) next slot back into applyUndo does nothing —
    // undoing is not itself undoable/redoable.
    const second = applyUndo(first?.next ?? null);
    expect(second).toBeNull();
  });
});
