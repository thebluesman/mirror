// Mirrors schema/scene-schema-draft.md (G2 draft). Illustrative until Phase 2
// formalizes this with validation/migration — keep the two in sync by hand.

export interface SceneFile {
  meta: Record<string, unknown>;
  room: Room;
  items: FurnitureItem[];
  cameras: CameraPosition[];
  layouts: Layout[];
  current: string;
}

export interface Room {
  ceilingHeightCm: number;
  floor: Array<{ name: string; x: number; z: number; w: number; d: number }>;
  walls: WallDef[];
}

export interface WallOpening {
  name: string;
  along: "x" | "z";
  start: number;
  size: number;
  type: "door" | "window";
  sillHeightCm?: number;
  headHeightCm?: number;
}

export interface WallDef {
  name: string;
  from: [number, number];
  to: [number, number];
  openings?: WallOpening[];
}

export interface FurnitureItem {
  id: string;
  name: string;
  dimsCm: { w: number; d: number; h: number };
  sourcePhotoHash?: string;
  glbHash?: string;
  notes?: string;
  // The seed JSON carries some fields beyond the schema draft (elevationCm,
  // legHeightCm, shape, main/chaise sub-footprints for the compound sofa) —
  // passed through untyped since Phase 2 owns formalizing this.
  [extra: string]: unknown;
}

export interface CameraPosition {
  id: string;
  name: string;
  eye: [number, number, number];
  lookAt: [number, number, number];
  fovDeg: number;
}

export interface PlaceCommand {
  type: "place";
  itemId: string;
  position: [number, number, number];
  rotationDeg: number;
}

export interface Layout {
  id: string;
  name: string;
  base: string | null;
  commands: PlaceCommand[];
}
