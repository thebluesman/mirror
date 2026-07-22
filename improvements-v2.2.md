# improvements-v2.2 — Room/Scene/Objects

Second thought-grouping in the post-v2 hardening series (see `improvements-v2.1.md`
for the first — UI/polish). This batch is scene/object behavior: bigger, more
speculative items that need research and proposals back from realladygrey
before any of them get built, not straight-to-implementation fixes. Where a
decision was still open, Shyam and Claude discussed it first; the resolved
scope is recorded per item below.

## 1. Rug texture import failure

Shyam can't currently import the rug texture image. Note: `flatItemTexture.ts`
/ `Viewport.tsx:429` (`computeFlatTextureFit`) already contains a fix for a
related historical bug — a square-pixel source photo (SONDEROD rug) reporting
1:1 `bitmap.width/height` regardless of true orientation, causing wrong-axis
texture mapping (see `spike-v2/OUTCOME.md`, `spike-v2/d4-rug-drive.mjs`). If
Shyam is still hitting a failure, it's either a regression in that fix or a
different bug entirely — **do not assume it's the same issue**.

First step: get a repro from Shyam (which image, which step fails, exact
error vs. a wrong-looking result) before diagnosing further.

## 2. Camera containment within room shell

No position/distance bound exists today — `Viewport.tsx` only clamps orbit's
vertical polar angle (`MIN_POLAR_ANGLE`/`MAX_POLAR_ANGLE`, lines 111–117, to
stop orbiting under the floor or over the ceiling). Zoom/pan/position are
otherwise unbounded, so the camera can currently push straight through walls.

**Resolved scope:** soft clamp, not hard. Camera position should be allowed
to push slightly past the room-shell bounds (e.g. for a wider framing shot)
but snap/ease back if pushed too far — not a rigid wall the camera can never
cross. Room dimensions are already available from the room schema
(`RoomSchema`, `src/schema/scene.ts`), so bounds can be derived from that
rather than hardcoded.

## 3. Multi-joint / multi-configuration objects (e.g. floor lamp)

No articulation concept exists anywhere in the current schema. `shape` in
`FurnitureItemSchema` (`src/schema/scene.ts:133–177`) is only a rendering
discriminator (`box` / `compound-sofa`), not a semantic or structural
concept, and there is no joint/pivot data at all. Building general rigging
(continuous joints, arbitrary axes, unbounded configurations) is a
sub-project on its own, not a quick add.

**Resolved scope:** research-and-propose, not spec'd-for-build. Scope any
proposal down to discrete named pivots per object with a fixed set of
allowed rotation states (e.g. a joint that snaps to 0°/90°/180°/270°),
rather than continuous/free rigging. Bring back a concrete schema + UI
proposal (how a joint is defined, how a user selects and cycles it) rather
than committing to a specific design up front.

## 4. Real-time lighting controls

Scene lighting today is fixed: one `THREE.DirectionalLight` (intensity 2.6,
shadow-casting) plus one `THREE.HemisphereLight` (intensity 1.05) —
`src/scene/buildScene.ts:398–417`. No HDRI/environment map, no per-object
light emission of any kind.

**Resolved scope, split in two:**
- **(a) In scope for this batch:** expose the existing global lights as
  real-time UI controls — sun intensity/angle, ambient (hemisphere) level.
  This is exposing existing renderer params, not new lighting infrastructure.
  UI location: Settings panel, or a new lighting/environment tab — leave the
  specific placement to realladygrey's proposal.
- **(b) Explicitly out of scope for this batch:** lamps/fixtures emitting
  real light (point/spot lights tied to object instances). This depends on
  the object-type tagging in §8 existing first, and should be scoped
  separately once that lands.

## 5. Expose texture/material color for editing

Room-shell surfaces already have a tint/repeat/rotation concept
(`src/scene/shellMaterials.ts`, calibrated per-surface in
`src/scene/defaultShellTextures.json`). Full image editing or texture
replacement is a much bigger feature than what Shyam is actually asking for.

**Resolved scope:** extend the existing tint pattern to per-object materials
— a color/tint adjustment, not image upload or paint-style editing. Full
texture-image replacement is explicitly out of scope for this batch.

## 6. Object edit flow: import preview, size/rotation edit, rename

Three related asks (preview before confirming import, editing size/rotation
after the fact, editing general properties like name) that resolve to one
feature, built as **one shared edit component reused in two contexts**:

- **Pre-confirm (new):** `ImportPanel.tsx`'s `confirm-dims` stage (~lines
  360–423) currently applies W/D/H and 90°-step rotation correction blind —
  plain number inputs and dropdowns, no 3D preview at all (confirmed: no
  `<canvas>`, no THREE/GLTFLoader usage anywhere in the file). Add a live 3D
  preview here: the object rendered in isolation (its own small orbit-able
  viewport), not dropped into the actual room, since room placement isn't
  finalized at this stage. Editing the fields updates the preview mesh live.
  High priority — real money is spent per generation and there's currently
  no way to fix a bad import after confirming.
- **Post-import (new):** for an already-placed object, the same edit fields
  (W/D/H, rotation, **name**) appear docked/floating in the actual room
  viewport and live-update the real mesh transform in place. `name` already
  exists as a schema field (`FurnitureItemSchema`) but there's currently no
  UI to change it after import — add one alongside the others.

Building two separate UIs for what's functionally the same field set would
be wasted effort — one editor component, two mounting contexts.

## 7. Object types (tag only, no behavior)

No type/category concept exists today — only `shape`
(`box`/`compound-sofa`), which is a geometry/rendering discriminator, not a
semantic category (lamp, chair, wall fixture, rug, decor).

**Resolved scope:** add a lightweight `category` field as metadata only — no
rules engine, no per-type behavior, no wall-fixture-specific logic. Its only
job right now is to unblock future work (e.g. §4(b)'s lamp lighting) without
committing to a full behavior/rules system prematurely. Do not build
type-specific behavior as part of this batch.

## 8. Camera snapshot / share feature

Take a snapshot from the current camera POV and download it as an image.
Renderer is `THREE.WebGLRenderer` (`Viewport.tsx:352`) — one concrete
gotcha: `preserveDrawingBuffer` is not currently set in the constructor
options, which by default can make `canvas.toDataURL()` return a blank
image unless either that flag is set or the snapshot is captured
immediately after a render call. Flag this explicitly so it isn't
discovered the hard way.

## Sequencing note

§1 (rug bug) needs a repro from Shyam before any diagnosis starts — flag
this back rather than guessing at root cause. §3 (multi-joint) and §7
(object types) are research-and-propose items, not spec'd builds — bring
back concrete proposals rather than a single fixed design. §4(b) is blocked
on §7 landing first. §2, §5, §6, §8 are otherwise independent of each other
and can be scoped/estimated in parallel.
