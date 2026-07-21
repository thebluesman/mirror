# Phase 4 handoff — furniture import flow

**Branch:** `claude/phase-4-handoff-notes-oflyu5` (playing the role of `v1/import`
per `plan-v1.md`'s branch convention). Based on `main` @ `1e1cab5` (post-Phase-3
merge). G1's ADR-0001 (browser-direct, no proxy) means the proxy-building item
in Phase 4's checklist was skipped as scoped.

## What's built (all four checklist items)

- **Settings panel** (`src/components/SettingsPanel.tsx`, `src/storage/
  settings.ts`, `src/storage/db.ts`): fal.ai key paste, stored in IndexedDB
  (new `settings` object store in the existing "mirror" DB — `db.ts` now
  centralizes the open/upgrade path so `autosave.ts` and `settings.ts` share
  one `DB_VERSION`, avoiding a version-mismatch bug two independent constants
  would eventually hit), never bundled.
- **fal.ai Meshy client wrapper** (`src/import/falClient.ts`): configures
  `@fal-ai/client` with the stored key (ADR-0001's browser-direct posture),
  uploads the photo, submits + polls `fal-ai/meshy/v6/image-to-3d` with
  progress callbacks, downloads the GLB. GLB-URL extraction is tolerant of
  which key the response uses (same candidate-path + fallback-scan approach
  as `spike/import/generate-item.py`, since that spike script's own docstring
  flagged the exact response schema as unconfirmed against a live call).
- **GLB rendering** (`src/scene/loadFurnitureModel.ts`, `buildScene.ts`,
  `Viewport.tsx`): an item with `glbHash` set loads its model from the OPFS
  asset store and fits it to the item's confirmed cm dims (rescale +
  floor-snap + recenter, done at load time in Three.js rather than
  pre-baked, unlike `process-glb.mjs`'s offline gltf-transform pass) —
  async, same after-the-structural-build pattern Phase 3 established for
  shell textures. Items without a GLB still render as the Phase 1 box
  placeholder.
- **Import flow + UI** (`src/components/ImportPanel.tsx`,
  `src/import/applyImport.ts`): pick an existing seed item (or name a new
  one) → upload photo → cost-confirm step → generate with live progress →
  confirm/adjust cm dims → commit. Commit stores the photo + GLB in OPFS
  (content-addressed), attaches the resulting hashes + confirmed dims to the
  item, and places it at its Figma-seeded command if one already exists or
  appends a default-position command if not — exactly PRD §7.3's flow.
  Failure keeps the app in "pick" state with nothing half-written to the
  scene; retry reuses the already-uploaded photo URL instead of re-uploading
  (tracked via `onPhotoUploaded` in the fal client wrapper).
- Also closed the Phase 2 code-review deferral assigned to this phase:
  `assets.ts`'s `putAsset()` now compares the existing file's byte size
  against the incoming blob before treating a hash as already-stored, so an
  interrupted write (0-byte stub) doesn't get masked as "already stored"
  forever. Regression test added.

## Verified

- `npm run build`, `npx tsc -b`, `npx oxlint` (no warnings under `src/`),
  `npm run test` (47/47) all clean.
- In-browser via Playwright (no real fal.ai key available in this session):
  viewport renders with no console errors, Settings panel saves/persists a
  key across reload, Import panel correctly gates the upload button on
  "key present + item selected/named" and shows the seed's un-imported
  items in its dropdown.

## What's NOT verified — the actual gap

**The live Meshy call itself has not been exercised.** No fal.ai key was
available in this sandboxed session. `falClient.ts`'s request shape and
response-URL extraction are built to the same best-effort spec
`generate-item.py` used (never live-tested either, per that script's own
docstring) — plausible, not confirmed. If the live schema differs, the
`extractGlbUrl` fallback scan should still find the GLB URL (it walks the
whole response for any `.glb`-suffixed URL), but this is unverified.

**Phase 4's own exit criterion is therefore still open:** "one real
furniture item goes photo → Meshy → placed in the rendered room, in-app,
with a paid generation Shyam approved." That step is explicitly
Shyam-gated per the original handoff note (his key, his approval to pay) —
someone with a real fal.ai key needs to run the Import tab against a real
photo once, confirm the mesh looks right, and confirm dims/placement land
correctly in the viewport. If the request schema turns out to be wrong,
the fix is scoped to `REQUEST_DEFAULTS`/`GLB_URL_KEY_CANDIDATES` in
`falClient.ts` — nothing else in the flow depends on the exact field names.

## Not done in this session

- No `/code-review` pass — the interactive skill wasn't invocable from this
  session; a thorough manual self-review was done instead (see commit
  message), but a real `/code-review` pass is still recommended before
  merging to `main`, per this repo's standing phase-branch convention.
- This branch has **not** been merged to `main` — that's an explicit
  orchestrator action the harness scope for this session didn't authorize
  (push-to-designated-branch only). `plan-v1.md`'s Phase 4 checkboxes are
  therefore also left untouched; tick them as part of the merge, once the
  live-key run above closes the exit criterion (or a decision is made to
  merge the code ahead of that, same as `generate-item.py` shipped
  unverified with the caveat documented).
