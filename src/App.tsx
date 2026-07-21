import { useEffect, useRef, useState } from "react";
import seedRaw from "../seed/living-room.json";
import { Viewport, type ViewportHandle } from "./components/Viewport";
import { ViewportChrome } from "./components/ViewportChrome";
import { ShellPanel } from "./components/ShellPanel";
import { ImportPanel } from "./components/ImportPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { parseScene, type CameraPosition, type SceneFile, type SurfaceCalibration } from "./schema/scene";
import { makeCameraPosition } from "./scene/cameraViewpoints";
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

  // Import completion is a discrete, deliberate commit (not a drag gesture
  // like the shell sliders) — persist immediately rather than debouncing, so
  // a newly-generated GLB's hashes are never lost to a closed tab.
  function handleImported(next: SceneFile) {
    setSceneFile(next);
    void saveProjectNow(next);
  }

  const viewportRef = useRef<ViewportHandle>(null);

  // A saved/deleted viewpoint is a discrete, deliberate action (like an
  // import commit) — persist immediately rather than debouncing. Computed
  // from `sceneFile` directly and passed to setSceneFile, same as
  // handleImported below — not the setSceneFile(prev => ...) functional-
  // update form updateShellSurface uses, because saveProjectNow (unlike
  // saveProjectDebounced) isn't idempotent-by-timer: React 18 StrictMode
  // double-invokes functional updaters in dev, which would fire two real
  // IndexedDB writes per click if the write lived inside the updater
  // (code-review finding). ViewportChrome only renders once `sceneFile` is
  // loaded, so it's never null here.
  function handleSaveView(name: string): boolean {
    if (!sceneFile) return false;
    const view = viewportRef.current?.getCurrentView();
    if (!view) return false;
    const cam: CameraPosition = makeCameraPosition(name, view.eye, view.lookAt, view.fovDeg, sceneFile.cameras);
    const next: SceneFile = { ...sceneFile, cameras: [...sceneFile.cameras, cam] };
    setSceneFile(next);
    void saveProjectNow(next);
    return true;
  }

  function handleDeleteView(id: string) {
    if (!sceneFile) return;
    const next: SceneFile = { ...sceneFile, cameras: sceneFile.cameras.filter((c) => c.id !== id) };
    setSceneFile(next);
    void saveProjectNow(next);
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
              <Viewport ref={viewportRef} sceneFile={sceneFile} shellCalibration={sceneFile.room.shell} />
              <ViewportChrome
                cameras={sceneFile.cameras}
                onRecall={(preset) => viewportRef.current?.flyTo(preset)}
                onSave={handleSaveView}
                onDelete={handleDeleteView}
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
            {tab === "Settings" && <SettingsPanel />}
          </div>
        </aside>
      </div>
    </div>
  );
}

export default App;
