# spike/textures — W-B shell photo textures (poc3-plan.md §4)

Textures the room shell (wall / floor / ceiling) in `scene2.html` from real
surfaces instead of the procedural canvas materials scene2.html builds by
default. Two independent paths get a surface's `albedo.jpg` (+ optional
`normal.jpg` / `roughness.jpg`) onto disk; `shell-textures.mjs` doesn't care
which one supplied it.

## The two paths

### Path A — CC0 texture sets (`fetch-textures.mjs`)

```
cd spike/textures
npm install                 # once — installs sharp for make-tileable.mjs
node fetch-textures.mjs     # fetches wall, floor, ceiling
```

Downloads candidate ambientCG sets (direct `https://ambientcg.com/get?file=...`
zips, CC0, no attribution needed) and unzips each into
`spike/textures/<surface>/`. **This cannot run from the environment W-B was
authored in** — ambientCG, Poly Haven, unpkg, and jsDelivr are all
proxy-blocked there (verified 403s, see `spike/research/texture-sources.md`
§1). It needs to run on Shyam's machine, which has open network access
(per poc3-plan.md §4, W-B: "Shyam ... runs downloads locally").

**The candidate set names are unverified guesses.** The ambientCG catalog
itself was unreachable, so `fetch-textures.mjs`'s `CANDIDATES` table names
plausible, well-known CC0 families (`Plaster*` for wall/ceiling, `Tiles*` for
the 60×60 floor) rather than confirmed-real set names:

| Surface | Primary guess | Alternate 1 | Alternate 2 |
|---|---|---|---|
| wall | `Plaster001` | `Plaster003` | `PaintedPlaster001` |
| floor | `Tiles101` | `Tiles074` | `Tiles087` |
| ceiling | `Plaster005` | `Plaster001` | `Concrete034` |

If a name 404s the script tries the next one automatically; if all three miss
for a surface, edit `CANDIDATES` in `fetch-textures.mjs` with real names once
you can browse ambientcg.com yourself (search "Plaster" / "Tiles"), or use
Path B instead. The script is idempotent (skips a surface that already has
`albedo.jpg` — pass `--force` to redo) and prints a clear per-surface
READY/MISSING summary at the end; a missing surface is never fatal, it just
means that surface stays on scene2.html's procedural material until fixed.

### Path B — Shyam's own photos (`make-tileable.mjs`)

For any surface where a straight-on, evenly-lit photo exists (per
poc3-plan.md §5 input #2):

```
node make-tileable.mjs --input ~/Downloads/wall-photo.jpg --surface wall
node make-tileable.mjs --input ~/Downloads/floor-photo.jpg --surface floor --size 1024 --blend 96
```

Center-crops to a square, quadrant-swaps (wraparound offset by 50%,50% — the
standard trick that makes the new left/right and top/bottom edges match
automatically), then cross-fades a mirrored copy across the resulting center
seam so the tile repeats without a hard line. Writes
`spike/textures/<surface>/albedo.jpg` in the same layout Path A produces (no
normal/roughness map — those stay off for a made-tileable photo unless you
have separate maps to drop in by hand under the same names).

Verified for real against a synthetic non-tileable input (strong left-right
lighting gradient by construction) — the output tiles 2×2 with no visible
seam line at any tile boundary (only the source's own gradient remains,
which is expected and not a tiling artifact).

## Calibration (`calibration.json`)

Whichever path supplied a surface's texture, `shell-textures.mjs` applies
`calibration.json` **multiplicatively** on top of it, so Shyam can nudge the
result against his reference photos without re-downloading or re-running
`make-tileable.mjs`:

```json
"wall": { "tint": "#f2e9d8", "repeat": [1, 1], "roughnessScale": 1.0 }
```

- `tint` — hex color multiplied into the material's base color. `#ffffff` is
  a no-op; warm/cool or lighten/darken from there.
- `repeat` — `[x, y]` multiplier on top of the computed real-world repeat
  (floor is cm-true 60cm tiles; wall/ceiling are meters-scale estimates).
  `[1,1]` is a no-op.
- `roughnessScale` — multiplier on the material's roughness, clamped to
  `[0,1]`. `1.0` is a no-op.

**Workflow:** edit `calibration.json`, reload `scene2.html`, compare the
couch-view and reverse-view renders against the reference photos for that
surface (poc3-plan.md §5 input #3), repeat. A missing or unparseable
`calibration.json` is treated as all no-ops — never an error.

## Integration (the one line the orchestrator adds to `scene2.html`)

`shell-textures.mjs` must run *after* scene2.html has built the floor,
ceiling, and wall meshes (it finds them structurally — see the module's
header comment for exactly how), so the import + call goes near the end of
the module script, after `DATA.walls.forEach(addWall)`:

```js
import { applyShellTextures } from "./textures/shell-textures.mjs";
applyShellTextures(scene, THREE, { MAT, renderer }).then(r => console.info("[shell]", r));
```

`applyShellTextures` returns `{ wall, floor, ceiling }`, each `'photo'` or
`'procedural-fallback'` — wire that into the HUD if useful. Nothing else in
scene2.html needs to change: no mesh needs a `.name`, no material needs to be
restructured. See the header comment in `shell-textures.mjs` for exactly
which meshes/materials it targets and why (short version: wall meshes are
found by `mesh.material === MAT.wall` reference equality since scene2.html
shares one wall material across every segment; floor/ceiling meshes are
found by `PlaneGeometry` + `position.y` since each of those already gets its
own per-rect material in scene2.html).

## Directory layout

```
spike/textures/
  fetch-textures.mjs      committed — Path A downloader
  make-tileable.mjs        committed — Path B photo-to-tile helper
  shell-textures.mjs       committed — the runtime module scene2.html imports
  calibration.json         committed — ships with all no-op defaults
  package.json / package-lock.json   committed — sharp dependency for make-tileable.mjs
  README.md                committed — this file
  wall/   floor/   ceiling/   GITIGNORED — populated by fetch-textures.mjs or
                              make-tileable.mjs; never committed (CC0 zips are
                              large binaries Shyam fetches locally, and this
                              content is regenerable from either script)
```

## What's verified vs. guessed

- **Guessed, unverified:** the ambientCG set names in `fetch-textures.mjs`
  (`CANDIDATES` table above) and the zip's internal `_Color/_NormalGL/
  _Roughness.jpg` naming convention (based on ambientCG's documented pattern,
  not confirmed against a real downloaded zip, since ambientCG is blocked
  from this sandbox).
- **Verified for real, in this sandbox:**
  - `make-tileable.mjs` end-to-end against a synthetic photo (2×2 tiling
    check, no seams).
  - `shell-textures.mjs` end-to-end via a standalone 3-plane room stub +
    headless Chromium screenshot: stand-in procedural JPEGs (not real
    downloads — see below) load correctly, colorSpace/repeat look sane
    (floor grout lines read at the right scale, wall gets a visibly-tinted
    calibration applied), and the missing-files fallback path renders
    identically to the untextured scene with zero console errors (only
    info-level logs).
  - The single blocked-network probe required by the task brief (one
    `fetch-textures.mjs wall` run against the real ambientCG URLs) — got the
    expected 403s, confirming the sandbox's network policy without wasting
    further attempts.

Stand-in verification textures (procedurally generated plaster/tile/ceiling
JPEGs used only to prove the pipeline works) were kept out of this directory
entirely — they live under the session scratchpad, not `spike/textures/`, so
there's no risk of mistaking them for real downloads.
