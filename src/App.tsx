import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { VisualizerEngine } from '@/engine/VisualizerEngine';
import { createDefaultScenes } from '@/scenes';
import './App.css';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<VisualizerEngine | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const instance = new VisualizerEngine(container, { scenes: createDefaultScenes() });
    setEngine(instance);

    return () => {
      instance.destroy();
      setEngine(null);
    };
  }, []);

  return (
    <div className="app-shell">
      <div className="canvas-stage">
        <div ref={containerRef} className="canvas-container" />
      </div>
      {engine && (
        <aside className="sidebar">
          <SceneSwitcher engine={engine} />
          <DevicePicker engine={engine} />
        </aside>
      )}
    </div>
  );
}

function SceneSwitcher({ engine }: { engine: VisualizerEngine }) {
  const activeSceneId = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.activeSceneId,
  );

  return (
    <>
      <h2>Scenes</h2>
      <ul className="scene-list">
        {engine.scenes.map((scene) => (
          <li key={scene.id}>
            <button
              type="button"
              className={scene.id === activeSceneId ? 'active' : ''}
              onClick={() => engine.selectScene(scene.id)}
            >
              {scene.label}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function DevicePicker({ engine }: { engine: VisualizerEngine }) {
  const activeDeviceId = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.activeDeviceId,
  );
  const devices = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.devices,
  );

  return (
    <>
      <h2>MIDI Device</h2>
      {devices.length === 0 ? (
        <p className="device-empty">No Device connected</p>
      ) : (
        <ul className="scene-list">
          {devices.map((device) => (
            <li key={device.id}>
              <button
                type="button"
                className={device.id === activeDeviceId ? 'active' : ''}
                onClick={() => engine.selectDevice(device.id)}
              >
                {device.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default App;
