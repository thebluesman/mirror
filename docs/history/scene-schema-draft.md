# Scene schema — draft (G2)

Status: **draft**, written to give the G2 Figma-conversion seed JSON a real
target shape. Phase 2 formalizes this with validation/migration/tests — it
doesn't invent the shape from scratch. Types below are illustrative
(TS-flavored), not a committed interface.

Units: **cm** throughout. Coordinate convention carried over from spike 3's
`geometry.json`: `x` = Figma x, `z` = Figma y (plan view), `y` = up.

```ts
interface SceneFile {
  meta: {
    source: string;       // provenance note, e.g. Figma file/frame + pull date
    units: "cm";
    schemaVersion: string;
  };
  room: Room;
  items: FurnitureItem[];
  cameras: CameraPosition[];
  layouts: Layout[];
  current: string;        // layoutId
}

interface Room {
  ceilingHeightCm: number;
  floor: Array<{ name: string; x: number; z: number; w: number; d: number }>;
  walls: Array<{
    name: string;
    from: [number, number];   // [x, z]
    to: [number, number];
    openings?: Array<{
      name: string;
      along: "x" | "z";
      start: number;
      size: number;
      type: "door" | "window";
      sillHeightCm?: number;
      headHeightCm?: number;
    }>;
  }>;
}

interface FurnitureItem {
  id: string;
  name: string;
  sourcePhotoHash?: string;   // OPFS content-addressed ref, filled in Phase 4 import
  glbHash?: string;           // OPFS content-addressed ref, filled in Phase 4 import
  dimsCm: { w: number; d: number; h: number };
  notes?: string;             // free-text, e.g. furniture-notes.md content
  purchaseInfo?: string;
}

interface CameraPosition {
  id: string;
  name: string;
  eye: [number, number, number];
  lookAt: [number, number, number];
  fovDeg: number;
}

// Branch shape included from v1 per product-review.md's addendum, even though
// v1 only ever populates one implicit layout — cheap now, expensive to retrofit
// once v2 arrangement and the two-user merge case exist.
interface Layout {
  id: string;
  name: string;
  base: string | null;        // parent layoutId, null for the root layout
  commands: PlaceCommand[];   // v1: one "place" command per Figma-seeded item
}

interface PlaceCommand {
  type: "place";
  itemId: string;
  position: [number, number, number];  // [x, y, z], y = floor-snap height
  rotationDeg: number;                 // yaw around vertical axis
}
```

Notes for the G2 seed JSON specifically:

- `items[].sourcePhotoHash` / `glbHash` stay empty until Phase 4 (furniture
  import) actually generates them — G2 only seeds geometry + placement.
- `layouts` has exactly one entry (`id: "current"`, `base: null`) holding a
  `place` command per Figma-seeded item; items with no Figma footprint (none,
  as of this pull) would be omitted from `commands` and get a default position
  at import time instead, per PRD §7.1/flow 3.
- Room shell openings' `sillHeightCm`/`headHeightCm` come from
  `spike/geometry.json`'s `assumed` notes (window sill 90/height 120, balcony
  door full-height) — carried forward, not re-derived from the 2D Figma plan
  view, which can't show them.
