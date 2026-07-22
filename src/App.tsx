import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode, RefObject } from 'react';
import { VisualizerEngine, type KeyboardBand } from '@/engine/VisualizerEngine';
import { createDefaultScenes } from '@/scenes';
import type { ParamSpec, ParamValue } from '@/engine/scene';
import {
  isExpanded,
  parseExpansion,
  SIDEBAR_EXPANSION_KEY,
  toggleExpansion,
  type ExpansionState,
} from '@/sidebarExpansion';
import './App.css';

function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<VisualizerEngine | null>(null);
  const [presentMode, setPresentMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  useEffect(() => {
    if (!presentMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPresentMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [presentMode]);

  return (
    <div className="app-shell">
      {engine && !presentMode && sidebarOpen && (
        <aside className="sidebar">
          <SidebarHeader
            engine={engine}
            onCollapse={() => setSidebarOpen(false)}
            onPresent={() => setPresentMode(true)}
          />
          <ExpansionProvider>
            <div className="sidebar-body">
              <AccordionGroup id="scene" title="Scene">
                <SceneSwitcher engine={engine} />
                <ParamControls engine={engine} />
              </AccordionGroup>
              <AccordionGroup id="input" title="Input">
                <DevicePicker engine={engine} />
                <VirtualInputControl engine={engine} />
              </AccordionGroup>
              <AccordionGroup id="overlays" title="Overlays">
                <CrystalsControl engine={engine} />
                <KeyboardBandControl engine={engine} />
              </AccordionGroup>
              <ResolutionPicker engine={engine} />
            </div>
          </ExpansionProvider>
        </aside>
      )}
      <div className="canvas-stage">
        <CanvasContainer containerRef={containerRef} engine={engine} />
        {presentMode && <PresentModeExit onExit={() => setPresentMode(false)} />}
      </div>
      {engine && !presentMode && !sidebarOpen && (
        <SidebarToggle open={false} onToggle={() => setSidebarOpen(true)} />
      )}
    </div>
  );
}

function SidebarHeader({
  engine,
  onCollapse,
  onPresent,
}: {
  engine: VisualizerEngine;
  onCollapse: () => void;
  onPresent: () => void;
}) {
  return (
    <div className="sidebar-header">
      <div className="sidebar-header-top">
        <SidebarToggle open onToggle={onCollapse} />
        <span className="sidebar-title">Controls</span>
        <MidiStatusDot engine={engine} />
      </div>
      <button type="button" className="present-button" onClick={onPresent}>
        Present
      </button>
    </div>
  );
}

// Open: the toggle sits in the header. Collapsed: it floats top-left to reopen.
function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`sidebar-toggle${open ? '' : ' sidebar-toggle--floating'}`}
      onClick={onToggle}
      aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
      aria-expanded={open}
    >
      <span aria-hidden="true">☰</span>
    </button>
  );
}

// Sidebar expansion state persistence lives in `sidebarExpansion.ts` (React,
// not the engine — ADR 0002). This context threads it to nested accordions.
interface ExpansionContextValue {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

const ExpansionContext = createContext<ExpansionContextValue | null>(null);

function useExpansion(id: string) {
  const ctx = useContext(ExpansionContext);
  if (!ctx) throw new Error('Accordion must be rendered inside an ExpansionProvider');
  return { open: ctx.isOpen(id), toggle: () => ctx.toggle(id) };
}

function ExpansionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ExpansionState>(() =>
    parseExpansion(
      typeof window === 'undefined' ? null : window.localStorage.getItem(SIDEBAR_EXPANSION_KEY),
    ),
  );

  const value: ExpansionContextValue = {
    isOpen: (id) => isExpanded(state, id),
    toggle: useCallback((id: string) => {
      setState((prev) => {
        const next = toggleExpansion(prev, id);
        try {
          window.localStorage.setItem(SIDEBAR_EXPANSION_KEY, JSON.stringify(next));
        } catch {
          // Ignore quota/availability failures; expansion is a UI nicety.
        }
        return next;
      });
    }, []),
  };

  return <ExpansionContext.Provider value={value}>{children}</ExpansionContext.Provider>;
}

// A collapsible disclosure keyed by `id` in the shared expansion state. The two
// levels differ only in their CSS classes: `group` is a top-level group header,
// `section` a member sub-section. Multiple may be open at once (non-exclusive).
const ACCORDION_CLASSES = {
  group: {
    root: 'accordion-group',
    header: 'accordion-group-header',
    content: 'accordion-group-content',
  },
  section: { root: 'accordion-section', header: 'accordion-header', content: 'accordion-content' },
} as const;

function Accordion({
  id,
  title,
  level,
  children,
}: {
  id: string;
  title: string;
  level: keyof typeof ACCORDION_CLASSES;
  children: ReactNode;
}) {
  const { open, toggle } = useExpansion(id);
  const classes = ACCORDION_CLASSES[level];

  return (
    <section className={classes.root}>
      <button type="button" className={classes.header} onClick={toggle} aria-expanded={open}>
        <span>{title}</span>
        <span className="accordion-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && <div className={classes.content}>{children}</div>}
    </section>
  );
}

function AccordionGroup(props: { id: string; title: string; children: ReactNode }) {
  return <Accordion level="group" {...props} />;
}

function AccordionSection(props: { id: string; title: string; children: ReactNode }) {
  return <Accordion level="section" {...props} />;
}

const PRESENT_EXIT_IDLE_MS = 2000;

function PresentModeExit({ onExit }: { onExit: () => void }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let timeout = setTimeout(() => setVisible(false), PRESENT_EXIT_IDLE_MS);
    const onMouseMove = () => {
      setVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setVisible(false), PRESENT_EXIT_IDLE_MS);
    };
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <button
      type="button"
      className={`present-mode-exit${visible ? ' visible' : ''}`}
      onClick={onExit}
    >
      Exit present mode
    </button>
  );
}

function CanvasContainer({
  containerRef,
  engine,
}: {
  containerRef: RefObject<HTMLDivElement>;
  engine: VisualizerEngine | null;
}) {
  const width = useSyncExternalStore(
    (onChange) => engine?.subscribe(onChange) ?? (() => {}),
    () => engine?.width,
  );
  const height = useSyncExternalStore(
    (onChange) => engine?.subscribe(onChange) ?? (() => {}),
    () => engine?.height,
  );

  return (
    <div
      ref={containerRef}
      className="canvas-container"
      style={
        width && height
          ? { aspectRatio: `${width} / ${height}`, width: `min(100%, ${(100 * width) / height}vh)` }
          : undefined
      }
    />
  );
}

function SceneSwitcher({ engine }: { engine: VisualizerEngine }) {
  const activeSceneId = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.activeSceneId,
  );

  return (
    <AccordionSection id="scene:picker" title="Scene picker">
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
    </AccordionSection>
  );
}

function ParamControls({ engine }: { engine: VisualizerEngine }) {
  const params = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.params,
  );
  const activeSceneId = engine.activeSceneId;

  // A real Scene is active whenever it has params; No Scene reports none.
  if (params.length === 0) return null;

  return (
    <AccordionSection id="scene:params" title="Parameters">
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
    </AccordionSection>
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
        <ToggleField
          label={spec.label}
          checked={Boolean(value)}
          onChange={(checked) => onChange(checked)}
        />
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

// Piano Preview and the Chroma Key green share one keyboard band, so they are a
// single mutually-exclusive choice — None / Piano Preview / Chroma Key — not two
// independent toggles (see issue #22). Crystals stays its own member above.
const KEYBOARD_BAND_OPTIONS: { value: KeyboardBand; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'piano', label: 'Piano Preview' },
  { value: 'chroma', label: 'Chroma Key' },
];

function KeyboardBandControl({ engine }: { engine: VisualizerEngine }) {
  const band = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.keyboardBand,
  );

  return (
    <AccordionSection id="overlays:keyboard-band" title="Keyboard band">
      <div className="segmented" role="radiogroup" aria-label="Keyboard band">
        {KEYBOARD_BAND_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === band}
            className={`segmented-option${option.value === band ? ' active' : ''}`}
            onClick={() => engine.setKeyboardBand(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </AccordionSection>
  );
}

function CrystalsControl({ engine }: { engine: VisualizerEngine }) {
  const crystalsVisible = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.crystalsVisible,
  );
  const crystalsOpacity = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.crystalsOpacity,
  );
  const crystalsLeftColor = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.crystalsLeftColor,
  );
  const crystalsRightColor = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.crystalsRightColor,
  );

  return (
    <AccordionSection id="overlays:crystals" title="Crystals">
      <ToggleField
        label="Show crystals"
        checked={crystalsVisible}
        onChange={(checked) => engine.setCrystalsVisible(checked)}
      />
      <label className="param-control">
        <span className="param-control-label">
          Opacity
          <span className="param-control-value">{Math.round(crystalsOpacity * 100)}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={crystalsOpacity}
          onChange={(event) => engine.setCrystalsOpacity(event.target.valueAsNumber)}
        />
      </label>
      <label className="param-control param-control-toggle">
        <span className="param-control-label">Left color</span>
        <input
          type="color"
          value={crystalsLeftColor}
          onChange={(event) => engine.setCrystalsLeftColor(event.target.value)}
        />
      </label>
      <label className="param-control param-control-toggle">
        <span className="param-control-label">Right color</span>
        <input
          type="color"
          value={crystalsRightColor}
          onChange={(event) => engine.setCrystalsRightColor(event.target.value)}
        />
      </label>
    </AccordionSection>
  );
}

function VirtualInputControl({ engine }: { engine: VisualizerEngine }) {
  const virtualInputEnabled = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.virtualInputEnabled,
  );
  const octaveLabel = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.virtualInputOctaveLabel,
  );
  // Clicking a Piano Preview key only plays while that band is showing, so the
  // hint is only truthful then (see issue #22).
  const pianoPreviewVisible = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.pianoPreviewVisible,
  );

  return (
    <AccordionSection id="input:virtual" title="Virtual Input">
      <ToggleField
        label="Play without a device"
        checked={virtualInputEnabled}
        onChange={(checked) => engine.setVirtualInputEnabled(checked)}
      />
      <div className="virtual-input-legend">
        <p>
          <span className="virtual-input-keys">A S D F G H J K</span> — white keys
        </p>
        <p>
          <span className="virtual-input-keys">W E T Y U</span> — black keys
        </p>
        <p>
          <span className="virtual-input-keys">Z / X</span> — octave down / up
        </p>
        <p className="virtual-input-octave">
          Octave: <strong>{octaveLabel}</strong>
        </p>
        {pianoPreviewVisible && (
          <p className="virtual-input-hint">Or click keys on the Piano Preview.</p>
        )}
      </div>
    </AccordionSection>
  );
}

function ResolutionPicker({ engine }: { engine: VisualizerEngine }) {
  const resolutionPreset = useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => engine.resolutionPreset,
  );

  return (
    <AccordionSection id="resolution" title="Resolution">
      <ul className="scene-list">
        {engine.resolutionPresets.map((preset) => (
          <li key={preset}>
            <button
              type="button"
              className={preset === resolutionPreset ? 'active' : ''}
              onClick={() => engine.setResolutionPreset(preset)}
            >
              {preset.replace('x', '×')}
            </button>
          </li>
        ))}
      </ul>
    </AccordionSection>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="param-control param-control-toggle">
      <span className="param-control-label">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
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
    <AccordionSection id="input:device" title="MIDI Device">
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
    </AccordionSection>
  );
}

const ACTIVITY_PULSE_MS = 200;

function MidiStatusDot({ engine }: { engine: VisualizerEngine }) {
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
    <span
      className={`activity-dot${activeDevice ? ' connected' : ''}${pulsing ? ' pulsing' : ''}`}
      role="status"
      aria-label={statusText}
      title={statusText}
    />
  );
}

export default App;
