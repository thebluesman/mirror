import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { fitModelToDims } from "./loadFurnitureModel";

function boxModel(w: number, h: number, d: number): { model: THREE.Object3D; mesh: THREE.Mesh } {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  const group = new THREE.Group();
  group.add(mesh);
  return { model: group, mesh };
}

describe("fitModelToDims", () => {
  it("scales axis-aligned model directly onto w/h/d and floor-snaps/recenters it", () => {
    const { model } = boxModel(1, 1, 1);
    fitModelToDims(model, { w: 40, d: 143.5, h: 72 });
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(size.x).toBeCloseTo(40);
    expect(size.z).toBeCloseTo(143.5);
    expect(size.y).toBeCloseTo(72);
    expect(box.min.y).toBeCloseTo(0);
  });

  // Code-review finding: fitModelToDims always rescales per-axis to force
  // the final bounding box to match `dims` exactly, regardless of whether a
  // rotation correction ran, ran correctly, or was silently removed — so
  // asserting only the final bbox size (as an earlier version of this test
  // did) passes even with a broken/no-op rotation. These two tests instead
  // track a specific point on the model's long local-X face (the "sideways"
  // end) through the full fit, and check *where it ends up*, which only
  // matches "at the top" if the rotation correction actually executed.
  it("actually reorients the model, not just rescales it: the long face ends up at the top after a 90deg Z correction", () => {
    // Authored lying on its side: local X is the long axis (155), which
    // should become the vertical axis (Y) once corrected upright.
    const { model, mesh } = boxModel(155, 72, 40);
    fitModelToDims(model, { w: 40, d: 143.5, h: 72 }, { x: 0, y: 0, z: 90 });

    const topPoint = mesh.localToWorld(new THREE.Vector3(155 / 2, 0, 0));
    expect(topPoint.y).toBeGreaterThan(60); // near the fitted height (72), not centered/low
    expect(Math.abs(topPoint.x)).toBeLessThan(5); // centered in X, not off to one side
  });

  it("without a correction, the same feature stays on the model's side instead of moving to the top", () => {
    const { model, mesh } = boxModel(155, 72, 40);
    fitModelToDims(model, { w: 40, d: 143.5, h: 72 }); // no modelRotationDeg
    const point = mesh.localToWorld(new THREE.Vector3(155 / 2, 0, 0));
    expect(point.y).toBeLessThan(50); // stays low/off to the side, not at the top
  });
});
