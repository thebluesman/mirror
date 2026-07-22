# Proposal: shell texturing — preview before commit + slider microcopy — improvements-minor-fixes §18

**Built (2026-07-22):** implemented as **Option P-2** per the review correction
below (not this doc's own P-1 recommendation) — `SurfaceRow`'s `handleFile`
path now runs `idle → processing → preview → confirm/cancel → commit`, with
`putAsset`/`onChange` deferred to Confirm; sliders are untouched. New
`ShellTexturePreview3D` (modeled on `ObjectPreview3D.tsx`, reusing
`shellMaterials.ts`'s `makeTexture`/`applyCalibrationToMaterial`, now
exported for that reuse) renders inline below the upload button. New
reusable `InfoTip` (Option T-2), documented in `DESIGN.md` §5, carries the
drafted microcopy on Repeat X/Y/Roughness. See
`src/components/ShellPanel.tsx`, `ShellTexturePreview3D.tsx`, `InfoTip.tsx`.

**Status:** approved for build (2026-07-22 review) — **Option P-2** (narrow
draft: preview gates only the *photo*, not the whole calibration), overriding
this doc's own P-1 recommendation — Shyam's call was P-2 is enough. The
other open questions (deferring `putAsset` to Confirm, tooltip mechanism
T-1 vs. T-2, inline vs. larger preview placement) were not explicitly
re-decided — carry forward this doc's recommended leans unless corrected
when this is actually built.
**Date:** 2026-07-22
**Scope frame:** two related changes to `ShellPanel.tsx`'s surface-photo flow —
(1) an isolated preview so an uploaded/imported texture is judged *before* it
commits to the live room shell, and (2) a reusable tooltip carrying brief
microcopy for the Repeat X/Y and Roughness sliders. No change to the tiling
pipeline (`photoToTileableBlob`), the storage model, or `shellMaterials.ts`'s
calibration math — the preview reuses those, it doesn't reimplement them.

## Problem

**No preview before committing.** `SurfaceRow`'s `handleFile`
(`ShellPanel.tsx:50–63`) runs the uploaded photo straight through
`photoToTileableBlob` → `putAsset` → `onChange` — an **immediate commit**. The
very first time Shyam sees the tiled result, it's already live on the real
wall/floor/ceiling in the viewport. He wants to preview how a photo (especially
his own CC0 textures, not just surface photos) will *tile* before it lands on
the actual room shell. A side effect of the current flow worth noting:
`putAsset` writes the tileable blob into content-addressed OPFS *before* the
user has decided to keep it, so a rejected texture leaves an orphan asset
behind.

**Sliders need microcopy.** Repeat X, Repeat Y, and Roughness
(`ShellPanel.tsx:104–142`) are a bare label plus a live numeric readout
(`Repeat X (1.00×)`) — nothing explains what the slider *visually does*. There's
no tooltip mechanism anywhere in the app to hang that on, and neither
`DESIGN.md` nor `cohere/DESIGN.md` documents a tooltip/popover pattern (both
were checked — the only `title` hits in `cohere/DESIGN.md` are table-column
headers, unrelated). So this is new UI ground, the same way the icon-size scale
(§2) was.

## Recommendation (summary)

- **Preview:** add a small standalone `ShellTexturePreview3D` component modeled
  on `ObjectPreview3D.tsx` (its own tiny WebGL renderer, one tiled
  `PlaneGeometry`, one light rig, live re-tiling via refs), and route
  `SurfaceRow` through a new **upload → preview → confirm/cancel → commit**
  state machine so nothing touches OPFS or the live room until Confirm. Defer
  `putAsset` to Confirm so a discarded texture never writes an orphan asset.
  Recommended draft scope: the preview captures the **whole candidate
  calibration** (new photo + repeat + roughness + tint), and Confirm commits the
  bundle — see Option P-1.
- **Tooltip:** a small reusable **`<InfoTip>` component** (a Lucide `Info` icon
  that reveals a token-styled popover), decided once and dropped next to any
  slider label — not native `title`, because `title` can't carry the design
  language and a tooltip is exactly the kind of chrome interaction DESIGN.md's
  "no undocumented variants" rule says to document. Microcopy drafted below.

---

# Part 1 — preview before commit

## 1.1 The preview component (`ShellTexturePreview3D`)

Same shape as `ObjectPreview3D.tsx` and for the same reasons its header spells
out: a deliberately tiny, self-contained Three.js build — its own
`WebGLRenderer`, `Scene`, camera, and light rig — **not** the real room's
`Viewport`, so nothing is threaded through the app's structural-rebuild
machinery for a texture that was never committed.

Concrete shape, mirroring `ObjectPreview3D`'s structure beat-for-beat:

- **Geometry:** a single `PlaneGeometry` (the "surface"), large enough that the
  candidate texture visibly tiles several times across it.
- **Material:** a `MeshStandardMaterial` whose `map` is a `THREE.Texture` built
  from the candidate tileable bitmap, `wrapS = wrapT = RepeatWrapping`,
  `repeat.set(x, y)`, and `roughness` driven by the candidate `roughnessScale`
  — **built via the same `shellMaterials.ts` calibration path the real shell
  uses** (`makeTexture` / `applyCalibrationToMaterial`), not a hand-rolled
  divergent material, so the preview matches what actually commits. (Fidelity
  caveat, stated honestly: the real shell multiplies the calibration repeat by a
  *surface-size-derived base* — meters-scale for walls, a 60 cm tile for floor,
  `estimateWallRepeat`/`floorBaseRepeat`. A neutral preview plane has no real
  surface size, so the preview shows *relative* tiling behaviour — this texture,
  this repeat multiplier, this roughness — not the exact per-wall tile count.
  That's fine for "will this tile cleanly / look right," which is the question
  §18 is asking; see open question 4.)
- **Lights + camera:** one directional + one hemisphere light like
  `ObjectPreview3D`, and a fixed or lightly-orbitable camera framed straight-on
  to the plane (straight-on reads tiling best; see open question 3).
- **Live updates via refs, exactly like `ObjectPreview3D`:** rebuild the
  `Texture` only when the candidate *bitmap* changes; update `repeat`/`roughness`
  live (a cheap `texture.repeat.set` / `mat.roughness =` in a
  dims/rotation-style second effect) without re-decoding, using the same
  "ref mirrors latest prop for an imperative closure" pattern
  (`ObjectPreview3D.tsx:39–46, 145–147`).

Props (candidate values, not committed): `{ bitmap | blob, repeat: [x,y],
roughnessScale, tint }`.

## 1.2 The new state machine in `SurfaceRow`

Today `SurfaceRow` has `status: "idle" | "processing" | "error"` and
`handleFile` commits immediately (`ShellPanel.tsx:50–63`). Replace that with an
explicit preview cycle:

```
idle
  └─(pick file)─► processing        // run photoToTileableBlob(file)
        └─(blob ready)─► preview     // hold the tileable blob in LOCAL state;
                                     // render ShellTexturePreview3D against a
                                     // DRAFT calibration; NO putAsset, NO onChange
              ├─(Confirm)─► commit   // putAsset(blob) → onChange(draftCalib) → idle (applied)
              └─(Cancel)──► idle     // drop draft blob + object URL; prior calib untouched
        └─(pipeline throws)─► error  // unchanged from today
```

Key differences from today:

- **`putAsset` moves to Confirm.** In `preview`, the tileable blob lives only in
  component state (drive the preview texture from an in-memory object URL). It's
  written to OPFS **only on Confirm** — so a cancelled preview leaves no orphan
  content-addressed asset. This is a concrete win over the current
  commit-immediately flow, not just a UX nicety.
- **`onChange` fires only on Confirm.** The live room shell — and the autosave /
  Viewport calibration effect it drives — sees nothing until the user commits.
  Cancel is a true no-op against committed state.
- **The draft-calibration question (see Option P-1 vs P-2).** In `preview`, do
  the Repeat/Roughness/Tint sliders edit the *draft* (so you calibrate before
  committing) or stay bound to the live surface? Two coherent designs below.

### Option P-1 — wide draft: preview captures the whole calibration (recommended)

While in `preview`, the Repeat X/Y, Roughness, and Tint sliders edit the
**draft** calibration and feed the preview live; the live room shell is
untouched. **Confirm** commits the whole bundle (new asset + all calibration)
in one `onChange`; **Cancel** discards all of it.

- *Pro:* you tune tiling/roughness against the isolated preview and commit a
  finished result in one act — matches "preview what a photo will tile like
  before committing it," and keeps the room from flickering through
  intermediate slider states.
- *Con:* the sliders now mean "edit the draft" during preview and "edit the live
  surface" otherwise — a mode the row didn't have before. Manageable (the
  sliders already have a `liveCalib` local mirror, `ShellPanel.tsx:41–48`, that
  this generalizes cleanly), but it's the more involved change.

### Option P-2 — narrow draft: preview gates only the *photo*

`preview` shows only the newly-uploaded texture at the surface's *current*
committed repeat/roughness. Confirm commits just the asset swap; the sliders
keep editing the live surface as they do today (no preview involvement).

- *Pro:* smallest change — the state machine wraps only `handleFile`; the
  sliders are untouched.
- *Con:* doesn't let you preview a repeat/roughness change, and §18's own
  example ("his own CC0 textures") is precisely about judging tiling density,
  which is the repeat slider — so P-2 under-serves the actual ask.

**Recommend P-1.** It's what §18 is really asking for; P-2 is the fallback if
the draft-mode slider behaviour is judged not worth the wiring.

## 1.3 Where the preview lives in the panel — sub-option

- **Inline (recommended):** the `SurfaceRow` expands in place to show the
  preview canvas + Confirm/Cancel below the upload button, styled as a flat
  bordered card (matching the sidebar panel language — `DESIGN.md` product-card
  / flat-elevation vocabulary). Keeps the row's context; a fixed small canvas
  like `ObjectPreview3D`'s box.
- **Modal/overlay:** a larger centered preview. More room to judge tiling, but
  `DESIGN.md` documents no modal pattern, so it'd invent chrome — and three
  rows each potentially opening a modal is heavier. Not recommended unless the
  inline canvas proves too small to judge tiling (open question 3).

---

# Part 2 — slider microcopy + tooltip mechanism

## 2.1 Mechanism — decide once, reuse everywhere

§18 is explicit: the tooltip mechanism should be "decided once, then reused for
every slider needing one — not one-off per slider." Three candidates:

- **Option T-1 — native `title` attribute.** Zero code: add `title="…"` to each
  label. *Pros:* free, nothing to build, keyboard/AT-readable. *Cons:*
  browser-default styling (can't touch a design token), a long hover delay, no
  touch support, and — the deciding objection — it can't carry the design
  language, so it quietly violates the "no undocumented interaction variants"
  spirit rather than documenting a real one.
- **Option T-2 — custom `<InfoTip>` component (recommended).** A small reusable
  component: a Lucide `Info` icon (sized per §2's proposed icon scale, so it's
  consistent the moment that lands) sitting after the slider label; on
  hover/focus it reveals a token-styled popover — Soft Stone `#eeece7` or
  near-black `#17171c` field, radius `xs`/`sm` (4–8px), `body`/`mono-label`
  type, `#d9d9dd` hairline border, no shadow (flat, per DESIGN.md elevation).
  One component, dropped anywhere as `<InfoTip>Repeat controls…</InfoTip>`.
  *Pros:* on-brand, reusable, keyboard-focusable, the "decide once" the ask
  wants. *Cons:* it's net-new UI, and since DESIGN.md has no tooltip entry,
  adopting it means *documenting* a new `info-tooltip` component in DESIGN.md
  (open question 5) — a feature of this option, not a bug, given the "no
  undocumented variants" rule.
- **Option T-3 — always-visible inline caption.** A small muted caption under
  each label (no hover at all). *Pros:* simplest possible, no popover
  positioning, always discoverable. *Cons:* adds permanent vertical clutter to
  a dense sidebar panel across three surface rows × three sliders; §18 asked for
  an "info-tooltip," implying on-demand, not always-on.

**Recommend T-2.** It's the only option that satisfies "decide once, reuse,
on-brand" and turns the tooltip into a documented component instead of ad-hoc
chrome. T-1 is the acceptable stopgap if Shyam wants zero new UI right now.

## 2.2 Drafted microcopy

Brief, per-slider, describing what each does visually when raised/lowered.
(`Repeat` defaults to `1×`, range 0.25–4; `Roughness` is a **multiplier**,
default `1×`, range 0–2, clamped 0–1 after scaling — so 1× = "as-is," hence the
"above/below 1×" framing.)

- **Repeat X** — *"How many times the texture repeats left-to-right across this
  surface. Raise it for smaller, tighter tiles; lower it for larger,
  more zoomed-in tiles."*
- **Repeat Y** — *"How many times the texture repeats top-to-bottom across this
  surface. Raise it for smaller, tighter tiles; lower it for larger,
  more zoomed-in tiles."*
- **Roughness** — *"Scales how matte or glossy the surface looks under light.
  Above 1× reads flatter and more matte; below 1× reads smoother and more
  reflective."*

(Optional, if Tint ever gets one too — *"Multiplies a color over the texture.
White leaves it unchanged; any other color washes the surface toward that
hue."*)

---

## Explicit non-goals (do not scope-creep)

- **No change to `photoToTileableBlob` or the tiling pipeline.** The preview
  renders whatever the pipeline already produces; this proposal doesn't touch
  how tileability is computed.
- **No change to `shellMaterials.ts`'s calibration math.** The preview *reuses*
  `makeTexture` / `applyCalibrationToMaterial`; it must not fork them (that's
  how the preview stays faithful to the committed result).
- **No new storage/schema.** `SurfaceCalibration` is unchanged; the draft is
  transient component state, committed through the existing `onChange`.
- **No perfect per-surface tile-count match in the preview.** The preview shows
  relative tiling on a neutral plane (§1.1 caveat), not the exact wall/floor
  tile count — matching reality exactly would mean feeding real surface
  dimensions into the preview, which is out of scope (open question 4).
- **Tooltip is not a general popover system.** T-2 is a one-purpose `<InfoTip>`
  for slider help, not a generic floating-UI framework.

## Open questions for Shyam

1. **Preview draft scope — P-1 (whole calibration) or P-2 (photo only)?**
   Recommendation is **P-1**: preview + tune repeat/roughness/tint against the
   isolated plane, commit the finished result in one act. P-2 is smaller but
   can't preview a tiling change, which is most of the point. (P-1 recommended.)
2. **Defer `putAsset` to Confirm?** Recommendation yes — a cancelled preview
   then writes no orphan OPFS asset. Any reason you'd want the blob persisted
   the moment it's generated (e.g. to survive a mid-preview reload)? (Lean:
   defer.)
3. **Preview placement + camera — inline straight-on, or something bigger?**
   Recommendation: inline flat-card canvas, straight-on framing (reads tiling
   best). Is a small inline canvas enough to judge tiling, or do you want a
   larger/orbitable view (and accept inventing a modal pattern DESIGN.md doesn't
   have)? (Lean: inline + straight-on, add light orbit only if it feels
   cramped.)
4. **How faithful must the preview tile-count be?** The preview shows relative
   tiling, not the exact per-wall/floor tile count (the real shell scales repeat
   by surface size). Is "does this tile cleanly / look right" enough, or do you
   want the preview to reproduce the true tile count per surface (more wiring —
   the preview would need each surface's real dimensions)? (Lean: relative is
   enough for §18's intent.)
5. **Tooltip mechanism — T-2 `<InfoTip>` (and document it in DESIGN.md), or
   T-1 native `title` for now?** Recommendation **T-2**, and record a small
   `info-tooltip` component in DESIGN.md (same precedent as §2's icon-size
   rule), since a tooltip is exactly the kind of chrome the "no undocumented
   variants" rule wants documented. T-1 is the zero-build stopgap if you'd
   rather not open a new component yet. (T-2 recommended.)
6. **Microcopy voice.** The drafts above are plain and literal. Want them
   terser (e.g. just "Smaller tiles ↔ larger tiles"), or is the
   one-sentence-with-raise/lower framing right? (Lean: keep as drafted — it
   answers "what does this do" without assuming Three.js knowledge.)
