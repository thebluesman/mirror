# HANDOFF — Phase 3 (shell texturing), branch `v1/texturing`

**Status as of 2026-07-21:** Phase 3 implementation is done (3 commits:
`360d3ee` tileable-texture algorithm, `7d9caff` shell materials + door-height/
DoubleSide/polar-clamp fixes, `036aaf8` upload UI + calibration panel). It
passed build/lint/tests and was verified in-browser (Playwright) with
Shyam's real surface photos — see the conversation/journal for details.

**In progress right now:** a `/code-review` pass against `git diff
main...HEAD` found 8 verified findings (7 CONFIRMED, 1 PLAUSIBLE — see below).
A fix agent is currently working through them on this same branch, committing
incrementally. If this session runs out of usage before that agent finishes,
**check `git log main..HEAD` first** — it may have landed some or all fixes
already. Anything still open should be picked up from the list below.

## The 8 findings (fix agent's mandate, in priority order)

1. **`src/storage/zipExport.ts`** — `referencedHashes()` doesn't include
   `scene.room.shell.{wall,floor,ceiling}.assetHash`, so exported project
   zips silently drop shell-texture assets. Fix: include those hashes.
2. **`src/components/Viewport.tsx`** — calibration-effect cleanup disposes
   textures without nulling `material.map`, causing a flicker/black-flash
   race when effect runs overlap (rapid slider drags).
3. **`src/components/Viewport.tsx`** — `loadShellTexture`'s `ImageBitmap` is
   only closed on the cancelled path; the success path leaks ~4MB/surface
   per calibration change.
4. **`src/components/Viewport.tsx` + `src/components/ShellPanel.tsx`** — no
   debounce on calibration sliders, and the effect reloads all 3 surfaces on
   any single-surface change — the root cause that makes #2/#3 actually
   fire during normal use.
5. **`src/scene/buildScene.ts`** — door/glass-door openings with
   `sillHeightCm > 0` render a see-through gap below the sill (window branch
   fills it, door branch doesn't). Not triggered by the current seed data.
6. **`src/scene/buildScene.ts`** — `headHeightCm >= wallHeight` produces a
   degenerate/inverted lintel `BoxGeometry` (unclamped, unguarded in
   `addSegment` — `addInWallSlab` has the equivalent guard, `addSegment`
   doesn't).
7. **`src/scene/buildScene.ts`** — `headHeightCm - sillHeightCm <= 2` makes
   `leafTop === sill`, so the door leaf silently disappears (zero-height
   guard in `addInWallSlab` no-ops it) while the lintel above still renders.
8. **`src/components/Viewport.tsx`** (PLAUSIBLE, latent) — the build effect
   was split off with `[]` deps + a `useRef`-captured `sceneFile`, so no
   future structural scene change (furniture/walls/camera) after mount will
   trigger a rebuild anymore — only shell-calibration changes still update
   the view. Not triggered by any current caller (App.tsx only mutates
   `room.shell` post-mount today), but a real regression from the prior
   `[sceneFile]`-keyed effect.

Full verified failure scenarios for each are in this conversation's
code-review transcript, not duplicated here — the fix agent already has them
in its prompt.

## If you're picking this up (Shyam or realladygrey)

1. `cd /Users/shyam/Documents/Projects/mirror-v1-texturing && git log
   --oneline main..HEAD` — see what's landed.
2. `npm run build && npm test` (or the project's lint command — check
   `package.json`) — confirm what's currently green.
3. Cross-reference commit messages against the 8 findings above to see
   what's left.
4. Once all 8 are fixed and verified (build/lint/tests clean, and ideally a
   quick in-browser check of the slider-drag flicker fix + a door opening
   with an extreme sill/head height), this is ready for a final
   `/code-review` re-pass or a maintainer's own read-through, then merge to
   `main` per `plan-v1.md`'s phase-exit convention (merge, `@historian`
   journal entry, tick Phase 3's checkboxes in `plan-v1.md`).
5. Don't touch `spike/` (frozen reference), and don't start Phase 4
   (furniture import) or Phase 5 (polish) work from this branch.
