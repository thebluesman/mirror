import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { buildScene } from "../scene/buildScene";
import type { SceneFile } from "../scene/types";
import "./Viewport.css";

const HUMAN_FOV = 38; // ~35mm-equivalent, per spike 2's C2 feedback

export function Viewport({ sceneFile }: { sceneFile: SceneFile }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const { scene, cameras } = buildScene(sceneFile);

    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    const camera = new THREE.PerspectiveCamera(HUMAN_FOV, 1, 5, 3000);
    const preset = cameras[0];
    if (preset) {
      camera.position.set(...preset.eye);
      camera.fov = preset.fovDeg || HUMAN_FOV;
      camera.updateProjectionMatrix();
    } else {
      camera.position.set(0, 300, 600);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.screenSpacePanning = true;
    if (preset) {
      controls.target.set(...preset.lookAt);
    }
    controls.update();

    function resize() {
      if (!container) return;
      const { clientWidth: w, clientHeight: h } = container;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    let frameId: number;
    function animate() {
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [sceneFile]);

  return <div ref={containerRef} className="viewport" />;
}
