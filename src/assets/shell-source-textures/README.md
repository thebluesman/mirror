# Shell source textures — Phase 5 lever 1 (PRD-v2 §7.5 / §11.2)

Two committed source images feeding the existing shell-texture pipeline
(`src/texturing/pipeline.ts` → `src/texturing/tileable.ts` →
`src/scene/shellMaterials.ts`, driven from `ShellPanel.tsx`'s upload +
tint/repeat/roughness calibration UI). These files are inputs to that
pipeline, exactly like a photo Shyam uploads himself — nothing in the
pipeline knows or cares that they came from here instead of a phone camera.

## What these are, and what they are NOT

**PRD-v2 §7.5 names Poly Haven / ambientCG as the CC0 texture source for this
lever.** Both are unreachable from this build sandbox — confirmed 403 policy
denials at `api.polyhaven.com` and `ambientcg.com` (consistent with
`spike/research/texture-sources.md`'s original finding, re-verified
2026-07-22). The sandbox's allowed hosts are `raw.githubusercontent.com` and
`registry.npmjs.org`.

**These two files are GitHub-raw-sourced substitutes, not the PRD's named
sources.** They were picked only because Poly Haven/ambientCG were blocked.
Swapping to genuine Poly Haven/ambientCG files later is a one-file-per-surface
change (see "Swapping to a real Poly Haven/ambientCG file" below) — the
pipeline has no source-specific assumptions baked in anywhere.

## Files, provenance, license

| File | Surface(s) | Source | License |
|---|---|---|---|
| `floor-rocky-ground.png` | floor | [`BabylonJS/Assets`](https://github.com/BabylonJS/Assets) — `textures/rockyGround_basecolor.png`, fetched from `https://raw.githubusercontent.com/BabylonJS/Assets/master/textures/rockyGround_basecolor.png` (1024×1024 PNG) | CC BY 4.0 — attribution: "BabylonJS/Assets" |
| `wall-ceiling-plaster-grain.jpg` | wall, ceiling | `BabylonJS/Assets` — `textures/sand.jpg`, fetched from `https://raw.githubusercontent.com/BabylonJS/Assets/master/textures/sand.jpg` (894×894 JPEG), **then converted to true greyscale** (per-pixel Rec. 601 luma) before committing — see "Known gap" below for why | CC BY 4.0 — attribution: "BabylonJS/Assets" |

**Why the wall/ceiling file is greyscale, not the raw download:** the raw
`sand.jpg` averages a strongly warm `rgb(187, 152, 101)` — fine as sand, wrong
for a neutral painted wall. The calibration UI's tint is *multiplicative*
(`mat.color.multiply(tint)`, starting from white — see
`shellMaterials.ts`'s `applyCalibrationToMaterial`), so it can only ever
darken a channel relative to the texture's own value, never brighten one past
it. Against `wall.JPG`'s reference average `rgb(149, 149.5, 144)`, that left
an ~40/255 blue deficit no tint setting could close — the first calibrated
render (before this fix) rendered a visible olive/yellow cast instead of
neutral grey (a real finding from actually running the comparison, not
theoretical). Converting the source to greyscale first means tint supplies
100% of the target hue, unclamped, while the source's own luminance pattern
(the actual fine grain) is preserved exactly — and a painted wall/ceiling
has no inherent hue to begin with, so this is a legitimate match for the
material, not just a workaround.

Both are real photographed materials (not procedural/synthetic), genuinely
tileable (they're shipped as game-ground textures, verified seamless in that
use), and far higher-resolution relative to the physical area they cover than
a single quick phone photo — which is what specifically targets the
"floor/wall/ceiling read as obvious tiles" complaint (PRD-v2 §7.5): that
complaint is about the *repeat pattern* being visible, not the exact
sub-material (aggregate-stone vs. rectified porcelain tile, or fine sand grain
vs. painted plaster), and a photo genuinely shot to tile removes the
mirror-fold artifact `tileable.ts` has to fake into any photo that wasn't.

**Search performed before landing on these two:** three.js's own
`examples/textures/` (verified reachable, MIT — see
`spike/research/texture-sources.md`) has no tile/plaster/paint asset, only
`hardwood2` (wood grain — wrong material class for this room's tile floor and
painted wall/ceiling) and non-architectural test patterns (checkerboard,
UV grids, brick). Khronos `glTF-Sample-Assets`' Sponza scene has a genuinely
matching marble floor + plaster columns, but is licensed under Crytek's own
terms (not CC0/permissive) — rejected on licensing grounds, not fit. The npm
package `@pmndrs/assets` (CC0) ships matcaps/normals/HDRIs/logos only, no flat
architectural surface photos. `BabylonJS/Assets` was the best fit found: real
architectural-adjacent surface photos, clearly licensed (CC BY 4.0, stated in
the repo), reachable via `raw.githubusercontent.com`.

**Known gap, honestly recorded:** neither file is a literal match for
"rectified porcelain floor tile with grout lines" or "smooth painted plaster."
`floor-rocky-ground.png` is aggregate/cobble stone; `wall-ceiling-sand-grain`
is a fine sand macro shot. Average-color sampling against
`spike/inputs/surfaces/*.JPG` (see `defaultShellTextures.json`'s `sampledColors`)
confirms both are close in overall tone to Shyam's real surfaces, and the
tint calibration below pulls them the rest of the way, but the sand source's
blue channel runs low relative to the wall/ceiling target — tint can only
darken a channel, never brighten it past the source's own value, so a mild
residual warm cast is expected and left for Shyam's own slider nudge (the
calibration UI exists exactly for this).

## Calibration

See `../scene/defaultShellTextures.ts` for the exact tint/repeat/roughnessScale
starting values used in the before/after comparison
(`v2-review/shell-quality/`), derived from sampling both the reference photos'
and the source textures' average RGB (script: see that comparison folder's
README) rather than eyeballing.

## Swapping to a real Poly Haven/ambientCG file later

1. Download the real file (e.g. `Tiles087_1K-JPG_Color.jpg` for floor,
   `Plaster001_1K-JPG_Color.jpg` for wall/ceiling) from a machine with open
   network access.
2. Replace `floor-rocky-ground.png` / `wall-ceiling-sand-grain.jpg` in this
   directory with the new file (any name is fine as long as
   `defaultShellTextures.ts`'s `sourceFile` path is updated to match).
3. Re-run the same calibration step (upload through `ShellPanel.tsx` as usual,
   or re-run the comparison driver) — tint/repeat/roughness will need
   re-tuning against the new file's own color, same as any new photo upload.

Nothing in `tileable.ts`, `pipeline.ts`, `shellMaterials.ts`, or
`ShellPanel.tsx` references Poly Haven, ambientCG, or GitHub — they only ever
see a `Blob`/`File`, exactly like today.
