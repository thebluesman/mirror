import { useEffect, useRef, useState } from "react";
import seedRaw from "../seed/living-room.json";
import { Viewport, type ViewportHandle } from "./components/Viewport";
import { ViewportChrome } from "./components/ViewportChrome";
import { LayoutChrome } from "./components/LayoutChrome";
import { ShellPanel } from "./components/ShellPanel";
import { ImportPanel } from "./components/ImportPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { parseScene, type CameraPosition, type SceneFile, type SurfaceCalibration } from "./schema/scene";
import { makeCameraPosition, renameCameraPosition } from "./scene/cameraViewpoints";
import { makeLayout, renameLayout } from "./scene/layouts";
import { commitToActiveLayout, setPlaceCommand } from "./scene/commit";
import { loadProject, saveProjectDebounced, saveProjectNow } from "./storage/autosave";
import "./App.css";

const TABS = ["Shell", "Import", "Settings"] as const;
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
  // one spot and gives a later phase (undo) a single place to observe every
  // committed SceneFile.
  function commit(next: SceneFile) {
    setSceneFile(next);
    void saveProjectNow(next);
  }

  // Import completion attaches the generated asset to its item and ensures the
  // active layout has a placement command for it (see applyImport.ts, which
  // writes through the shared commitToActiveLayout helper) — `next` arrives
  // already-computed from ImportPanel.
  function handleImported(next: SceneFile) {
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">mirror</span>
      </header>
      <div className="app-body">
        <main className="app-viewport">
          {sceneFile ? (
            <>
              <Viewport
                ref={viewportRef}
                sceneFile={sceneFile}
                shellCalibration={sceneFile.room.shell}
                onCommitPlacement={commitPlacement}
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
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          <div className="app-panel-body">
            {sceneFile && tab === "Shell" && (
              <ShellPanel shell={sceneFile.room.shell} onUpdateSurface={updateShellSurface} />
            )}
            {sceneFile && tab === "Import" && <ImportPanel sceneFile={sceneFile} onImported={handleImported} />}
            {tab === "Settings" && <SettingsPanel sceneFile={sceneFile} />}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
