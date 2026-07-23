# PoC 3 Plan — Whole-Room Similarity (image-to-3D imports + photo textures)

Successor to `poc2-plan.md`. That spike ended **GO-WITH-REFRAME**
(`spike/OUTCOME-2.md`, 2026-07-17): the real-time PBR pipeline passed Tier 1 on
layout/proportion and brightness/mood, with color/material fidelity the one
sub-criterion that didn't clear "without caveats" — and the identified fix was
*real photo-derived textures per material, not a better renderer*.

This plan deliberately **revisits the reframe**. The reframe ("decide layouts and
colorways confidently," not "visualize realistically") was the right call given the
levers spent at the time. Two identified levers were left unspent: photo textures on
the room shell, and image-to-3D generation for furniture (researched in
`spike/research/image-to-3d-import.md`; Shyam has since manually tested Meshy 6 on
fal.ai with reasonable results on furniture from single images). Spike 3 spends both
and asks the question that decides whether this project gets any further investment:

**With photo-derived appearance everywhere it matters — generated furniture meshes
whose textures come from real product photos, and a room shell textured from photos
of the actual surfaces — does the rendered room clear whole-room visual similarity?**

This is a scoping + delegation plan. Nothing here is implemented yet.

## 1. Framing corrections (recorded so the spike tests the right thing)

Three corrections to the informal pitch ("use Meshy to render the objects instead of
path tracing"), agreed before planning:

1. **Meshy does not render anything.** It generates meshes with photo-derived
   textures. Rendering stays with the scene2 pipeline; final-image similarity is
   geometry × textures × lighting, and Meshy improves the first two *for furniture
   only*. If the spike only imported furniture, the shell (walls/floor/ceiling —
   dominant in most views) would keep procedural textures and could sink the verdict
   for reasons unrelated to Meshy. Hence the second workstream (§4, W-B).
2. **Path tracing is not being replaced — it was never the gap.** C3 used the D6
   path-traced stills precisely to prove the renderer wasn't the bottleneck. It
   remains a de-risked stretch option for a final decision-grade still (§4, D7).
3. **This spike re-raises a bar the project already lowered — on purpose.** A no-go
   here does not undo OUTCOME-2's go-with-reframe; it caps the product at the
   reframed pitch. The outcomes in §2 are written accordingly.

## 2. The decision bar (set now, before any generation)

Judged on the same two views as spikes 1–2 (couch + reverse), **side-by-side against
reference photos of the real room** — this time mandatory, no judging from memory
(spike 2's C2 deviation is not repeated; the reference photos are a §5 blocking
input).

- **Gate (per-object, checkpoint C1):** each generated mesh, dropped into scene2
  under its lighting and rescaled to known cm dimensions, must (a) read as *that
  specific item* — silhouette, voids, category, color — from the standard views
  **and from at least one angle that sees the generated back**, and (b) not regress
  anything spike 2 passed (proportion, floor contact, scale against neighbors).
- **Bar (whole-room, checkpoint C2):** looking at render vs. reference photo
  side-by-side, does Shyam say "that's my room"? Concretely: the color/material
  sub-criterion that C2-of-spike-2 scored "not quite there yet" now passes without
  caveats he has to talk himself out of, at room level — while layout/proportion and
  brightness/mood hold their existing passes.

**Go** = whole-room bar passes → the project graduates from spike to product build,
with the v1 architecture set by this result: photo → generate (Meshy) → confirm cm →
rescale + floor-snap → cached local GLB for furniture; photo-calibrated textures for
the shell; authored primitives as the fallback path.
**Qualified go** = objects pass the gate but the room bar falls short only on
identifiable, addressable residue (e.g. shell texture calibration, or the
mixed-fidelity issue §4's F1 escalation addresses) → spend the named fix, re-judge
once, then record whichever branch results. One iteration, not a loop.
**No-go** = objects fail the gate in scene2 lighting, or the room bar fails for
reasons no identified lever addresses → the product stays capped at the OUTCOME-2
reframe, and the decision on whether *that* product is worth building is made on the
reframe's own merits, explicitly, in OUTCOME-3.

As before: if borderline, one outside reaction (Supritha) before recording.

## 3. Known risks (from the research memo + critique, so they're tested, not discovered)

- **Viewer flattery.** Meshy/fal preview viewers light meshes with their own studio
  environment. Shyam's manual results are encouraging but not evidence; nothing
  counts until the GLB renders inside scene2's sun + IBL. The C1 gate exists for
  this.
- **Baked-in lighting.** Photo-derived albedo can carry the source photo's shadows
  and highlights, which then fight the scene sun. Mitigation: prefer flat-lit
  catalog shots as input where they exist (per §5 input plan); judge under both the
  couch and reverse sun angles.
- **Hallucinated backs / fused thin members.** Single-view generation invents unseen
  geometry and can fuse chair legs. The C1 back-view requirement targets this.
  Hunyuan multi-view is the named escalation if one item fails only on its back —
  not integrated by default (§6).
- **Per-axis rescale distortion.** Forcing the GLB bounding box to known cm can
  skew proportions when the generation is off. Memo judged this inside Tier 1
  tolerance at room distance; C1 verifies rather than assumes.
- **Mixed-fidelity jar.** Three generated items beside ~12 authored primitives may
  make the room read as inconsistent even if each piece passes alone. Handled by the
  F1 fill-in escalation (§4), gated on C1 so the extra ~$10 is only spent on a
  pipeline already known to work.

## 4. Workstreams and delegation map

Two independent workstreams (different files/assets — genuinely parallel, unlike
spike 2's single-file constraint), converging at C2.

**W-A — Furniture imports (fal.ai, Meshy 6).** The 3 items with the worst
authored-primitive cost/benefit, per the research memo: **Cozy pod swivel chair,
STÄLL shoe cabinet, pine bookshelf.** Endpoint `fal-ai/meshy/v6/image-to-3d`, smart
topology ~15k, PBR on, `auto_size: true`, `origin_at: bottom`; reuse the
`fal_client.subscribe` pattern from `spike/generate.py`, FAL_KEY passed inline per
run as in spike 1. Each GLB: inspect (`npx @gltf-transform/cli inspect` —
polycount/textures/bounds), rescale to the known cm dims, floor-snap, insert into
scene2 beside (then replacing) the authored version.

**W-B — Shell photo textures.** Texture walls/floor/ceiling from photos of the
actual surfaces: use Shyam's surface photos to *select and calibrate* CC0 sets
(Poly Haven / ambientCG — reachable from this network, unlike the spike-2 sandbox),
or make tileable textures directly from his photos where a straight-on shot allows.
Calibrate base color under the scene's lighting against the reference photos, not
against the swatch. Rug and sofa fabric may get the same treatment if cheap; all
other furniture keeps its spike-2 procedural materials (they passed category-level).

| # | Task | Agent type | Runs | Inputs | Output / done criteria |
|---|---|---|---|---|---|
| D1 | W-A: fal Meshy 6 script + generate 3 items, inspect, rescale, floor-snap, insert into scene2 | general-purpose (build) | first, parallel with D2 | item images (§5), cm dims from geometry.json/furniture-notes.md, FAL_KEY | 3 GLBs in-repo + scene2 renders: standard views + one back-view per item |
| D2 | W-B: shell textures from Shyam's surface photos + CC0 calibration | general-purpose (build) | parallel with D1 | surface photos, reference photos | scene2 with photo-textured shell + both-view renders |
| C1 | **Object gate (Shyam):** each generated item vs. §2 gate, in scene2 lighting incl. back views, beside its authored version | human | after D1 | D1 contact sheet | pass/fail per item; fail on backs only → note Hunyuan escalation; fail broadly → no-go path |
| F1 | *Contingent fill-in:* generate remaining furniture (~12 items, ~$10) if C1 passed and mixed fidelity is expected to jar at C2 | general-purpose (build) | after C1, only if invoked | D1's script | fully-generated room |
| D6 | Merge W-A + W-B, final contact sheet: render vs. reference photo side-by-side, both views | general-purpose (build) | after C1 + D2 | scene2, reference photos | `out3/contact-sheet.html` |
| C2 | **Whole-room judgment (Shyam):** §2 bar | human | after D6 | contact sheet | go / qualified go / no-go per §2 |
| D7 | *Stretch:* one path-traced decision-grade still of the winning view (pipeline already de-risked, ~10 min/still) | general-purpose (build) | after C2, only if go/qualified | pathtrace-run.mjs | 1–2 stills appended to OUTCOME-3 |
| C3 | **Record (Shyam):** OUTCOME-3 written, product decision explicit either way | human | last | everything | decision written down |

## 5. Inputs needed from Shyam

1. **Item images for the 3 W-A items** — product-listing/catalog shots where
   findable (preferred: flat lighting generates cleaner); his own photos for any
   item without a findable listing. One image per item; a second angle only if the
   first generation's back fails C1.
2. **Surface photos**: wall paint, floor, ceiling — as straight-on and evenly lit as
   practical. Needed at D2 kickoff.
3. **Reference photos of the room for both camera views** — **blocking for C2**;
   the spike-2 practice of judging from memory is explicitly not acceptable here,
   since whole-room similarity is the entire question.
4. **FAL_KEY** passed inline at D1/F1 run time (never committed), as in spike 1.
5. At C1/C2/C3: judgment against the §2 bar, set before looking at results.

## 6. Explicitly out of scope

- **No Meshy-direct integration.** Shyam's tests found direct output slightly better
  than fal's, but not by much; fal reuses the existing client pattern and key flow.
  Revisit only if C1 failures look like texturing-quality failures specifically.
- **No Hunyuan multi-view by default.** It is the named escalation for a back-view
  failure on an owned item, nothing more.
- **No import UI or app flow** — everything scripted. The v1 import flow is what a
  go *unlocks*, not what this spike builds.
- **No new renderer work.** scene2's pipeline is frozen except for texture/material
  hookup; path tracing only as the D7 stretch still.
- **No room-shell generation.** The shell stays hand-authored geometry with photo
  textures; image-to-3D is for discrete furniture only.
- No floor-plan editor, schema, database, or catalog-sourcing work (unchanged).

## 7. Cost and record-keeping

- **~$3–5**: 3 items × $0.80 + retries. **+~$10 contingent** (F1 fill-in, only after
  C1 passes). Everything else renders locally at zero API cost.
- Deliverable: `spike/OUTCOME-3.md` in the established format — what ran, what held,
  what drifted, decision + product implication. Per §2, a no-go must still state the
  explicit verdict on whether the reframed (OUTCOME-2) product proceeds, so the
  "final test" actually ends in a decision either way.
