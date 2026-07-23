# PoC 2 Plan — Real-Time Render Pass (post-AI-still pivot)

Successor to `poc-plan.md`. That spike ended **NO-GO on AI-still rendering**
(`spike/OUTCOME.md`, 2026-07-17): depth-conditioned geometry worked (room shell 10/10,
every silhouette given proper geometry read correctly), but the AI appearance layer
could not be trusted for decisions. This plan scopes the follow-up question OUTCOME.md
poses: **what is the best real-time rendered (non-photoreal) visualization we can
reasonably build, and is it good enough to be the product's visualization mechanism?**

This is a scoping + delegation plan. Nothing here is implemented yet.

## 1. What this PoC answers

Spike 1 proved the *geometry* pipeline (Three.js scene from `geometry.json`, cm-true,
correct silhouettes). Spike 2 asks whether the *appearance* layer can move in-house:
take the same scene, replace flat Lambert colors with real materials and lighting, and
see how close "honest real-time rendering" gets to decision-useful.

One assumption from `product-review.md` must be explicitly retired first:
Addendum 2 §8 ranked live-viewport materials/lighting **last** ("most of this effort is
thrown away the moment AI stills exist"). AI stills no longer exist. Materials and
lighting in the live renderer are now the *primary* fidelity mechanism, not a
placeholder — that inverts the §8 ranking and is the reason this PoC is worth running
at all.

## 2. The decision bar (set now, before any renders)

The old bar — "would I buy this rug" photorealism — is what the AI path failed, and an
honest raster renderer will not clear it either. Pretending otherwise sets up a
guaranteed second no-go. The revised bar has two tiers, judged on the same two views
as spike 1 (couch view + reverse view), against Shyam's reference photos side-by-side:

- **Tier 1 — layout/proportion/color decisions (must pass).** Can Shyam look at a
  render and confidently decide things like "the bookshelf works better by the sofa,"
  "a 240×170 rug is the right size," "blue rug vs. beige rug"? This needs correct
  geometry (already proven), plus materials that read as *the right category and
  color* (oak reads as oak, the melange weave reads as dark grey fabric), plus
  lighting that doesn't lie about brightness/mood.
- **Tier 2 — material/texture decisions (stretch, informs product framing).** Can any
  render mode (see rung 4, path-traced stills) get close enough to answer texture-level
  questions? Not expected to fully pass; the point is to measure the gap.

**Go** = Tier 1 passes on both views without caveats Shyam has to talk himself out of.
**Go-with-reframe** = Tier 1 passes but Tier 2 clearly never will → the product pitch
changes from "visualize realistically" to "decide layouts and colorways confidently."
**No-go** = even Tier 1 fails → the visualization mechanism question reopens entirely
(and with both AI stills and real-time rendering falsified, the product idea itself
needs rework).

As in spike 1: if borderline, get one outside reaction (Supritha) before recording.

## 3. Fidelity ladder

Each rung is independently shippable and ends in a **checkpoint**: a contact sheet
(couch + reverse view PNGs, plus the same views from spike 1 run 2 for comparison)
that Shyam judges against the §2 bar. Stop climbing the moment Tier 1 passes — later
rungs exist to measure Tier 2, not to gold-plate.

### Rung 0 — Correct the geometry debt (prerequisite, not fidelity)

- Rebuild the swivel chair as the closed pod OUTCOME.md's review note specifies:
  upholstery to floor over a concealed base, back+arms one continuous ring sloping
  toward the front, total height ~76 cm (current model is an office-chair archetype at
  100 cm — the one silhouette bug spike 1 diagnosed but never fixed).
  **Needs the West Elm Cozy reference images from Shyam** (AptDeco listing photos are
  not in the repo) to verify proportions; the written description suffices to start.
- Give the STÄLL shoe cabinet a real silhouette (slim wall-leaning cabinet, front
  legs only, 79×29×148) instead of a plain box — the other confirmed geometry bug.
- Sanity-check remaining plain boxes (bookshelf, Billy+Högadal, water cooler) against
  the "outline and voids" rule from OUTCOME.md: geometry must be right where it changes
  the outline; interior detail stays prompt-, now material-, recoverable.

### Rung 1 — Physically-based render pipeline (the floor of modern quality)

Fork `spike/scene.html` → `spike/scene2.html` (keep the depth-map spike intact as the
record of spike 1). Upgrade the renderer, not yet the artistry:

- `MeshStandardMaterial`/`MeshPhysicalMaterial` everywhere, sRGB output, ACES filmic
  tone mapping, physically-correct lights.
- Per-item base color/roughness/metalness from `furniture-notes.md` (which was written
  for prompts but is exactly a material spec: oak frame + white drawer fronts, bamboo
  weave doors, charcoal melange, light-greige slightly-reflective porcelain, etc.).
- Soft shadow maps (one sun through the balcony door/window + ambient), an
  environment map for image-based ambient light (Three.js `RoomEnvironment` is free;
  a real HDRI if network access to Poly Haven works from the session).

This rung alone is the biggest single perceived-quality jump per hour and may already
put Tier 1 within reach for color/mood judgments.

### Rung 2 — Texture and detail pass

- Textures where flat color visibly lies: wood grain (oak/pine/pecan), the bamboo
  door weave, rug pile, fabric weave on sofa/chair. Source order: procedural
  (cheap, no assets) → CC0 texture sets (ambientCG/Poly Haven) if reachable →
  hand-rolled canvas textures as fallback.
- Interior detail that materials can now carry on correct masses: bookshelf cubbies
  with book spines (a color-noise texture is enough), TV stand drawer front seams,
  shoe cabinet compartment lines, Frame TV white bezel (finally controllable — this
  was a top prompt-resistant failure in spike 1).
- Decor props only if cheap and load-bearing for "lived-in" feel (spike 1 noted
  renders read empty): tower speakers, a few throw cushions. No prop system.

### Rung 3 — Lighting and camera quality

- SSAO + subtle bloom post-processing; lighting tuned per the reference photos
  (afternoon sun direction through the west glazing).
- If dynamic lighting still looks flat: timebox one day on baked/static AO or
  lightmapping. Do not build a general baking pipeline — this is a spike.
- Camera: keep the two presets, add FOV/height tweaks and 2–3 additional saved
  viewpoints; product-review §8 already noted framing compounds every other fidelity
  investment.

### Rung 4 — Path-traced stills (the Tier 2 experiment)

Same scene, same materials, rendered offline with `three-gpu-pathtracer` (progressive,
seconds-to-minutes per still). This is the structural replacement for what the AI
layer was *supposed* to do — photoreal-leaning stills from a saved camera — with zero
drift by construction: it renders exactly the authored geometry and materials.
Strictly timeboxed (≤1 day): the risk isn't the library, it's that fidelity now
bottlenecks on material-authoring hours, which is exactly the trap product-review
warned about. One good and one bad result are both useful answers here.

## 4. Agent delegation map

Principle: this is a **single-file spike** (`scene2.html` + `geometry.json`) — build
work must be mostly serial or agents will conflict. Parallelism goes to research and
evaluation, not to concurrent edits. Each build agent must verify its own output by
rendering headless screenshots (Chromium + Playwright are preinstalled in this
environment; `scene.html` already supports `?mode=&cam=&clean` URL params for scripted
capture) — no agent reports done on code it hasn't seen rendered.

| # | Task | Agent type | Runs | Inputs | Output / done criteria |
|---|---|---|---|---|---|
| D1 | Rung 0+1: fork scene2, geometry fixes, PBR pipeline | general-purpose (build) | first, alone | geometry.json, furniture-notes.md, OUTCOME.md review note, chair photos from Shyam | scene2.html + both-view PNGs; chair reads as pod, materials are per-item PBR |
| D2 | Texture sourcing research: what's reachable (Poly Haven/ambientCG via proxy), what must be procedural, per-item recommendation | Explore/general-purpose (research) | parallel with D1 | furniture-notes.md item list | short memo: per-item texture source + fallback |
| D3 | Path-tracer feasibility research: three-gpu-pathtracer version/API compatibility with the scene's Three.js version, expected render times | Explore/general-purpose (research) | parallel with D1 | scene.html (r160) | short memo: go/no-go on rung 4 approach + pinned versions |
| C1 | **Checkpoint 1 (Shyam)**: judge D1 contact sheet vs. §2 Tier 1 | human | after D1 | contact sheet | proceed / stop / redirect |
| D4 | Rung 2: textures + detail per D2's memo | general-purpose (build) | after C1 | scene2.html, D2 memo | updated scene2 + contact sheet |
| D5 | Rung 3: lighting/post + extra viewpoints | general-purpose (build) | after D4 (same file) | scene2.html, reference photos | updated scene2 + contact sheet |
| C2 | **Checkpoint 2 (Shyam)**: Tier 1 verdict on both views | human | after D5 | contact sheet + side-by-side vs. photos | Tier 1 pass/fail recorded |
| D6 | Rung 4: path-traced stills per D3's memo (timeboxed) | general-purpose (build) | after C2, only if C2 ≥ borderline | scene2.html, D3 memo | 2–4 stills per view |
| C3 | **Final decision (Shyam)**: §2 outcome recorded in a spike-2 OUTCOME doc | human | last | everything | go / go-with-reframe / no-go, written down |

Efficiency notes:
- D2 and D3 are the only genuinely parallel tracks; they're cheap, read-only, and
  de-risk D4/D6 before those slots open. Don't spawn build agents in parallel on the
  same file to look busy.
- Every build agent's prompt includes: the §2 decision bar verbatim, the "outline and
  voids" rule, the checkpoint contact-sheet format, and the instruction to compare
  against spike-1 run-2 images so regressions are visible.
- If C1 already passes Tier 1 cleanly, D4/D5 collapse into one polish pass and the
  schedule shortens — the ladder is a maximum, not a quota.

## 5. Inputs needed from Shyam

1. **Swivel chair reference images** (the AptDeco/West Elm Cozy photos) — needed at D1
   kickoff to verify the pod proportions. Not blocking this plan.
2. **Room reference photos** for the two camera views (or nearest equivalents) — needed
   at C2 for the side-by-side judgment. The walkthrough video frames used in spike 1
   would do.
3. At C1/C2/C3: honest judgment against the §2 bar, set before looking at results.

## 6. Explicitly out of scope

- No floor-plan editor, app scaffolding, schema, or database (unchanged from spike 1).
- No general parametric furniture system — one-off silhouette fixes only.
- No real catalog 3D assets (IKEA model sourcing etc.) — that's the follow-on
  milestone product-review already scoped for v1 proper; this spike measures what the
  *authored-primitive* pipeline can do, since that's what the product could actually
  sustain per object.
- No dynamic GI/baking pipeline beyond the rung-3 timebox; no engine switch
  (Unreal/Unity) — the review's argument that the bottleneck is artist-hours, not
  engine, stands.
- No further AI-still generation. The NO-GO is decided; rung 4 is its replacement
  hypothesis, not a retry.

## 7. Cost and record-keeping

- Zero API cost (the fal.ai line item disappears; everything renders locally).
- The deliverable of the whole PoC is a `spike/OUTCOME-2.md` in the same format as
  spike 1's: what ran, what held, what drifted, decision + implication for the MVP
  visualization question.
