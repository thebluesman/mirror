# Proposal: re-import entry point from ObjectInspector — improvements-minor-fixes.md §14

**Status:** approved for build (2026-07-22 review) — go with this doc's own
lean on both open questions: switching to the Import tab via "Re-import"
leaves `ObjectInspector` open behind the sidebar (does not deselect the
item); icon is `RefreshCw`.
**Date:** 2026-07-22
**Scope frame:** a UI entry-point/routing question, per the source doc's own
framing — no new import logic. `ImportPanel.tsx`'s `confirm-cost` /
`generating` / `confirm-dims` stages are already built, tested, and
item-aware; this proposal is only about how `ObjectInspector` hands off to
them.

## Problem

Fixing a bad import today means: deselect the item (leaving
`ObjectInspector`), click the **Import** tab, re-select the same item from
`ImportPanel`'s dropdown, then re-run the photo flow. §14 asks whether a
"Re-import" affordance should live directly in `ObjectInspector`, while the
item is already selected, skipping the tab switch and re-selection.

## Recommendation (summary)

**Add a "Re-import" button to `ObjectInspector` that switches to the Import
tab and pre-selects the item in `ImportPanel`'s existing picker — do not
inline the confirm-cost/generating/confirm-dims stages into the docked
panel.** The source doc flags "state duplication" as option (b)'s risk;
checked against the actual code, that risk is real and larger than the doc's
framing suggests — see §3.

## 1. What exists today

- **`ImportPanel`** (`ImportPanel.tsx`) owns the whole import flow as a
  component-local state machine: `hasFalKey`, a `Stage` union (`pick` →
  `confirm-cost` → `generating` → `confirm-dims`, or `error`), and a
  `selection` string (`"__new__"` or an item id) that drives which item a
  completed import writes onto. It's rendered by `App.tsx` only while
  `tab === "Import"` (`App.tsx:412`) — mounted/unmounted per tab, not kept
  alive in the background.
- **`ObjectInspector`** (`ObjectInspector.tsx`) is rendered by `Viewport.tsx`
  whenever an item is selected in the 3D view (`Viewport.tsx:2041-2048`),
  docked bottom-left over the canvas. It knows nothing about import — its
  only props are `item`, `onEdit`, `onClose`, and it edits
  name/dims/rotation through `ObjectEditFields`, the same field component
  `ImportPanel`'s `DimsConfirmForm` already shares (`ImportPanel.tsx:468`,
  `ObjectInspector.tsx:120-128`). That shared component is the right
  precedent to keep in mind for §3: dumb, presentational field groups are
  already shared between the two flows; the async orchestration around them
  is not, and never has been.
- The two are structurally distant: `ObjectInspector` is a child of
  `Viewport.tsx`, `ImportPanel` is a child of `App.tsx`'s sidebar. Any
  hand-off between them has to go up through `Viewport.tsx`'s existing
  prop-callback pattern (`onEditItem`, `onToggleLock`, etc.) into `App.tsx`,
  which is the only component that can see both `tab` state and can pass
  props into `ImportPanel`.

## 2. Where the affordance lives in `ObjectInspector`

A full-width button below `ObjectEditFields`, inside the existing
`.object-inspector` card — the same "primary action button under the form
fields" placement `ImportPanel` itself uses (`.import-panel-button`,
e.g. "Upload photo…", `ImportPanel.tsx:219-226`). Not in the header row next
to the close `×`: the card is only 220px wide (`ObjectInspector.css:11`)
against `ImportPanel`'s 320px sidebar (`--sidebar-width`,
`tokens.css:51`) — there's no comfortable room for a second icon button
beside the title without crowding it.

Label is conditional on whether the item already has a generated model,
mirroring `ImportPanel`'s own dropdown convention (`"(re-import, replaces
current model)"`, `ImportPanel.tsx:190`):

```tsx
<button
  type="button"
  className="object-inspector-reimport"
  onClick={() => onReimport(item.id)}
>
  <RefreshCw size={13} aria-hidden="true" />
  {item.glbHash ? "Re-import…" : "Import…"}
</button>
```

No eligibility filter needed — `ImportPanel`'s own dropdown already lists
every item regardless of shape (`ImportPanel.tsx:187-192`), including
`compound-sofa` items, and `buildScene.ts`'s `addFurniture` honors
`glbHash` ahead of shape-specific rendering unconditionally
(`buildScene.ts:364-371`) — a compound-sofa item that gets a `glbHash` via
import renders the GLB instead of its box assembly. So "Re-import" applies
to whatever `ObjectInspector` currently has selected, with no shape check.

## 3. The hand-off shape — (a) vs. (b)

### (a) Switch tabs + pre-select — recommended

`ObjectInspector` gains an `onReimport?: (itemId: string) => void` prop.
`Viewport.tsx` threads it up as a new callback prop (same shape as the
existing `onEditItem`/`onToggleLock` pass-through). `App.tsx` implements it:

```ts
function handleRequestReimport(itemId: string) {
  setReimportTarget(itemId);
  setTab("Import");
}
```

The one real design detail: **how `ImportPanel` learns which item to
pre-select.** `ImportPanel` currently owns `selection` entirely internally
(`useState<string>("__new__")`, `ImportPanel.tsx:58`) with no prop input.
Because `App.tsx` only mounts `ImportPanel` while `tab === "Import"`
(`App.tsx:412`, a plain conditional render, not a `display:none`-style
keep-alive), **every switch to the Import tab is a fresh mount** — so a new
prop consumed only as the `useState` initializer works cleanly, no effect or
"consumed" flag required:

```ts
// ImportPanel.tsx
function ImportPanel({ sceneFile, onImported, initialSelection }: {
  sceneFile: SceneFile;
  onImported: (next: SceneFile) => void;
  initialSelection?: string;
}) {
  const [selection, setSelection] = useState<string>(initialSelection ?? "__new__");
  ...
```

One thing this naive version gets wrong, worth calling out concretely rather
than glossing over: `reimportTarget` in `App.tsx` has to be **cleared on any
direct click of the Import tab button**, not just consumed once — otherwise
clicking "Re-import" once, backing out, then later clicking the Import tab
normally would silently re-apply a stale pre-selection from the earlier
re-import request. Concretely, the tab nav's own `onClick` for "Import"
needs to null `reimportTarget` before switching, while
`handleRequestReimport` is the only other writer:

```ts
// the existing TABS.map(...) button, App.tsx:394-403 — Import case only
onClick={() => { setReimportTarget(null); setTab(t); }}
```

This is a small, self-contained addition: one new prop on `ImportPanel`, one
new prop plumbed through `Viewport`/`ObjectInspector`, one new piece of
`App.tsx` state with one extra clear-on-click line. Nothing about
`ImportPanel`'s existing stage machine changes.

### (b) Inline the stages into `ObjectInspector`

This would mean `ObjectInspector` reimplementing (or sharing via extraction)
`ImportPanel`'s `hasFalKey` check, `Stage` state machine, `runGeneration`,
and `handleConfirmDims` (`ImportPanel.tsx:60-135`) — the actual fal.ai
generation call, its cost-confirmation gate, progress-phase rendering, and
the `confirm-dims` step's `ObjectPreview3D` live preview.

Checked against the doc's own flagged concern ("inlining risks duplicating
state ImportPanel already owns") rather than taking it on faith: the risk is
real and larger than "some duplicated state." Two ways it plays out, both
worse than (a):

- **Literal duplication** — copy the stage machine into `ObjectInspector`.
  Now the fal.ai request/error handling, the cost-confirmation copy, and the
  progress labels (`PROGRESS_LABEL`, `ImportPanel.tsx:40-45`) exist in two
  places. A future fix to any of them (a new `GenerationPhase`, a changed
  error message, a schema field added to the confirm-dims payload) has two
  call sites to update, silently divergeable — exactly the class of bug this
  whole app's commit-seam conventions (`commitToActiveLayout`,
  `applyFurnitureImport`, the single `commit()` tail in `App.tsx`) exist to
  avoid.
- **Extraction** — pull the stage machine into a shared hook (e.g.
  `useFurnitureImportFlow`) both components consume. Avoids literal
  duplication, but is a materially bigger change than (a): it means
  restructuring `ImportPanel`'s tested, working flow to fit a second
  consumer with different layout constraints, not just adding a button.

That second point compounds with a real layout problem: `ObjectPreview3D`,
the `confirm-dims` stage's live 3D preview, is styled `width: 100%; height:
220px` (`ObjectPreview3D.css`) to fit inside `ImportPanel`'s 320px sidebar
tab. `ObjectInspector`'s docked card is 220px wide total, floating over the
live viewport it shares the screen with — the preview would either have to
shrink further, floating-card real estate would have to grow substantially
(crowding the 3D view it sits on top of), or the confirm-dims stage would
need a different, non-preview layout when inlined, which is scope beyond
"expose the existing flow."

**Verdict: (b)'s state-duplication risk is confirmed, not just plausible —
recommend (a).**

## 4. What this does *not* change

- `ImportPanel`'s stage machine, `applyFurnitureImport`, and the
  cost-confirmation/progress/dims-confirm UI are untouched — this is purely
  a second entry point into the same flow.
- No new commit path: a re-import triggered this way still lands through
  `handleImported` → `commit()` in `App.tsx` (`App.tsx:194-196`), same as
  today's Import-tab-driven flow.
- `ObjectInspector` stays closed/open independent of the tab switch —
  switching to Import doesn't need to also deselect the item in the
  viewport; whether it should is an open question below.

## 5. Open questions for Shyam

1. **Should switching to the Import tab via "Re-import" also close
   `ObjectInspector`** (deselect the item), or leave it open behind the
   sidebar? Leaving it open means the item stays visibly selected/outlined
   in the viewport while the user re-imports it, which is arguably useful
   context; closing it avoids two panels implicitly referring to the same
   item at once. No strong preference — leaning toward leaving it open,
   since `ObjectInspector`'s dock position (bottom-left) doesn't overlap
   `ImportPanel`'s sidebar.
2. **Icon choice for the button** — proposed `RefreshCw` (lucide-react,
   not yet used elsewhere in this codebase but part of the same icon set
   already in use). No strong alternative in mind; flagging only because
   every other icon in this app was picked from a small, deliberate set
   (`Lock`/`LockOpen`, `Camera`, `Pencil`, `X`, `Footprints`/`Orbit`) and
   this would be the first new one added since v2.1.
