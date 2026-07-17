# Spike 3 Outcome — Whole-Room Similarity (image-to-3D imports + photo textures)

**Status: CLEAN GO (2026-07-18).** C1 passed on all three items; C2 passed the
whole-room bar without caveats. See "Final decision" below.

Successor to `OUTCOME-2.md` (spike 2, GO-WITH-REFRAME). Plan and decision bar:
`poc3-plan.md`. Question: with photo-derived appearance everywhere it matters —
generated furniture meshes textured from real product photos, and a room shell
textured from photos of the actual surfaces — does the rendered room clear whole-room
visual similarity?

## What was run

- **W-A (furniture imports):** 3 items generated via `fal-ai/meshy/v6/image-to-3d`
  (smart topology ~15k tris, PBR on, `auto_size: true`, `origin_at: bottom`),
  rescaled to known cm dims, floor-snapped, and inserted into `scene2.html`:
  - **Swivel chair** (West Elm Cozy pod, 98×90×76) — input: flat-lit product-listing
    photo.
  - **Shoe cabinet** (IKEA STÄLL, 79×29×148) — input: IKEA product-listing photo.
  - **Bookshelf** (pine, 8-cubby, 72×40×155) — no catalog listing exists for this
    piece; input was one of Shyam's own photos (books-in-shelf, per
    `import/items.json`'s pre-recorded expectation that this would bias texture
    toward "loaded shelf" rather than empty cubbies).
  - Import orientation bug (Meshy's +Z-at-yaw-0 convention vs. the authored
    builders' local convention) found and fixed post-generation (`bca0c2d`) —
    `rotationYDeg` set per item, verified by render (chair opens SE into the room;
    bookshelf/cabinet face into the room, backs to the south wall).
- **W-B (shell textures):** wall/floor/ceiling textured from Shyam's own surface
  photos via `make-tileable.mjs`, calibrated against reference photos (not swatches).
- Contact sheet: `out3/contact-sheet.html` — both required views (couch, reverse),
  generated items beside authored primitives including back-view angles, final
  render vs. reference photos side-by-side.
- F1 (fill-in the remaining ~12 furniture items) was **not run** — mixed-fidelity
  did not end up jarring enough at C2 to warrant it.
- D7 (path-traced decision-grade still) was **not run** — clean go didn't need the
  stretch escalation.

## Checkpoint record

- **C1 (per-object gate):** all three items **pass**, including back-view angles.
  - Swivel chair and shoe cabinet — both generated from real product-listing
    photos — read as "extremely good": silhouette, voids, color, and category all
    correct from the standard views and the back.
  - Bookshelf — generated from Shyam's own (non-catalog) photo — passed but was
    "not the cleanest," "good enough for a spike run." Consistent with the
    plan's own risk note: no flat-lit catalog shot existed for this item, and the
    input photo had books in it (expected to bias the texture, per
    `import/items.json`).
  - No regression vs. spike 2 on proportion, floor-contact, or scale against
    neighbors.
- **C2 (whole-room bar):** **pass**, "clean go" — the color/material sub-criterion
  that spike 2's C2 scored "not quite there yet" now clears at room level without
  caveats Shyam has to talk himself out of. Layout/proportion and brightness/mood
  continue to hold their spike-2 passes.
  - Floor and wall textures "could have been better" but this was a noted, minor
    reservation, not a blocker — attributed to input photo quality rather than the
    pipeline, and not enough to prevent a clean (not qualified) go.

## What held / what drifted

**Held:**
- Photo-derived furniture from real product photos (chair, cabinet) is
  decision-grade on first try — no iteration needed.
- Photo-calibrated shell textures closed the exact gap OUTCOME-2 flagged
  (color/material fidelity) — confirms that memo's identified fix (real photo
  textures, not a better renderer) was the correct lever.
- Whole-room similarity — the bar this spike specifically re-raised over
  OUTCOME-2's reframe — passes without qualification.

**Drifted (accepted, not blocking):**
- Furniture generated from a non-catalog personal photo (bookshelf) is visibly a
  notch below furniture generated from flat-lit product-listing photos. Likely
  input-quality-attributable rather than a pipeline defect — untested whether a
  better-lit personal photo would close the gap, since no catalog shot was
  available to compare against for this item.
- Shell texture quality (floor/wall) has room to improve; also attributed to
  source photo quality, not the calibration approach.

## Final decision (C2, 2026-07-18)

**CLEAN GO on whole-room similarity via photo-derived generation.** The project
graduates from spike to product build. Per §2's architecture-on-go: photo → generate
(Meshy) → confirm cm → rescale + floor-snap → cached local GLB for furniture;
photo-calibrated textures for the shell; authored primitives as the fallback path
(e.g. for items without any usable input photo).

**Implication for the product:** this closes out the three-spike arc
(OUTCOME: NO-GO on AI stills → OUTCOME-2: GO-WITH-REFRAME on real-time PBR →
OUTCOME-3: CLEAN GO on photo-derived whole-room rendering). The visualization
mechanism is validated end-to-end. Open, unspiked question for product scoping:
input photo quality is now the main lever on furniture/shell fidelity (catalog shot
> personal photo, per the bookshelf/shell results here) — worth a product-facing
guideline ("use a straight-on, evenly-lit photo") rather than further pipeline work,
unless a future spike shows otherwise.

## Run commands (reference)

```
FAL_KEY=<key> node spike/run-spike3.mjs      # generate + process + texture + render
node spike/capture.mjs --out spike/out3      # contact-sheet captures
```
