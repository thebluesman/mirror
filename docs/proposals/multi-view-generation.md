# Proposal: multi-view / multi-angle Hunyuan generation

**Status:** parked — not written up, not scoped, no schema/UI work started.
This is a placeholder so the thread survives the 2026-07-23 docs cleanup, not
a design document. Write the real proposal when someone wants the answer.
**Date parked:** 2026-07-23 (originally raised in `docs/history/PRD-v2.md`
§11.5 and `spike-v2/OUTCOME.md`, confirmed out of scope for v2)

## The question

Hunyuan3D's `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d` generates one mesh from
one source photo, so the back/sides of a piece of furniture are the model's
inference, not observed geometry. Would generating from multiple photos of
the same object (front + back, or a short turntable) at import time produce
meaningfully better back-view fidelity? PRD-v2 flagged this as worth a
standalone probe but never ran it — v2 shipped with the single-photo path
unchanged.

## Why it's parked, not built

No real object in the room has surfaced a fidelity problem worth the API/UX
cost (multiple uploads, a merge or best-of-N step, more fal.ai spend). It's a
speculative quality question, not a blocked feature.

## Revisit when

Shyam hits a specific piece of furniture whose generated back/sides look
wrong enough to bother him in the assembled room — bring that example back
here rather than re-deriving the question from scratch.
