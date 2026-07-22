# Phase 5 — shell-texture lever 1, before/after comparison

PRD-v2 §7.5 / §11.2. See `contact-sheet.html` for the side-by-side (open it
directly in a browser — it's plain HTML, no server needed) and
`screenshots/` for the individual PNGs.

**This is evidence for Shyam to judge, not a pass/fail verdict.** Per the
PRD, the bar ("floor/wall/ceiling no longer read as obvious tiles, judged by
Shyam against the same reference photos as C2") is his call, at the two
standard views (couch-view / reverse-view — see `spike/scene2.html`'s key 0 /
key 9 presets and `spike/OUTCOME-3.md`'s "both required views (couch,
reverse)").

## What "before" and "after" are

- **before-*.png**: Shyam's own real surface photos
  (`spike/inputs/surfaces/{floor,wall,ceiling}.JPG`) uploaded through the
  unmodified `ShellPanel.tsx` pipeline at default (no-op) calibration. This is
  the most honest, reproducible stand-in for what the acceptance run
  complained about — his actual tuned calibration from that run only ever
  lived in his own browser's IndexedDB/OPFS, never committed to this repo, so
  it can't be replayed exactly. Default calibration is a fair baseline: it's
  exactly what a first-time upload looks like before any hand-tuning.
- **after-*.png**: the Phase 5 lever-1 source textures
  (`src/scene/defaultShellTextures.ts` — see
  `src/assets/shell-source-textures/README.md` for exactly what they are and
  where they're from) uploaded through the same unmodified pipeline, then
  calibrated per that file's starting tint/repeat/roughnessScale values.

Both were produced by `drive-comparison.mjs`, driving the real running dev
server through the actual upload button + calibration sliders in
`ShellPanel.tsx` — no shortcuts into internal state, same pattern as
`spike-v2/w-a-drive.mjs` and friends.

## Reproducing this

```
npm run dev -- --port 5191 --strictPort   # or any port; pass it as argv[2]
node v2-review/shell-quality/drive-comparison.mjs http://127.0.0.1:5191/
```

Takes a few minutes — each of the six surface-photo uploads (3 before + 3
after) decodes and processes a full-resolution image through
`photoToTileableBlob` under headless SwiftShader software rendering, which
measured 15-50s per upload in this sandbox (no GPU acceleration). Not a sign
of anything wrong; see the comments in `drive-comparison.mjs`.

## A real finding from actually running this, worth keeping visible

The first calibration attempt for wall/ceiling used the raw downloaded
`sand.jpg` color as-is and rendered a visible olive/yellow cast instead of
neutral grey — the calibration UI's tint is multiplicative-only (can darken a
channel, never brighten one past the source's own value), and the raw
photo's blue channel ran ~40/255 below the target. Converting that source to
true greyscale before committing it (so tint alone supplies 100% of the
target hue, unclamped) fixed it — see
`src/assets/shell-source-textures/README.md`'s "Known gap" section and
`src/scene/defaultShellTextures.json`'s `note`. Recorded here rather than
quietly fixed and forgotten, since it's exactly the kind of thing Shyam or a
future lever-2 pass would want to know already got hit once.

## Two standard views

`couch-view` was already a saved camera in `seed/living-room.json`.
`reverse-view` was added in this phase (same eye/lookAt as
`spike/scene2.html`'s key-9 preset — this room's wall coordinates are
unchanged since spike 3, so the framing carries over directly) specifically
so this comparison could cover both of the project's two standard views, not
just one.
