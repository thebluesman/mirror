import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { computeRoomBoundsCm } from "../scene/cameraBounds";
import { itemFootprintAABB, type AABB } from "../scene/collision";
import { computeMinimapProjection, worldToMinimapPx } from "../scene/minimapProjection";
import type { FurnitureItem, PlaceCommand, Room } from "../scene/types";
import "./Minimap.css";

// improvements-minor-fixes.md §13: early/lite top-down HUD minimap —
// "boxes + camera dot, no polish" per the doc's own scope note. Explicitly
// NOT the start of a richer HUD/space-UI treatment (deferred there); don't
// grow this into per-item icons, colors, labels, or a live-drag-following
// furniture layer without Shyam re-opening scope.

const CANVAS_SIZE_PX = 160;
const CANVAS_PADDING_PX = 12;
const CAMERA_DOT_RADIUS_PX = 4;
const FACING_WEDGE_LENGTH_PX = 15;
const FACING_WEDGE_HALF_WIDTH_PX = 5;

// Canvas 2D drawing can't consume CSS custom properties directly (unlike the
// HUD panel div below, which uses var(...) normally) — these colors are the
// same rgba(255,255,255,0.3) hairline ViewportChrome.css/Viewport.css already
// use for a translucent line on the near-black HUD background, not a new
// palette, plus DESIGN.md's --color-canvas/--color-action-blue for the
// furniture fill and camera marker.
const ROOM_OUTLINE_STYLE = "rgba(255, 255, 255, 0.3)";
const FURNITURE_FILL_STYLE = "rgba(255, 255, 255, 0.55)";
const CAMERA_MARKER_STYLE = "#1863dc"; // --color-action-blue

export interface MinimapHandle {
  /** Called every animate() frame from Viewport.tsx with the live camera's
   *  world x/z (cm) and its current facing direction's x/z components (need
   *  not be a unit vector — see minimapProjection.ts's normalizeXZ, which
   *  this component runs the direction through before drawing the wedge). */
  updateCamera(xCm: number, zCm: number, dirX: number, dirZ: number): void;
}

/** Top-down HUD minimap: room floor outline, furniture footprints as plain
 *  boxes, and the live camera as a dot + facing wedge — visible in both
 *  orbit and walk mode since Viewport.tsx drives updateCamera every frame
 *  regardless of which control scheme is active. Furniture/room data comes
 *  from the same sceneFile props Viewport already has (not the live
 *  mutate-during-gesture groups — a mid-drag item lags on the minimap until
 *  its commit, an acceptable "lite" tradeoff per the doc's scope). */
export const Minimap = forwardRef<MinimapHandle, { room: Room; items: FurnitureItem[]; commands: PlaceCommand[] }>(
  function Minimap({ room, items, commands }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Latest camera reading, written imperatively by updateCamera (called up
    // to once per animate() frame) rather than React state — the same
    // "hot per-frame data lives in a ref" pattern Viewport.tsx uses
    // throughout, so a camera move never triggers a React re-render here.
    const cameraRef = useRef({ xCm: 0, zCm: 0, dirX: 0, dirZ: -1 });

    const bounds = useMemo(
      () => computeRoomBoundsCm(room),
      // eslint-disable-next-line react-hooks/exhaustive-deps -- room.floor/ceilingHeightCm are the only fields computeRoomBoundsCm reads
      [room.floor, room.ceilingHeightCm],
    );

    // Static per-item world footprints: reuses collision.ts's own
    // itemFootprintAABB (furnitureFootprint + rotation, already exported for
    // exactly this "world-space rectangle for a placed item" need) rather
    // than re-deriving rotation trig here. Same axis-aligned-not-oriented
    // simplification collision.ts already made for these items — fine twice
    // over for a "no polish" minimap.
    const itemRects = useMemo(() => {
      const itemsById = new Map(items.map((item) => [item.id, item]));
      const rects: AABB[] = [];
      commands.forEach((cmd) => {
        const item = itemsById.get(cmd.itemId);
        if (item) rects.push(itemFootprintAABB(item, cmd.position, cmd.rotationDeg));
      });
      return rects;
    }, [items, commands]);

    function draw() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const projection = computeMinimapProjection(bounds, canvas.width, canvas.height, CANVAS_PADDING_PX);

      ctx.strokeStyle = ROOM_OUTLINE_STYLE;
      ctx.lineWidth = 1;
      room.floor.forEach((rect) => {
        const [x0, y0] = worldToMinimapPx(rect.x, rect.z, projection);
        const [x1, y1] = worldToMinimapPx(rect.x + rect.w, rect.z + rect.d, projection);
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      });

      ctx.fillStyle = FURNITURE_FILL_STYLE;
      itemRects.forEach((aabb) => {
        const [x0, y0] = worldToMinimapPx(aabb.minX, aabb.minZ, projection);
        const [x1, y1] = worldToMinimapPx(aabb.maxX, aabb.maxZ, projection);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      });

      const { xCm, zCm, dirX, dirZ } = cameraRef.current;
      const [cx, cy] = worldToMinimapPx(xCm, zCm, projection);
      ctx.fillStyle = CAMERA_MARKER_STYLE;
      ctx.beginPath();
      ctx.arc(cx, cy, CAMERA_DOT_RADIUS_PX, 0, Math.PI * 2);
      ctx.fill();

      // Facing wedge: a small triangle from the dot along (dirX, dirZ), base
      // corners offset perpendicular to that direction.
      const tipX = cx + dirX * FACING_WEDGE_LENGTH_PX;
      const tipY = cy + dirZ * FACING_WEDGE_LENGTH_PX;
      const perpX = -dirZ * FACING_WEDGE_HALF_WIDTH_PX;
      const perpY = dirX * FACING_WEDGE_HALF_WIDTH_PX;
      ctx.beginPath();
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(cx + perpX, cy + perpY);
      ctx.lineTo(cx - perpX, cy - perpY);
      ctx.closePath();
      ctx.fill();
    }

    // Redraws on a structural data change (room/items/commands) independent
    // of the camera — without this, a furniture edit landing between camera
    // moves (e.g. the app briefly idle in walk mode with no keys held) would
    // leave the minimap showing stale boxes until the next frame update.
    useEffect(draw, [bounds, itemRects]);

    useImperativeHandle(ref, () => ({
      updateCamera(xCm, zCm, dirX, dirZ) {
        cameraRef.current = { xCm, zCm, dirX, dirZ };
        draw();
      },
      // No deps array: recreated each render so it always closes over the
      // latest bounds/itemRects (structural scene edits) without needing its
      // own separate resync effect — cheap, since Viewport only re-renders
      // this component on an actual sceneFile prop change, not per frame.
    }));

    return (
      <div className="minimap">
        <canvas ref={canvasRef} width={CANVAS_SIZE_PX} height={CANVAS_SIZE_PX} className="minimap-canvas" />
      </div>
    );
  },
);
