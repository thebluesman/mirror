import { describe, expect, it } from "vitest";
import { computeInspectorAnchor, fixedCornerAnchor, rectOverlapsViewport, type ScreenRect } from "./inspectorAnchor";

const CONTAINER_W = 1000;
const CONTAINER_H = 800;
const GAP = 16;
const MARGIN = 24;
const PANEL_W = 220;
const PANEL_H = 200;

function rect(left: number, top: number, right: number, bottom: number): ScreenRect {
  return { left, top, right, bottom };
}

describe("computeInspectorAnchor", () => {
  it("prefers below the object, horizontally centered on it, when there's room", () => {
    const objRect = rect(400, 300, 500, 350); // small box, mid-screen — plenty of room below
    const result = computeInspectorAnchor(objRect, PANEL_W, PANEL_H, CONTAINER_W, CONTAINER_H, GAP, MARGIN);
    expect(result.top).toBe(350 + GAP);
    expect(result.left).toBe((400 + 500) / 2 - PANEL_W / 2);
  });

  it("falls back to above when there's no room below but room above", () => {
    // Bottom of the object is close enough to the container's bottom edge
    // that below + gap + panelHeight + margin overflows.
    const objRect = rect(400, 500, 500, CONTAINER_H - 10);
    const result = computeInspectorAnchor(objRect, PANEL_W, PANEL_H, CONTAINER_W, CONTAINER_H, GAP, MARGIN);
    expect(result.top).toBe(500 - GAP - PANEL_H);
    expect(result.left).toBe((400 + 500) / 2 - PANEL_W / 2);
  });

  it("falls back to the nearest side when neither above nor below fits", () => {
    // Object spans nearly the full viewport height — no vertical room
    // either way.
    const objRect = rect(100, 5, 300, CONTAINER_H - 5);
    const result = computeInspectorAnchor(objRect, PANEL_W, PANEL_H, CONTAINER_W, CONTAINER_H, GAP, MARGIN);
    // Object's center-x (200) is left of the container's center (500), so
    // the panel goes on the right (more free room there).
    expect(result.left).toBe(300 + GAP);
    expect(result.top).toBe((5 + (CONTAINER_H - 5)) / 2 - PANEL_H / 2);
  });

  it("picks the left side when the object dominates height and sits right of center", () => {
    const objRect = rect(700, 5, 900, CONTAINER_H - 5);
    const result = computeInspectorAnchor(objRect, PANEL_W, PANEL_H, CONTAINER_W, CONTAINER_H, GAP, MARGIN);
    expect(result.left).toBe(700 - GAP - PANEL_W);
  });

  it("clamps the below placement's left edge when the object is near the right wall", () => {
    const objRect = rect(CONTAINER_W - 50, 300, CONTAINER_W - 10, 350);
    const result = computeInspectorAnchor(objRect, PANEL_W, PANEL_H, CONTAINER_W, CONTAINER_H, GAP, MARGIN);
    expect(result.left).toBe(CONTAINER_W - PANEL_W - MARGIN);
  });

  it("clamps the below placement's left edge when the object is near the left wall", () => {
    const objRect = rect(10, 300, 50, 350);
    const result = computeInspectorAnchor(objRect, PANEL_W, PANEL_H, CONTAINER_W, CONTAINER_H, GAP, MARGIN);
    expect(result.left).toBe(MARGIN);
  });

  it("clamps top into the viewport even in the pathological all-sides-fail case", () => {
    // Object fills the entire viewport in both axes — below/above both
    // fail, and even the "nearest side" fallback has nowhere to put the
    // panel without clamping.
    const objRect = rect(-50, -50, CONTAINER_W + 50, CONTAINER_H + 50);
    const result = computeInspectorAnchor(objRect, PANEL_W, PANEL_H, CONTAINER_W, CONTAINER_H, GAP, MARGIN);
    expect(result.left).toBeGreaterThanOrEqual(MARGIN);
    expect(result.left).toBeLessThanOrEqual(CONTAINER_W - PANEL_W - MARGIN);
    expect(result.top).toBeGreaterThanOrEqual(MARGIN);
    expect(result.top).toBeLessThanOrEqual(CONTAINER_H - PANEL_H - MARGIN);
  });

  it("pins to margin rather than inverting the clamp range when the panel doesn't fit the container", () => {
    const objRect = rect(400, 300, 500, 350);
    const result = computeInspectorAnchor(objRect, 50, 50, 40, 40, GAP, MARGIN);
    expect(result.left).toBe(MARGIN);
    expect(result.top).toBe(MARGIN);
  });
});

describe("rectOverlapsViewport", () => {
  it("is true for a rect fully inside the container", () => {
    expect(rectOverlapsViewport(rect(100, 100, 200, 200), CONTAINER_W, CONTAINER_H)).toBe(true);
  });

  it("is true for a rect partially overlapping the container's edge", () => {
    expect(rectOverlapsViewport(rect(-50, 100, 50, 200), CONTAINER_W, CONTAINER_H)).toBe(true);
  });

  it("is false for a rect entirely to the left of the container", () => {
    expect(rectOverlapsViewport(rect(-200, 100, -50, 200), CONTAINER_W, CONTAINER_H)).toBe(false);
  });

  it("is false for a rect entirely below the container", () => {
    expect(rectOverlapsViewport(rect(100, CONTAINER_H + 10, 200, CONTAINER_H + 100), CONTAINER_W, CONTAINER_H)).toBe(
      false,
    );
  });

  it("is false for a rect entirely to the right of the container", () => {
    expect(rectOverlapsViewport(rect(CONTAINER_W + 10, 100, CONTAINER_W + 100, 200), CONTAINER_W, CONTAINER_H)).toBe(
      false,
    );
  });

  it("is false for a rect entirely above the container", () => {
    expect(rectOverlapsViewport(rect(100, -200, 200, -50), CONTAINER_W, CONTAINER_H)).toBe(false);
  });
});

describe("fixedCornerAnchor", () => {
  it("reproduces the old bottom-left corner in left/top terms", () => {
    const result = fixedCornerAnchor(PANEL_H, CONTAINER_H, MARGIN);
    expect(result.left).toBe(MARGIN);
    expect(result.top).toBe(CONTAINER_H - PANEL_H - MARGIN);
  });
});
