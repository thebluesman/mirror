# Proposal: object categories (`category` field) — improvements-v2.2 §7

**Status:** proposal (research-and-propose per §7 + the doc's sequencing note)
**Date:** 2026-07-22
**Scope frame:** metadata-only tag, no behavior. Unblocks §4(b) (lamp
point-lights); commits to nothing else.

## Problem

The schema has no semantic category concept. `shape`
(`box`/`compound-sofa`, `scene.ts:133–191`) is a geometry/rendering
discriminant — it says how to build the mesh, not what the object *is*. There
is no way to ask "which items are lamps" (or seating, or rugs), so §4(b)
(lamps/fixtures emitting real light) has nothing to filter on. §4(b) is
explicitly blocked on this landing first (improvements-v2.2 §4b, §7,
sequencing note).

## Recommendation (summary)

Add one optional field, `category`, to both furniture union branches as a
fixed `z.enum([...])`. Optional, no schema `.default()`, no `SCHEMA_VERSION`
bump. Absent = uncategorized. This mirrors the `locked` precedent exactly
(`scene.ts:156–164`): an additive optional declared on both branches so
`z.infer` types it.

## 1. Schema

### Field

```ts
// improvements-v2.2 §7: a semantic category tag. Metadata ONLY — no rules
// engine, no per-category rendering/behavior (§7 resolved scope). Its one
// job is to let a future feature (§4b lamp point-lights) filter items by
// kind: `items.filter(i => i.category === "lamp")`. Distinct from `shape`,
// which is a geometry/rendering discriminant, not a semantic kind.
// Optional + no default so every existing seed/saved file validates
// unchanged (field absent → undefined → "uncategorized"), same backward-
// compat reasoning as `locked` and `room.shell`. Declared on both union
// branches explicitly (not via `.loose()`) so `z.infer` types it on
// FurnitureItem instead of leaving it reachable only through an untyped
// loose access — the `locked` precedent.
category: FurnitureCategory.optional(),
```

with the enum hoisted to module scope next to `OpeningType` (so it's
exported and a future §4(b) can import the literal-union type):

```ts
export const FurnitureCategory = z.enum([
  "seating",      // sofa, armchair, swivel chair, stool, bench
  "table",        // dining, coffee, side, console
  "storage",      // shelving, cabinet, media unit, shoe rack, dresser
  "lamp",         // floor lamp, table lamp — the light-EMITTING fixtures §4b consumes
  "rug",          // flat floor covering
  "appliance",    // powered devices — water cooler, TV, fan
  "decor",        // art, plants, vases, cushions, mirrors (near-future; no current item)
  "other",        // deliberately-tagged "none of the above" (see §1 default note)
]);
export type FurnitureCategory = z.infer<typeof FurnitureCategory>;
```

Added identically to `BoxFurniture` (`scene.ts:133`) and
`CompoundSofaFurniture` (`scene.ts:168`), same as `locked`.

### Enum values — grounding

Every value except `decor` maps to a real item in `seed/living-room.json`;
none are speculative-only except `decor`, which is the one near-future
placeholder (Shyam has cushions/art in the real room but they aren't modeled
yet):

| Seed item | `category` |
|---|---|
| `swivel-chair`, `applaryd-sofa` | `seating` |
| `dining-table`, `coffee-table` | `table` |
| `tv-stand`, `billy-hogadal-shelving`, `bookshelf`, `shoe-rack` | `storage` |
| `floor-lamp`, `table-lamp` | `lamp` |
| `sonderod-rug` | `rug` |
| `water-cooler`, `tv-samsung-frame` | `appliance` |

Eight values total is deliberately small. This is not a furniture taxonomy —
it's the minimum set that (a) covers the real room and (b) makes the §4(b)
"is this a light" question answerable. Resist growing it speculatively; add a
value only when a real item or real feature needs it.

### Enum vs. free-form string — argue enum

A fixed `z.enum` over `z.string()`, for three reasons:

1. **§4(b) filter reliability.** The downstream consumer is
   `i.category === "lamp"`. A free string lets `"Lamp"`, `"floor lamp"`,
   `"floorlamp"` all coexist and silently fall out of that filter — a lamp
   that emits no light with no error. A closed enum makes the value set total
   and the filter typo-proof; zod rejects anything off-list at the load
   boundary.
2. **Exhaustiveness.** `z.infer` yields a literal union, so a future `switch`
   or filter over categories is TS-checkable — adding a value surfaces every
   unhandled site.
3. **UI.** A closed set is exactly a `<select>`; no free-text validation, no
   normalization layer.

Cost: adding a category later is a code edit, not a data edit. For a
solo hobby project where Shyam is the only person ever entering data, that's
cheap, and `"other"` is the escape hatch for the interim. This tension is a
genuine open question (§5) — but the default should be the enum.

### Required vs. optional, and default

**Optional, with no schema `.default()`.** Required would break every
existing seed/saved file on load (they have no `category`) — the same reason
`locked`, `elevationCm`, `room.shell`, and every other post-v1 field is
optional. A schema `.default("other")` is also wrong: `.default()` fires
during parse, so it would rewrite every uncategorized legacy item to
*explicitly* `"other"` on first load, destroying the distinction between
"never categorized" and "user chose other." Leave it `undefined` when absent.

**Fallback semantics:** `undefined` = uncategorized. Consumers treat
undefined as "no category" (the §4(b) filter naturally excludes it — undefined
`!== "lamp"`). The `"other"` enum member exists for the *different* case where
the user looked at an item and decided none of the named values fit — a
deliberate choice, not an absence. UI renders both as "Uncategorized" /
"Other" respectively.

### Migration

**No `SCHEMA_VERSION` bump, no `migrate()` change.** Purely additive optional
field — identical situation to the `room.shell` comment (`scene.ts:82–92`):
"purely additive/optional, so it doesn't require a SCHEMA_VERSION bump." A
`v1` or `v1-draft` file with no `category` on any item validates unchanged and
every item reads back as uncategorized. Nothing to backfill.

## 2. UI

Category is a general item property, like `name`. Its natural home is the same
place `name` gets edited — which §6 (object edit flow) is building. Two
mounting contexts, no new surface invented:

- **Primary — §6's post-import edit panel.** §6 adds a docked/floating editor
  with `name` + `W/D/H` + rotation for an already-placed item (§6 "Post-import"
  bullet; `name` has no edit UI today). Add a `category` `<select>` there
  alongside `name`. This is where most tagging happens: the seed ships 12
  uncategorized items, and the user tags them by picking each and choosing a
  category. This proposal **depends on §6's editor existing** for its primary
  UI; if §6 slips, the field can still ship schema-only and be set later.
- **Secondary — at import time (`ImportPanel.tsx`).** Optionally add the same
  `<select>` to the `confirm-dims` stage (`DimsConfirmForm`, `ImportPanel.tsx:355`)
  so a brand-new import can be tagged in the same breath as its dims. Pre-fill
  from the selected existing item's current `category` on a re-import;
  `undefined` for a genuinely new item. Low priority — §6's panel covers it —
  but cheap if §6's category `<select>` is built as a reusable control.

### Plumbing note (concrete, for whoever builds it)

`ImportResult` (`applyImport.ts:11`) gains an optional `category`, written onto
the new/updated item in `applyFurnitureImport`. **Unlike `modelRotationDeg`,
category must be merge-preserved on re-import**, not full-replaced: re-importing
to fix a wrong source photo (`applyImport.ts:56–60` full-replaces
`modelRotationDeg` by design) must NOT wipe a category the user already set.
So in the `existingIdx >= 0` branch, carry `category` from the existing item
unless the import explicitly provides a new one.

## 3. What it unblocks (concrete)

§4(b) wants point/spot lights tied to light-emitting object instances. With
this field, that feature is:

```ts
// §4b, later — illustrative, NOT built here:
sceneFile.items
  .filter((i) => i.category === "lamp")
  .forEach((lamp) => addPointLightForItem(lamp /* at its placed position */));
```

The `lamp` value is the whole point of the exercise: it lets §4(b) enumerate
exactly `floor-lamp` and `table-lamp` from the current seed and attach a
point light to each, without §4(b) hardcoding item ids or re-deriving "is this
a light" from names/shapes. Nothing about the light itself (intensity, color,
offset from the mesh origin) lives here — that's §4(b)'s to design. This field
only answers *which items*.

Note the `appliance` boundary: the TV emits light in reality, but §4(b) is
about lamps, and a Frame TV is not a lamp. Keeping the TV as `appliance` (not
`lamp`) keeps the §4(b) filter clean — `lamp` means "a fixture whose job is to
light the room." If a future feature wants glowing screens, that's a separate
value/filter, not a reason to broaden `lamp` now.

## 4. Explicit non-goals (do not scope-creep)

- **No rules engine.** No per-category logic, config, or dispatch table.
- **No per-category rendering or behavior in this batch.** A `lamp` renders
  exactly like any other box until §4(b) is separately built. A `rug` gets no
  new treatment from this field (its flat-texture path already exists via
  `flatTextureHash`, unrelated to category).
- **No wall-fixture-specific logic.** §7 forbids it. This is also why the enum
  has no `wall-fixture` value (see §5) — naming a mounting relationship as a
  category invites exactly the behavior §7 rules out.
- **No geometry/category consistency validation.** The schema does not check
  that a `category: "lamp"` item is shaped like a lamp, or that a
  `compound-sofa` shape is `seating`. Category and `shape` are independent; a
  mismatch is the user's business, not a validation error.
- **No auto-classification.** Categories are not inferred from item `name` or
  the source photo. The user sets them explicitly.

## 5. Open questions for Shyam

1. **Closed enum vs. open string?** Recommendation is a closed enum (§1) for
   filter reliability. The cost is that adding a category is a code edit, not a
   data edit. Since you're the only person ever entering data, are you fine
   with "ping Claude to add a value" when a new kind of thing shows up, or
   would you rather free-type a string and accept that the §4(b) filter only
   works if you spell `"lamp"` consistently? (Enum strongly recommended; this
   is the one call that's genuinely yours.)
2. **Where does the TV go?** Proposed `appliance` (powered device). The
   Samsung Frame is arguably `decor` (it's literally designed to look like
   framed art) or its own `electronics`. `appliance` keeps the enum small and
   the §4(b) `lamp` filter clean either way — flagging only because it's the
   one seed item that doesn't map to an obvious single value.
3. **Ship the field before §6's editor exists?** The primary UI (§2) lives in
   §6's post-import edit panel. If §6 isn't landing in this batch, do you want
   the schema field + import-time `<select>` shipped now (so data can be
   tagged) and the post-import editor to follow, or hold the whole thing until
   §6 is ready so category ships with a real editing home? (No strong
   preference — schema-first is harmless and unblocks §4(b) planning.)
4. **Is `decor` worth including with no current item?** It's the one
   speculative value. Include it as a ready slot for cushions/art/plants you
   have but haven't modeled, or drop it until something needs it? (Lean:
   include — it's obviously coming and costs nothing.)
