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
      <ActivityIndicator engine={engine} />
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

const ACTIVITY_PULSE_MS = 200;

function ActivityIndicator({ engine }: { engine: VisualizerEngine }) {
  const activeDeviceId = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.activeDeviceId,
  );
  const devices = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.devices,
  );
  const activityTick = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.activityTick,
  );

  const [pulsing, setPulsing] = useState(false);
  const isFirstTick = useRef(true);

  useEffect(() => {
    if (isFirstTick.current) {
      isFirstTick.current = false;
      return;
    }
    setPulsing(true);
    const timeout = setTimeout(() => setPulsing(false), ACTIVITY_PULSE_MS);
    return () => clearTimeout(timeout);
  }, [activityTick]);

  const activeDevice = devices.find((device) => device.id === activeDeviceId);
  const statusText = activeDevice ? `Connected: ${activeDevice.label}` : 'No Device connected';

  return (
    <div className="midi-activity">
      <span
        className={`activity-dot${activeDevice ? ' connected' : ''}${pulsing ? ' pulsing' : ''}`}
      />
      <span className="activity-status">{statusText}</span>
    </div>
  );
}

export default App;
