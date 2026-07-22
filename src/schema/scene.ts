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

// Meshy doesn't guarantee a generated GLB comes out upright/forward-facing
// (OUTCOME-3's "+Z-at-yaw-0 convention" finding) — applied to the raw model
// *before* loadFurnitureModel.ts's fitModelToDims computes its bounding box,
// so an axis-swap (item lying on its side) or a backwards yaw both correct
// before the box-to-dims rescale, not after. Distinct from PlaceCommand's
// rotationDeg, which is world-space placement of an already-correct model.
const ModelRotation = z.object({ x: z.number(), y: z.number(), z: z.number() }).loose();

// WallOpening.type gained "glass-door" in Phase 2: the seed's full-height
// balcony door is glazed edge-to-edge, and typing it "door" rendered it as
// an opaque leaf (Phase 1 code-review finding). The value is the schema
// discriminant Phase 3 rendering hooks into; Phase 2 only owns the type.
export const OpeningType = z.enum(["door", "glass-door", "window"]);

// improvements-v2.2 §7 (docs/proposals/object-categories.md): a semantic
// category tag. Metadata ONLY — no rules engine, no per-category rendering/
// behavior. Its one job is to let a future feature (§4b lamp point-lights)
// filter items by kind: `items.filter(i => i.category === "lamp")`. Distinct
// from `shape` below, which is a geometry/rendering discriminant, not a
// semantic kind. Eight values, deliberately small — the minimum set that
// covers the real room and makes the §4(b) "is this a light" question
// answerable; add a value only when a real item or real feature needs it.
export const FurnitureCategory = z.enum([
  "seating", // sofa, armchair, swivel chair, stool, bench
  "table", // dining, coffee, side, console
  "storage", // shelving, cabinet, media unit, shoe rack, dresser
  "lamp", // floor lamp, table lamp — the light-EMITTING fixtures §4b consumes
  "rug", // flat floor covering
  "appliance", // powered devices — water cooler, TV, fan
  "decor", // art, plants, vases, cushions, mirrors (near-future; no current item)
  "other", // deliberately-tagged "none of the above" (see the field comment below)
]);
export type FurnitureCategory = z.infer<typeof FurnitureCategory>;

// improvements-minor-fixes §10 (docs/proposals/tint-blend-modes.md): which
// blend formula combines tintColor with the material's base color. Multiply
// is the enum's own implicit default — undefined means "multiply," not "no
// blend," so every existing item with a tintColor and no tintBlendMode keeps
// rendering exactly as it does today. No schema .default("multiply") for the
// same reason category avoids .default("other"): .default() fires at parse
// time and would rewrite every legacy item to *explicitly* carry "multiply,"
// destroying the "never set" vs. "deliberately chose multiply" distinction
// for no benefit — the fallback belongs in the render code
// (furnitureMaterialFor / applyModelTint via src/scene/tintBlend.ts), not the
// schema. Meaningless without tintColor also set; the schema doesn't enforce
// that pairing, same posture as category/shape independence.
//
// All five values are declared here even though the 2026-07-22 build only
// implements "multiply" and "screen" (see docs/proposals/tint-blend-modes.md's
// status note) — overlay/soft-light/darken are deferred to a later round, not
// dropped, and this way that round doesn't need a schema change. Render code
// falls back to "multiply" for any of the three unimplemented values.
export const TintBlendMode = z.enum(["multiply", "screen", "overlay", "soft-light", "darken"]);
export type TintBlendMode = z.infer<typeof TintBlendMode>;

// Minimum gap enforced between an opening's sill and head when both are
// given. Without this, buildScene.ts's leafTop = max(sill, head - 2) can
// collapse to exactly `sill`, silently dropping the door leaf (code review
// finding) — better to reject the invalid data at the load boundary than
// have it render as a degenerate hole in the wall.
const MIN_SILL_HEAD_GAP_CM = 10;

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
  .loose() // carry provenance notes (e.g. `note`) through untouched
  .refine(
    (o) =>
      o.sillHeightCm === undefined ||
      o.headHeightCm === undefined ||
      o.headHeightCm - o.sillHeightCm >= MIN_SILL_HEAD_GAP_CM,
    { message: `headHeightCm must be at least ${MIN_SILL_HEAD_GAP_CM}cm above sillHeightCm` },
  );

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

// Real-time lighting controls (improvements-v2.2 §4a): exposes buildScene.ts's
// previously-hardcoded DirectionalLight ("sun") + HemisphereLight params as
// scene data. Distance-from-target is deliberately NOT a field — only angle
// (azimuth/elevation) and intensity are in scope per the improvements doc —
// so the sun orbits its fixed target at a fixed radius; buildScene.ts derives
// both from the original hardcoded position/target below and reconstructs
// `sun.position` from azimuth/elevation/radius at render time.
//
// Math (reproducing today's exact hardcoded look, so a saved file without
// `room.lighting` — or a user who hasn't touched the sliders — renders
// pixel-identical to before this feature existed):
//   sun.position = (60, 330, 420), sun.target.position = (820, 0, 560)
//   vector (position - target) = (60-820, 330-0, 420-560) = (-760, 330, -140)
//   radius (SUN_DISTANCE_CM)   = |vector| = sqrt(760^2 + 330^2 + 140^2) ≈ 840.30cm
//   elevation                 = asin(vector.y / radius)          -- angle above horizontal
//   azimuth                   = atan2(vector.x, vector.z)        -- horizontal angle, 0deg = +Z, 90deg = +X
// The constants below compute this via actual Math calls (not rounded
// decimal literals) so the round-trip through buildScene's inverse
// (position = target + radius * (sin(az)cos(el), sin(el), cos(az)cos(el)))
// reproduces the original vector to floating-point precision.
const SUN_REFERENCE_VECTOR = { x: 60 - 820, y: 330 - 0, z: 420 - 560 };
export const SUN_DISTANCE_CM = Math.hypot(
  SUN_REFERENCE_VECTOR.x,
  SUN_REFERENCE_VECTOR.y,
  SUN_REFERENCE_VECTOR.z,
);
const DEFAULT_SUN_ELEVATION_DEG =
  (Math.asin(SUN_REFERENCE_VECTOR.y / SUN_DISTANCE_CM) * 180) / Math.PI;
const DEFAULT_SUN_AZIMUTH_DEG =
  (Math.atan2(SUN_REFERENCE_VECTOR.x, SUN_REFERENCE_VECTOR.z) * 180) / Math.PI;
const DEFAULT_SUN_INTENSITY = 2.6;
const DEFAULT_HEMISPHERE_INTENSITY = 1.05;

export const LightingSchema = z
  .object({
    sunIntensity: z.number().default(DEFAULT_SUN_INTENSITY),
    sunAzimuthDeg: z.number().default(DEFAULT_SUN_AZIMUTH_DEG),
    sunElevationDeg: z.number().default(DEFAULT_SUN_ELEVATION_DEG),
    hemisphereIntensity: z.number().default(DEFAULT_HEMISPHERE_INTENSITY),
  })
  .loose();

export const RoomSchema = z.object({
  ceilingHeightCm: z.number(),
  floor: z.array(FloorRect),
  walls: z.array(WallDefSchema),
  shell: ShellCalibrationSchema.optional(),
  lighting: LightingSchema.optional(),
});

/** No-op calibration — used when a surface has no entry in `room.shell` yet. */
export const DEFAULT_SURFACE_CALIBRATION: SurfaceCalibration = {
  tint: "#ffffff",
  repeat: [1, 1],
  roughnessScale: 1,
};

/** No-op lighting — used when `room.lighting` is absent (old saved files, or
 *  a user who hasn't touched the sliders yet). Reproduces buildScene.ts's
 *  original hardcoded sun/hemisphere exactly — see the derivation above. */
export const DEFAULT_LIGHTING: Lighting = {
  sunIntensity: DEFAULT_SUN_INTENSITY,
  sunAzimuthDeg: DEFAULT_SUN_AZIMUTH_DEG,
  sunElevationDeg: DEFAULT_SUN_ELEVATION_DEG,
  hemisphereIntensity: DEFAULT_HEMISPHERE_INTENSITY,
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
    // v2 spike D4 (W-B, rug fix ladder lever 2 — see spike-v2/OUTCOME.md):
    // a photo-derived flat texture, for a box item rendered as a textured
    // plane/box instead of a generated GLB. Deliberately restricted to
    // BoxFurniture, not CompoundSofaFurniture — the only candidate (the
    // SONDEROD rug) is a plain box, and a flat texture over a compound
    // multi-part footprint has no obvious single "top face" to map it onto.
    // Mutually exclusive with glbHash in practice (buildScene prefers
    // glbHash when both are set), but the schema doesn't enforce that —
    // an item simply never has both populated by any code path here.
    flatTextureHash: z.string().optional(),
    modelRotationDeg: ModelRotation.optional(),
    notes: z.string().optional(),
    purchaseInfo: z.string().optional(),
    // improvements-v2.1 §4: per-item placement lock. A scene fact (persists
    // with the item, round-trips through save/export), distinct from the
    // ephemeral "lock all" HUD toggle Viewport/ViewportChrome carry in plain
    // React state — that one is view-only safety and deliberately never
    // touches SceneFile. Optional/defaults-to-unlocked so every existing
    // seed/saved file still validates unchanged. Declared on both union
    // branches explicitly (not left to `.loose()`'s passthrough) so
    // `z.infer` actually types it on FurnitureItem instead of leaving it
    // reachable only via an `any`-typed loose access.
    locked: z.boolean().optional(),
    // improvements-v2.2 §5: per-item color tint, extending the shell-surface
    // tint pattern (SurfaceCalibrationSchema.tint above) to furniture.
    // Undefined means "no tint, render at the material's natural color" —
    // distinct from an explicit "#ffffff" (a no-op multiplicatively, but a
    // set value). Declared on both union branches for the same reason as
    // `locked` just above: so z.infer types it directly instead of leaving
    // it reachable only through `.loose()`'s any-typed passthrough.
    tintColor: z.string().optional(),
    // See TintBlendMode's comment above — same field, same rationale.
    tintBlendMode: TintBlendMode.optional(),
    // improvements-v2.2 §7 (docs/proposals/object-categories.md): a semantic
    // category tag. Optional + no default so every existing seed/saved file
    // validates unchanged (field absent → undefined → "uncategorized"), same
    // backward-compat reasoning as `locked`/`tintColor` above. Declared on
    // both union branches explicitly (not via `.loose()`) so `z.infer` types
    // it on FurnitureItem instead of leaving it reachable only through an
    // untyped loose access — the `locked` precedent. `undefined` means
    // "never categorized"; the `"other"` enum member is a deliberate "none
    // of the above" choice — the two are not the same and a schema
    // `.default()` would collapse that distinction on load, so there isn't
    // one here.
    category: FurnitureCategory.optional(),
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
    modelRotationDeg: ModelRotation.optional(),
    notes: z.string().optional(),
    purchaseInfo: z.string().optional(),
    // See BoxFurniture's `locked` comment — same field, same rationale.
    locked: z.boolean().optional(),
    // See BoxFurniture's `tintColor` comment — same field, same rationale.
    tintColor: z.string().optional(),
    // See TintBlendMode's comment above — same field, same rationale.
    tintBlendMode: TintBlendMode.optional(),
    // See BoxFurniture's `category` comment — same field, same rationale.
    category: FurnitureCategory.optional(),
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
export type ModelRotation = z.infer<typeof ModelRotation>;
export type WallOpening = z.infer<typeof WallOpeningSchema>;
export type WallDef = z.infer<typeof WallDefSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type SurfaceCalibration = z.infer<typeof SurfaceCalibrationSchema>;
export type ShellCalibration = z.infer<typeof ShellCalibrationSchema>;
export type Lighting = z.infer<typeof LightingSchema>;
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
