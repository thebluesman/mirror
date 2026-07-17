# Spike 3 runbook — what Shyam runs, in order

Everything in `poc3-plan.md` that is *code* is built and verified (as far as this
sandbox allows — see "what's untested" at the bottom). Detailed docs:
`import/README.md` (W-A) and `textures/README.md` (W-B).

## The short version (recommended): drop files, run one command

```bash
git pull && git checkout claude/pr5-c3-spike-completion-aff0vy
pip install fal-client        # the only manual dep; npm deps auto-install on first run

# 1. drop your photos into spike/inputs/ (exact names — see spike/inputs/README.md):
#      items/swivel-chair.jpg  items/shoe-cabinet.jpg  items/bookshelf.jpg
#      surfaces/wall.jpg  surfaces/floor.jpg  surfaces/ceiling.jpg   (or skip → --cc0)
#      reference/couch.jpg  reference/reverse.jpg                    (mandatory for C2)

node spike/run-spike3.mjs --status      # see what it would do, runs nothing
FAL_KEY=<key> node spike/run-spike3.mjs # generate + process + texture + render
```

The driver is idempotent — re-run it any time; it only does work whose input exists
and whose output doesn't (so it never re-spends fal.ai credits), and it ends with a
checklist of exactly what's still missing. Add `--cc0` to fetch stock CC0 textures
for any surface you didn't photograph. When it finishes, it prints the three
judgment steps (C1 side-by-side URL, C2 contact sheet, OUTCOME-3 record).

Everything below is the same flow broken into manual steps, if you want to run or
re-run a single stage by hand.

## 0. One-time setup (manual path)

```bash
cd spike/import   && npm install    # gltf-transform for process-glb.mjs
cd ../textures    && npm install    # sharp for make-tileable.mjs
pip install fal-client              # or reuse spike/.venv from spike 1
```

## 1. W-A — generate the three furniture items (needs FAL_KEY + item images)

Per `poc3-plan.md` §4: swivel chair, shoe cabinet, bookshelf. Prefer flat-lit
catalog/product shots as input (§3 "baked-in lighting" risk).

```bash
# sanity-check the request first (no cost):
FAL_KEY=<key> python spike/import/generate-item.py --image chair.jpg --item swivel-chair --dry-run

# real runs (~$0.80 each):
FAL_KEY=<key> python spike/import/generate-item.py --image chair.jpg    --item swivel-chair
FAL_KEY=<key> python spike/import/generate-item.py --image cabinet.jpg  --item shoe-cabinet
FAL_KEY=<key> python spike/import/generate-item.py --image shelf.jpg    --item bookshelf

# rescale to true cm + floor-snap (dims per item are in spike/import/items.json):
node spike/import/process-glb.mjs spike/import/glb/swivel-chair.glb --dims 98x90x76  --out spike/import/glb/swivel-chair.processed.glb
node spike/import/process-glb.mjs spike/import/glb/shoe-cabinet.glb --dims 79x29x148 --out spike/import/glb/shoe-cabinet.processed.glb
node spike/import/process-glb.mjs spike/import/glb/bookshelf.glb    --dims 72x40x155 --out spike/import/glb/bookshelf.processed.glb
```

Note: the fal call in `generate-item.py` is the one piece of code that could not be
tested against the live API from the sandbox (no key). If the first real call fails
on a parameter name, the error will say which — the script prints the full response;
`--dry-run` shows the exact request it will send.

## 2. W-B — shell photo textures (no key needed)

Either path, or both (your own photos win where you have a good straight-on shot):

```bash
# Path A: CC0 sets (set names are candidates — the catalog was unreachable from the
# sandbox; the script tries 3 per surface and tells you which surfaces are READY):
node spike/textures/fetch-textures.mjs

# Path B: your own surface photos → tileable:
node spike/textures/make-tileable.mjs --input wall-photo.jpg  --surface wall
node spike/textures/make-tileable.mjs --input floor-photo.jpg --surface floor
```

Then calibrate against your reference photos: open the scene (step 3), compare with
the real room, and nudge `spike/textures/calibration.json` (tint / repeat /
roughnessScale per surface) — reload to see each change.

## 3. View and judge

Serve `spike/` locally (`python3 -m http.server` in `spike/`) and open `scene2.html`:

- `scene2.html?imports=side` — **C1 object gate**: each generated item beside its
  authored primitive, in scene2 lighting. Orbit to check the generated backs
  (poc3-plan §2 gate: reads as *that specific item* incl. from a back-view angle,
  no regression on proportion/floor-contact/scale).
- `scene2.html?imports=on` — generated items replace the authored primitives
  (default when processed GLBs exist).
- `scene2.html?imports=off` / `?shell=off` — kill switches for A/B comparison.
- Camera presets unchanged: 0 couch, 9 reverse, 8 dining, 7 overview.

Contact-sheet captures for the record: `node spike/capture.mjs --out spike/out3`.

## 4. Judgment checkpoints (yours, per poc3-plan §2 — bar set before looking)

1. **C1** after step 1: per-object gate, side-by-side, including backs.
2. **C2** after steps 1+2: whole-room "that's my room" bar, render vs. reference
   photo — reference photos are mandatory this time (§5 input 3).
3. **C3**: record go / qualified-go / no-go in `spike/OUTCOME-3.md` (plan §7 format).

## What's untested from the sandbox (everything else was verified with renders)

- `generate-item.py`'s live fal.ai call (no FAL_KEY here) — request shape best-effort,
  `--dry-run` provided, response parsing defensive.
- `fetch-textures.mjs`'s ambientCG set names (catalog proxy-blocked) — 3 candidates
  per surface, graceful per-file failure reporting.
- Everything downstream of both (process → place → hide/side-by-side → shell apply →
  calibration → fallback when files are absent) was tested headless end-to-end with
  synthetic GLBs/textures; renders confirmed correct placement, scale, floor-snap,
  texture application, and zero regression with no assets on disk.
