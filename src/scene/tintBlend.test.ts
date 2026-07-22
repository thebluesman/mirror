import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applyTintBlend, blendTint } from "./tintBlend";

// improvements-minor-fixes §10: unit coverage for the blend math itself
// (blendTint) and the material-level dispatch (applyTintBlend). The
// onBeforeCompile shader-patch path (applyTintBlend against a textured
// material, "screen" mode) is only smoke-tested here — no real WebGL context
// in this test environment, so there's no meaningful way to assert the
// rendered pixel output; see the proposal's own note on this (§4).

describe("blendTint", () => {
  it("multiply: base * tint per channel, matching the pre-existing .color.multiply() behavior", () => {
    const base = new THREE.Color(0.5, 0.4, 0.2);
    const tint = new THREE.Color(0.8, 0.5, 1.0);
    const result = blendTint(base, tint, "multiply");
    expect(result.r).toBeCloseTo(0.4); // 0.5 * 0.8
    expect(result.g).toBeCloseTo(0.2); // 0.4 * 0.5
    expect(result.b).toBeCloseTo(0.2); // 0.2 * 1.0
  });

  it("screen: 1 - (1-base)*(1-tint) per channel", () => {
    const base = new THREE.Color(0.5, 0.4, 0.2);
    const tint = new THREE.Color(0.8, 0.5, 1.0);
    const result = blendTint(base, tint, "screen");
    // 1 - (1-0.5)*(1-0.8) = 1 - 0.5*0.2 = 0.9
    expect(result.r).toBeCloseTo(0.9);
    // 1 - (1-0.4)*(1-0.5) = 1 - 0.6*0.5 = 0.7
    expect(result.g).toBeCloseTo(0.7);
    // 1 - (1-0.2)*(1-1.0) = 1 - 0.8*0 = 1
    expect(result.b).toBeCloseTo(1);
  });

  it("screen with a black tint is a no-op (screen's identity element)", () => {
    const base = new THREE.Color(0.3, 0.6, 0.9);
    const result = blendTint(base.clone(), new THREE.Color(0, 0, 0), "screen");
    expect(result.r).toBeCloseTo(0.3);
    expect(result.g).toBeCloseTo(0.6);
    expect(result.b).toBeCloseTo(0.9);
  });

  it("screen with a white tint saturates to white (screen's absorbing element)", () => {
    const base = new THREE.Color(0.3, 0.6, 0.9);
    const result = blendTint(base.clone(), new THREE.Color(1, 1, 1), "screen");
    expect(result.r).toBeCloseTo(1);
    expect(result.g).toBeCloseTo(1);
    expect(result.b).toBeCloseTo(1);
  });

  it("mutates and returns the same baseColor instance, mirroring .color.multiply()'s in-place contract", () => {
    const base = new THREE.Color(0.5, 0.5, 0.5);
    const result = blendTint(base, new THREE.Color(0.5, 0.5, 0.5), "screen");
    expect(result).toBe(base);
  });

  // Deferred modes (improvements-minor-fixes §10 scope correction, 2026-07-22):
  // overlay/soft-light/darken are declared in the schema but not implemented
  // this round — blendTint must fall back to multiply for them rather than
  // throwing, so a scene file that somehow carries one of these values (e.g.
  // authored by a later build) still renders sanely here.
  it.each(["overlay", "soft-light", "darken"] as const)(
    "falls back to multiply for the not-yet-implemented mode %s",
    (mode) => {
      const base = new THREE.Color(0.5, 0.4, 0.2);
      const tint = new THREE.Color(0.8, 0.5, 1.0);
      const result = blendTint(base, tint, mode);
      expect(result.r).toBeCloseTo(0.4);
      expect(result.g).toBeCloseTo(0.2);
      expect(result.b).toBeCloseTo(0.2);
    },
  );
});

describe("applyTintBlend", () => {
  it("flat/untextured material (no .map): multiply mode matches the plain .color.multiply() fast path", () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9ac8f });
    const expected = mat.color.clone().multiply(new THREE.Color("#ff0000"));
    applyTintBlend(mat, "#ff0000", "multiply");
    expect(mat.color.getHex()).toBe(expected.getHex());
    expect(mat.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile); // no shader patch installed
  });

  it("flat/untextured material (no .map): screen mode blends directly into .color, no shader patch needed", () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb9ac8f });
    const baseColor = mat.color.clone();
    applyTintBlend(mat, "#ff0000", "screen");
    const expected = blendTint(baseColor, new THREE.Color("#ff0000"), "screen");
    expect(mat.color.getHex()).toBe(expected.getHex());
    expect(mat.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile);
  });

  it("textured material (.map set): multiply mode still uses the plain .color.multiply() fast path, unchanged", () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    mat.map = new THREE.Texture(); // stand-in "has a texture" marker, no real image data needed
    const baseColor = mat.color.clone();
    applyTintBlend(mat, "#336699", "multiply");
    const expected = baseColor.clone().multiply(new THREE.Color("#336699"));
    expect(mat.color.getHex()).toBe(expected.getHex());
    expect(mat.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile); // no shader patch for multiply
  });

  it("textured material (.map set): screen mode installs an onBeforeCompile shader patch instead of touching .color", () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    mat.map = new THREE.Texture();
    const baseColor = mat.color.clone();
    expect(() => applyTintBlend(mat, "#336699", "screen")).not.toThrow();
    expect(mat.onBeforeCompile).not.toBe(THREE.Material.prototype.onBeforeCompile);
    expect(mat.color.getHex()).toBe(baseColor.getHex()); // .color left untouched — blend happens in shader
  });

  it("the installed onBeforeCompile patch sets the tint uniform and patches the fragment shader, without throwing", () => {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
    mat.map = new THREE.Texture();
    applyTintBlend(mat, "#336699", "screen");

    // Simulate what three.js's WebGLProgram does when compiling this
    // material: call the installed onBeforeCompile with a shader-shaped
    // object carrying stock chunks, and confirm it mutates it as expected.
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      fragmentShader: "#include <common>\nvoid main() {\n#include <map_fragment>\n}",
      vertexShader: "void main() {}",
    };
    expect(() => mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as never)).not.toThrow();
    expect(shader.uniforms.tintColor).toBeDefined();
    expect((shader.uniforms.tintColor.value as THREE.Color).getHexString()).toBe(
      new THREE.Color("#336699").getHexString(),
    );
    expect(shader.fragmentShader).toContain("uniform vec3 tintColor;");
    expect(shader.fragmentShader).toContain("diffuseColor.rgb = 1.0 - (1.0 - diffuseColor.rgb) * (1.0 - tintColor);");
  });
});
