import { useEffect, useMemo, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import seedRaw from "../seed/living-room.json";
import { Viewport, type ViewportHandle } from "./components/Viewport";
import type { ObjectEditPatch } from "./components/ObjectInspector";
import { ViewportChrome } from "./components/ViewportChrome";
import { LayoutChrome } from "./components/LayoutChrome";
import { ShellPanel } from "./components/ShellPanel";
import { LightingPanel } from "./components/LightingPanel";
import { ImportPanel } from "./components/ImportPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ShortcutCheatsheet } from "./components/ShortcutCheatsheet";
import {
  parseScene,
  type CameraPosition,
  type Lighting,
  type LightingMode,
  type Location,
  type SceneFile,
  type SurfaceCalibration,
} from "./schema/scene";
import { makeCameraPosition, renameCameraPosition } from "./scene/cameraViewpoints";
import { makeLayout, renameLayout } from "./scene/layouts";
import { commitToActiveLayout, setPlaceCommand } from "./scene/commit";
import { applyUndo, recordUndo, type UndoSlot } from "./scene/undo";
import { allItemsLocked } from "./scene/lockState";
import { LENS_PRESETS, nearestLensPresetId, type LensPresetId } from "./scene/cameraLens";
import { loadProject, saveProjectDebounced, saveProjectNow } from "./storage/autosave";
import "./App.css";

const TABS = ["Shell", "Lighting", "Import", "Settings"] as const;
type Tab = (typeof TABS)[number];

// Load order (Phase 2 exit criterion — persists across a browser restart):
// restore the autosaved project from IndexedDB if present; otherwise seed
// from the committed living-room.json (through schema validation + migration)
// and autosave that, so subsequent loads restore from the store, not the file.
async function loadInitialScene(): Promise<SceneFile> {
  const restored = await loadProject();
  if (restored) return restored;
  const seeded = parseScene(seedRaw);
  await saveProjectNow(seeded);
  return seeded;
}

function App() {
  const [sceneFile, setSceneFile] = useState<SceneFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("Shell");

  // Single-step undo slot (PRD-v2 §7.9). Holds the SceneFile as it was just
  // before the most recent committed action; `null` means nothing to undo.
  // Deliberately in-memory only (plain component state, not persisted): undo
  // does NOT survive a reload — PRD-v2 says nothing about it surviving, and the
  // slot's meaning ("the action you just took") doesn't carry across a session
  // boundary. A fresh load starts with an empty slot / disabled button.
  const [undoSlot, setUndoSlot] = useState<UndoSlot>(null);

  // improvements-v2.1 §4: "lock all" HUD toggle. View-only interaction
  // safety ("can't be accidentally dragged while orbiting"), not a scene
  // fact — deliberately ephemeral component state, same treatment as
  // undoSlot above, NOT folded into `sceneFile`/autosave/undo. A reload
  // starts unlocked, same as undo starts empty. This flag alone is threaded
  // to Viewport unchanged (it's the actual override gate isPlacementLocked
  // reads) — but NOT to ViewportChrome's button display anymore; see
  // `lockAllActive` below for why.
  const [globalLock, setGlobalLock] = useState(false);

  // improvements-minor-fixes.md §3 (review round, new scope added at
  // review): the HUD "Lock all" button's label/pressed state used to be
  // just `globalLock` above, which goes stale the moment an item is
  // individually locked via the per-item "L" key — the flag stays false
  // even though every item is genuinely locked. Derived here from the real
  // per-item `locked` flags (allItemsLocked, src/scene/lockState.ts) OR'd
  // with the override flag itself, so the button reflects reality
  // regardless of which path got every item locked. `sceneFile?.items ?? []`
  // rather than gating this whole memo on `sceneFile` being loaded, since
  // ViewportChrome doesn't render before sceneFile exists anyway.
  const lockAllActive = globalLock || (sceneFile ? allItemsLocked(sceneFile.items) : false);

  // improvements-minor-fixes.md §17: live lens-picker FOV — ephemeral view
  // state, NOT part of sceneFile, mirroring globalLock's shape exactly
  // (state + setter in App.tsx, threaded to ViewportChrome for the picker UI
  // and to Viewport as a prop that drives the actual camera.fov mutation).
  // Starts `undefined` (not HUMAN_FOV) — see Viewport.tsx's live-update
  // effect for why defaulting here would clobber a saved viewpoint's own
  // fovDeg on the very first render; Viewport reports the real starting
  // value back via onFovRecalled once it knows it.
  const [liveFovDeg, setLiveFovDeg] = useState<number | undefined>(undefined);
  // Recall-sync (proposal §3, docs/proposals/camera-lens-picker.md): derives
  // which preset (if any) the picker should highlight from the live fov,
  // rather than tracking "which preset was last clicked" as separate state
  // — so a saved-viewpoint recall (which sets camera.fov directly and
  // reports back through onFovRecalled) re-syncs the highlight for free,
  // snapping to the nearest preset within tolerance or showing no
  // highlight ("Custom") if it's meaningfully off from all three.
  const activeLensPreset = useMemo(
    () => (liveFovDeg === undefined ? null : nearestLensPresetId(liveFovDeg)),
    [liveFovDeg],
  );

  function handleSetLensPreset(id: LensPresetId) {
    const preset = LENS_PRESETS.find((p) => p.id === id);
    if (preset) setLiveFovDeg(preset.fovDeg);
  }

  // improvements-minor-fixes.md §3: the `?` cheatsheet overlay's open state.
  // Ephemeral UI state, same shape as `naming`/`renamingId` in
  // ViewportChrome — not worth threading through sceneFile.
  const [showShortcuts, setShowShortcuts] = useState(false);

  // docs/proposals/reimport-entry-point.md §14: which item ObjectInspector's
  // "Re-import…" button asked to pre-select in ImportPanel's picker, once
  // the tab switches to "Import". Ephemeral UI-routing state, same shape as
  // showShortcuts above — not a scene fact, never persisted. Consumed only
  // as ImportPanel's `useState` initializer (see that component: it's
  // freshly mounted every time `tab === "Import"` becomes true, a plain
  // conditional render below, not a keep-alive), so this doesn't need to be
  // "cleared after use" on that path — but it DOES need clearing on a
  // direct click of the Import tab button (see TABS.map below), so a stale
  // pre-selection from an earlier Re-import click can't silently resurface
  // on a later plain click of the tab.
  const [reimportTarget, setReimportTarget] = useState<string | null>(null);

  // docs/proposals/reimport-entry-point.md §14: ObjectInspector's
  // "Re-import…"/"Import…" button, threaded up through Viewport.tsx's
  // onReimport prop. Per the proposal's confirmed lean: leaves
  // ObjectInspector open behind the sidebar (does not deselect the item) —
  // the item stays visibly selected/outlined in the viewport as useful
  // context while re-importing it.
  function handleRequestReimport(itemId: string) {
    setReimportTarget(itemId);
    setTab("Import");
  }

  useEffect(() => {
    let cancelled = false;
    loadInitialScene()
      .then((scene) => {
        if (!cancelled) setSceneFile(scene);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Shell calibration changes come from ShellPanel's sliders/uploads. They're
  // persisted through the existing storage layer (debounced autosave, same
  // as any other scene mutation would be) but kept out of the `sceneFile`
  // reference Viewport uses for its one-time structural build — Viewport
  // reads `shellCalibration` as a separate prop and applies it live without
  // rebuilding the WebGL scene (see Viewport.tsx).
  function updateShellSurface(surface: "wall" | "floor" | "ceiling", calib: SurfaceCalibration) {
    setSceneFile((prev) => {
      if (!prev) return prev;
      const next: SceneFile = {
        ...prev,
        room: { ...prev.room, shell: { ...prev.room.shell, [surface]: calib } },
      };
      saveProjectDebounced(next);
      return next;
    });
  }

  // improvements-v2.2 §4a: sun/hemisphere sliders come from LightingPanel.
  // Same debounced-autosave, kept-out-of-the-structural-Viewport-prop shape
  // as updateShellSurface above — Viewport reads `lighting` as a separate
  // prop and applies it live without rebuilding the WebGL scene.
  function updateLighting(lighting: Lighting) {
    setSceneFile((prev) => {
      if (!prev) return prev;
      const next: SceneFile = { ...prev, room: { ...prev.room, lighting } };
      saveProjectDebounced(next);
      return next;
    });
  }

  // improvements-minor-fixes §9: mode toggle + location facts, same
  // debounced-autosave shape as updateLighting above. Deliberately separate
  // setters (not folded into updateLighting) since `lightingMode`/`location`
  // are source facts distinct from `lighting`'s resolved slider values
  // (proposal §4.1) — switching modes must never clobber the other mode's
  // stored data.
  function updateLightingMode(lightingMode: LightingMode) {
    setSceneFile((prev) => {
      if (!prev) return prev;
      const next: SceneFile = { ...prev, room: { ...prev.room, lightingMode } };
      saveProjectDebounced(next);
      return next;
    });
  }

  function updateLocation(location: Location) {
    setSceneFile((prev) => {
      if (!prev) return prev;
      const next: SceneFile = { ...prev, room: { ...prev.room, location } };
      saveProjectDebounced(next);
      return next;
    });
  }

  // The single persistence tail every discrete, deliberate scene commit
  // shares — import, viewpoint save/delete, layout save/delete/switch, and a
  // placement drag/rotate release. Each such action is persisted immediately
  // (not the debounced path updateShellSurface uses for a continuously-dragged
  // slider) because the action itself is the discrete moment; there's nothing
  // after it to coalesce, and a newly-generated GLB's hashes must never be
  // lost to a closed tab.
  //
  // `next` is always computed from a closed-over `sceneFile`, then handed to
  // both setSceneFile and saveProjectNow — deliberately NOT the
  // setSceneFile(prev => ...) functional-update form updateShellSurface uses.
  // saveProjectNow (unlike saveProjectDebounced) isn't idempotent-by-timer, so
  // putting the write inside a functional updater would fire two real
  // IndexedDB writes per action under React 18 StrictMode's dev double-invoke
  // (code-review finding). Centralizing the tail here keeps that reasoning in
  // one spot and gives Phase 7 (undo) a single place to observe every committed
  // SceneFile.
  //
  // Phase 7 (single-step undo, §7.9) hooks here: every discrete action funnels
  // through `commit`, so recording the *previous* `sceneFile` into the undo
  // slot on each call captures all of them — move/rotate/elevation (via
  // commitPlacement), import/replace (handleImported), and layout/view
  // save-delete-rename — from one seam, without an undo-aware wrapper in each
  // handler. `sceneFile` here is the state as it was before `next`, so it's
  // exactly the snapshot undo restores. Shell-texture calibration is
  // deliberately NOT covered: it takes the debounced updateShellSurface path,
  // not commit(), because it's a continuously-adjusted slider, not a discrete
  // action (§7.9).
  function commit(next: SceneFile) {
    if (sceneFile) setUndoSlot(recordUndo(sceneFile));
    setSceneFile(next);
    void saveProjectNow(next);
  }

  // Restores the single undo snapshot as the current scene and persists it
  // through the same saveProjectNow path a commit uses, so the reverted state
  // survives a reload. Restoring the *whole* SceneFile (not popping one
  // commands[] entry) is what lets one code path undo any action type: a
  // deleted layout comes back in layouts[] AND `current` is restored to
  // whatever it was, an added view disappears, a move reverts — uniformly.
  //
  // The slot is cleared (not re-recorded), so this is single-step with no
  // redo: a second press does nothing until another action records a fresh
  // slot. Deliberately does NOT route through commit() — doing so would record
  // the post-undo state as a new undo target, which is redo, explicitly out of
  // scope (§7.9).
  function handleUndo() {
    const result = applyUndo(undoSlot);
    if (!result) return;
    setUndoSlot(result.next);
    setSceneFile(result.restored);
    void saveProjectNow(result.restored);
  }

  // Ref to the latest handleUndo so the once-bound window listener below always
  // calls the current closure (undoSlot changes on every action) without
  // re-binding the listener each render.
  const undoRef = useRef(handleUndo);
  undoRef.current = handleUndo;

  // Undo keyboard shortcut (Cmd/Ctrl+Z). Deliberately a window-level listener,
  // NOT the viewport's canvas-scoped onKeyDown (Phase 1's focus-ownership
  // model): that model exists because rotate/elevation act on the *selected
  // item in the canvas*, so they should only fire when the canvas owns focus.
  // Undo is a whole-app-document action that must work when the canvas does not
  // have focus — e.g. right after clicking a layout pill's × to delete it,
  // focus is on that button, not the canvas. So global-but-input-safe is the
  // right fit: bail when the event target is an editable element, so Cmd/Ctrl+Z
  // inside a rename/name field does the browser's native text-undo instead of
  // reverting a scene action. Shift/Alt+Z (a redo chord on some platforms) is
  // ignored — there is no redo in v2 (§7.9).
  useEffect(() => {
    function onKeyDown(evt: KeyboardEvent) {
      if (!(evt.ctrlKey || evt.metaKey) || evt.shiftKey || evt.altKey) return;
      if (evt.key !== "z" && evt.key !== "Z") return;
      const target = evt.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      evt.preventDefault();
      undoRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Import completion attaches the generated asset to its item and ensures the
  // active layout has a placement command for it (see applyImport.ts, which
  // writes through the shared commitToActiveLayout helper) — `next` arrives
  // already-computed from ImportPanel.
  function handleImported(next: SceneFile) {
    commit(next);
  }

  // Whole-project import (SettingsPanel, improvements-v2.1 §6): `next`
  // arrives already unzipped/validated/rehydrated-into-OPFS by
  // importProjectZip — same one-liner tail as handleImported above, so a
  // project import is persisted immediately and is one-step undoable like
  // any other discrete commit.
  function handleImportProject(next: SceneFile) {
    commit(next);
  }

  const viewportRef = useRef<ViewportHandle>(null);

  // ViewportChrome only renders once `sceneFile` is loaded, so it's never null
  // here (the guard is a type-narrowing formality).
  function handleSaveView(name: string): boolean {
    if (!sceneFile) return false;
    const view = viewportRef.current?.getCurrentView();
    if (!view) return false;
    const cam: CameraPosition = makeCameraPosition(name, view.eye, view.lookAt, view.fovDeg, sceneFile.cameras);
    commit({ ...sceneFile, cameras: [...sceneFile.cameras, cam] });
    return true;
  }

  // improvements-v2.2 §8: same download pattern as SettingsPanel's
  // handleExport (create an <a>, set href/download, click, discard) — except
  // captureSnapshot already returns a data URL rather than a Blob, so there's
  // no object URL to create or revoke here.
  function handleSnapshot() {
    const dataUrl = viewportRef.current?.captureSnapshot();
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `mirror-snapshot-${Date.now()}.png`;
    a.click();
  }

  function handleDeleteView(id: string) {
    if (!sceneFile) return;
    commit({ ...sceneFile, cameras: sceneFile.cameras.filter((c) => c.id !== id) });
  }

  // PRD-v2 §7.2: in-place rename — id/eye/lookAt/fovDeg untouched, so this is
  // a plain map over cameras[], same shape as handleDeleteView above.
  function handleRenameView(id: string, name: string) {
    if (!sceneFile) return;
    commit({ ...sceneFile, cameras: sceneFile.cameras.map((c) => (c.id === id ? renameCameraPosition(c, name) : c)) });
  }

  // D3 (v2 spike, W-A persistence): saving/deleting a layout, and switching
  // which one is `current`, are each a discrete, deliberate action — same
  // immediate-persist treatment (via `commit`) as viewpoint save/delete.
  function handleSwitchLayout(id: string) {
    if (!sceneFile) return;
    commit({ ...sceneFile, current: id });
  }

  function handleSaveLayout(name: string): boolean {
    if (!sceneFile) return false;
    const source = sceneFile.layouts.find((l) => l.id === sceneFile.current);
    if (!source) return false;
    const layout = makeLayout(name, source, sceneFile.layouts);
    commit({ ...sceneFile, layouts: [...sceneFile.layouts, layout], current: layout.id });
    return true;
  }

  function handleDeleteLayout(id: string) {
    if (!sceneFile) return;
    // LayoutChrome already disables deleting the last remaining layout or
    // the currently active one (so `current` never dangles) — this is a
    // second guard against the same invariant, not the only one.
    if (id === sceneFile.current || sceneFile.layouts.length <= 1) return;
    commit({ ...sceneFile, layouts: sceneFile.layouts.filter((l) => l.id !== id) });
  }

  // PRD-v2 §7.2: in-place rename — id/base/commands untouched, so this is a
  // plain map over layouts[], same shape as handleDeleteLayout above.
  function handleRenameLayout(id: string, name: string) {
    if (!sceneFile) return;
    commit({ ...sceneFile, layouts: sceneFile.layouts.map((l) => (l.id === id ? renameLayout(l, name) : l)) });
  }

  // v2 spike (W-A, `v2/spike-arrange`): Viewport's drag-release/rotate-step
  // gesture handlers call this exactly once per gesture (never per-frame —
  // see Viewport.tsx's mutate-during-gesture seam) with the item's final
  // position/rotation. The command write goes through commitToActiveLayout /
  // setPlaceCommand (src/scene/commit.ts) — the single seam every
  // placement-affecting action shares (drag/rotate here, default placement in
  // applyImport.ts), so Phase 7's undo has one place to hook, not four.
  function commitPlacement(itemId: string, position: [number, number, number], rotationDeg: number) {
    if (!sceneFile) return;
    commit(commitToActiveLayout(sceneFile, (commands) => setPlaceCommand(commands, itemId, position, rotationDeg)));
  }

  // improvements-v2.1 §4: per-item placement lock — a scene fact (persists,
  // round-trips through save/export), so it goes through the same discrete
  // commit() tail as rename/delete rather than the ephemeral globalLock
  // state above. Same shape as handleRenameLayout/handleDeleteLayout: map
  // over the relevant array, replace the one matching item.
  function handleToggleLock(itemId: string) {
    if (!sceneFile) return;
    commit({
      ...sceneFile,
      items: sceneFile.items.map((i) => (i.id === itemId ? { ...i, locked: !i.locked } : i)),
    });
  }

  // improvements-v2.2 §6: post-import docked editor (ObjectInspector, via
  // Viewport.tsx). Same discrete-commit shape as handleToggleLock — map over
  // items, replace the one field set that changed — except this patch always
  // carries all three fields together (ObjectInspector debounces and bundles
  // them), so a rapid multi-field edit lands as one commit, not three.
  // `dimsCm` is written unconditionally, matching applyImport.ts's existing
  // treatment of a compound-sofa's dimsCm as an explicit override (not just a
  // box-only field) — see furnitureOverallDims's read side for why that's
  // already the right thing to write.
  //
  // Code-review note: for a compound-sofa, ObjectInspector hides the W/D
  // fields (they're not real for that shape — see its `dimsAxes` comment)
  // but `patch.dimsCm` still carries whatever W/D `furnitureOverallDims`
  // currently derives from `main`/`chaise`, unedited. Writing that through
  // sets `dimsCm` explicitly for the first time on a sofa that never had
  // one, which makes `furnitureOverallDims` start reading it as a frozen
  // override instead of re-deriving from `main`/`chaise` on every call.
  // Harmless today (nothing else in-app edits `main`/`chaise` after seeding,
  // and every commit through this panel refreshes the freeze to whatever's
  // currently derived) — but if `main`/`chaise` ever become independently
  // editable, this would need to stop writing W/D for that shape rather
  // than just hiding the fields.
  function handleEditItem(itemId: string, patch: ObjectEditPatch) {
    if (!sceneFile) return;
    commit({
      ...sceneFile,
      items: sceneFile.items.map((i) =>
        i.id === itemId ? { ...i, name: patch.name, dimsCm: patch.dimsCm, modelRotationDeg: patch.modelRotationDeg } : i,
      ),
    });
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">mirror</span>
        {/* Single-step undo (PRD-v2 §7.9). Lives in the app header, not the
         *  viewport/layout chrome, because it reverts any discrete action —
         *  placement, import, or a layout/view op — so it belongs to the whole
         *  document, not one surface. Disabled (greyed) when there's nothing to
         *  undo. Keyboard equivalent: Cmd/Ctrl+Z (see the window listener). */}
        <button
          type="button"
          className="app-undo"
          onClick={handleUndo}
          disabled={!undoSlot}
          title="Undo last action (Cmd/Ctrl+Z)"
          aria-label="Undo last action"
        >
          {/* Inline icon+label (DESIGN.md §6): 16 — mirrors tokens.css's --icon-size-inline. */}
          <Undo2 size={16} aria-hidden="true" /> Undo
        </button>
      </header>
      <div className="app-body">
        <main className="app-viewport">
          {sceneFile ? (
            <>
              <Viewport
                ref={viewportRef}
                sceneFile={sceneFile}
                shellCalibration={sceneFile.room.shell}
                lighting={sceneFile.room.lighting}
                lightingMode={sceneFile.room.lightingMode}
                location={sceneFile.room.location}
                onCommitPlacement={commitPlacement}
                onToggleLock={handleToggleLock}
                globalLock={globalLock}
                onEditItem={handleEditItem}
                onReimport={handleRequestReimport}
                fovDeg={liveFovDeg}
                onFovRecalled={setLiveFovDeg}
              />
              <LayoutChrome
                layouts={sceneFile.layouts}
                currentId={sceneFile.current}
                onSwitch={handleSwitchLayout}
                onSave={handleSaveLayout}
                onDelete={handleDeleteLayout}
                onRename={handleRenameLayout}
              />
              <ViewportChrome
                cameras={sceneFile.cameras}
                onRecall={(preset) => viewportRef.current?.flyTo(preset)}
                onSave={handleSaveView}
                onDelete={handleDeleteView}
                onRename={handleRenameView}
                lockAllActive={lockAllActive}
                onToggleGlobalLock={() => setGlobalLock((v) => !v)}
                onSnapshot={handleSnapshot}
                onOpenShortcuts={() => setShowShortcuts(true)}
                lensPreset={activeLensPreset}
                onSetLensPreset={handleSetLensPreset}
              />
            </>
          ) : (
            <div className="app-status">{error ? `Failed to load: ${error}` : "Loading…"}</div>
          )}
        </main>
        <aside className="app-panel">
          <nav className="app-panel-tabs">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                className={`app-panel-tab${tab === t ? " app-panel-tab--active" : ""}`}
                onClick={() => {
                  // docs/proposals/reimport-entry-point.md §14 gotcha: a
                  // direct click of the Import tab must clear any stale
                  // reimportTarget from an earlier "Re-import" click —
                  // handleRequestReimport is the only other writer, and
                  // ImportPanel only ever consumes this once, as its
                  // `useState` initializer on mount — so without this clear,
                  // clicking Re-import once, backing out, then later
                  // clicking Import normally would silently re-apply that
                  // stale pre-selection.
                  setReimportTarget(null);
                  setTab(t);
                }}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="app-panel-body">
            {sceneFile && tab === "Shell" && (
              <ShellPanel shell={sceneFile.room.shell} onUpdateSurface={updateShellSurface} />
            )}
            {sceneFile && tab === "Lighting" && (
              <LightingPanel
                lighting={sceneFile.room.lighting}
                onChange={updateLighting}
                lightingMode={sceneFile.room.lightingMode}
                onChangeMode={updateLightingMode}
                location={sceneFile.room.location}
                onChangeLocation={updateLocation}
              />
            )}
            {sceneFile && tab === "Import" && (
              <ImportPanel sceneFile={sceneFile} onImported={handleImported} initialSelection={reimportTarget ?? undefined} />
            )}
            {tab === "Settings" && (
              <SettingsPanel sceneFile={sceneFile} onImportProject={handleImportProject} />
            )}
          </div>
        </aside>
      </div>
      {/* improvements-minor-fixes.md §3: full-viewport modal, so it renders
       *  at the whole-app level (fixed positioning, `.shortcut-cheatsheet-
       *  scrim`) rather than nested inside `.app-viewport` — it isn't
       *  scoped to the 3D view the way ViewportChrome/LayoutChrome are. */}
      <ShortcutCheatsheet open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </div>
  );
}

export default App;
