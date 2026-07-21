import { useEffect, useState } from "react";
import seedRaw from "../seed/living-room.json";
import { Viewport } from "./components/Viewport";
import { ShellPanel } from "./components/ShellPanel";
import { parseScene, type SceneFile, type SurfaceCalibration } from "./schema/scene";
import { loadProject, saveProjectDebounced, saveProjectNow } from "./storage/autosave";
import "./App.css";

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

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">mirror</span>
      </header>
      <div className="app-body">
        <main className="app-viewport">
          {sceneFile ? (
            <Viewport sceneFile={sceneFile} shellCalibration={sceneFile.room.shell} />
          ) : (
            <div className="app-status">{error ? `Failed to load: ${error}` : "Loading…"}</div>
          )}
        </main>
        <aside className="app-panel">
          {sceneFile && <ShellPanel shell={sceneFile.room.shell} onUpdateSurface={updateShellSurface} />}
        </aside>
      </div>
    </div>
  );
}

export default App;
