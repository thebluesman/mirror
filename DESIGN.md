# DESIGN.md — visual language (adapted from getdesign.md/cohere)

Source: https://getdesign.md/cohere/design-md (independent extraction of Cohere's
public design patterns; not affiliated with Cohere). Adopted as the v1 UI's visual
language per Shyam's 2026-07-18 decision — "don't spend time on design language."

## 1. Color

**Brand & accent**
| Name | Hex | Role |
|---|---|---|
| Near-Black Primary | `#17171c` | Primary CTAs, dark chrome, deep UI cards |
| Deep Enterprise Green | `#003c33` | Dark feature/product bands |
| Dark Navy | `#071829` | Alternate dark band |
| Action Blue | `#1863dc` | Links, pagination accents |
| Coral | `#ff7759` | Editorial chips, active-state markers |

**Surface & text**
| Name | Hex | Role |
|---|---|---|
| Canvas | `#ffffff` | Dominant background |
| Soft Stone | `#eeece7` | Cards, warm neutral blocks |
| Ink | `#212121` | Body text |
| Hairline | `#d9d9dd` | Rules/dividers |
| Muted Slate | `#93939f` | Metadata, secondary labels |
| Body Muted | `#616161` | Secondary body text |
| Border Light | `#e5e7eb` | Light borders |
| Card Border | `#f2f2f2` | Card outlines |

**Form/state**
| Name | Hex | Role |
|---|---|---|
| Focus Blue | `#4c6ee6` | Focus rings |
| Form Focus (purple) | `#9b60aa` | Textfield focus outline |
| Error | `#b30000` | Error text/borders |

## 2. Typography

Font stack: `"Space Grotesk"` (display/body), `"Space Mono"` (mono/labels) — local
substitutes preserving Cohere's extracted scale.

| Token | Size / weight / line-height / tracking |
|---|---|
| hero-display | 96px / 400 / 1 / -1.92px |
| product-display | 72px / 400 / 1 / -1.44px |
| section-heading | 48px / 400 / 1.2 / -0.48px |
| card-heading | 32px / 400 / 1.2 / -0.32px |
| feature-heading | 24px / 400 / 1.3 / 0 |
| body-large | 18px / 400 / 1.4 / 0 |
| body | 16px / 400 / 1.5 / 0 |
| button | 14px / 500 / 1.71 / 0 |
| mono-label | 14px / 400 / 1.4 / 0.28px, uppercase |

## 3. Spacing scale

`2, 6, 8, 12, 16, 24, 32, 80` (px)

## 4. Radius scale

`xs 4px · sm 8px · md 16px · lg 22px · xl 30px · pill 32px`

## 5. Components

- **button-primary** — `#17171c` bg, white text, pill radius (32px), 12px/24px padding.
- **button-secondary** — transparent, underline, ink text.
- **button-pill-outline** — 1px ink border, transparent bg, pill radius — filter/tag use.
- **blog-filter-chip** — oversized coral outline chip, active state fills coral bg /
  primary text.
- **hero-photo-card** — rounded (22px) media panel, gradient/photo-led fill.
- **product-card** — soft-stone bg, 8px radius, hairline `<hr>` rule between blocks.
- **agent-console-card** — dark (primary) panel mockup: title + status chips + input row.
- **dark-feature-band** — full-bleed dark (deep-green/navy) rounded band, 3-panel grid.
- **form fields** — 1px `#808080` border, 4px radius, 12px padding; focus state = colored
  border + 2px glow ring (`box-shadow: 0 0 0 2px rgba(...,.65)`).
- **table** — hairline borders, soft-stone header row.
- **elevation** — no shadows; depth communicated via flat white / bordered / dark-field /
  gradient-media, not box-shadow blur.

## 6. Responsive

| Breakpoint | Width | Behavior |
|---|---|---|
| Small mobile | <425px | single-column, compact nav |
| Mobile | 425–640px | hero/media stacks, form rows stack |
| Tablet | 768–1024px | 2-column cards begin |
| Desktop | 1024–1440px | full nav, 3-column grids |
| Large desktop | 1440–2560px | wide containers, large vertical rhythm |

## 7. Quick-reference palette (agent prompt guide)

`#17171c` primary · `#003c33` dark band · `#ffffff` canvas · `#eeece7` stone card ·
`#ff7759` editorial/active · `#1863dc` link

Rule of thumb from the source system: white canvas or a full dark band first, pill CTAs,
rounded media cards, no undocumented interaction variants.
