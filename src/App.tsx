import sceneFileRaw from "../seed/living-room.json";
import { Viewport } from "./components/Viewport";
import type { SceneFile } from "./scene/types";
import "./App.css";

const sceneFile = sceneFileRaw as unknown as SceneFile;

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">mirror</span>
      </header>
      <div className="app-body">
        <main className="app-viewport">
          <Viewport sceneFile={sceneFile} />
        </main>
        <aside className="app-panel" />
      </div>
    </div>
  );
}

export default App;
