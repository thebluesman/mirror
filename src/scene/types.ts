// Scene types now live in the formalized schema module (`src/schema/scene.ts`),
// which derives them from the zod validators so there's no hand-kept mirror to
// drift. This file re-exports them for the scene/viewport code that imports
// from "./types"; new code can import from "../schema/scene" directly.

export type {
  SceneFile,
  Room,
  WallDef,
  WallOpening,
  FurnitureItem,
  CameraPosition,
  PlaceCommand,
  Layout,
  Dims,
} from "../schema/scene";
