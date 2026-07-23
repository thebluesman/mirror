# Proposal: multi-step undo / redo

**Status:** parked — not written up, not scoped, no schema/UI work started.
This is a placeholder so the thread survives the 2026-07-23 docs cleanup, not
a design document. Write the real proposal when someone wants the answer.
**Date parked:** 2026-07-23 (originally raised in `docs/history/PRD-v2.md`
§7.9 as an open implementation question, resolved down to single-step for the
v2 build)

## The question

v2 shipped single-step undo for placement edits (move/rotate/elevation).
Multi-step history (an undo stack, redo) was explicitly left as "an open
implementation question for the build phase, not decided here" — it was never
picked back up once single-step proved sufficient to ship.

## Why it's parked, not built

Single-step has been enough in practice so far; no reported case where a user
needed to undo more than the most recent edit.

## Revisit when

Shyam hits a real "I needed to undo three moves back" moment during use —
bring that concrete case back here rather than re-deriving the question from
scratch.
