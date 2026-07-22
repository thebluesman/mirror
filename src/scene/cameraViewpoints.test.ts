import { describe, expect, it } from "vitest";
import type { CameraPosition } from "../schema/scene";
import {
  deriveLiveCameraReading,
  makeCameraPosition,
  renameCameraPosition,
  resolveStructuralBuildCameraPreset,
} from "./cameraViewpoints";
import { SYNTHETIC_LOOKAT_DISTANCE_CM } from "./walkCamera";

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

describe("renameCameraPosition", () => {
  const cam: CameraPosition = { id: "couch-view", name: "Couch view", eye: [1, 2, 3], lookAt: [4, 5, 6], fovDeg: 50 };

  it("updates the name, leaving id, eye, lookAt, and fovDeg untouched", () => {
    const renamed = renameCameraPosition(cam, "Reading nook");
    expect(renamed.name).toBe("Reading nook");
    expect(renamed.id).toBe(cam.id);
    expect(renamed.eye).toBe(cam.eye);
    expect(renamed.lookAt).toBe(cam.lookAt);
    expect(renamed.fovDeg).toBe(cam.fovDeg);
  });

  it("falls back to the existing id when given a blank name", () => {
    const renamed = renameCameraPosition(cam, "   ");
    expect(renamed.name).toBe(cam.id);
  });

  it("trims surrounding whitespace", () => {
    const renamed = renameCameraPosition(cam, "  Sunset spot  ");
    expect(renamed.name).toBe("Sunset spot");
  });

  it("does not mutate the input camera", () => {
    const before = JSON.parse(JSON.stringify(cam));
    renameCameraPosition(cam, "Reading nook");
    expect(cam).toEqual(before);
  });
});

// improvements-minor-fixes.md §15 regression coverage: a structural rebuild
// (e.g. the SONDEROD rug's flat-texture upload — any furniture-item edit
// goes through structuralSceneFile's `sceneFile.items` dep, not just
// room/layout changes) used to unconditionally frame the fresh camera on
// `cameras[0]`, discarding wherever the user had actually orbited to. The
// seed's `cameras[0]` ("couch-view") is a coffee-table-occluded angle on the
// rug (spike-v2/d4-rug-drive.mjs's header documents this), so every edit
// silently kicked the live view back to an angle where the rug — and any
// texture change on it — is barely visible, reading as "no visual change"
// even though the texture itself applied correctly underneath. These two
// functions are the pure decision/derivation Viewport.tsx's structural-build
// effect now uses instead of the old unconditional `cameras[0]` read; see
// that effect's cleanup (captures via deriveLiveCameraReading) and setup
// (picks via resolveStructuralBuildCameraPreset) for the imperative wiring
// this doesn't reach on its own (needs a live THREE camera/controls pair).
describe("resolveStructuralBuildCameraPreset", () => {
  const couchView: CameraPosition = {
    id: "couch-view",
    name: "couch-view",
    eye: [660, 115, 640],
    lookAt: [683, 120, 324],
    fovDeg: 60,
  };
  const liveRestore: CameraPosition = {
    id: "__live-camera-reading__",
    name: "__live-camera-reading__",
    eye: [683, 220, 620],
    lookAt: [683, 0, 540],
    fovDeg: 45,
  };

  it("prefers a stashed live restore over cameras[0] — the bug: it never used to", () => {
    expect(resolveStructuralBuildCameraPreset(liveRestore, [couchView])).toBe(liveRestore);
  });

  it("falls back to cameras[0] only when there's no live restore yet (the very first build)", () => {
    expect(resolveStructuralBuildCameraPreset(null, [couchView])).toBe(couchView);
  });

  it("returns null when there's neither a live restore nor any saved camera", () => {
    expect(resolveStructuralBuildCameraPreset(null, [])).toBeNull();
  });
});

describe("deriveLiveCameraReading", () => {
  it("orbit mode: lookAt is the orbit target, untouched", () => {
    const reading = deriveLiveCameraReading([683, 220, 620], 45, "orbit", [683, 0, 540], [0, -1, 0]);
    expect(reading.eye).toEqual([683, 220, 620]);
    expect(reading.lookAt).toEqual([683, 0, 540]);
    expect(reading.fovDeg).toBe(45);
  });

  it("walk mode: lookAt is synthesized from eye + forward direction, ignoring orbitTarget", () => {
    const eye: [number, number, number] = [100, 160, 200];
    const forward: [number, number, number] = [1, 0, 0];
    const reading = deriveLiveCameraReading(eye, 38, "walk", [999, 999, 999], forward);
    expect(reading.lookAt).toEqual([
      eye[0] + forward[0] * SYNTHETIC_LOOKAT_DISTANCE_CM,
      eye[1] + forward[1] * SYNTHETIC_LOOKAT_DISTANCE_CM,
      eye[2] + forward[2] * SYNTHETIC_LOOKAT_DISTANCE_CM,
    ]);
  });

  it("copies eye/lookAt into fresh arrays, not references to the inputs", () => {
    const eye: [number, number, number] = [1, 2, 3];
    const target: [number, number, number] = [4, 5, 6];
    const reading = deriveLiveCameraReading(eye, 50, "orbit", target, [0, 0, -1]);
    expect(reading.eye).not.toBe(eye);
    expect(reading.lookAt).not.toBe(target);
  });
});
