import { describe, it, expect } from "vitest";
import seedRaw from "../../seed/living-room.json";
import {
  SceneFileSchema,
  SCHEMA_VERSION,
  DEFAULT_SURFACE_CALIBRATION,
  ShellCalibrationSchema,
  SurfaceCalibrationSchema,
  migrate,
  parseScene,
  type SceneFile,
} from "./scene";

// A minimal valid v1 scene, built up in tests that need to mutate one field.
function minimalV1(): unknown {
  return {
    meta: { source: "test", units: "cm", schemaVersion: "v1" },
    room: {
      ceilingHeightCm: 240,
      floor: [{ name: "f", x: 0, z: 0, w: 100, d: 100 }],
      walls: [{ name: "w", from: [0, 0], to: [100, 0] }],
    },
    items: [{ id: "box", name: "Box", dimsCm: { w: 10, d: 10, h: 10 } }],
    cameras: [],
    layouts: [{ id: "current", name: "current", base: null, commands: [] }],
    current: "current",
  };
}

describe("SceneFile validation", () => {
  it("accepts a minimal valid v1 scene", () => {
    expect(() => SceneFileSchema.parse(minimalV1())).not.toThrow();
  });

  it("rejects a scene missing a required field", () => {
    const bad = minimalV1() as Record<string, unknown>;
    delete bad.room;
    expect(() => SceneFileSchema.parse(bad)).toThrow();
  });

  it("rejects an unknown opening type", () => {
    const scene = minimalV1() as any;
    scene.room.walls[0].openings = [
      { name: "o", along: "x", start: 0, size: 10, type: "portal" },
    ];
    expect(() => SceneFileSchema.parse(scene)).toThrow();
  });

  it("accepts the glass-door opening type", () => {
    const scene = minimalV1() as any;
    scene.room.walls[0].openings = [
      { name: "o", along: "x", start: 0, size: 10, type: "glass-door", sillHeightCm: 0, headHeightCm: 210 },
    ];
    expect(() => SceneFileSchema.parse(scene)).not.toThrow();
  });
});

describe("furniture union", () => {
  it("accepts a box item (dimsCm) and a compound sofa (main/chaise)", () => {
    const scene = minimalV1() as any;
    scene.items = [
      { id: "b", name: "Box", dimsCm: { w: 1, d: 1, h: 1 } },
      {
        id: "sofa",
        name: "Sofa",
        shape: "compound-sofa",
        main: { w: 290, d: 93 },
        chaise: { w: 91, d: 162 },
      },
    ];
    const parsed = SceneFileSchema.parse(scene);
    expect(parsed.items).toHaveLength(2);
  });

  it("rejects a box item with no dimsCm and no compound shape", () => {
    const scene = minimalV1() as any;
    scene.items = [{ id: "x", name: "X" }];
    expect(() => SceneFileSchema.parse(scene)).toThrow();
  });

  it("preserves descriptive extras via loose objects", () => {
    const scene = minimalV1() as any;
    scene.items = [
      { id: "t", name: "Table", dimsCm: { w: 1, d: 1, h: 1 }, legHeightCm: 20 },
    ];
    const parsed = SceneFileSchema.parse(scene) as any;
    expect(parsed.items[0].legHeightCm).toBe(20);
  });
});

describe("migrate", () => {
  it("bumps v1-draft to the current version", () => {
    const draft = minimalV1() as any;
    draft.meta.schemaVersion = "v1-draft";
    const migrated = migrate(draft) as SceneFile;
    expect(migrated.meta.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("leaves opening types untouched — glass-door must be authored explicitly, not inferred", () => {
    const draft = minimalV1() as any;
    draft.meta.schemaVersion = "v1-draft";
    draft.room.walls[0].openings = [
      // Same sill/head heights as a real full-height glass door, but typed
      // "door" — migration must not guess at reclassification from heights.
      { name: "balcony", along: "z", start: 0, size: 110, type: "door", sillHeightCm: 0, headHeightCm: 210 },
      { name: "d", along: "x", start: 0, size: 90, type: "door" },
    ];
    const migrated = migrate(draft) as any;
    expect(migrated.room.walls[0].openings[0].type).toBe("door");
    expect(migrated.room.walls[0].openings[1].type).toBe("door");
  });

  it("does not mutate the input", () => {
    const draft = minimalV1() as any;
    draft.meta.schemaVersion = "v1-draft";
    migrate(draft);
    expect(draft.meta.schemaVersion).toBe("v1-draft");
  });

  it("is a no-op for an already-current scene", () => {
    const scene = minimalV1();
    expect(migrate(scene)).toBe(scene);
  });

  it("throws on an unknown schemaVersion", () => {
    const scene = minimalV1() as any;
    scene.meta.schemaVersion = "v99";
    expect(() => migrate(scene)).toThrow(/unknown schemaVersion/);
  });
});

describe("parseScene (migrate + validate) and round-trip", () => {
  it("parses the committed seed and round-trips through JSON", () => {
    const scene = parseScene(seedRaw);
    expect(scene.current).toBe("current");
    // JSON round-trip must re-parse identically (autosave/file save rely on this).
    const roundTripped = parseScene(JSON.parse(JSON.stringify(scene)));
    expect(roundTripped).toEqual(scene);
  });

  it("upgrades a v1-draft seed to the current schemaVersion on parse", () => {
    // The committed seed is authored at v1-draft; parseScene runs migrate first.
    expect((seedRaw as any).meta.schemaVersion).toBe("v1-draft");
    const scene = parseScene(seedRaw);
    expect(scene.meta.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("keeps the seed's balcony door as glass-door", () => {
    const scene = parseScene(seedRaw);
    const westWall = scene.room.walls.find((w) => w.name === "west-wall");
    const balcony = westWall?.openings?.find((o) => o.name === "balcony-door");
    expect(balcony?.type).toBe("glass-door");
  });
});

describe("shell texture calibration (Phase 3)", () => {
  it("is optional — a scene with no room.shell still validates (old files unaffected)", () => {
    expect(() => SceneFileSchema.parse(minimalV1())).not.toThrow();
    const scene = SceneFileSchema.parse(minimalV1());
    expect(scene.room.shell).toBeUndefined();
  });

  it("accepts a partial shell (only some surfaces calibrated)", () => {
    const scene = minimalV1() as any;
    scene.room.shell = { wall: { tint: "#ffcc00", repeat: [2, 1.5], roughnessScale: 0.8 } };
    const parsed = SceneFileSchema.parse(scene);
    expect(parsed.room.shell?.wall?.tint).toBe("#ffcc00");
    expect(parsed.room.shell?.floor).toBeUndefined();
  });

  it("SurfaceCalibrationSchema fills in defaults for an empty object", () => {
    const parsed = SurfaceCalibrationSchema.parse({});
    expect(parsed).toEqual({ tint: "#ffffff", repeat: [1, 1], roughnessScale: 1 });
  });

  it("carries assetHash through and defaults DEFAULT_SURFACE_CALIBRATION matches the schema default", () => {
    const parsed = SurfaceCalibrationSchema.parse({ assetHash: "abc123" });
    expect(parsed.assetHash).toBe("abc123");
    expect({ tint: parsed.tint, repeat: parsed.repeat, roughnessScale: parsed.roughnessScale }).toEqual(
      DEFAULT_SURFACE_CALIBRATION,
    );
  });

  it("ShellCalibrationSchema round-trips through JSON like the rest of the scene", () => {
    const scene = minimalV1() as any;
    scene.room.shell = {
      wall: { assetHash: "h1", tint: "#eeeeee", repeat: [1.2, 1], roughnessScale: 1 },
      floor: { assetHash: "h2", tint: "#ffffff", repeat: [10.9, 6.3], roughnessScale: 1 },
    };
    const parsed = parseScene(scene);
    const roundTripped = parseScene(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped).toEqual(parsed);
  });

  it("rejects a malformed calibration (repeat must be a 2-tuple)", () => {
    expect(() => ShellCalibrationSchema.parse({ wall: { repeat: [1, 2, 3] } })).toThrow();
  });
});
