# Spike 2 Outcome — Real-Time Render Pass (PoC 2)

**Status: GO-WITH-REFRAME (2026-07-17).** C2 passed as borderline; D6 path-traced
stills rendered and reviewed at C3. See "Final decision" below.

Successor to `OUTCOME.md` (spike 1, NO-GO on AI stills). Plan and decision bar:
`poc2-plan.md`. Question: is honest real-time rendering good enough to be the
product's visualization mechanism?

## What was run

- `spike/scene2.html` — fork of spike 1's scene, climbed the §3 fidelity ladder:
  - **Rung 0 (geometry debt):** swivel chair rebuilt as the closed Cozy pod (lathe
    body + tilted torus ring, 76 cm, per `reference/cozy-swivel-chair.md`); STÄLL
    shoe cabinet given its slim front-legs silhouette.
  - **Rung 1 (PBR floor):** MeshStandard/Physical materials, sRGB + ACES, sun through
    the west glazing, RoomEnvironment IBL, PCF soft shadows, hemisphere bounce fill
    (the ceiling is unlit without it — IBL contributes ~nothing to downward faces).
  - **Rung 2 (textures/detail):** seeded procedural canvas textures per the D2 memo
    (wood grain ×3 species, bamboo weave, Lejde hatch, charcoal melange, rug blobs +
    pile bump, cm-true 60 cm floor tiles); bookshelf front = 2×4 cubbies of book
    spines; TV stand open media shelf; tower speaker; throw cushions.
  - **Rung 3 (lighting/camera):** GTAO contact shadows + subtle bloom (vendored r160
    passes; AO params rescaled for cm world units); 38° (35mm-equiv) human-POV lens
    per C2 feedback; four camera presets (couch 0, reverse 9, dining 8, overview 7).
  - **Rung 4 (Tier 2 experiment):** `spike/pathtrace.html` + `pathtrace-run.mjs` —
    same room and materials under three-gpu-pathtracer 0.0.23 (D3 memo's pinned
    versions + r160 shim), GradientEquirect env, real GI. 300-sample 1024×768 stills
    of both C2 views (~2 s/sample on this Mac's SwiftShader ≈ 10 min/still, vs the
    25–90 min the cloud-sandbox memo projected).
- Contact sheet: `out2/contact-sheet.html` (raster views vs spike-1 AI stills; a C3
  section added side-by-side, rung-3 raster vs rung-4 path-traced at 300 samples, for
  both required views).

## Checkpoint record

- **C1 (rungs 0–1):** passed — "looks good, already more promising \[than spike 1]."
- **C2 (rungs 0–3), verbal, judged from memory** (reference photos unavailable —
  deviation from plan §5 input 2, accepted because the judge knows the room):
  - Layout/proportion: **pass** — "works, this is enough for that," camera POV note
    (fixed same day: 60° → 38° lens).
  - Color/material: **not yet** — "not quite there yet, but clearly on its way."
  - Brightness/mood: **pass** — "close enough at this stage."
  - Overall: **borderline** → D6 unlocked per plan §4.

## What held / what drifted (vs the §2 bar)

**Held:**
- Geometry/proportion at decision grade in all four views; the pod chair finally
  reads as the Cozy (spike 1's one unfixed silhouette bug).
- Material *category* recognition: oak/pine/bamboo/melange/rug all read as the right
  kind of thing at room distance; procedural textures alone got there (D2's verdict
  confirmed — no CC0 downloads were needed even with open network).
- Brightness/mood honesty at raster tier; GI tier adds physically-real bounce light.
- Ops findings worth keeping: bamboo-style regular weaves must be drawn as
  directional banding (checker cells mip into mosaic noise); GTAO defaults assume
  meters (near-invisible in a cm scene — verify against the AO-term buffer); the
  path tracer scrambles material indices after any multi-material mesh (use
  single-material meshes only).

**Drifted / open:**
- Color/material *fidelity* (not category) is the acknowledged Tier-1 gap — C2's
  "not quite there yet." Candidate next lever, not yet spent: real CC0 photo
  textures (Poly Haven/ambientCG reachable locally, unlike in the cloud sandbox).
- Rug pile depth, fabric softness remain bump-faked at raster tier — genuine
  Tier 2 territory; judge whether the path-traced stills close it.
- Path-traced tone runs warmer than raster (real GI propagates the sun's warmth;
  raster's hemisphere fill dilutes it). Neither is "wrong"; they will not match
  pixel-for-pixel.

## Final decision (C3, 2026-07-17)

**GO-WITH-REFRAME on real-time PBR rendering as the visualization mechanism.**

C3 sat down with the D6 path-traced stills side-by-side against the rung-3 raster
renders (`out2/contact-sheet.html`, couch + reverse views, 300 samples each). Verdict:
the path tracer's real GI mainly shifts overall tone warmer — it does not add material
fidelity, since both renderers draw from the same procedural textures. It confirms the
raster hemisphere-fill approximation was honest rather than closing the "color/material
not quite there yet" gap C2 already flagged. Given that, Tier 1 lands as: layout/
proportion — pass; brightness/mood — pass; color/material — the one sub-criterion that
doesn't clear "without caveats," and the fix for it (real photo textures per-material,
not a better renderer) is identified but unspent, per the D2 memo's candidate lever.

That reads as Tier 1 passing on the criteria that matter most for the product's actual
decisions (does the layout/proportion/size read correctly, is the mood honest) with one
acknowledged, addressable gap — not a Tier 1 failure, and Tier 2 (fine texture/pile
fidelity) was never expected to fully pass. That combination is exactly the plan's
go-with-reframe branch, not a clean go: the product pitch reframes from "visualize
realistically" to "decide layouts and colorways confidently," with color/material
fidelity flagged as a known, improvable limitation rather than a blocking failure.

**Implication for the product:** the real-time Three.js/WebGL pipeline (authored
geometry + PBR materials) is the visualization mechanism going forward, replacing the
AI-still/ControlNet path spike 1 ruled out. If a later milestone needs tighter
color/material fidelity, the identified next lever is real CC0 photo textures
(Poly Haven/ambientCG — reachable from a normal network, unlike this sandbox), not a
switch to path tracing; path tracing is now de-risked (pinned versions, known gotchas)
as a stretch option for occasional decision-grade stills, not a rendering-mode change.

## Run commands (reference)

```
# raster contact-sheet captures (all four presets)
PLAYWRIGHT_DIR=<playwright install> node spike/capture.mjs

# path-traced still, one view (~10 min at 300 samples on this Mac)
PLAYWRIGHT_DIR=<playwright install> node spike/pathtrace-run.mjs --cam 0 --samples 300 --timebox-min 30
```
