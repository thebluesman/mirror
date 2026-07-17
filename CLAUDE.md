# mirror — home digital twin

Local-first browser app to model Shyam's home: import furniture from photos
(Meshy image-to-3D), texture the room shell from surface photos, view the
assembled room in real-time PBR. Solo project, personal use, PoC-stage.

## Current state (2026-07-18)

Three-spike R&D arc **closed** (`spike/OUTCOME*.md` — AI-still NO-GO, real-time
PBR GO-WITH-REFRAME, photo-derived generation CLEAN GO). Now building **v1:
import + view only**, per `PRD-v1.md`. Arrangement is v2, measurement is v3 —
do not pull them forward without Shyam re-opening scope.

## Canonical documents

| Doc | Holds |
|---|---|
| `PRD-v1.md` | v1 scope, flows, architecture decisions, success criteria |
| `plan-v1.md` | v1 build plan — phases, agent/model assignments, resume protocol |
| `DESIGN.md` | Visual language (adapted Cohere system) — tokens, components |
| `product-review.md` | Pre-spike scoping review + addendum (platform/storage/schema rationale) |
| `spike/OUTCOME*.md` | R&D evidence for what v1 builds on |
| `docs/adr/` | New decisions from v1 build onward — one per file, supersede-don't-edit |
| `docs/journal/` | Decision narrative, written by `@historian` — don't edit by hand |

## Standing decisions (don't re-litigate; supersede via ADR)

- **Browser-only** shell (no Tauri/Electron) — Vite + React + Three.js, no
  backend, no SQLite. Rationale recorded in PRD §8.
- **Storage:** versioned JSON project file (File System Access API +
  IndexedDB autosave); binary assets (photos, GLBs, textures) in OPFS,
  content-addressed, referenced by hash from the JSON; zip export for
  portability. `layouts[]`/`current` branch shape in the schema from v1.
- **Placement (v1):** furniture positions/rotations are seeded by the one-time
  Figma MCP conversion (like spike 3's `geometry.json`); no in-app
  repositioning until v2.
- **Only network call:** fal.ai Meshy (`fal-ai/meshy/v6/image-to-3d`).
  Texturing and rendering are local.

## Workflow

- **Historian:** a Stop hook (`.claude/hooks/historian-check.py`) watches
  canonical docs and prompts `@historian` to journal + commit + push. It runs
  **only in the primary checkout on `main`** — worktree/branch sessions are
  gated out by design; decisions land in the journal when they merge to main.
- **Commits:** docs and journal batches commit directly to `main` (solo repo,
  no PR ceremony for docs). Implementation work follows normal branch
  discipline once orchestration starts.
- **No sprint/kanban ceremony** — kanban-pull, no Notion board, at this stage.

## Conventions

- All docs are Markdown.
- ISO dates (`2026-07-18`) everywhere.
- `spike/` is frozen evidence — don't refactor or "clean up" spike code; v1
  productizes `spike/scene2.html`'s Three.js core into the app, it doesn't
  edit the spike in place.
