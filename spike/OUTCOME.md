# Spike Outcome — AI-Still Rendering (depth-conditioned)

**Status: NO-GO on AI-still rendering** (decided 2026-07-17). See "Final decision"
below.

## What was run

- 3D scene built from the Figma "Living Room" frame (1px = 1cm): `spike/scene.html`
  (Three.js, depth/edge/shaded modes, couch-view + reverse-view camera presets,
  compound silhouettes for the ÄPPLARYD sofa and swivel chair, plain boxes for the rest).
- Depth maps: `out/depth.png` (couch view), `out/depth-reverse.png` (reverse view).
- 11 images generated via `fal-ai/flux-control-lora-depth` at default strength 1.0,
  1024×768 (~$0.04 each): 1 smoke test + 5 couch view + 5 reverse view.
  All in `out/`, reviewable at `out/contact-sheet.html`.

## Interim findings (consistent across all 10 evaluation images)

**Held up:**
- Room geometry fully preserved — walls, entry opening, window positions, TV
  size/placement, object distances. No invented/moved architecture.
- The two compound silhouettes were recognized correctly every time: swivel chair 5/5,
  sofa 5/5 (once even as a proper chaise L-shape). Confirms product-review.md's
  silhouette argument (§question 2).
- Photorealism is at "real estate photo" level, not AI-placeholder level.

**Drifted:**
- Plain boxes lose object identity: dining table → kitchen island/cabinet in 5/5
  reverse views (solid box has no leg void); TV stand → sideboard/bench/console
  variously in couch views.
- Results read emptier/more staged than a lived-in room; decor, rug, warmth largely
  missing despite prompt mentions.

Shyam's read: "composition is mostly good, details often poor — the depth map is
carrying the experiment; I haven't provided enough info about decor and other
furniture."

## Second run (2026-07-17, runs 112149 couch / 112228 reverse)

Prep: real product/material details collected in `furniture-notes.md` (product pages,
Shyam's photos, apartment walkthrough video); ceiling 240 confirmed by measuring a
photo; geometry updated to the new Figma layout (swivel chair NW corner, bookshelf by
sofa, Billy+Högadal 160×30×149, west wall = window + full-height balcony door); dining
table and TV stand rebuilt as slab-on-legs silhouettes; GUTTANE coffee table + blue
SÖNDERÖD rug added; both prompts rewritten from the notes. 10 images, same model,
default strength.

**Fixed vs first run:**
- Dining table read correctly 5/5 in reverse views (legs + void killed the
  kitchen-island failure) — confirms silhouette-over-prompt as the fix for identity
  drift, same lesson as the sofa/chair result in run 1.
- TV stand 5/5 and strikingly close to the real unit (oak frame, white drawer fronts,
  open shelf with AV gear, tapered legs).
- Blue high-pile rug reads correctly in all reverse views; tower speakers usually
  present; balcony door with charcoal frames holds; room geometry still solid 10/10.

**Still drifting — appearance-level:**
- Frame TV bezel: black in most, literal oak picture frame once; "white bezel" never
  landed.
- West glazing often widens into a full glass wall; occasional phantom white cabinet
  near the kitchen.

**Still drifting — later re-attributed to geometry (see review note below):**
- Swivel chair: right position/fabric, shape wanders (office chair / barrel / drum) —
  never quite the Cozy pod.
- Shoe cabinet (reverse foreground): rendered as bookcase/sideboard, not a slim shoe
  cabinet.

Read: identity drift is essentially solved by silhouette geometry; the remaining
misses are fine-grained appearance details that text prompting alone struggles to
force.

## Review note (2026-07-17, post-decision): two "drift" items were geometry bugs

Cross-checking the run-2 images against reference photos of the actual West Elm Cozy
Swivel Chair (AptDeco listing, same colorway) showed the chair failure was
misclassified above:

- **The real chair** is one continuous closed pod — upholstery runs to the floor over
  a concealed swivel base, back and arms form a single ring sloping down toward the
  front, total height ~76 cm.
- **The modeled silhouette** (`scene.html` `buildSwivelChair`) is an office-chair
  archetype: exposed foot disk + pedestal column, flat seat cylinder floating at
  45 cm, thin open-shell backrest rising to 100 cm — 24 cm taller than the whole real
  chair.
- The generator followed that depth map *faithfully*: office chairs, drums, barrels —
  and in 3 of 5 couch views the overhanging seat rim was split off and rendered as a
  phantom round side table. The model never had a chance to draw a pod, because it was
  never shown one. Same failure mode as run 1's dining-table-as-kitchen-island; the
  silhouette-over-prompt fix that repaired the table and TV stand was never applied to
  the chair. The shoe cabinet (still a plain box in `geometry.json`) is the same bug.

**Cutouts are (mostly) not needed.** The media console is the control case: its
geometry has no cutout for the open middle shelf — just a slab on legs — yet the open
shelf with AV gear rendered correctly 5/5 from the prompt alone. Pattern across both
runs: geometry must be right where it changes the *outline and voids* (legs,
under-gaps, overall mass); interior detail (shelf openings, drawer fronts, weave) is
prompt-recoverable once the mass reads as the right object. So: no cutouts for the
bookshelf/console; a rounded pod profile for the chair would have been worth ~20 lines
of Three.js.

**Impact on the decision:** the NO-GO stands, but on narrower evidence than first
written. The chair and shoe cabinet don't count as appearance-layer failures — the
genuinely prompt-resistant misses (white Frame TV bezel, west glazing widening into a
glass wall, phantom cabinets, decision-grade material/color fidelity) carry the no-go
on their own, and those alone fail the "would I buy this rug" bar. Correcting the
attribution actually *strengthens* the pivot: nearly every identity failure across all
21 images traces to a silhouette shortcut, i.e. depth-conditioned geometry is even
more load-bearing than the first write-up credited.

## Final decision (2026-07-17)

**NO-GO on AI-still rendering as the visualization mechanism.** Shyam's judgment: none
of the 10 second-run images were accurate enough to realistically make a decision from
(e.g. "would I buy this rug") — the bar poc-plan.md step 1 sets for the whole product
idea. Two rounds of prompt enrichment (generic → detailed real-product descriptions)
did not close the gap, which rules out "needs more prompting" as the explanation.

**What did work, clearly:** the depth-conditioned geometry and object silhouettes did
the heavy lifting across both runs — room shell 10/10, sofa/chair recognizable 5/5 in
run 1, dining table + TV stand identity fixed 5/5 in run 2 once given proper
silhouettes. The failure is specifically in the AI-still *appearance* layer (photoreal
materials/color/detail), not in geometry-from-depth-map as a technique. (The review
note above narrows this: the run-2 swivel chair and shoe cabinet misses were geometry
bugs, not appearance failures — the appearance-layer verdict rests on the bezel,
glazing, and material-fidelity misses, which suffice on their own.)

**Implication for the product:** this reframes the MVP question from "can an AI still
look like a real photo" (no) to "what's the best *real-time rendered* (non-photoreal)
visualization we can reasonably build" — i.e. lean into the Three.js/WebGL geometry
pipeline that already worked in this spike, rather than the fal.ai/ControlNet layer on
top of it. Next step is a new scoping pass on what "good enough" real-time rendering
looks like (materials, lighting, camera controls) — see poc-plan.md for whether/how to
revise the plan.

## Run commands (reference)

```
FAL_KEY=<key> spike/.venv/bin/python spike/generate.py --n 5
FAL_KEY=<key> spike/.venv/bin/python spike/generate.py --n 5 --depth out/depth-reverse.png --prompt-file prompt-reverse.txt
```
