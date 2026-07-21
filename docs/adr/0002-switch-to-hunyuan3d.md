# ADR-0002: Switch image-to-3D provider from Meshy to Hunyuan3D

**Status:** accepted
**Date:** 2026-07-22
**Amends:** ADR-0001 (does not supersede — ADR-0001's core decision, browser-
direct fal.ai calls with no proxy, is unchanged and continues to hold; only
which fal-hosted model gets called changes)

## Context

The v2 arrangement spike's W-C workstream (`v2-spike-plan.md` §2/§7, D5/R1)
was scoped specifically to test an informal finding from Shyam: a Hunyuan3D
run looked noticeably better than Meshy in an early, unscientific look. Per
OUTCOME-3's standing rule (repeated in the spike plan's §2/§6), nothing about
that counted until verified inside the app's own renderer/lighting, not a
provider preview viewer — that's what D5 (generation) and C3 (Shyam judging
the results in-app, 2026-07-22) existed to settle.

R1 (`spike-v2/R1-hunyuan-memo.md`) first triangulated fal's Hunyuan3D
endpoint/pricing from indexed docs (fal's site blocks a plain fetch), flagged
as unconfirmed. D5 then made a real, live `fal.subscribe` call before writing
any harness code and corrected two of R1's guesses: the real input field is
`input_image_url` (not the guessed name), the real output path is
`model_glb.url`, and multi-view is optional fields on the same
`v3.1/pro/image-to-3d` endpoint rather than a separate one.

D5 generated bookshelf, water-cooler, and the SONDEROD rug on
`fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, reusing Shyam's existing v1
Meshy-generated GLBs for the Meshy side of the comparison (no Meshy spend
needed), and rendered both through the app's real `buildScene()`/lighting
setup — not fal's or Meshy's own preview viewers — into side-by-side contact
sheets (`spike-v2/d5-contact-sheets/`).

## Decision

**Hunyuan3D (`fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`) replaces Meshy
(`fal-ai/meshy/v6/image-to-3d`) as the app's only image-to-3D provider.**
No per-item or per-user model choice is being added — same single
hardcoded-provider shape v1 already had for Meshy, just pointed at a
different model.

Basis for the decision, from C3 (Shyam judging the real contact sheets,
2026-07-22):

- **Quality: Hunyuan wins significantly**, confirmed under the app's own
  sun+IBL lighting — settles the "viewer flattery" risk the spike plan
  called out; this is a real edge, not a hosted-viewer artifact.
- **Cost: Hunyuan is also cheaper.** Real confirmed spend from D5:
  ~$0.53–0.68 per generation (base + PBR, + multi-view add-on where used)
  vs. Meshy's ~$0.80/run (spike 3's figure). Quality and cost point the same
  direction — there's no tradeoff to weigh.
- **Feasibility: unchanged.** Hunyuan3D sits on the same fal queue-job
  platform as Meshy (`fal.storage.upload` / `fal.subscribe` /
  direct-fetch-the-result-URL) — D5's live calls confirm this empirically,
  not just by platform-consistency inference (R1's original caveat). No new
  CORS legs, no proxy, ADR-0001's architecture carries over unchanged.

**Two known-bad results from D5/C3, neither of which weighs against this
decision:**
- The rug's generated mesh is bad on both providers — moot regardless of
  provider choice, since the rug now bypasses mesh generation entirely via
  the flat-textured-plane approach (D4, PR #11).
- The bookshelf's cubby-orientation defect (cubbies on the narrow end,
  should be the wide end) reproduces identically on both providers —
  evidence this is the *source photo's* fault, not something Meshy handled
  differently from Hunyuan. Needs a re-shoot of that item's source photo,
  not a provider decision.

**Not decided here, explicitly deferred:** whether to keep Meshy reachable
as a fallback/manual option. Shyam's call (2026-07-22): "I don't really see
any use for Meshy after this pass" — no fallback path is being built. If a
future case argues otherwise, that's a new ADR, not a silent revival.

## Consequences

- `CLAUDE.md`'s standing decision "Only network call: fal.ai Meshy
  (`fal-ai/meshy/v6/image-to-3d`)" is stale as of this ADR and needs updating
  to name Hunyuan3D instead — done alongside this ADR, not left to drift.
- The import flow's fal.ai integration (`src/import/falClient.ts`,
  `applyImport.ts` — v1 Phase 4) needs its endpoint literal and
  request/response field names swapped to Hunyuan3D's real schema
  (`input_image_url` in, `model_glb.url` out) — not done in this ADR, this
  is the PRD-v2/build-phase work this decision unblocks.
- Every already-imported v1 item's existing Meshy GLB stays valid and in
  place — this decision governs *future* generations, not a mass
  regeneration of Shyam's already-placed room. Re-generating an existing
  item (e.g. via D3's replace flow) would now call Hunyuan instead.
- fal's own pricing/schema for hosted models can change without notice
  (R1 already found its own docs partly stale/unreachable by plain fetch) —
  this ADR's cost figures are a point-in-time confirmation (D5, 2026-07-21),
  not a guarantee; worth a live sanity check if adoption cost becomes
  material again later (e.g. at much higher generation volume).
