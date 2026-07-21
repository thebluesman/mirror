// Formalized scene schema (Phase 2). Supersedes the illustrative
// `src/scene/types.ts` mirror and the `schema/scene-schema-draft.md` draft:
// this module is the single source of truth for both the runtime shape
// (zod validation) and the compile-time types (z.infer). `types.ts` now
// re-exports from here.
//
// Why zod: the seed JSON is authored by hand (the one-time Figma-MCP
// conversion, PRD §7.1) and, post-v1, will round-trip through file
// import/export and browser storage — all places a malformed shape can
// enter. A runtime validator catches that at the load boundary instead of
// as an undefined-access deep inside buildScene. zod also derives the TS
// types, so there's no hand-kept mirror to drift (the drift the old
// types.ts header warned about).

import { z } from "zod";

export const SCHEMA_VERSION = "v1" as const;

// Units: cm throughout. Coords carried from spike 3's geometry.json:
// x = Figma x, z = Figma y (plan view), y = up.

const Dims = z.object({ w: z.number(), d: z.number(), h: z.number() });
const SubFootprint = z.object({ w: z.number(), d: z.number() });

// WallOpening.type gained "glass-door" in Phase 2: the seed's full-height
// balcony door is glazed edge-to-edge, and typing it "door" rendered it as
// an opaque leaf (Phase 1 code-review finding). The value is the schema
// discriminant Phase 3 rendering hooks into; Phase 2 only owns the type.
export const OpeningType = z.enum(["door", "glass-door", "window"]);

const WallOpeningSchema = z
  .object({
    name: z.string(),
    along: z.enum(["x", "z"]),
    start: z.number(),
    size: z.number(),
    type: OpeningType,
    sillHeightCm: z.number().optional(),
    headHeightCm: z.number().optional(),
  })
  .loose(); // carry provenance notes (e.g. `note`) through untouched

const WallDefSchema = z
  .object({
    name: z.string(),
    from: z.tuple([z.number(), z.number()]),
    to: z.tuple([z.number(), z.number()]),
    openings: z.array(WallOpeningSchema).optional(),
  })
  .loose();

const FloorRect = z.object({
  name: z.string(),
  x: z.number(),
  z: z.number(),
  w: z.number(),
  d: z.number(),
});

// Shell texture calibration (Phase 3, PRD §7.2). Per-surface tint/repeat/
// roughness multipliers replacing the spike's hand-edited calibration.json —
// applied multiplicatively on top of whatever texture (or flat procedural
// color, if no photo uploaded yet) buildScene already produces, exactly like
// spike/textures/shell-textures.mjs's applyMapsToMaterial. `assetHash`
// references the tileable-processed photo in the OPFS asset store (Phase 2's
// content-addressed store); absent means "no photo uploaded, stay
// procedural." Purely additive/optional, so it doesn't require a
// SCHEMA_VERSION bump — a v1 file without `room.shell` still validates and
// simply renders with all-default (no-op) calibration, same as the spike
// treated a missing calibration.json.
export const SurfaceCalibrationSchema = z
  .object({
    assetHash: z.string().optional(),
    tint: z.string().default("#ffffff"),
    repeat: z.tuple([z.number(), z.number()]).default([1, 1]),
    roughnessScale: z.number().default(1),
  })
  .loose();

export const ShellCalibrationSchema = z
  .object({
    wall: SurfaceCalibrationSchema.optional(),
    floor: SurfaceCalibrationSchema.optional(),
    ceiling: SurfaceCalibrationSchema.optional(),
  })
  .loose();

export const RoomSchema = z.object({
  ceilingHeightCm: z.number(),
  floor: z.array(FloorRect),
  walls: z.array(WallDefSchema),
  shell: ShellCalibrationSchema.optional(),
});

/** No-op calibration — used when a surface has no entry in `room.shell` yet. */
export const DEFAULT_SURFACE_CALIBRATION: SurfaceCalibration = {
  tint: "#ffffff",
  repeat: [1, 1],
  roughnessScale: 1,
};

// FurnitureItem is a union rather than a flat shape with an optional
// dimsCm, so buildScene can discriminate on `shape` instead of probing for
// the presence of `main`/`chaise` (Phase 1 code-review finding: the old
// presence-check had an unguarded `item.dimsCm.w` fallback that throws on a
// mixed item). A plain box carries `dimsCm`; the compound sofa carries
// `main`+`chaise` sub-footprints and an optional overall `dimsCm`.
// `.loose()` passes through the many descriptive extras the seed carries
// (legHeightCm, seatHeightCm, backrestHeightCm, …) without enumerating each.

const BoxFurniture = z
  .object({
    id: z.string(),
    name: z.string(),
    shape: z.literal("box").optional(),
    dimsCm: Dims,
    elevationCm: z.number().optional(),
    sourcePhotoHash: z.string().optional(),
    glbHash: z.string().optional(),
    notes: z.string().optional(),
    purchaseInfo: z.string().optional(),
  })
  .loose();

const CompoundSofaFurniture = z
  .object({
    id: z.string(),
    name: z.string(),
    shape: z.literal("compound-sofa"),
    main: SubFootprint,
    chaise: SubFootprint,
    dimsCm: Dims.optional(),
    backHeightCm: z.number().optional(),
    elevationCm: z.number().optional(),
    sourcePhotoHash: z.string().optional(),
    glbHash: z.string().optional(),
    notes: z.string().optional(),
    purchaseInfo: z.string().optional(),
  })
  .loose();

// CompoundSofa first: it's the more specific shape. A box item lacks
// `shape: "compound-sofa"` so it can only match BoxFurniture; the sofa
// lacks a required top-level `dimsCm` so it can only match CompoundSofa.
export const FurnitureItemSchema = z.union([CompoundSofaFurniture, BoxFurniture]);

export const CameraPositionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    eye: z.tuple([z.number(), z.number(), z.number()]),
    lookAt: z.tuple([z.number(), z.number(), z.number()]),
    fovDeg: z.number(),
  })
  .loose(); // carry provenance notes (e.g. `note`) through untouched, like every sibling schema

export const PlaceCommandSchema = z
  .object({
    type: z.literal("place"),
    itemId: z.string(),
    position: z.tuple([z.number(), z.number(), z.number()]),
    rotationDeg: z.number(),
  })
  .loose();

// Branch shape included from v1 per product-review.md's addendum, even
// though v1 only ever populates one implicit layout.
export const LayoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  base: z.string().nullable(),
  commands: z.array(PlaceCommandSchema),
});

export const SceneMetaSchema = z
  .object({
    source: z.string(),
    units: z.literal("cm"),
    schemaVersion: z.string(),
  })
  .loose();

export const SceneFileSchema = z.object({
  meta: SceneMetaSchema,
  room: RoomSchema,
  items: z.array(FurnitureItemSchema),
  cameras: z.array(CameraPositionSchema),
  layouts: z.array(LayoutSchema),
  current: z.string(),
});

export type Dims = z.infer<typeof Dims>;
export type WallOpening = z.infer<typeof WallOpeningSchema>;
export type WallDef = z.infer<typeof WallDefSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type SurfaceCalibration = z.infer<typeof SurfaceCalibrationSchema>;
export type ShellCalibration = z.infer<typeof ShellCalibrationSchema>;
export type FurnitureItem = z.infer<typeof FurnitureItemSchema>;
export type CameraPosition = z.infer<typeof CameraPositionSchema>;
export type PlaceCommand = z.infer<typeof PlaceCommandSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type SceneFile = z.infer<typeof SceneFileSchema>;

/**
 * Migrate a raw scene object of any known older shape up to the current
 * SCHEMA_VERSION. Pure (returns a new object; does not mutate the input) and
 * total for the versions it knows; throws on an unrecognized version so a
 * corrupt/foreign file fails loud rather than silently half-migrating.
 *
 * v1-draft -> v1: bump schemaVersion only. The draft's "glass-door" opening
 * type is authored explicitly (see the committed seed's balcony-door) rather
 * than inferred from sill/head heights — a value-based heuristic here would
 * misclassify an ordinary door that happens to share the same heights, so
 * v1-draft files need "glass-door" set directly, not guessed at migration.
 */
export function migrate(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("migrate: scene must be an object");
  }
  const scene = raw as Record<string, unknown>;
  const meta = (scene.meta ?? {}) as Record<string, unknown>;
  const version = meta.schemaVersion;

  if (version === SCHEMA_VERSION) return raw;

  if (version === "v1-draft") {
    return { ...scene, meta: { ...meta, schemaVersion: SCHEMA_VERSION } };
  }

  throw new Error(`migrate: unknown schemaVersion "${String(version)}"`);
}

/**
 * The load boundary: migrate a raw parsed-JSON object to the current schema
 * version, then validate. Throws a zod error on an invalid shape. Every path
 * that brings a scene in from outside memory (seed import, file open, IndexedDB
 * restore, zip import) goes through here.
 */
export function parseScene(raw: unknown): SceneFile {
  return SceneFileSchema.parse(migrate(raw));
}
