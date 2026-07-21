import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { fitModelToDims } from "./loadFurnitureModel";

function boxModel(w: number, h: number, d: number): THREE.Object3D {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

describe("fitModelToDims", () => {
  it("scales axis-aligned model directly onto w/h/d and floor-snaps/recenters it", () => {
    const model = boxModel(1, 1, 1);
    fitModelToDims(model, { w: 40, d: 143.5, h: 72 });
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(size.x).toBeCloseTo(40);
    expect(size.z).toBeCloseTo(143.5);
    expect(size.y).toBeCloseTo(72);
    expect(box.min.y).toBeCloseTo(0);
  });

  it("applies modelRotationDeg before measuring the bounding box, correcting a model lying on its side", () => {
    // A model authored lying on its side: its "real" 72-wide/143.5-tall/40-deep
    // shape is present in the mesh, but along the wrong local axes (height is
    // along local X, not Y) until a 90deg Z rotation stands it upright.
    const model = boxModel(155, 72, 40);
    fitModelToDims(model, { w: 40, d: 143.5, h: 72 }, { x: 0, y: 0, z: 90 });
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    box.getSize(size);
    expect(size.x).toBeCloseTo(40);
    expect(size.z).toBeCloseTo(143.5);
    expect(size.y).toBeCloseTo(72);
    expect(box.min.y).toBeCloseTo(0);
  });
});
