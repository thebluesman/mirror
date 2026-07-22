# Proposal: additional tint blend modes (`tintBlendMode` field) — improvements-minor-fixes §10

**Status:** proposed — awaiting Shyam's review (2026-07-22)
**Date:** 2026-07-22
**Scope frame:** additive per-item option alongside the existing multiply
tint, not a replacement. realladygrey surveys and shortlists per §10's
decision — Shyam had no specific modes in mind.

## Problem

The per-item tint (improvements-v2.2 §5) only ever multiplies a chosen color
into the material's base color. It works and Shyam likes it, but "multiply
only" is one point in the much larger space of photo-editing blend modes
(screen, overlay, soft-light, etc.), and he wants more of that space
available as a per-item choice — not instead of multiply, in addition to it.

The catch: almost every blend-mode reference (Photoshop, CSS
`mix-blend-mode`, GIMP) defines these modes for two *images* — a backdrop
and a source, both spatially varying. Here there is no source image, only a
single flat tint color being combined with a base that is sometimes flat
(placeholder box) and sometimes a photo-derived texture (an imported GLB, or
the rug's flat-texture top face). Not every mode survives that substitution
with a result that's still useful for "tint this piece of furniture" — this
proposal works out which ones do.

## Recommendation (summary)

Add one optional field, `tintBlendMode`, alongside the existing `tintColor`
on both furniture union branches, as a fixed `z.enum` of five modes:
**multiply** (existing, default), **screen**, **overlay**, **soft-light**,
**darken**. Optional, no `.default()`, no `SCHEMA_VERSION` bump — same shape
as `tintColor` and `locked`. A `<select>` goes in `TintRow` next to the
existing color `<input type="color">`, only rendered once a tint is
actually set (the mode has no effect without a color). Implementation cost
is *not* uniform across the shortlist: multiply is already free (a single
`.color.multiply()` call); the other four are cheap for the flat/untextured
placeholder-box path but require a real `onBeforeCompile` shader patch for
the textured GLB/rug path, which is the common case once an item has an
imported model. See §4.

## 0. How the current multiply tint actually works (grounding)

Two call sites implement `tintColor` today, both doing the same thing —
multiplying the tint into whatever color value the material already carries,
no shader, no `onBeforeCompile`:

- **Placeholder box furniture** — `furnitureMaterialFor` in
  `src/scene/buildScene.ts:255-260`:
  ```ts
  function furnitureMaterialFor(item: FurnitureItem): THREE.MeshStandardMaterial {
    if (!item.tintColor) return MAT.furniture;
    const mat = MAT.furniture.clone();
    mat.color.multiply(new THREE.Color(item.tintColor));
    return mat;
  }
  ```
  `MAT.furniture` (`buildScene.ts:39`) is a flat `MeshStandardMaterial` —
  `color: 0xb9ac8f, roughness: 0.7`, **no texture map**. `.color` is the
  material's *only* color signal here, so `.multiply()` is exact and total.

- **Imported GLB furniture** — `applyModelTint` in
  `src/scene/loadFurnitureModel.ts:107-116`, called from
  `src/components/Viewport.tsx:713` once a model finishes loading:
  ```ts
  export function applyModelTint(model: THREE.Object3D, tintColor: string): void {
    const tint = new THREE.Color(tintColor);
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        (mat as THREE.Material & { color?: THREE.Color }).color?.multiply(tint);
      });
    });
  }
  ```
  This walks every mesh/material a Hunyuan3D GLB carries and multiplies each
  one's `.color` by the tint — but a generated GLB's materials typically
  *do* carry a baked albedo/base-color texture map from the source photo.
  `.color` is a uniform that the standard PBR shader multiplies against the
  sampled texture (`diffuseColor = material.color * texture(map).rgb`), so
  `.multiply()` here is scaling every texel by the same constant — still
  exact, because multiply is linear and commutes with "sample then scale."

- **The rug's flat-texture top face** (`flatTextureHash`,
  `buildScene.ts`'s `addFlatTextureFurniture` path) starts from
  `furnitureMaterialFor`'s flat-color material and has a texture (`.map`)
  filled in asynchronously by `Viewport.tsx` once the photo loads
  (`Viewport.tsx:738-759`). Once that happens it's in the same "textured
  base" bucket as a GLB, not the flat-box bucket, even though it starts from
  the box code path.

This distinction — **flat scalar base vs. per-texel textured base** — is
exactly what determines which blend modes are cheap and which need shader
work (§4). It doesn't show up in `tintColor`'s own implementation because
multiply happens to be linear and commutes through a texture sample; most
other blend modes are not linear in the base value and don't have that
property.

## 1. Survey: which blend modes have a clean flat-tint equivalent

Every standard blend-mode formula (Photoshop, CSS Compositing) is already
defined per-pixel/per-channel — that part isn't the obstacle. Substituting a
constant tint color for the "source layer" at every pixel is mathematically
well-formed for *any* mode; the backdrop can vary per-texel or be a single
scalar, the math doesn't care. So "does it have a clean formula against a
flat color" is true for essentially the whole catalog. The two things that
actually differ per mode are **(a) whether the result looks like a useful
tint** for furniture recoloring, and **(b) what it costs to render** against
a textured base (§4). Below, `base` = the material's existing base color
channel (backdrop), `tint` = the item's chosen `tintColor` channel (source),
both in `[0, 1]`.

### Shortlisted (5, including multiply)

| Mode | Formula (`base`, `tint` → result) | Character |
|---|---|---|
| **Multiply** (existing) | `base * tint` | Darkens toward tint; existing behavior, unchanged. |
| **Screen** | `1 - (1 - base) * (1 - tint)` | Lightens toward tint; multiply's mirror image. |
| **Overlay** | `base <= 0.5 ? 2*base*tint : 1 - 2*(1-base)*(1-tint)` | Contrast-preserving recolor — darkens dark base, lightens light base, both toward tint. |
| **Soft-light** | `tint <= 0.5`: `base - (1 - 2*tint)*base*(1-base)`; else `base + (2*tint - 1)*(D(base) - base)`, where `D(base) = base <= 0.25 ? ((16*base - 12)*base + 4)*base : sqrt(base)` | Same intent as overlay, gentler — the "airbrush" version. |
| **Darken** | `min(base, tint)` | Clamps toward tint only where tint is darker — good for a "grime/shadow" wash. |

Overlay and soft-light use the standard W3C-compositing / Photoshop
formulas (soft-light's is the exact piecewise form, not the simplified
`2*base*tint + base²*(1-2*tint)` approximation some references use, which
diverges visibly near `base ≈ 1`).

### Excluded, and why

- **Hard-light.** `Hard-light(base, tint) = Overlay(tint, base)` — literally
  the same formula with the two operands swapped. Over a flat tint the
  practical difference from overlay is which of "the fixed tint" or "the
  varying base" drives the 0.5 split; overlay (split on `base`) reads more
  naturally as "recolor this object" since the split follows the object's
  own shading, not a single fixed threshold from the tint color. Not enough
  distinct value to justify a second slot next to overlay.
- **Lighten.** `max(base, tint)` — darken's mirror, same shape and same
  formula class. Screen already covers "push the result toward a lighter
  version of the base," and in practice lighten and screen produce visually
  similar washed-out results for typical furniture-tint use (light tint
  colors). Kept darken (a genuinely different "shadow wash" look) over
  lighten to avoid two modes that read almost the same in the UI.
- **Color / Hue / Saturation / Luminosity** (the non-separable HSL family).
  These *are* well-defined against a flat tint — in fact "Color" is close
  to what a naive user might expect "tint" to mean (replace the base's hue
  and saturation with the tint's, keep its lightness/shading intact). But
  unlike every mode above, they are not per-channel-independent: computing
  them requires converting `base` to HSL, substituting components from
  `tint`, and converting back, per texel. That's a materially bigger shader
  patch than the separable modes above (§4) for a case that's genuinely
  useful but not asked for. Worth a follow-up round if Shyam wants a
  "recolor while preserving surface shading" mode specifically — flagged as
  a real candidate, just not bundled into this batch's cost estimate.
- **Difference, Exclusion, Add/Linear-Dodge, Subtract, Divide, Vivid-light,
  Linear-light, Pin-light.** All have equally clean flat-tint formulas —
  this isn't a math exclusion. They're excluded on product fit: against a
  single flat tint these either invert/solarize unpredictably (difference,
  exclusion) or blow out to pure black/white for a wide swath of ordinary
  tint colors (add, subtract, divide, the "light" family are all designed
  for combining two full-contrast images, not softly recoloring a beige
  sofa). None of these read as "a tint" the way multiply/screen/overlay/
  soft-light/darken do.

## 2. Schema

Mirrors `tintColor`'s exact shape (`src/schema/scene.ts:225`,
`src/schema/scene.ts:247`) — optional, no `.default()`, declared on both
union branches so `z.infer` types it directly rather than leaving it
reachable only via `.loose()`'s untyped passthrough (same reasoning as
`locked` and `category`).

```ts
// improvements-minor-fixes §10: which blend formula combines tintColor with
// the material's base color. Multiply is the enum's own implicit default —
// undefined means "multiply," not "no blend," so every existing item with a
// tintColor and no tintBlendMode keeps rendering exactly as it does today.
// No schema .default("multiply") for the same reason category avoids
// .default("other"): .default() fires at parse time and would rewrite every
// legacy item to *explicitly* carry "multiply," destroying the "never set"
// vs. "deliberately chose multiply" distinction for no benefit — the
// fallback belongs in the render code (furnitureMaterialFor / applyModelTint),
// not the schema. Meaningless without tintColor also set; the schema doesn't
// enforce that pairing, same posture as category/shape independence.
export const TintBlendMode = z.enum(["multiply", "screen", "overlay", "soft-light", "darken"]);
export type TintBlendMode = z.infer<typeof TintBlendMode>;
```

Field, added next to `tintColor` on both `BoxFurniture` (`scene.ts:225`)
and `CompoundSofaFurniture` (`scene.ts:247`):

```ts
tintBlendMode: TintBlendMode.optional(),
```

No `SCHEMA_VERSION` bump, no `migrate()` change — purely additive optional,
identical situation to `tintColor` and `category`. A file with no
`tintBlendMode` on any item validates unchanged and every tinted item reads
back exactly as it renders today (multiply).

## 3. UI

`TintRow` (`src/components/ImportPanel.tsx:312-358`) gets a `<select>` next
to the existing `<input type="color">`. Rendered **inside the same
`{item.tintColor && (...)}` block** as the "Clear tint" button
(`ImportPanel.tsx:351-355`), not unconditionally — the field has no visual
effect without a `tintColor`, so there's no state where the mode picker is
visible but inert.

```tsx
{item.tintColor && (
  <>
    <label className="import-field">
      <span>Blend mode</span>
      <select
        value={item.tintBlendMode ?? "multiply"}
        onChange={(e) => onBlendModeChange(e.target.value as TintBlendMode)}
      >
        <option value="multiply">Multiply</option>
        <option value="screen">Screen</option>
        <option value="overlay">Overlay</option>
        <option value="soft-light">Soft light</option>
        <option value="darken">Darken</option>
      </select>
    </label>
    <button type="button" className="import-panel-button-secondary" onClick={handleClear}>
      Clear tint
    </button>
  </>
)}
```

Needs a new handler in `ImportPanel.tsx` mirroring `handleTintChange`
(`ImportPanel.tsx:157-162`) — `handleBlendModeChange(itemId, tintBlendMode)`
setting the field directly on the matching item, union-spread-preserved the
same way. Unlike the color picker, a `<select>` change is a discrete pick,
not a drag — commit immediately, no `useDebouncedCallback`/
`TINT_DEBOUNCE_MS` (`ImportPanel.tsx:19`,`325`) needed for it, same
reasoning `handleClear` already uses for its own immediate commit.
"Clearing" the mode isn't a separate action — clearing the *color* already
removes the tint entirely, and the mode select simply reappears defaulted
to "Multiply" the next time a tint is set (it does not need its own
"reset" affordance).

## 4. Implementation approach — cost by rendering path

This is not one implementation, it's two, because of §0's flat-vs-textured
split:

**Flat/untextured base (placeholder box furniture, `furnitureMaterialFor`).**
`base` is a single scalar per channel — no texture map on `MAT.furniture`.
Every shortlisted mode reduces to one blend computed once in JS and written
straight to `.color` via `.setRGB(...)`, replacing today's
`.color.multiply(...)` call with a small `blendTint(base, tint, mode)`
dispatch function. Zero shader work, stock `MeshStandardMaterial`, same
clone-per-tinted-item pattern already in place. Cheap regardless of mode.

**Textured base (imported GLB via `applyModelTint`; the rug's
`flatTextureHash` top face once its texture loads).** `base` is sampled
per-texel from an albedo/base-color map, and the standard PBR shader only
ever *multiplies* that sample by `material.color`
(`diffuseColor = material.color * texture.rgb`). That's the entire reason
multiply is free today — a per-texel multiply by a texture commutes with an
extra scalar multiply, so folding the tint into `.color` is exact. None of
the other four shortlisted modes have that property:

- **Screen** is affine in `base` (`base*(1-tint) + tint`) but has an
  *additive* constant term (`+ tint`) that `.color` cannot express — `.color`
  is purely multiplicative in the stock shader. There's no material-color
  trick that reproduces it exactly.
- **Overlay, soft-light** are piecewise/nonlinear in `base` (the `base <=
  0.5` split, soft-light's `D(base)`) — not expressible as any single scalar
  multiply of `base` at all.
- **Darken** (`min`) is nonlinear (a comparison), same problem.

So for the textured path, multiply stays a one-line change (already true
today) and the other four require an actual `onBeforeCompile` patch: inject
the mode's formula into the fragment shader after the texture sample, with
the tint color (and a mode selector, likely a `#define` per compiled
variant rather than a runtime branch, to avoid a shader recompile every time
a color changes) passed in as a uniform. This has to run once per distinct
material a GLB carries (`applyModelTint`'s existing `model.traverse` already
walks all of them) and needs a matching patch point for the rug's top-face
material once `Viewport.tsx:738-759` fills in its `.map`.

Practically: build a single shared helper, e.g.
`applyTintBlend(material, tintColor, mode)`, used by both
`furnitureMaterialFor` (which can keep taking the cheap flat-scalar shortcut
when it detects no `.map` on the material) and `applyModelTint`/the rug
top-face path (which goes through `onBeforeCompile` for any mode other than
multiply). The honest cost statement for Shyam: **multiply is free, and the
placeholder-box case is free for all five modes — but a real imported GLB
(the common case once an item has gone through the fal.ai pipeline) needs a
genuine shader patch for screen/overlay/soft-light/darken, not a copy-paste
of the existing one-liner.** That's real but bounded work — one shader
chunk, written once, parameterized by mode — not an open-ended cost.

## 5. Open questions for Shyam

1. **Ship all five now, or start smaller?** The flat/placeholder-box path is
   free for all five; the cost is entirely in the textured-GLB path (§4). If
   the shader-patch work is worth deferring, a first cut could ship
   `tintBlendMode` with just `multiply`/`screen` (screen is the next
   cheapest conceptually — mirror of multiply) and add overlay/soft-light/
   darken once the `onBeforeCompile` plumbing exists. No strong preference —
   flagging because it's a real sequencing choice, not because five modes is
   too many to build at once.
2. **Is "Color" (HSL recolor) worth a follow-up round?** Excluded from this
   shortlist for cost (§1) — it's arguably the most intuitive "tint" of all
   ("give it this color, keep its shading"), but non-separable and a bigger
   shader lift than the other four. Worth its own pass if the shortlisted
   five don't scratch the itch.
3. **Per-mode UI copy?** "Screen"/"Overlay"/"Soft light"/"Darken" are the
   standard photo-editing names (matches Photoshop/CSS `mix-blend-mode`
   terminology Shyam is likely already fluent in from that domain) — no
   translation into house-decorating language proposed. Flag if that reads
   wrong in the actual `<select>`.
