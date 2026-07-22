# Proposal: give the manipulation handles a design-system voice — improvements-minor-fixes §5

**Status:** approved for build (2026-07-22 review) — **Option B** (shape +
palette reskin) confirmed. The three open sub-questions (Coral-on-hover vs.
Coral-only-while-dragging; whether to document handle colors in `DESIGN.md`;
whether to align collision-red to the documented Error hex) were not
explicitly re-decided at review time — carry forward this doc's own
recommended leans (hover-triggers-Coral; document the mapping in
`DESIGN.md`; keep the brighter `#ff5c5c` over the darker documented Error
red) unless Shyam says otherwise when this is actually built.
**Date:** 2026-07-22
**Scope frame:** a *visual* reskin of the three existing manipulation handles
(rotate ring, rotate knob, elevation double-arrow). No change to what they do,
how they raycast, how they commit, or the state-color *semantics* (idle /
hover / collision / locked stay four distinct states). Geometry, proportions,
and the color assignments are the only things in scope.

## Problem

The manipulation handles work but look like default Three.js gizmo parts, not
like this product. Concretely, today (`Viewport.tsx:279–334`):

- **Rotate ring** — a `TorusGeometry(ringRadius, 2.5, 12, 64)` laid flat on the
  floor: a round-tube donut, 2.5 cm tube radius.
- **Rotate knob** — a `SphereGeometry(6, 16, 16)`: a plain ball riding the ring
  at the item's front.
- **Elevation handle** — a `CylinderGeometry(1.6, 1.6, 24, 12)` stem capped by
  two `ConeGeometry(4, 9, 16)` arrowheads: a thin double-arrow.
- **Material** — every mesh is one `MeshBasicMaterial`, unlit flat color,
  `depthTest: false`, `renderOrder: 999` (an always-on-top overlay).
- **Color** — all four states are hardcoded hexes chosen for legibility, not
  from `DESIGN.md`: idle/selection `SELECTION_COLOR = 0x4fd1ff` (a cyan), hover
  `0xd6f5ff` (pale cyan), collision `COLLISION_COLOR = 0xff5c5c` (red), locked
  `LOCKED_COLOR = 0xffc94f` (amber).

`DESIGN.md`'s vocabulary — the radius scale, pill/rounded-rect shape language,
the Coral `#ff7759` / Action Blue `#1863dc` accents, and crucially the
**"elevation = no shadows; depth via flat fields, not blur"** rule — has never
been applied here. The good news buried in that last point: `MeshBasicMaterial`
(unlit, flat, shadeless) is *already* the 3D analog of the design system's
flat-depth philosophy. So a reskin is mostly about **silhouette and color**,
not about adopting lit/shadowed materials — the current material choice is
already on-language and all three options below keep it.

### The one cross-cutting constraint: the color-state system

`DESIGN.md`'s two accents don't drop in naively, because the handles already
carry a **four-state color language** (idle / hover / collision / locked), and
`Viewport.tsx` composes those states with a fixed precedence (collision wins
over locked, `updateCollisionHighlight`). Two collisions to design around:

1. **Coral `#ff7759` sits right next to the existing collision red
   `#ff5c5c`.** If Coral becomes the *idle* handle color, a resting handle and
   a colliding handle would read as nearly the same hue — destroying the
   collision signal. So Coral **cannot** be the idle color.
2. But Coral is *perfect* for **hover/active** — `DESIGN.md` literally assigns
   Coral to "active-state markers" and the blog-filter-chip's active fill. That
   maps cleanly: **Action Blue `#1863dc` = idle selection** (the system's
   link/accent color, distinct from both red and amber), **Coral = the handle
   you're actively engaging** (hover, and during a drag). Because collision
   already wins over every other state in the compositor, Coral-hover and
   red-collision are never shown on the same handle at the same time — the
   existing precedence resolves the near-hue clash for free.

This Action-Blue-idle / Coral-active mapping is shared by **all three options
below** — it's the "color voice" half of §5 and it's the same regardless of
which silhouette Shyam picks. The options differ in the "shape voice" half.

## Recommendation (summary)

**Option B (shape + palette reskin).** Swap the three generic primitives for
design-system silhouettes — a flat annulus ring, a **pill grip knob**, and a
rounded-cap elevation arrow with chevron heads — recolor to Action-Blue-idle /
Coral-active, and keep everything else (MeshBasic flat material, depthTest-off
overlay, the group-of-meshes structure, all positioning/raycast/commit code)
exactly as is. It's the option that actually makes the handles *read* as this
product (pill language, flat rings, softened corners), while staying entirely
inside built-in Three.js geometry — no shaders, no new rendering machinery, a
contained edit to two builder functions plus the color constants. Option A is
the cheap fallback (color only, generic shapes remain); Option C is the stretch
if Shyam wants the handles to literally carry the "1px ink border + two-tone
fill" chrome motif and will accept the fat-line-addon complexity.

---

## Option A — palette & material reskin (color only, keep every shape)

**What changes.** Nothing geometric. Only the four color constants
(`Viewport.tsx:219–238`) and their roles:

| State | Today | Option A |
|---|---|---|
| Idle / selection | `0x4fd1ff` cyan | **Action Blue `0x1863dc`** |
| Hover / active | `0xd6f5ff` pale cyan | **Coral `0xff7759`** |
| Collision | `0xff5c5c` red | `0xb30000` (align to `DESIGN.md` Error) or keep |
| Locked | `0xffc94f` amber | keep (already a warm-amber, on-language) |

The torus ring, sphere knob, and cone double-arrow are untouched. Material
stays `MeshBasicMaterial`. `setHandleColor`'s traverse-and-recolor already
handles any number of meshes, so the state compositor needs no structural
change — only the constants it feeds in.

**Build cost / risk.** Lowest possible — a handful of constant edits, no new
geometry, no shader, no positioning changes, no new disposal concerns. Risk
near zero.

**What it buys / doesn't.** Fixes the *color* voice completely (handles now
speak Action Blue / Coral like the rest of the chrome). Does **not** fix the
*shape* voice — the silhouette is still a generic donut + ball + thin
double-arrow. If §5's complaint is "wrong colors," this closes it; if it's
"reads as a default gizmo," this only half-closes it.

---

## Option B — shape + palette reskin (recommended)

Everything in Option A's color mapping, **plus** three silhouette swaps that
quote `DESIGN.md`'s shape language. All geometry below is built-in Three.js
(`RingGeometry`, `Shape` + `ExtrudeGeometry`); material stays `MeshBasic`;
depthTest-off / renderOrder-999 overlay treatment is preserved; the group
structure, `userData.ringRadius`/`userData.knob` stashing, and every
positioning/raycast/commit path stay identical.

**Rotate ring — round tube → flat annulus.** Replace
`TorusGeometry(r, 2.5, …)` with a `RingGeometry(rInner, rOuter, 64)` laid flat
(`rotation.x = π/2`), a thin flat washer rather than a 3D donut. This is the
direct 3D read of the system's "flat, no-shadow, depth-via-field" elevation
rule — a flat ring on the floor looks *drawn on*, like a UI stroke, not like a
lit torus. Keep `ROTATE_HANDLE_LIFT_CM` to avoid z-fighting the rug. Ring
"thickness" becomes `rOuter − rInner` (propose ~3 cm, echoing a bordered
stroke).

**Rotate knob — sphere → pill grip.** Replace `SphereGeometry(6)` with a
**rounded-rectangle pill** — a `Shape` rounded-rect (corner radius from the
`DESIGN.md` radius scale; at ~6 cm a `pill`/`xl`-proportioned full-round cap
reads best) `ExtrudeGeometry`'d to a shallow depth, oriented tangent to the
ring at the item's front. This is the single most legible design-system quote
available: it's the **button-pill / pill-CTA silhouette** the whole UI uses,
turned into a 3D grip. It reads unambiguously as "pinch and turn me," and it
inherits the camera-relative constant-on-screen sizing the sphere had
(`positionRotateHandle`'s `knob.scale.setScalar(cameraRelativeScale(...))`) with
no change.

**Elevation arrow — thin double-arrow → rounded-cap stem + chevrons.** Replace
the sharp cones with softer heads and round the stem's caps: either (a) keep
`CylinderGeometry` but cap it with **chevron** heads (two short extruded
`Shape` chevrons) instead of sharp cones, or (b) render the stem as a slim
vertical **pill** (rounded top/bottom) with chevrons — corner/tip treatment
softened per the radius scale so it stops looking like a physics-lab vector and
starts looking like a UI stepper. Same up/down raycast target, same
`positionElevationHandle` math (the group's overall extent is unchanged if the
chevron heights match the old cone lengths).

**Color.** Action-Blue idle / Coral active exactly as Option A.

**Build cost / risk.** Moderate. `RingGeometry` is a one-line swap (built-in).
The pill knob and chevrons need `Shape` + `ExtrudeGeometry` (built-in, no
shader) — the only genuinely new code is authoring two rounded-rect/chevron
`Shape` paths, plus making sure `disposeHandle` still disposes them (it
traverses, so it already does). No change to raycasting, hover, the state
compositor, per-frame positioning, or commit. Risk low: it's the same
architecture with different meshes inside the same groups.

**What it buys.** Closes both halves of §5 — color *and* shape now speak the
design language, and the pill knob in particular makes the handles
unmistakably part of this product. This is the recommendation.

---

## Option C — chrome-matched treatment (two-tone borders + constant-width lines)

Everything in Option B, **plus** carrying the system's *bordered / two-tone*
motif into 3D:

- **Two-tone ring & knob** — echo `button-pill-outline` (1px ink border,
  transparent/filled interior): render each handle as an Action-Blue fill mesh
  plus a thin **near-black `#17171c` outline** (`DESIGN.md`'s "1px ink border"
  from the form-field / pill vocabulary). The state color drives the *fill*;
  the border stays ink — so a handle reads as a bordered UI object, not a
  flat-filled blob.
- **Constant-width ring stroke** — to make the ring's outline hold a constant
  *pixel* width regardless of zoom (the way a UI border is always 1px, not
  thicker when you lean in), draw it with the `Line2` / `LineMaterial` fat-line
  addon rather than geometry, with its `resolution` uniform updated on resize.

**Build cost / risk.** Highest. Two-tone means more meshes per handle, and the
state compositor (`setHandleColor`) must learn to recolor *only the fill* and
leave the ink border alone — today it recolors every mesh it traverses, so this
needs a `userData` tag to distinguish fill from border (a real but bounded
change). The `Line2` addon is the risky part: it's an addon (not core), it
needs per-resize `resolution` bookkeeping, and it interacts with the
depthTest-off / renderOrder-999 overlay treatment in ways that need testing
(fat lines and manual render order don't always compose cleanly). This is the
only option that introduces a non-built-in material and new per-frame state.

**What it buys.** The highest-fidelity match to the 2D system — the handles
would literally carry the border + two-tone + constant-stroke chrome language.
Worth it only if Shyam specifically wants that and accepts the addon complexity;
Option B already reads as on-brand without any of it.

---

## Option comparison

| | Rotate ring | Knob | Elevation | New geometry? | Shader/addon? | State-compositor change | Risk |
|---|---|---|---|---|---|---|---|
| **A** | torus (unchanged) | sphere (unchanged) | cones (unchanged) | none | no | none | ~zero |
| **B** | flat annulus | **pill grip** | rounded-cap + chevrons | built-in `Shape`/`Extrude` | no | none | low |
| **C** | two-tone + fat-line stroke | two-tone pill | two-tone chevrons | built-in + `Line2` addon | **yes (`Line2`)** | fill-vs-border tagging | med |

All three share the **Action-Blue-idle / Coral-active** color mapping and keep
the flat `MeshBasic` / overlay treatment.

## Explicit non-goals (do not scope-creep)

- **No new manipulation *behavior*.** Same three gestures, same snap, same
  keyboard steps, same commit paths. This is paint, not mechanics.
- **No change to the four-state *semantics*.** Idle / hover / collision /
  locked stay four distinct, separately-meaningful states with the existing
  precedence (collision wins over locked). Only the hexes and which state gets
  which accent change.
- **No lit / shadowed materials.** `MeshBasicMaterial` stays — it's the correct
  3D read of `DESIGN.md`'s flat-depth rule, not a compromise.
- **No repositioning / resizing logic changes.** `positionRotateHandle` /
  `positionElevationHandle` and the camera-relative sizing are untouched; new
  meshes drop into the same groups those functions already move.
- **Not a DESIGN.md rewrite.** If Shyam wants the handle color roles recorded
  (like §2's proposed icon-scale rule), that's a one-line addition to
  `DESIGN.md`'s component section — flagged as open question 3, not assumed.

## Open questions for Shyam

1. **Which option?** Recommendation is **B** — genuine shape + color reskin,
   all built-in geometry, contained edit. **A** if you only care that the
   colors match and are fine with the generic donut/ball silhouette. **C** if
   you want the handles to literally carry the bordered/two-tone chrome motif
   and accept the fat-line-addon complexity. (B recommended; this is the call
   that's genuinely yours.)
2. **Coral for hover, or reserve Coral for the drag-in-progress only?** The
   mapping is Action-Blue-idle / Coral-active. "Active" could mean *hovered*
   (Coral on mouseover, matching today's brighten-on-hover) or *only while
   actually dragging* (hover stays a lighter Action Blue, Coral appears just
   during the gesture). The former is simpler and matches the current
   hover-brighten idiom; the latter reserves Coral for true engagement. Lean:
   Coral on hover (simplest, and hover *is* the "you're about to grab this"
   signal). Either way collision-red still overrides.
3. **Record the handle color roles in DESIGN.md?** `DESIGN.md` has no entry for
   3D-handle state colors today. Want this proposal's mapping (Action-Blue
   idle, Coral active, red collision, amber locked) written into DESIGN.md as a
   small documented component — same precedent as §2's proposed icon-size rule
   — so it can't drift, or keep it as constants in `Viewport.tsx` only? (Lean:
   one short DESIGN.md line; it's exactly the "no undocumented interaction
   variants" rule §5 cites.)
4. **Align collision red to the documented Error `#b30000`?** Today's collision
   red `#ff5c5c` is a lighter red than `DESIGN.md`'s Error `#b30000`. Snap it to
   the documented Error hex for full palette consistency, or keep the brighter
   `#ff5c5c` because a dark Error red reads poorly as an always-on-top overlay
   against furniture? (Lean: keep the brighter red — legibility as an overlay
   beats palette purity here, and it's still unmistakably "red = problem.")
