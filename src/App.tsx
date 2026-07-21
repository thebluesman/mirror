import { useEffect, useState } from "react";
import seedRaw from "../seed/living-room.json";
import { Viewport } from "./components/Viewport";
import { parseScene, type SceneFile } from "./schema/scene";
import { loadProject, saveProjectNow } from "./storage/autosave";
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

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">mirror</span>
      </header>
      <div className="app-body">
        <main className="app-viewport">
          {sceneFile ? (
            <Viewport sceneFile={sceneFile} />
          ) : (
            <div className="app-status">{error ? `Failed to load: ${error}` : "Loading…"}</div>
          )}
        </main>
        <aside className="app-panel" />
      </div>
    </div>
  );
}

export default App;
