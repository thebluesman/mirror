import { describe, expect, it } from "vitest";
import type { CameraPosition } from "../schema/scene";
import { makeCameraPosition } from "./cameraViewpoints";

describe("makeCameraPosition", () => {
  it("slugifies the name into an id and carries the reading through untouched", () => {
    const cam = makeCameraPosition("Reading Nook!", [1, 2, 3], [4, 5, 6], 42, []);
    expect(cam).toEqual({
      id: "reading-nook",
      name: "Reading Nook!",
      eye: [1, 2, 3],
      lookAt: [4, 5, 6],
      fovDeg: 42,
    });
  });

  it("de-dupes against existing camera ids by suffixing a counter", () => {
    const existing: CameraPosition[] = [
      { id: "couch-view", name: "couch-view", eye: [0, 0, 0], lookAt: [0, 0, 0], fovDeg: 60 },
    ];
    const cam = makeCameraPosition("couch view", [1, 1, 1], [2, 2, 2], 50, existing);
    expect(cam.id).toBe("couch-view-2");
  });

  it("falls back to the derived id when the trimmed name is empty", () => {
    const cam = makeCameraPosition("   ", [0, 0, 0], [0, 0, 0], 38, []);
    expect(cam.id).toBe("view");
    expect(cam.name).toBe("view");
  });
});
