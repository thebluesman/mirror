# mirror — home digital twin

Local-first browser app to model Shyam's home: import furniture from photos
(Hunyuan3D image-to-3D, per ADR-0002 — was Meshy in v1), texture the room
shell from surface photos, view the assembled room in real-time PBR. Solo
project, personal use, PoC-stage.

## Current state (2026-07-23)

**v1 (import + view) and v2 (arrangement) have both shipped** and passed
acceptance. The app is now in a deliberate pause for post-v2 hardening and
open-ended use — Shyam is living with it before deciding what shape comes
next. Measurement (v3) stays shelved; don't pull it forward without Shyam
re-opening scope. Two threads are parked, not forgotten: see
`docs/proposals/multi-view-generation.md` and
`docs/proposals/undo-redo-history.md`.

## Canonical documents

| Doc | Holds |
|---|---|
| `DESIGN.md` | Visual language (adapted Cohere system) — tokens, components |
| `docs/adr/` | Standing architecture decisions — one per file, supersede-don't-edit |
| `docs/proposals/` | Scoped-but-not-committed feature designs — status-labeled (deferred/built/parked) |
| `docs/journal/` | Decision narrative, written by `@historian` — don't edit by hand |
| `docs/history/` | Superseded/completed docs (PRDs, plans, spike-arc scoping) — archive, not a reading list for current state |
| `spike/OUTCOME*.md`, `spike-v2/OUTCOME.md` | R&D evidence for what v1/v2 build on |

## Standing decisions (don't re-litigate; supersede via ADR)

- **Browser-only** shell (no Tauri/Electron) — Vite + React + Three.js, no
  backend, no SQLite. Rationale recorded in `docs/history/PRD-v1.md` §8.
- **Storage:** versioned JSON project file (File System Access API +
  IndexedDB autosave); binary assets (photos, GLBs, textures) in OPFS,
  content-addressed, referenced by hash from the JSON; zip export for
  portability. `layouts[]`/`current` branch shape in the schema from v1.
- **Placement:** furniture positions/rotations seed from the one-time Figma
  MCP conversion (like spike 3's `geometry.json`); in-app move/rotate/
  elevation with undo shipped in v2.
- **Only network call:** fal.ai Hunyuan3D (`fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`,
  per ADR-0002 — supersedes v1's Meshy call, `fal-ai/meshy/v6/image-to-3d`).
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
- ISO dates (`2026-07-23`) everywhere.
- `spike/` and `spike-v2/` are frozen evidence — don't refactor or "clean up"
  spike code; v1/v2 productize spike findings into the app, they don't edit
  the spike in place.
- `docs/history/` is likewise archive — read it for provenance, don't edit it;
  a correction to a superseded decision goes in an ADR or the current doc, not
  back into the historical record.
