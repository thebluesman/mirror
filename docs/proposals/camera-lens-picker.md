# Proposal: switchable camera lenses (live FOV presets) — improvements-minor-fixes §17

**Status:** approved for build (2026-07-22 review), with one scope change
from this doc's own recommendation: **presets, not a slider** (confirmed),
but labeled and specified by **35mm-equivalent focal length**, not FOV
degrees — **Wide 24mm / Normal 35mm / Tele 85mm**. The UI must never show a
degree value; focal length is the only unit the user sees. This doc's §1.2
preset table (55°/38°/20°) needs to be re-derived from these three focal
lengths instead, using whatever sensor-format convention (e.g. standard
36×24mm full-frame equivalent) the app already assumes elsewhere for "35mm-
equivalent" — check `HUMAN_FOV = 38`'s own derivation
(`walkCamera.ts`/`Viewport.tsx`) for the existing convention before picking
a new one, so the three presets and the existing default stay on the same
basis. This conversion is new work the original proposal didn't need to do.
**Date:** 2026-07-22
**Scope frame:** a HUD control that changes the *live* orbit/walk camera's
`fov` in the moment, independent of saved viewpoints. Does not touch
`CameraPositionSchema`, saved-viewpoint recall, or `HUMAN_FOV`'s role as
the app's default.

## Problem

`Viewport.tsx` fixes the live camera at `HUMAN_FOV = 38` (`Viewport.tsx:65`,
"~35mm-equivalent, per spike 2's C2 feedback") for both orbit and walk
mode, set once at construction (`Viewport.tsx:784`) and otherwise only
ever changed by recalling a saved viewpoint's own `fovDeg`
(`applyCameraPreset`, `Viewport.tsx:79-85`, reading
`preset.fovDeg ?? HUMAN_FOV`). There is no way to change field of view in
the moment while just looking around — a saved viewpoint is the only path
to a non-default FOV, and it requires having pre-saved one at that FOV.
Shyam wants a lens picker: a live control, independent of the saved-view
list.

**Correction to the ask's framing:** `CameraPositionSchema.fovDeg`
(`schema/scene.ts:262`) is actually **required** (`z.number()`, no
`.optional()`), not optional — every saved viewpoint always carries a
concrete `fovDeg`, populated from `getCurrentView()`'s live
`camera.fov` read (`Viewport.tsx:1680`/`1686`) at save time
(`App.tsx handleSaveView:211-217` → `makeCameraPosition`). This doesn't
change the ask, but it matters for §3 below: since saving already just
reads whatever `camera.fov` happens to be *right now*, a live FOV control
requires no new plumbing to be captured by "+ Save view" — it already
would be.

## Recommendation (summary)

1. **Presets, not a slider** — three named pills (Wide / Normal / Tele),
   not a continuous drag control. Genuinely a close call; §1 lays out
   both sides. Recommended values: **Wide 55°, Normal 38° (unchanged
   `HUMAN_FOV`), Tele 20°.**
2. **Lives in `ViewportChrome.tsx`**, as a small three-way segmented
   control in the pill bar — but the actual `camera.fov` mutation has to
   happen inside `Viewport.tsx` (only it holds `cameraRef`), so the state
   itself should be lifted to `App.tsx` as ephemeral view state and
   threaded to both components, mirroring the existing `globalLock`
   precedent exactly. See §2.
3. **Live-adjust-then-save "just works"** via the existing
   `getCurrentView()` → `handleSaveView` path — no special-casing needed.
   The one real open question is the reverse direction: recalling a saved
   view changes `camera.fov` directly inside `Viewport.tsx`, bypassing the
   lifted App.tsx state, so the picker's active-pill highlight can drift
   from the live camera unless recall also reports back. See §3.

## 1. Preset values vs. a continuous slider

### The case for presets (recommended)

- **Matches the app's own established idiom.** Every other "adjust a
  camera/selected-item property in the moment" control in this codebase
  is a discrete step or a fixed set of states, not a continuous drag:
  `ROTATE_STEP_DEG` (15°, keyboard step), `ELEVATION_STEP_CM` (5px,
  keyboard step), the orbit/walk mode toggle (`viewport-mode-toggle-pill`,
  a two-state cycle), and the lock toggle. The deferred
  `multi-joint-objects.md` proposal makes the same call explicitly for a
  reason directly on point here: "reusing the keyboard idiom keeps this
  consistent... and avoids inventing a parallel control surface"
  (`multi-joint-objects.md` §4.1). A slider would be the first continuous
  drag control anywhere in the viewport-level HUD.
- **Named presets are legible in a way raw degrees aren't.** "Wide /
  Normal / Tele" tells you what you're choosing *for* (see more of the
  room vs. a flattened, considered framing); "34°" doesn't, unless you
  already think in vertical FOV degrees.
- **Cheap to build.** Three buttons, no drag/pointer-capture handling, no
  debounce (contrast `LightingPanel.tsx`'s sliders, which need
  `SLIDER_DEBOUNCE_MS` + a local "live" mirror precisely because a range
  input fires on every pixel of drag, `LightingPanel.tsx:6-31` — a preset
  pill fires once per click, no debounce needed).

### The case for a slider

- **More expressive.** A camera person might want 45° specifically, not
  the nearest of three buckets — three presets can't hit an in-between
  value a saved viewpoint might have been framed at (recall could land on
  a `fovDeg` between presets, and there'd be no live picker position that
  matches it; see §3).
  `LightingPanel.tsx` already establishes the range-input + debounce
  pattern in this codebase, so it wouldn't be new infrastructure, just a
  different component reusing an existing one.
- **Finer control for photography-style framing** — if Shyam's use of
  saved viewpoints trends toward "get the FOV exactly right for a specific
  shot," a slider's continuous range serves that better than three fixed
  stops.

**This is flagged as genuinely open, per the ask.** The recommendation
leans presets because it fits the surrounding idiom and is the smaller
build, but if Shyam's actual use case is closer to "frame considered shots
precisely" than "glance around at a different zoom," a slider is the
better tool and the LightingPanel pattern is right there to copy.

### Preset degree values

| Preset | `fovDeg` | Rough photographic equivalent |
|---|---|---|
| Wide | 55° | ~24mm — see more of the room, useful in tight corners |
| Normal | 38° (`HUMAN_FOV`, unchanged) | ~35mm — the existing default, per spike 2's C2 feedback |
| Tele | 20° | ~85mm — flattened perspective, a considered single-object framing |

These are ballpark labels, not physically-derived from sensor geometry —
the same rigor level `HUMAN_FOV`'s own comment already uses ("~35mm-
equivalent" without a cited derivation, `Viewport.tsx:65`). `Normal` is
pinned to the existing `HUMAN_FOV` constant (imported, not
re-declared) so there's exactly one source of truth for "the default
FOV" and switching back to Normal is bit-identical to today's baseline,
not a close-but-not-quite value.

## 2. Where it lives, and how the mutation reaches the camera

### HUD placement

`ViewportChrome.tsx`'s pill bar (`.viewport-chrome-bar`,
`ViewportChrome.css:23-31`) already mixes two kinds of pills: standalone
actions with no persistent state (Snapshot), and a persistent-state toggle
with an active/pressed look (`viewport-chrome-lock`/
`viewport-chrome-lock--active`, `ViewportChrome.tsx:85-94`,
`ViewportChrome.css:66-78`). A lens picker is closer to the second
kind — it reflects a current, ongoing state (which lens is active), not a
one-shot action like Snapshot.

Propose a new grouped control, `.viewport-chrome-lens`: a single
pill-shaped container (same rounded, near-black-on-primary visual
language as the outer `.viewport-chrome-bar` itself) holding three small
buttons — Wide / Normal / Tele — with the active one styled like
`viewport-chrome-lock--active` (solid canvas-on-ink fill vs. the
transparent default). Sits beside the Lock-all/Snapshot pills
(`ViewportChrome.tsx:85-106`), before the saved-cameras list — grouped
with the other "standalone viewport actions" rather than mixed into the
per-saved-view chips, since it isn't a saved-view list item.

### Where the state lives — the `globalLock` precedent

The camera itself only exists inside `Viewport.tsx` (`cameraRef`), so
whichever component owns "which lens is selected," `Viewport.tsx` has to
be the one that actually writes `camera.fov`. Two existing patterns in
this codebase handle "HUD state that isn't part of `sceneFile`" two
different ways, and they point in different directions here:

- **`cameraMode`** is fully self-contained inside `Viewport.tsx` — the
  mode-toggle pill is rendered directly by `Viewport` itself
  (`Viewport.tsx:2049-2067`), not routed through `ViewportChrome`/
  `App.tsx`, because nothing outside `Viewport` needs to read or control
  it.
- **`globalLock`** is lifted to `App.tsx` as plain ephemeral state — "like
  `undoSlot`... NOT part of `sceneFile`" (`Viewport.tsx:412-417`'s own
  comment on the prop) — and threaded down to *both* `ViewportChrome`
  (renders/toggles the pill) and `Viewport` (applies the effect). This is
  necessary specifically because the control that displays/toggles the
  state (`ViewportChrome`) and the component that has to act on it
  (`Viewport`) are different components.

**The lens picker is structurally identical to the `globalLock` case, not
the `cameraMode` case** — the task explicitly wants it living in
`ViewportChrome`, so the state can't be self-contained in `Viewport` the
way `cameraMode` is. Recommend: add `fovPreset` (or a raw `liveFovDeg`
number) as `App.tsx` state, ephemeral like `globalLock`, passed to
`ViewportChrome` as `{ fovPreset, onSetFovPreset }` (mirroring
`{ globalLock, onToggleGlobalLock }`, `ViewportChrome.tsx:16-17`/`36-37`)
and to `Viewport` as a new prop, applied via its own small live-update
effect.

### Applying it without a structural rebuild

Model this directly on the lighting live-update effect
(`Viewport.tsx:1810-1828`), which is explicitly the *simpler* sibling of
the shell-calibration effect for exactly the reason that applies here too
— "plain numbers... no diffing against a previously-applied value is
needed; recomputing is trivial and idempotent":

```ts
useEffect(() => {
  const camera = cameraRef.current;
  if (!camera) return;
  camera.fov = fovDeg ?? HUMAN_FOV;
  camera.updateProjectionMatrix();
}, [fovDeg]);
```

Guarded on `cameraRef.current` (null before the first structural build,
same null-guard every other live-update effect and `ViewportHandle`
method already uses) — no `buildVersion` dependency needed for
re-triggering after a rebuild the way the lighting effect has one,
*unless* a structural rebuild should reset the live FOV back to whichever
preset is active (probably yes, for consistency — worth confirming, see
§3's open question list is really about recall, but this is the same
shape of question for rebuilds).

## 3. Interaction with saved-viewpoint `fovDeg`

### Live-adjust, then save: already works, no new plumbing

`handleSaveView` (`App.tsx:211-217`) calls
`viewportRef.current?.getCurrentView()`, which reads `camera.fov` live
(`Viewport.tsx:1680`, `1686`) — not any prop or saved default. Once the
live-update effect in §2 is setting `camera.fov` directly, whatever the
picker last set is exactly what a subsequent "+ Save view" captures. This
is worth stating explicitly because it wasn't asked about directly, but
it's the obvious next question once a live FOV control exists, and the
answer is: **yes, and no extra code makes it so** — it's a consequence of
`getCurrentView()` already being a live read rather than a cached one.

### Recall, then picker state: the one real gap

The reverse direction *does* need a decision. `flyTo` → `applyCameraPreset`
(`Viewport.tsx:79-85`, `1704-1710`) sets `camera.fov = preset.fovDeg ??
HUMAN_FOV` **directly on the live camera object**, entirely inside
`Viewport.tsx` — it has no path back to the `fovPreset` state §2 proposes
lifting into `App.tsx`. After a recall, the live camera and the HUD
picker's "active" pill can disagree: the camera is at the recalled
viewpoint's `fovDeg`, but the picker still shows whichever preset was
last clicked (or the initial "Normal").

Two ways to resolve this, neither obviously right — **flagging as open**:

1. **`flyTo` reports the recalled `fovDeg` back up** through a new
   callback (symmetric to how `onCommitPlacement`/`onEditItem` report
   gesture results back to `App.tsx`), and `App.tsx` updates `fovPreset`
   to match — snapping to the nearest preset, or to a fourth implicit
   "Custom" state if the recalled value doesn't match any preset exactly
   (very possible: nothing stops a saved viewpoint from having been
   captured at an arbitrary `fovDeg`, e.g. from mid-zoom before this
   feature existed, or from a future slider design per §1). Correct, but
   adds a round-trip and a "Custom" display state to design.
2. **Don't try to keep them in sync.** Treat the picker's pills as
   one-shot actions with no persistent "active" indicator at all — closer
   to how the `Snapshot` button has no pressed state — so there's nothing
   to drift. Cheaper, and arguably honest about the picker's actual job
   ("set the FOV to X right now"), but loses "which lens am I currently
   on" feedback, which is presumably part of the point of presets over a
   slider in the first place.

Recommendation is (1) if the "which lens is active" affordance matters to
Shyam (which the preset framing in §1 implies it does), else (2) is
meaningfully simpler to ship. Not deciding this here on purpose — it's a
real product call, not an implementation detail.

## Open questions for Shyam

1. **Presets vs. slider (§1)** — the recommendation is presets for
   idiom-consistency and build cost, but flagged explicitly since a
   slider is a legitimate, not-much-more-expensive alternative this
   codebase already has the pattern for (`LightingPanel.tsx`).
2. **Recall-sync behavior (§3)** — report the recalled `fovDeg` back to
   the picker (with a "Custom" fallback state) vs. leave the picker as a
   one-shot control with no persistent "active" indicator. Real product
   call, not decided here.
3. **Does a structural rebuild reset live FOV?** (§2, tail note) — if
   Shyam picks Tele, then imports a new item (triggering a structural
   rebuild per `structuralSceneFile`'s deps, `Viewport.tsx:645-649`),
   should the camera stay at Tele or reset to Normal? Leaning "stays,"
   for the same "don't undo what the user just set" reasoning
   `structuralSceneFile` already applies to `cameras`/`layouts` not being
   rebuild deps — but flagging since it's a real one-line behavior
   choice in the effect from §2.
