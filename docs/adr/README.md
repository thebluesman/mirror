# Architecture Decision Records

One decision per file, numbered: `NNNN-short-slug.md`. **Supersede, don't
edit** — a changed decision gets a new ADR that names the one it replaces; the
old ADR gets a `Superseded by ADR-NNNN` line at the top and is otherwise left
intact.

## Template

```markdown
# ADR-NNNN: Title

**Status:** accepted | superseded by ADR-NNNN
**Date:** YYYY-MM-DD

## Context
What forces are at play; what problem this decides.

## Decision
The choice, stated plainly.

## Consequences
What follows — costs accepted, doors closed, doors deliberately left open.
```

## Index

- [ADR-0001](0001-fal-browser-direct.md) — fal.ai calls go browser-direct, no proxy
- [ADR-0002](0002-switch-to-hunyuan3d.md) — switch image-to-3D provider from Meshy to Hunyuan3D

(decisions made pre-ADR live in `docs/history/PRD-v1.md` §8 and
`docs/history/product-review.md`)
