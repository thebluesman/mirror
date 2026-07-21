import { describe, expect, it } from "vitest";
import { slugify, uniqueId } from "./slug";

describe("slugify", () => {
  it("lowercases, replaces non-alphanumerics with hyphens, and trims edge hyphens", () => {
    expect(slugify("Reading Nook!", "fallback")).toBe("reading-nook");
  });

  it("falls back when the slug would be empty", () => {
    expect(slugify("   ", "fallback")).toBe("fallback");
    expect(slugify("###", "fallback")).toBe("fallback");
  });
});

describe("uniqueId", () => {
  it("returns the base id unchanged when it's not taken", () => {
    expect(uniqueId("couch", new Set())).toBe("couch");
  });

  it("suffixes an incrementing counter until it finds a free id", () => {
    expect(uniqueId("couch", new Set(["couch"]))).toBe("couch-2");
    expect(uniqueId("couch", new Set(["couch", "couch-2"]))).toBe("couch-3");
  });
});
