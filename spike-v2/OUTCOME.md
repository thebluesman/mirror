# v2 Spike — Outcome (in progress)

Tracks verdicts as `v2-spike-plan.md`'s workstreams complete. Started
2026-07-21. Format follows `spike/OUTCOME*.md`.

## D0 — TV-not-showing diagnosis

**Status: cause hypothesized from code tracing, not yet confirmed against
Shyam's actual project state (still needed — see plan §8.6).**

Traced the import path end to end: `ImportPanel.tsx` → `applyImport.ts` →
`buildScene.ts` → `Viewport.tsx`'s async GLB-load effect. The Phase 4
code-review fallback (`Viewport.tsx:157-164`) already degrades a failed GLB
load to a box placeholder — so a corrupt/missing OPFS asset would show as
"looks unimported," not "invisible," and logs a `console.error`. That known
failure mode is **not** the TV's symptom as reported ("completed import,
object not showing"), which points elsewhere.

Two real gaps found while tracing, either of which fits the report:

1. **`ImportPanel.tsx:36`** — `importableItems = sceneFile.items.filter((i)
   => !i.glbHash)`. Once an item has any `glbHash` (including a prior
   attempt), it drops out of the dropdown entirely. There is no "re-import /
   replace" path in v1 — which is exactly why W-A's Replace task (D3) exists.
   If Shyam tried to re-import or fix the TV's asset, the panel would have
   forced him to `+ New item…` instead.
2. **`applyImport.ts:59-69`** — a genuinely new item (no existing id match)
   gets a default placement command at `position: [0, 0, 0], rotationDeg: 0`
   with no `elevationCm` accounting. Seed data bakes elevation into the
   placement's y directly (e.g. `tv-samsung-frame`'s seeded command uses
   y=70, matching its `elevationCm: 70`) — but a fresh import has no seeded
   command, so it lands on the floor at the room's origin corner, nowhere
   near the actual TV wall. Easy to read as "didn't import" if it's off in a
   corner behind/under other geometry.

**Working hypothesis:** Shyam picked "+ New item…" (likely because the
already-imported TV no longer appeared as importable), which created a
second, unplaced-by-design TV item at world origin — distinct from the
seeded `tv-samsung-frame` item and its correctly-positioned command — and
that duplicate is either occluded or just not where he was looking.

**Not fixed here.** Both gaps are legitimate but out of D0's "fix if small"
budget: gap 1 *is* D3's Replace feature, not a patch to bolt on ahead of it;
gap 2 only matters for genuinely new items, and it's D1/D3's placement code
this spike is already rebuilding. Fixing either now risks work D3 throws
away. Recorded here per plan discipline ("fix if small; otherwise record
cause for v2") — D3 should treat both as acceptance criteria: replacing an
already-imported item must not require `+ New item…`, and any new-item
default placement should be visible/sane, not silently at the origin.

**To confirm/close:** Shyam's project export (or the TV source photo, for a
fresh repro) per plan §8.6 — still outstanding.

## D1 — W-A core (selection, floor-plane drag, rotate)

Status: started, see `v2/spike-arrange` branch.

## R1 — Hunyuan3D (fal.ai) endpoint/pricing survey

Status: started.

## D2/D3/D4/D5 — not started

Blocked on D1 (D2/D3) or R1 (D5), or on Shyam's inputs (D4's rug photo).
