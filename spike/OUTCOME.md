# Spike Outcome — AI-Still Rendering (depth-conditioned)

**Status: DECISION PENDING** (as of 2026-07-17). Not yet a go/no-go — Shyam wants to
re-run with richer prompt context (decor, materials, details for the other furniture)
before judging against the bar in poc-plan.md step 4.

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

## Next session

- Shyam brings detailed decor/furniture/material descriptions; update `prompt.txt` /
  `prompt-reverse.txt` and re-run (~$0.04/image).
- Levers not yet tried: `--scale` (conditioning strength), `--model sd15` fallback,
  edge-map conditioning (scene.html mode 3), longer/structured prompts.
- Then judge against the pre-set bar (≥3 of 5 pass all three step-4 questions,
  no cherry-picking; outside reaction if borderline) and update this file with the
  final outcome.

## Run commands (reference)

```
FAL_KEY=<key> spike/.venv/bin/python spike/generate.py --n 5
FAL_KEY=<key> spike/.venv/bin/python spike/generate.py --n 5 --depth out/depth-reverse.png --prompt-file prompt-reverse.txt
```
