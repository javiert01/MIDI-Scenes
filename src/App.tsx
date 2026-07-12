import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { VisualizerEngine } from '@/engine/VisualizerEngine';
import { createDefaultScenes } from '@/scenes';
import type { ParamSpec, ParamValue } from '@/engine/scene';
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
          <ParamControls engine={engine} />
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

function ParamControls({ engine }: { engine: VisualizerEngine }) {
  const params = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.params,
  );
  const activeSceneId = engine.activeSceneId;

  if (params.length === 0 || !activeSceneId) return null;

  return (
    <>
      <h2>Parameters</h2>
      <div className="param-controls">
        {params.map(({ spec, value }) => (
          <ParamControl
            key={spec.key}
            spec={spec}
            value={value}
            onChange={(next) => engine.setParam(activeSceneId, spec.key, next)}
          />
        ))}
      </div>
    </>
  );
}

function ParamControl({
  spec,
  value,
  onChange,
}: {
  spec: ParamSpec;
  value: ParamValue;
  onChange: (value: ParamValue) => void;
}) {
  switch (spec.type) {
    case 'range':
      return (
        <label className="param-control">
          <span className="param-control-label">
            {spec.label}
            <span className="param-control-value">{value}</span>
          </span>
          <input
            type="range"
            min={spec.min}
            max={spec.max}
            step={spec.step ?? 1}
            value={Number(value)}
            onChange={(event) => onChange(event.target.valueAsNumber)}
          />
        </label>
      );
    case 'toggle':
      return (
        <label className="param-control param-control-toggle">
          <span className="param-control-label">{spec.label}</span>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
        </label>
      );
    case 'color':
      return (
        <label className="param-control param-control-toggle">
          <span className="param-control-label">{spec.label}</span>
          <input
            type="color"
            value={String(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      );
    case 'select':
      return (
        <label className="param-control">
          <span className="param-control-label">{spec.label}</span>
          <select value={String(value)} onChange={(event) => onChange(event.target.value)}>
            {spec.options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );
  }
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
