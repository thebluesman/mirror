# Proof-of-Concept Plan — AI-Still Rendering Spike

## What this answers

Before investing in the editor, scene schema, or any app scaffolding: can a
depth-conditioned AI image model turn a dimensionally-correct but crude box layout of
the living room into a still that's convincing enough to make a real decision from
(e.g. "would I buy this rug")? If not, the core value prop ("visualize what a change
would look like realistically") doesn't hold and the project's shape needs to change
before more time goes in.

This is throwaway validation work — no app code, no editor, nothing here needs to
survive the spike.

## Decision this session should produce

**Go / no-go** on continuing to invest time (and Claude usage) in the full build, plus
which of these it turned out to be:
- Go as originally scoped (AI-still pipeline works well enough).
- Go, but budget more time to the conditioning/prompting step than planned (works, but
  needs more iteration than expected).
- No-go / rethink (outputs don't preserve geometry or don't look convincing regardless
  of prompting — reconsider whether "realistic visualization" is the right MVP goal).

## Why fal.ai + ControlNet depth

Chosen over alternatives already ruled out:
- **Adobe Firefly Structure Reference** — does true structural conditioning but API
  access requires an enterprise agreement (~$1k/mo minimum). Not viable.
- **Gemini / Nano Banana image editing** — cheap/free, but does prompted image fusion,
  not true depth-map conditioning. Higher risk of exactly the drift problem this spike
  is designed to rule out (reinterpreting proportions, moving a window).
- **fal.ai hosted ControlNet (depth)** — the actual technique the product review
  recommended, real API (reusable later, not throwaway), ~$0.005–0.02 per image. This
  is the pick.

Fallback if this spike succeeds and cost ever matters at higher volume later: the same
ControlNet-depth technique self-hosted via ComfyUI on a free Colab GPU. Not needed for
the spike itself.

## Prerequisites (do before the session, or in the first 10 minutes)

1. Create a fal.ai account: https://fal.ai
2. Generate an API key from the fal.ai dashboard.
3. Add a small amount of credit / a card — budget **$5**, which covers hundreds of test
   images at these prices. This is the only money this spike should cost.

## Steps

### 1. Build the crude reference scene (no editor, no polish)

Using the living room dimensions already on hand from the Figma reference
(`Living Room` frame, `Scale 1cm = 1px`):

| Item | Dimensions (cm) |
|---|---|
| Bookshelf | 72 × 40 |
| TV stand | 188 × 39 |
| Billy + Hemnes shelving | 169 × 38 |
| Dining table | 153 × 92 |
| Swivel chair | 98 × 98 |
| Shoe rack | 79 × 29 |
| ÄPPLARYD sofa | 3-seat with chaise longue, Lejde light grey (article 094.180.51) — 290 × 93 cm, 162 cm depth on the chaise side, 82 cm height including back cushions, 47 cm seat height |

Place these at roughly their plan positions (exact placement doesn't need to match
perfectly — this is a proportion/geometry and recognizability test, not the final
layout) in any throwaway 3D tool: a 5-minute Three.js scene, Blender, or even a Python
script (e.g. `trimesh`) that can output a render. Set one camera position roughly at
"couch view, looking at the TV wall."

For the sofa and swivel chair specifically — the two items the evaluation step judges
on "is it recognizable as that object" — build a crude compound shape (seat block +
backrest slab + arm bolsters for the sofa; seat + back + base for the chair) instead of
a single box. This is maybe 30 extra minutes and matters: `product-review.md:437-447`
argues a plain box depth map doesn't give the AI-still pipeline enough to render a
recognizable sofa, and recommends pulling silhouette shapes into v1 for exactly that
reason. Running this spike with pure boxes risks a **false no-go** — a bad result would
be ambiguous between "depth conditioning doesn't work" and "a box just doesn't encode
sofa," and the review already predicts the latter. Everything else (bookshelf, TV
stand, shelving, dining table, shoe rack) can stay a plain labeled box — they aren't
being judged on recognizability the same way.

Render two outputs from that camera:
- A **depth map** (grayscale, distance from camera).
- Optionally an **edge/wireframe map** as a second conditioning input to compare.

### 2. Write the materials/style prompt

A short text description of what each surface should look like, e.g.:

> A living room. Olive green linen sofa. Light oak dining table. Warm white walls.
> Black TV stand and wall-mounted TV. Beige rug. Natural daylight from a window,
> soft afternoon light.

Keep it close to what's actually in the room — this isn't concept art, it's meant to
answer "does this look like my room."

### 3. Call the fal.ai ControlNet depth endpoint

Use an SDXL or Flux depth-ControlNet model on fal.ai (e.g.
`fal-ai/sd15-depth-controlnet` or an SDXL/Flux depth-conditioned equivalent — check
fal.ai's current model list at session time, since offerings change). Inputs: the depth
map image + the materials prompt. Generate 3–5 variations, adjusting conditioning
strength if the first pass looks warped or the geometry drifts.

### 4. Evaluate against the decision criteria

Look at each output and ask, honestly:
- Does the room's geometry (wall positions, window, proportions) match the box scene,
  or did the model invent/move things?
- Does it look like a plausible living room — is the sofa recognizably a sofa, not a
  blob?
- Would this be good enough to make a real decision from (e.g. "yes, order this rug"),
  or does it still read as an AI-generated placeholder?

Set the bar before looking at results, not after: call it a **go** if at least 3 of
the 5 variations pass all three questions above without cherry-picking or extra
prompting. One good result out of five is not a go — it means the technique is
inconsistent, which is itself useful information but not a green light.

If the result is borderline either way, get one outside reaction (partner, Supritha)
before recording the outcome — self-judging a borderline result risks rationalizing
toward whichever answer feels better after the time invested.

### 5. Decide and record the outcome

Write down (a few sentences is enough) which of the three outcomes in "Decision this
session should produce" happened, and why. That becomes the next planning input —
either straight into scoping the editor build, or back to the drawing board on the
fidelity approach.

**If the sofa/chair results are poor despite the silhouette shapes from step 1**, that's
a real signal about the technique — record it as such. **If step 1 was run with plain
boxes instead of silhouettes for any reason**, a poor result is inconclusive, not a
no-go: re-run with silhouette shapes before deciding.

## Explicitly out of scope for this session

- No floor-plan editor.
- No app scaffolding, schema, or database.
- No general furniture silhouette geometry *system* — just the two crude one-off
  silhouettes from step 1 (sofa, chair). Building a reusable parametric taxonomy across
  all archetypes is real work the review scopes for v1 proper, not this spike.
- No integration into a real product — this is a standalone script/notebook and a
  fal.ai account, nothing more.
