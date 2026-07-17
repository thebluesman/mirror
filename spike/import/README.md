# W-A furniture imports (PoC 3 / D1) — commands for Shyam

This directory is the code half of D1 (poc3-plan.md sec.4, W-A). It is ready to
run end to end as soon as you supply the two blocking inputs from sec.5:

1. **One image per item** (swivel chair, STALL shoe cabinet, bookshelf) — see
   `items.json`'s `notes` field per item for what kind of image is preferred.
2. **FAL_KEY** — get one at https://fal.ai/dashboard/keys, export it in your
   shell, never commit it.

Nothing here was run against the live fal API while building it (no key was
available) — see the "UNTESTED AGAINST THE LIVE API" note at the top of
`generate-item.py`. `process-glb.mjs` (the rescale/floor-snap/recenter step)
*was* tested for real, against a synthetic test GLB — see "Verification" in
the PR/commit description for the numbers.

## 0. One-time setup

```sh
cd spike/import
npm install          # pulls @gltf-transform/{core,functions,extensions} from npm
pip install fal-client httpx     # or: uv run generate-item.py ... (installs automatically)
export FAL_KEY=your-key-here     # never commit this; per-shell-session only
```

## 1. Generate each item

Run once per item in `items.json` (`swivel-chair`, `shoe-cabinet`, `bookshelf`).
`--image` accepts a local file path or an image URL.

```sh
cd spike/import
python3 generate-item.py --image ~/Downloads/cozy-swivel-chair.jpg --item swivel-chair
python3 generate-item.py --image ~/Downloads/stall-cabinet.jpg     --item shoe-cabinet
python3 generate-item.py --image ~/Downloads/IMG_0455.jpg          --item bookshelf
```

Each run costs ~$0.80 (fal-ai/meshy/v6/image-to-3d) and takes ~1-4 minutes.
It writes:
- `spike/import/glb/<item>.glb` — the raw generated mesh
- `spike/import/glb/<item>.meta.json` — the request args + fal response metadata

Before your *first* real run, sanity-check the request will actually be
accepted: run with `--dry-run` first (validates FAL_KEY, image, output dir,
prints the exact request without spending money), then drop `--dry-run` and
maybe re-check the field names against the live schema at
https://fal.ai/models/fal-ai/meshy/v6/image-to-3d/api if the real call errors
on an unknown field (see the script's docstring for why this might happen).

```sh
python3 generate-item.py --image ~/Downloads/cozy-swivel-chair.jpg --item swivel-chair --dry-run
```

## 2. Process each GLB (rescale to known cm dims, floor-snap, recenter)

Dims come from `items.json` (sourced from geometry.json / furniture-notes.md).
This step is local, free, and fast (no API call).

```sh
cd spike/import
node process-glb.mjs glb/swivel-chair.glb --dims 98x90x76  --out glb/swivel-chair.processed.glb
node process-glb.mjs glb/shoe-cabinet.glb --dims 79x29x148 --out glb/shoe-cabinet.processed.glb
node process-glb.mjs glb/bookshelf.glb    --dims 72x40x155 --out glb/bookshelf.processed.glb
```

It prints an inspection (triangle count, texture count/sizes, bounds before
and after) so you can eyeball whether the generation is in a sane polycount
range (budget: <=30k triangles/item per the research memo) before opening it
in scene2.

## 3. View in scene2.html, side-by-side (C1 gate)

Serve `spike/` over a local static server (ES module imports need http://, not
file://) and open scene2.html with the `imports=side` URL param, which places
each *processed* GLB found at its `items.json` path 120cm to the +X side of
the authored primitive (which stays visible) — so you can compare both
directly, per the plan's C1 gate.

```sh
cd spike
python3 -m http.server 8000
# then open, e.g.:
#   http://localhost:8000/scene2.html?cam=0&imports=side   (couch view)
#   http://localhost:8000/scene2.html?cam=9&imports=side   (reverse view)
```

Once an item passes C1 and you want to see it *replacing* the authored
primitive (the eventual v1 behavior):

```
http://localhost:8000/scene2.html?cam=0&imports=on     (default; same as omitting the param)
http://localhost:8000/scene2.html?cam=0&imports=off    (force authored primitives everywhere, ignore any GLBs)
```

Any item whose `processed.glb` isn't present yet (not generated, or generation
failed) silently falls back to its authored primitive — nothing breaks if you
only have 1 or 2 of the 3 items done. All other URL params (`mode`, `cam`,
`clean`) and camera presets (0/7/8/9) are unaffected.

For a full contact sheet across camera presets, reuse `spike/capture.mjs`
(pass `?imports=...` isn't wired into that script's fixed URL list — for now,
add `&imports=side` by editing the SHOTS urls there, or drive Playwright
directly the way this D1 build's own verification did).

## What the C1 gate checks (quoted from poc3-plan.md sec.2)

> **Gate (per-object, checkpoint C1):** each generated mesh, dropped into
> scene2 under its lighting and rescaled to known cm dimensions, must (a) read
> as *that specific item* — silhouette, voids, category, color — from the
> standard views **and from at least one angle that sees the generated back**,
> and (b) not regress anything spike 2 passed (proportion, floor contact,
> scale against neighbors).

Concretely: check both `cam=0` (couch) and `cam=9` (reverse) with
`imports=side`, plus at least one orbit angle (drag the mouse) that shows the
generated mesh's back/rear side, since single-image generation can hallucinate
unseen geometry there (the plan's named risk; Hunyuan multi-view is the
escalation if only the back fails).

## Where things land

```
spike/import/
  generate-item.py       - fal submission script (this doc's step 1)
  process-glb.mjs        - rescale/floor-snap/recenter (step 2)
  items.json             - the 3-item manifest (dims, positions, notes)
  package.json           - npm deps for process-glb.mjs (run `npm install` here)
  glb/
    <item>.glb            - raw generated mesh (step 1 output)
    <item>.meta.json      - fal request/response metadata (step 1 output)
    <item>.processed.glb  - rescaled/floor-snapped/recentered (step 2 output;
                            this is the file scene2.html looks for)
```

`spike/import/node_modules/` is gitignored (top-level `.gitignore`); run
`npm install` fresh in this directory rather than expecting it to be present.
