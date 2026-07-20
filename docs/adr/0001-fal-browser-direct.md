# ADR-0001: fal.ai calls go browser-direct, no proxy

**Status:** accepted
**Date:** 2026-07-20

## Context

PRD-v1 §8/§12 and plan-v1.md Phase 0 (gate G1) flagged fal.ai Meshy as v1's
only network call and required verifying, before any app code, that a
browser-origin client using `fal.config({ credentials })` can complete the
full round trip without hitting CORS. Each leg (upload, job submit/poll,
result download) can fail independently — a generate-only probe passing
wouldn't have ruled out a break in Phase 4's import flow. If any leg failed,
v1 would need a minimal local proxy, and building it would become the first
task of Phase 4.

Verified with a throwaway HTML page (not committed — scratch per plan) using
`@fal-ai/client`, run against `fal-ai/meshy/v6/image-to-3d` with a real photo
(`spike/inputs/items/bookshelf.jpg`) and Shyam's fal.ai key, human-in-the-loop.

## Decision

All three legs completed with no CORS errors:

- **Upload** (`fal.storage.upload`) — OK, returned a `v3b.fal.media` URL.
- **Submit + poll** (`fal.subscribe` on `fal-ai/meshy/v6/image-to-3d`) — OK,
  queue updates streamed through to completion.
- **Result GLB download** — OK, 8,051,108 bytes fetched directly from
  `v3b.fal.media`.

v1 calls fal.ai directly from the browser with `fal.config({ credentials })`.
No proxy is built.

## Consequences

- Phase 4 does not gain a proxy-building task — the import flow can call
  Meshy directly from the Settings-panel-stored key (IndexedDB, never
  bundled), as PRD-v1 §12 already assumed for the no-proxy case.
- The API key still lives in the browser at runtime, visible to anyone
  inspecting network requests from Shyam's own machine — acceptable for a
  solo, personal-use PoC per the standing browser-only decision, but this
  would need revisiting before any multi-user or hosted deployment.
- fal's own client docs recommend a server-side proxy for production web
  apps; this decision knowingly departs from that recommendation, scoped to
  v1's solo/local context.
