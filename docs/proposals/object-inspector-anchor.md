# Proposal: reposition `ObjectInspector` relative to the selected object — improvements-minor-fixes §11

**Built (2026-07-22):** implemented per this doc's §1–§3, with one
reconciliation against work that landed after this proposal was drafted —
`improvements-minor-fixes.md §3`'s keyboard-cheatsheet pass wrapped
`ObjectInspector` in a new `.object-inspector-wrap` (a selection-hint pill
stacked above the card) and moved the fixed-corner positioning onto that
wrapper. Rather than the forwardRef/useImperativeHandle route into
`ObjectInspector` this doc's §3 describes (written before the wrap existed),
`Viewport.tsx` anchors `.object-inspector-wrap` directly via a plain DOM
ref — it already renders that element itself, so this is simpler than
routing a ref through a child component, and it's the right unit anyway:
the hint pill and the card move together as one anchored block. The
below/above/side/clamp decision math lives in `src/scene/inspectorAnchor.ts`
as a pure, unit-tested function (`inspectorAnchor.test.ts`), fed by a
projection helper (`updateInspectorAnchor`) inside `Viewport.tsx`'s existing
`animate()` loop, called there and once synchronously from `selectItem`, per
§3. Panel size is cached via `ResizeObserver` (open question 1's lean), the
projection re-derives from live camera state every frame so `flyTo`/
saved-viewpoint recall is covered for free (open question 2), and the
off-screen/behind-camera fallback reuses the old fixed corner with no extra
"which item" affordance (open question 3). `npm run test`/`build`/`lint`
all pass.

**Status:** approved for build (2026-07-22 review) — all three open
questions confirmed per this doc's own leans: (a) cache the panel height,
re-measure via `ResizeObserver` on content change, not a per-frame
`getBoundingClientRect()` read; (b) yes, the panel follows the selected
object through camera moves too (saved-viewpoint recall, `flyTo`), not just
drag/orbit; (c) the existing title bar (`Edit "{item.name}"`) is sufficient
context for the off-screen/behind-camera clamp fallback — no extra
"which item" affordance needed there.
**Date:** 2026-07-22
**Scope frame:** repositioning logic for the existing `ObjectInspector`
panel only. Does not change what it edits (`ObjectEditFields`' name/dims/
rotation), its debounced-commit behavior, or add new fields.

## Problem

`ObjectInspector` is currently pinned to a fixed HUD corner —
`position: absolute; left: var(--space-24); bottom: var(--space-24)`
(`ObjectInspector.css:7-20`), chosen originally because it was "the one
corner none of [LayoutChrome/ViewportChrome/the mode-toggle pill] already
claims" (`ObjectInspector.css:1-6`). That reasoning is about avoiding HUD
collisions, not about the editor's relationship to what it edits — the panel
doesn't visually connect to the item it's modifying, and for an item on the
far side of the room from the bottom-left corner, editor and object can be
uncomfortably far apart on screen.

Shyam wants the panel to visually anchor to the selected object instead:
follow it in viewport-space as the camera orbits, but never go fully
off-screen or become unreachable while the item stays selected.

## Recommendation (summary)

1. **Anchor rule:** prefer **below** the object's on-screen bounding box,
   horizontally centered on it; fall back to **above** if there isn't
   vertical room below; fall back to the **nearest free side** (left/right)
   if there isn't room above or below either. See §1.
2. **Clamp margin:** reuse `--space-24` (24px) — the same inset the panel
   already uses today, and the one every other HUD chrome edge already
   standardizes on. See §2.
3. **Screen-space plumbing:** project the item's world-space bounding box
   through the camera inside `Viewport.tsx`'s existing `animate()` loop
   (same frame, same place the rotate/elevation handles already reposition
   themselves every frame), and thread the result to `ObjectInspector`
   **imperatively via a ref, not React state** — a per-frame `setState`
   here would re-render `Viewport` and `ObjectInspector` (and its child
   `ObjectEditFields`, with its debounce timers and local mirrors) 60
   times a second for a value nothing user-visible in the form actually
   depends on. See §3.

## 1. Anchor rule

### What "the object's on-screen position" means

A single projected point (e.g. the item's center) isn't enough to reason
about "is there room below/above" — a tall lamp and a wide rug have very
different on-screen extents from the same world-space center. The
codebase already computes exactly the world-space box needed:

- **Floor footprint (X/Z, rotation-aware):** `itemFootprintAABB(item,
  position, rotationDeg)` (`src/scene/collision.ts:29-56`) — already used
  every frame for collision highlighting, so this is a well-exercised,
  cheap, pure function, not new math.
- **Height (Y):** `furnitureOverallDims(item).h` (`src/scene/buildScene.ts`,
  already imported into `Viewport.tsx` and used by both manipulation
  handles).

Combine them into the box's 8 world-space corners (4 at `y = groupY`, 4 at
`y = groupY + h`), project each through `camera` with
`THREE.Vector3.project()`, convert each result from NDC (`-1..1`) to
container-pixel space:

```ts
const px = (ndc.x * 0.5 + 0.5) * containerWidth;
const py = (-ndc.y * 0.5 + 0.5) * containerHeight;
```

and take the min/max of the 8 projected `(px, py)` pairs to get the item's
on-screen bounding rect (`objLeft/objRight/objTop/objBottom`). This is
exact for any yaw and any camera angle (unlike projecting just the center
and estimating a radius), and reuses two functions the file already trusts
for per-frame work.

### The rule itself

Evaluated in this order; the first candidate that fits without needing to
clamp wins:

1. **Below.** Horizontally center the panel on `(objLeft + objRight) / 2`;
   top edge at `objBottom + GAP`. Fits if
   `objBottom + GAP + panelHeight + MARGIN <= containerHeight`.
2. **Above.** Same horizontal centering; bottom edge at `objTop - GAP`.
   Fits if `objTop - GAP - panelHeight - MARGIN >= 0`.
3. **Nearest side.** If neither vertical placement fits (the object's
   on-screen box is tall enough to fill most of the viewport — a very
   close camera, or a floor-to-ceiling item), fall back to whichever
   horizontal side has more room: right of `objRight` if
   `objRight < containerWidth / 2`... actually, right if the object's
   on-screen center-X is left of the container's center (more free space
   to its right), left otherwise. Vertically center on
   `(objTop + objBottom) / 2`.
4. **Clamp.** Whatever position steps 1–3 produced, clamp the panel's
   final `left`/`top` into
   `[MARGIN, containerWidth - panelWidth - MARGIN]` /
   `[MARGIN, containerHeight - panelHeight - MARGIN]`. This is what makes
   "goes off-screen" impossible even for a fully off-screen or
   behind-camera object (see the edge case below) — the clamp is the
   backstop, not just the near-edge case.

**Why below-first:** it keeps the panel clear of the elevation handle
(`createElevationHandle`, `Viewport.tsx:307-335`), which floats *above*
the item's top face — an above-first default would put the panel and that
drag handle fighting for the same screen region for every selected item
tall enough to have room above it. Below is also visually closer to how a
label/caption normally relates to the thing it describes.

**Why above is the first fallback, not a side:** it's the smaller visual
jump (the panel swaps top/bottom around the same horizontal center) and
keeps the "anchored above or below what it edits" reading Shyam described,
where a side-fallback reads more like "docked to a screen edge" again —
closer to the old behavior mentally. Sides are the fallback of last
resort, only reached when the object dominates the viewport vertically.

### Edge case: object behind the camera or fully off-screen

`Vector3.project()` for a point behind the camera returns NDC coordinates
with `z > 1` (or wildly outside `-1..1` on x/y) — a naive use would place
the panel somewhere nonsensical rather than off-screen. Guard explicitly:
if the projected point's `z > 1` (behind the near/far clip in the
"behind camera" sense) or the computed on-screen box doesn't overlap the
viewport at all, skip the anchor-rule math entirely and fall back to a
fixed clamped position — reuse the *old* fixed corner
(`left: MARGIN, bottom: MARGIN`) as that fallback, so "object not
currently visible" degrades to exactly today's behavior instead of a new
edge case to design. This can genuinely happen: nothing deselects the item
when the user orbits it out of view, so the panel needs a defined
position even then, per Shyam's "always reachable while selected"
requirement.

## 2. Clamp margin

**24px — `var(--space-24)`.** This is not a new number: it's the exact
inset the panel already uses today (`ObjectInspector.css:9-10`), and the
value every other floating HUD chrome already standardizes its
viewport-edge inset on (`ViewportChrome.css:1-4`'s `bottom: var(--space-24)`,
`ObjectInspector.css`'s own current `left`/`bottom`). Reusing it means the
clamped position, when it's active, sits exactly where the old fixed
corner used to — visually consistent with the rest of the chrome, and no
new token to justify.

Separately, the **object-to-panel gap** (`GAP` in §1's math, i.e. how far
off the object's edge the panel floats when *not* clamped) should be a
smaller, distinct value — `var(--space-16)` (16px) is proposed, enough to
read as "floating near" rather than "touching," without the aggressive
push-off effective the full 24px margin would look like this close to the
object. These are two different design decisions rewarding two different
tokens (screen-edge margin vs. anchor gap); conflating them into one
number is the wrong compression even though a first pass might reach for
the same value both places.

## 3. Screen-space plumbing

### Where the projection happens

Inside `animate()`, in the same conditional block that already repositions
the rotate/elevation handles every frame (`Viewport.tsx:1570-1580`):

```ts
if ((rotateHandle || elevationHandle) && selId) {
  const group = built.furnitureGroups.get(selId);
  const item = itemsByIdRef.current.get(selId);
  if (group && item) {
    if (rotateHandle) positionRotateHandle(rotateHandle, group, item, camera);
    if (elevationHandle) positionElevationHandle(elevationHandle, group, item, camera);
  }
}
```

Add a sibling call, gated the same way (`selId` truthy — the panel only
renders when something is selected, mirroring
`selectedItem && <ObjectInspector .../>` at `Viewport.tsx:2041`), that
computes the anchor per §1 and pushes it to the panel. This is the right
place because it's *already* the per-frame "reposition screen/world
overlays for the current selection" seam — the item's group can move
every frame from a live drag/rotate/elevate gesture (per the
mutate-during-gesture comment at `Viewport.tsx:900-910`), so the panel's
anchor has to be recomputed at the same cadence as the handles, not just
on selection change.

### How it reaches `ObjectInspector` — ref, not state

**Do not** add a `screenPos: {left, top}` prop fed by `useState` +
`setState` inside `animate()`. That function already runs 60 times a
second unconditionally (`requestAnimationFrame(animate)`,
`Viewport.tsx:1520`); wiring its output through React state would mean:

- `Viewport` re-renders every frame an item is selected, for a value nothing
  in its own JSX besides one prop pass-through actually needs.
- `ObjectInspector` re-renders every frame too, re-running its `useEffect`
  dependency checks and re-executing render-time work
  (`furnitureOverallDims(item)` recompute, `dimsAreValid` gate, JSX diffing
  its debounce timer's owning closures don't need touched) purely because
  its position moved — the same order-of-magnitude waste the drag/rotate/
  elevation code above it in this same file was explicitly designed to
  avoid ("no React state touched" — `Viewport.tsx:906`).

Instead, follow the pattern this file already uses for the handles
themselves: **mutate directly, imperatively, once per frame, and never
touch React state for it.** Concretely:

1. Convert `ObjectInspector` to `forwardRef` and expose one imperative
   method via `useImperativeHandle`:
   ```ts
   export interface ObjectInspectorHandle {
     setAnchor(left: number, top: number): void;
   }
   ```
   which writes straight to the panel's own root DOM node —
   `el.style.left = \`${left}px\`; el.style.top = \`${top}px\`` — bypassing
   `position: absolute; left/bottom` in the CSS in favor of `left`/`top`
   set inline per-frame (the CSS keeps `position: absolute` and a static
   fallback `left`/`top`, e.g. the old corner values, for the one frame
   before the first `animate()` tick runs).
2. `Viewport.tsx` keeps an `inspectorRef = useRef<ObjectInspectorHandle>(null)`
   alongside the existing `rotateHandleRef`/`elevationHandleRef`, and calls
   `inspectorRef.current?.setAnchor(left, top)` from the same `animate()`
   block, right after positioning the two 3D handles.
3. **Content** (name/dims/rotation values, the close button, the "Edit
   ..." title) stays exactly the driven-by-props/React-state as it is
   today — only *position* moves to the imperative path. `key={item.id}`
   on the panel (`Viewport.tsx:2043`) already forces a clean remount on
   selection change, so there's no stale-ref risk across a different
   item being selected.

This is a direct extension of the file's own established idiom — every
other per-frame, per-gesture mutation in this component (drag position,
rotate angle, elevation Y, the two manipulation handles' world transforms)
already goes straight to a Three.js object or, here, a DOM node, and only
a *discrete, infrequent* action (`onCommitPlacementRef`, `onToggleLockRef`,
and now the debounced `onEdit`) touches React/`sceneFile` state. Panel
position is exactly that same shape of value: continuous, per-frame,
visually-only — never something `sceneFile`, undo, or a save needs to know
about.

### Initial position on selection

`setAnchor` should also be called once synchronously at the moment of
selection (inside `selectItem`, `Viewport.tsx:1061` on), not only from
`animate()`, so the panel doesn't render at its CSS fallback position for
one visible frame before `animate()` first runs. Cheap — it's the same
computation, just invoked from one more call site.

## Open questions for Shyam

1. **Panel height for the "does it fit" check.** §1's fit tests need
   `panelHeight`, but the panel's height isn't fixed today (CSS has no
   explicit height — it sizes to content, and `ObjectEditFields` may grow
   if a future item type adds fields, e.g. the deferred `jointed` shape's
   per-joint controls). Measuring it via `getBoundingClientRect()` each
   frame is trivial to add but is one more per-frame DOM read; caching it
   and only re-measuring on content change (item selection change, or a
   `ResizeObserver` on the panel) is cheap and recommended — flagging
   only because it's a real implementation decision, not obviously "do
   the simplest thing."
2. **Does the panel track *only* the selected item, or also react to
   camera moves from `flyTo`/saved-viewpoint recall?** The projection
   naturally does either way (it re-derives from live `camera` state every
   frame regardless of what moved it), so this isn't really a fork in the
   implementation — flagging only so the answer ("yes, it should follow
   through a recall too, same as it follows an orbit drag") isn't assumed
   silently.
3. **Should the panel's clamp-to-corner fallback (object behind camera /
   off-screen, §1) still show *which* item is being edited**, or is
   landing back at the old fixed corner with full content enough context?
   No strong opinion — the title bar already says `Edit "{item.name}"`
   (`ObjectInspector.tsx:115`), so this is probably already sufficient,
   flagging only because "the object it's anchored to isn't currently
   visible" is a slightly odd state worth Shyam seeing described once.
