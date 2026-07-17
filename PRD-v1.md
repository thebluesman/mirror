# PRD v1 — Home Digital Twin: Import + View

**Status:** Draft, 2026-07-18. Scope: the validated slice only (import furniture/shell
from photos, view an accurate rendered room). Arrangement (v2) and measurement (v3)
are explicitly out of scope here — see §9.

## 1. Problem

Before buying, moving, or hanging something, the real question is "what will it look
like in my actual room, and can I trust that enough to decide?" Photos of furniture in
isolation, or generic showroom renders, don't answer that — you need to see the
specific item, at true scale, in your specific room, lit the way your room is lit.

## 2. Background — what's already validated

Three spikes (`spike/OUTCOME.md`, `OUTCOME-2.md`, `OUTCOME-3.md`) answered the
visualization-mechanism question end to end:

1. **AI-still rendering (depth-conditioned ControlNet): NO-GO.** Appearance fidelity
   (materials, color, product-specific detail) never cleared the bar across two
   prompt-enrichment rounds.
2. **Real-time PBR rendering (Three.js, authored geometry): GO-WITH-REFRAME.**
   Layout/proportion and brightness/mood passed; color/material fidelity was the one
   gap, with "real photo textures, not a better renderer" identified as the fix.
3. **Photo-derived generation (Meshy image-to-3D furniture + photo-calibrated shell
   textures): CLEAN GO.** Closed the color/material gap. Whole-room similarity passes
   without caveats Shyam has to talk himself out of.

v1 turns spike 3's pipeline into a real, usable app. No new rendering or generation
technique — this is productization, not R&D.

## 3. Divergence from the original spec (recorded explicitly)

The original project spec (pre-spike) scoped photos narrowly: "verification/
material-extraction/artwork-capture only, NOT automatic room reconstruction." The
spikes moved past that — Meshy image-to-3D generates actual furniture *geometry* from
a single photo, not just a material swatch, and that's the CLEAN GO result v1 is
built on. This PRD supersedes the original spec on that one point; everything else in
the original spec (local-first, parametric furniture data, layered
intent→command→scene architecture, 2D+3D editing modes, named camera positions,
measurement-as-core) still holds as the longer-term shape — v1 just doesn't reach all
of it yet.

## 4. Goals (v1)

- Import a room's shell (walls, floor, ceiling) textured from the user's own surface
  photos.
- Import individual furniture items from a photo, generated as scaled, floor-snapped
  3D meshes via Meshy.
- View the assembled room in real-time PBR (Three.js/WebGL), with free camera control
  and the option to save named viewpoints (per spike 2/3's camera-preset pattern).
- Run entirely in-browser, local-first for data (photos, generated GLBs, room
  definition) per the decision to ship browser-only for v1 (File System Access API
  where available; OPFS for binary assets, IndexedDB for autosave — see §8 Storage).

## 5. Non-goals (v1)

- **Arrangement** — dragging/repositioning furniture, collision/overlap detection,
  saving multiple layouts. Zero spike coverage; gets its own spike before its own PRD
  (v2).
- **Measurement** — clearance/distance overlays, physical placement instructions.
  Depends on v2's placement model existing first (v3).
- **Chat-driven editing**, structured command history/undo, AI intent interpretation
  layer — part of the original spec's longer-term architecture, not v1.
- **Multi-room / full-home modeling** — v1 is single-room, matching the original
  spec's own MVP framing.
- Desktop packaging (Tauri) — deferred; see decision below.
- Furniture marketplace, AR/VR, photorealistic (path-traced) rendering as the default
  path, automatic room scanning, physics simulation — unchanged from the original
  spec's exclusions.

## 6. Users

Single user (Shyam), personal use, own home. No multi-user, sharing, or account
system in v1.

## 7. Core flows

1. **Room setup** — define the room shell (dimensions, wall/window/door openings)
   **and seed furniture positions/rotations** via a **manual, one-time
   Figma-MCP-session conversion** into the JSON scene schema
   (decided in `product-review.md`'s addendum, superseding that doc's earlier
   plugin-importer recommendation). This is explicitly a one-shot conversion, not a
   live importer — an LLM reads the existing Figma layout via an MCP session and
   produces the scene JSON by hand-in-the-loop, not a guaranteed-numeric extraction.
   Two things this implies for v1: (a) a calibration step against real measurements
   still applies regardless of extraction method — Figma-derived numbers are a
   starting point, not ground truth; (b) any future layout change means redoing the
   session manually — acceptable given the apartment isn't moving, but worth the app
   surfacing as a known limitation rather than silently going stale. **Placement
   decision (2026-07-18):** since arrangement UI is v2, the Figma session is also how
   furniture reaches its real position and rotation in v1 — exactly what spike 3's
   `geometry.json` did. Imported furniture items snap to their Figma-drawn footprint;
   there is no in-app repositioning in v1.
2. **Shell texturing** — upload wall/floor/ceiling photos → tileable texture
   generation + calibration against a reference photo (per `spike/textures/`
   pipeline). Calibration gets a **minimal in-app UI** (tint/repeat sliders replacing
   the spike's hand-edited `calibration.json`) — hand-editing JSON would violate §10's
   no-manual-steps criterion.
3. **Furniture import** — per item: upload a photo (product-listing shot preferred,
   personal photo as fallback per OUTCOME-3's finding that catalog shots generate
   cleaner results) → Meshy generate → confirm/adjust known cm dimensions → rescale +
   floor-snap → place at the item's Figma-seeded position/rotation (see flow 1; items
   with no Figma footprint get a default position, acceptable for evaluating a
   prospective purchase).
4. **View** — orbit/pan/zoom the rendered room; save/recall named camera viewpoints.

## 8. Architecture

- **Shell:** browser-only web app (decided 2026-07-18 — see rationale below), built as
  **Vite + React + Three.js** (per `product-review.md`'s platform recommendation,
  which explicitly cut the originally-proposed Node backend + SQLite as
  over-engineering for single-user/single-home scale). `scene2.html`'s Three.js core
  is the rendering foundation, productized into this app shell.
- **Storage:** one versioned **JSON project file** per home — File System Access API
  (Chromium) for real file read/write, plain download/upload as the cross-browser
  fallback, autosave to IndexedDB in between. The scene *description* is kilobytes;
  JSON is diffable, git-friendly, and (once a command log exists, post-v1) gives
  history/undo for free. **Binary assets (source photos, generated GLBs, textures —
  MB-scale, ~3 MB for spike 3's single room) do not live in the JSON:** they're
  stored in **OPFS**, content-addressed, and the JSON references them by hash.
  Portability ("the project file") is the JSON plus a **zip export** bundling the
  referenced assets. Real folder ownership via a Tauri wrap stays available later if storage
  durability becomes a real problem (near zero-rewrite path per the SWOT comparison
  done during scoping) — not needed for v1.
- **External dependency:** fal.ai Meshy 6 (`fal-ai/meshy/v6/image-to-3d`) for
  furniture generation — the only network call in the pipeline; everything else
  (texturing, rendering) is local/offline. **API key:** pasted once into a settings
  panel, stored locally (IndexedDB), never bundled. **First build task: verify fal.ai
  accepts browser-origin (CORS) calls with a user key** — if it doesn't, v1 needs a
  minimal local proxy (a `vite dev`-style helper process), which would dent but not
  break the browser-only posture; resolve before building the import flow.
  Generation is an async, minutes-long job: the flow must handle failure explicitly
  (a failed job leaves no half-imported item in the scene; retry is per-item and
  re-uses the uploaded photo). Meshy calls cost real money per generation — surface
  that in the confirm step rather than firing on drop.
- **Data model (v1 subset of the original spec's entities):** Room (dims, shell
  materials), Furniture Item (source photo, generated GLB, cm dims), Camera Position
  (named). **Position and rotation live in the layout, not on the item** — the
  implicit v1 layout holds each item's placement (seeded from Figma, see §7.1), so
  v2's multi-layout arrangement doesn't have to migrate placement off the item
  later. **Include the `layouts: [{name, base, commands[]}]`, `current: layoutId`
  branch shape in the schema from v1**, even though v1 only ever populates a single
  implicit layout — per `product-review.md`'s addendum, this is what later resolves
  both arrangement-versioning (v2) and the two-user case cleanly (each person edits
  their own named branch of the same synced JSON file — via Dropbox/iCloud/Syncthing,
  no server — and merging to `current` is an explicit human choice, not automatic
  conflict resolution). It's cheap to include now and expensive to retrofit later.

### Why browser-only (recorded decision)

Two forks argued both sides critically (SWOT); both independently converged on: the
"local-first" claim is already compromised by the Meshy API call, so browser-only
isn't sacrificing a purity the project genuinely has, and the shell choice isn't
irreversible (Tauri-wraps-later is near-zero-rewrite). Browser-only ships faster and
matches the still-solo, still-personal usage pattern; desktop packaging overhead
(Rust toolchain, cross-platform signing, updater) has no payoff yet. Revisit if
storage eviction/data-loss or cross-browser pain actually bites.

## 9. Visual design

`DESIGN.md` (adapted from the Cohere system via getdesign.md, decided 2026-07-18) is
the base visual language — colors, type scale, spacing/radius tokens, component
patterns. Two things extrapolated beyond the source system, since it's a marketing
site pattern set, not a 3D-tool one:

- **Viewport chrome** (camera-preset buttons, orbit hints, floating controls over the
  Three.js canvas): built from `DESIGN.md`'s existing tokens (near-black `#17171c`
  floating control bar, pill buttons), not a new system.
- **Upload/processing states** (drag-and-drop, "generating via Meshy…" progress,
  success/failure): not designed yet — figure out during build; Shyam can design
  quickly in Figma if the ad-hoc version isn't good enough.
- **No dark shell** — the app uses the light-canvas theme as-is; Cohere's dark bands
  are available for accent use (e.g. a processing panel) but the app default is light.

## 10. Success criteria

v1 is done when Shyam can, for his actual room: set up the shell from his own photos,
import his actual furniture items via photo, and get a rendered view he'd judge the
same way OUTCOME-3's C2 did — "that's my room" — inside an app, not a one-off script
run. Concretely: no manual script invocation required for the core flow (upload →
generate → view), room/furniture data persists across browser sessions.

## 11. Future (explicitly deferred, not designed here)

- **v2 — Arrangement.** Gets a dedicated spike first (drag/drop interaction,
  collision/overlap detection, snapping, multi-layout save) before its own PRD, since
  it's the one workstream with zero spike coverage. Rough estimate from prior
  discussion: 3–5 weeks once scoped.
- **v3 — Measurement.** Clearance/distance overlays and physical placement
  instructions, depends on v2's placement model. Rough estimate: 1–3 weeks.
- Longer-term architecture from the original spec (chat-driven structured commands,
  AI intent interpretation layer, full command history/undo, multi-room) stays the
  eventual shape but isn't scheduled yet.

## 12. Open questions

Room-shell input, storage strategy, and UI framework (previously open here) are
resolved — see §7 and §8. Remaining:

- **Figma layer/naming conventions** for the one-time MCP conversion session —
  **promoted to a scheduled pre-build task** (it now blocks placement seeding too,
  per the §7.1 decision, so it gates the first end-to-end run, not just room setup).
- **AI provider abstraction** — out of v1's critical path (v1 has no chat/command
  layer), but `product-review.md` recommends building any LLM-touching call (there
  isn't one in v1 today, unless furniture-photo handling ever adds vision extraction)
  behind a thin, swappable interface from the start rather than hardcoding a provider.
  Flagging here so it isn't forgotten if v1's furniture flow grows a vision step.
