# Proposal: multi-joint / multi-configuration objects

**Status:** proposal (research-and-propose per `improvements-v2.2.md` §3 — not
spec'd-for-build)
**Date:** 2026-07-22
**Scope resolved upstream:** discrete named pivots per object, fixed set of
allowed rotation states (snap, not free rigging). This document brings back a
concrete schema + UI; it does not commit to a build.

Grounding example throughout: a **floor lamp** — a fixed base, an arm/head that
hinges at one point and snaps to a few angles (pointed up / forward / down). One
object, one joint, three states. Everything below is sized to that, not to a
general rigging system.

## 1. The hard constraint, stated first

A joint moves *part of* an object independently of the rest. That requires the
object's geometry to be **separable** — a "base" sub-tree that stays put and a
"head" sub-tree that rotates about the pivot.

**A Hunyuan3D generation cannot provide this.** Per ADR-0002 the only generator
is `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, and it emits **one rigid mesh per
source photo** (`model_glb.url` → a single GLB the fit pipeline treats as one
bounding box — `fitModelToDims` in `loadFurnitureModel.ts` scales/floor-snaps/
recenters the *whole* object against one `Box3`). There is no addressable
"shade" node to move; the arm and base are fused triangles. Rotating anything
about a pivot inside that mesh rotates the entire lamp, base included — useless.

So a jointed object is **not a generated item**. This is not a limitation to
engineer around at load time; it is inherent to single-photo → single-mesh
generation. The honest framing:

> A jointed item is a **manually-authored compound object**, exactly like
> `compound-sofa` today is a bespoke primitive assembly (`furnitureFootprint` /
> `addFurnitureBoxMeshes` build it from box meshes, it is never GLB-derived).
> `compound-sofa` is the precedent this feature extends, not the GLB path.

Two ways to author the separable geometry, in increasing cost:

- **(A) Primitive parts — recommended for v-next.** Base = a box/cylinder, arm =
  a box, head = a box/cylinder, positioned in a small parent-child tree. Blocky,
  placeholder-grade — same fidelity as the compound-sofa box render today. Cheap,
  fully in-engine, no asset surgery.
- **(B) Per-part GLBs — deferred.** Each part is its own generated-or-modelled
  GLB (shade generated separately from base), each fit by its own `fitModelToDims`
  call, assembled into the same part tree. Better looking, but requires either
  photographing/generating parts in isolation or manual mesh-splitting in Blender
  — a content-pipeline problem, not a schema one. The schema below allows it
  (`part.glbHash`) but the build work is out of scope for this proposal.

Option (C) — a single generated GLB with a joint that rotates the whole thing —
is listed only to reject it: it cannot move a sub-part, so it does not solve the
problem.

## 2. Schema

Additive and optional, so — like `room.shell` and `locked` before it — **no
`SCHEMA_VERSION` bump** is required: existing seeds/saved files carry neither the
new `shape` value nor `joints`, and validate unchanged. `migrate()` is untouched.

Coordinate convention for pivot/axis/offsets — **item local space**, matching
what `fitModelToDims` establishes for a placed item: cm; **X/Z centered on the
footprint** (bbox center → 0,0), **Y = 0 at the floor, +Y up**. The item's
world placement (`PlaceCommand.position`/`rotationDeg`) and yaw live on the
outer `THREE.Group` (`addFurniture`), so a joint never reasons about world
coordinates — only about the object's own frame. Rotation sign is the
right-hand rule about `axis` (THREE default), so authoring is predictable.

### 2.1 Shared sub-schemas

```ts
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

// A discrete pivot. Moves exactly one part sub-tree about one axis, snapping
// to one of a fixed list of angles. No continuous range, no multi-axis.
const JointSchema = z
  .object({
    id: z.string(),
    name: z.string(),                       // human label, e.g. "shade arm"
    movesPartId: z.string(),                // which PartSchema sub-tree rotates
    pivotCm: Vec3,                           // pivot point, item local space (cm)
    axis: Vec3,                              // unit rotation axis, item local space
    statesDeg: z.array(z.number()).min(2),   // allowed angles about `axis`
    activeState: z.number().int().nonnegative().default(0), // index into statesDeg
  })
  .loose()
  .refine((j) => j.activeState < j.statesDeg.length, {
    message: "joint.activeState out of range for statesDeg",
  });

// One rigid piece of an authored jointed object. Parts form a tree via
// `parent`; the root part(s) attach to the item group, a moved part attaches
// under its joint's pivot group at build time (see §3).
const PartSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    parent: z.string().nullable(),          // parent part id; null = attaches to item root
    offsetCm: Vec3,                          // position relative to parent origin
    // Geometry: a primitive (option A) OR a per-part GLB (option B, deferred).
    primitive: z.enum(["box", "cylinder"]).optional(),
    dimsCm: Dims.optional(),                 // box: w/d/h; cylinder: w=d=diameter, h=length
    glbHash: z.string().optional(),          // option B — a part's own generated/authored GLB
  })
  .loose();
```

### 2.2 New furniture branch

Joints only mean something when there is separable geometry to move, so
`joints`/`parts` live on a **new `shape: "jointed"` branch** rather than being
sprinkled onto `BoxFurniture`/`CompoundSofaFurniture` (a `joints` array on a
single-GLB box would have nothing to move — declaring it there would be a lie the
type system tells). This is the deliberate divergence from the `locked`
precedent: `locked` applies to every item so it went on both branches; a joint
applies to no single-mesh item so it goes on neither existing branch.

```ts
const JointedFurniture = z
  .object({
    id: z.string(),
    name: z.string(),
    shape: z.literal("jointed"),
    parts: z.array(PartSchema).min(1),
    joints: z.array(JointSchema),           // may be empty during authoring
    dimsCm: Dims.optional(),                 // overall bounds for footprint/collision (see §3)
    elevationCm: z.number().optional(),
    modelRotationDeg: ModelRotation.optional(),
    notes: z.string().optional(),
    purchaseInfo: z.string().optional(),
    locked: z.boolean().optional(),          // same field/rationale as the other branches
  })
  .loose();

// Discriminator order: most-specific literals first, Box (optional shape) last.
export const FurnitureItemSchema = z.union([
  CompoundSofaFurniture, // shape: "compound-sofa"
  JointedFurniture,      // shape: "jointed"
  BoxFurniture,          // shape: "box" | undefined  (catch-all, stays last)
]);
```

A jointed item matches `JointedFurniture` on its required `shape: "jointed"`;
nothing else claims that literal, and box items still can only fall through to
`BoxFurniture`. Old files (no `"jointed"` anywhere) are unaffected.

### 2.3 Worked example — the floor lamp

```jsonc
{
  "id": "floor-lamp-arc",
  "name": "Arc floor lamp",
  "shape": "jointed",
  "dimsCm": { "w": 30, "d": 30, "h": 160 },
  "parts": [
    { "id": "base",  "name": "base",  "parent": null,   "offsetCm": [0, 0, 0],
      "primitive": "cylinder", "dimsCm": { "w": 28, "d": 28, "h": 4 } },
    { "id": "stem",  "name": "stem",  "parent": "base",  "offsetCm": [0, 4, 0],
      "primitive": "cylinder", "dimsCm": { "w": 4, "d": 4, "h": 140 } },
    { "id": "head",  "name": "head",  "parent": "stem",  "offsetCm": [0, 140, 0],
      "primitive": "box", "dimsCm": { "w": 22, "d": 22, "h": 18 } }
  ],
  "joints": [
    {
      "id": "head-hinge",
      "name": "head tilt",
      "movesPartId": "head",
      "pivotCm": [0, 144, 0],   // top of the stem, local space
      "axis": [1, 0, 0],        // tilt about the local X axis
      "statesDeg": [-90, 0, 90], // down / forward / up
      "activeState": 1
    }
  ]
}
```

## 3. Build / render interaction

`buildScene`'s `addFurniture` gains a `shape === "jointed"` branch alongside the
existing GLB / flat-texture / box-placeholder branches. It builds the part tree
as nested `THREE.Group`s (option A: `BoxGeometry`/`CylinderGeometry` per part;
option B: a per-part `pendingModels`-style async GLB load into the part group).
For each joint:

1. Create a **pivot group** positioned at `joint.pivotCm`.
2. Reparent `movesPartId`'s group under the pivot group (child offset adjusted so
   the part keeps its authored world-local position).
3. Set the pivot group's rotation = `axis * statesDeg[activeState]` (a
   quaternion-from-axis-angle, applied once — it is a snap, not an animation).

This reuses the established **async-after-build** pattern only for option-B
per-part GLBs; the primitive path (option A) is fully synchronous like the
existing box placeholder.

`furnitureOverallDims` / `furnitureFootprint` for a jointed item derive from
`dimsCm` (authored overall bounds) — **the footprint is the object's static
envelope and does not change when a joint moves.** A lamp head swung to
"forward" that physically pokes past `dimsCm` is not reflected in collision
AABBs (`src/scene/collision.ts`). That is an accepted limitation, restated in §5.

`fitModelToDims` is **not** involved in option A at all (no GLB). In option B it
runs once per part GLB against that part's own `dimsCm`, exactly as it runs today
for a whole item — the function needs no change; it is called at a finer
granularity.

## 4. UI

Two distinct interactions: **define** a joint (authoring, rare) and **cycle** a
joint's state (viewing, frequent).

### 4.1 Cycle a joint's state (view time) — reuse the existing idiom

Model this on the existing selected-item keyboard-step controls in `Viewport.tsx`
(`ROTATE_STEP_DEG` q/e, `ELEVATION_STEP_CM` PageUp/PageDown, and the `l`
lock-toggle), which are the repo's settled idiom for "a discrete gesture that
steps a transform and commits once." A joint cycle is an even more natural fit
than those: it is *already* discrete state, so there is no snapping to reason
about.

- With a jointed item selected, a key — proposed `j` — **cycles the active
  joint's `activeState` to the next index** (wrapping), mutating the live pivot
  group's rotation in place (the same mutate-during-gesture seam
  `furnitureGroups` exists for), then committing.
- For the common one-joint object (the lamp) that is the whole interaction. For
  a rare multi-joint object, `Shift+j` cycles *which* joint is active; a small
  HUD label ("head tilt: forward") shows the current joint + state. No new
  gizmo geometry required.
- **Commit path:** joint state is *item data*, not placement data, so it does not
  go through `onCommitPlacementRef` (position/rotationDeg). It needs a sibling
  callback — proposed `onSetJointState(itemId, jointId, stateIndex)` — mirroring
  exactly how `onToggleLockRef` edits item data through `App.tsx`'s commit rather
  than mutating placement. Round-trips through save/export like any other item
  field.

A per-joint button/dropdown in a HUD panel is a viable alternative to the
keyboard cycle, but reusing the keyboard idiom keeps this consistent with rotate/
elevation/lock and avoids inventing a parallel control surface. Recommend
keyboard-cycle as primary; a dropdown can be added later if multi-joint objects
ever proliferate (they are not expected to — see §6).

### 4.2 Define a joint (authoring) — hook into §6's edit panel, don't build a gizmo

`improvements-v2.2.md` §6 builds a shared post-import edit component (W/D/H,
rotation, rename) mounted both pre-confirm and post-import. A **"Joints" section
in that post-import panel** is the natural home: it lists an item's joints, lets
the user rename them, edit `statesDeg`, and pick the default `activeState`.

**What that panel should NOT try to be:** a visual pivot-picker (drag a gizmo to
place `pivotCm`, orbit to set `axis`). That is a genuine sub-project — a 3D
manipulator with its own raycast/state — and is explicitly out of scope. For the
near-term single object, **pivot/axis/parts are hand-authored in the seed JSON
(or a preset), not clicked in-app.** The edit panel exposes the *cheap* fields
(names, angle list, default state); geometry authoring stays in the file. If real
demand for in-app joint creation emerges, that is a separate proposal.

This also means: joints are **not** defined during import. Import produces a
single Hunyuan mesh (§1) — a generated item is never jointed. A jointed object is
authored deliberately, outside the generate-from-photo flow.

## 5. Scope boundaries (do not scope-creep without re-deciding)

Explicitly **excluded**, by the resolved scope and the reasoning above:

- **Continuous / free rotation.** States are a fixed enumerated list; the joint
  snaps. No dragging a handle through a range.
- **Large state counts.** A handful (2–6) per joint. The keyboard-cycle UX and
  the "author angles by hand" model both assume small. Not enforced in schema
  (`statesDeg` is `.min(2)` only), but a soft convention.
- **Multi-axis joints.** One `axis` per joint. A ball-joint / two-DOF head is
  modelled, if ever, as two stacked single-axis joints — and the ergonomics of
  that are not being built now.
- **Physics / collision of moved parts.** A swung joint does not update the
  item's collision footprint (§3); parts do not collide with each other, the
  room, or other furniture. The footprint is the static envelope.
- **Interpolation / animation between states.** States snap instantly. No
  tweening, no motion.
- **Joint dependencies / IK.** Joints are independent; no "move A also moves B."
- **Generated jointed meshes.** Hunyuan produces one rigid mesh; a jointed item
  is authored (option A primitives now, option B per-part GLBs later). The
  generator is never asked to produce articulation.

## 6. Open questions for Shyam

1. **Is there a real object to model this for right now?** The whole proposal is
   grounded in a floor lamp — but does one actually exist in the room worth the
   build, or is this speculative? If there is no near-term real object, the
   honest recommendation is to **land the schema shape (cheap, additive, no
   version bump) and defer the build entirely** until an object justifies it.
2. **Fidelity tolerance for the moving object.** Option A renders a jointed lamp
   as blocky primitives (base cylinder + stem + box head), placeholder-grade like
   the compound-sofa box render. Is that acceptable, or does a jointed object
   need to look as good as a generated GLB? Those pull opposite directions —
   good-looking articulation means the per-part GLB content pipeline (option B),
   which is real content work, not just code.
3. **What is the joint *for*?** Purely visual (show the lamp head's angle in the
   twin), or is it a hook for §4(b)'s future lamp light-emission (the head's
   `axis`/state would aim a spotlight)? If the latter, joints should be designed
   in tandem with the object-type/lighting work, not ahead of it — changes
   priority and sequencing.
4. **Authoring appetite.** Is hand-authoring `parts`/`pivotCm`/`axis` in JSON for
   one or two objects acceptable, or is an in-app visual joint editor a hard
   requirement? The former is this proposal; the latter is a much larger,
   separately-scoped sub-project (a 3D pivot-picker gizmo).
5. **Collision expectation.** Is a static footprint (moved parts ignored by
   collision) fine, or does a swung-out arm need to actually block placement?
   Making collision configuration-aware is a meaningful extra and currently
   excluded.

## 7. Recommendation in one line

Land `JointSchema` + a `shape: "jointed"` primitive-parts branch (additive, no
version bump), cycle states via the existing selected-item keyboard idiom with an
`onSetJointState` commit sibling to the lock toggle, define the cheap fields in
§6's edit panel and hand-author geometry in JSON — **but build none of it until
Shyam confirms a real object needs it** (open question 1).
