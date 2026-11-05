import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { Analytics } from '@vercel/analytics/react';
import {
  NO_SCENE_ID,
  VisualizerEngine,
  type KeyboardBand,
  type ResolutionPresetId,
} from '@/engine/VisualizerEngine';
import { createDefaultScenes } from '@/scenes';
import type { ParamSpec, ParamValue } from '@/engine/scene';
import { describeDeviceChange, describeDeviceStatus, type DeviceState } from '@/deviceStatus';
import {
  SOUND_MODE_OPTIONS,
  describeSoundStrip,
  gatesForSoundMode,
  type SoundStripView,
} from '@/soundStrip';
import {
  isExpanded,
  parseExpansion,
  SIDEBAR_EXPANSION_KEY,
  toggleExpansion,
  type ExpansionState,
} from '@/sidebarExpansion';
import './App.css';

function useEngineValue<T>(engine: VisualizerEngine, select: (engine: VisualizerEngine) => T): T {
  return useSyncExternalStore(
    (onChange) => engine.subscribe(onChange),
    () => select(engine),
  );
}

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
    <>
      <div className="app-shell">
        {engine && !presentMode && (
          <Sidebar
            engine={engine}
            open={sidebarOpen}
            onOpen={() => setSidebarOpen(true)}
            onCollapse={() => setSidebarOpen(false)}
            onPresent={() => setPresentMode(true)}
          />
        )}
        <div className="canvas-stage">
          <CanvasContainer containerRef={containerRef} engine={engine} />
          {presentMode && <PresentModeExit onExit={() => setPresentMode(false)} />}
        </div>
      </div>
      <Analytics />
    </>
  );
}

function Sidebar({
  engine,
  open,
  onOpen,
  onCollapse,
  onPresent,
}: {
  engine: VisualizerEngine;
  open: boolean;
  onOpen: () => void;
  onCollapse: () => void;
  onPresent: () => void;
}) {
  // Lives above the open/collapsed split, so a hot-plug is still announced while
  // the panel is collapsed. Present Mode unmounts this: a recording stays clean.
  const deviceNotice = useDeviceNotice(engine);

  if (!open) {
    return (
      <>
        <button type="button" className="sidebar-reopen" onClick={onOpen}>
          <span aria-hidden="true">☰</span> Controls
        </button>
        {deviceNotice && (
          <p className="device-toast" role="status">
            {deviceNotice}
          </p>
        )}
      </>
    );
  }

  return (
    <aside className="sidebar" aria-label="Controls">
      <header className="sidebar-header">
        <h1 className="sidebar-title">MIDI Visualizer</h1>
        <button
          type="button"
          className="button button--primary"
          onClick={onPresent}
          title="Hide the controls for recording. Press Esc to bring them back."
        >
          Present
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onCollapse}
          aria-label="Hide controls"
          title="Hide controls"
        >
          <span aria-hidden="true">☰</span>
        </button>
      </header>
      <DeviceCard engine={engine} notice={deviceNotice} />
      <SoundStrip engine={engine} />
      <ExpansionProvider>
        <div className="sidebar-body">
          <SceneSection engine={engine} />
          <CrystalsSection engine={engine} />
          <KeyboardBandSection engine={engine} />
          <InputSection engine={engine} />
          <ResolutionSection engine={engine} />
        </div>
      </ExpansionProvider>
      <SettingsFooter engine={engine} />
    </aside>
  );
}

function selectDeviceState(engine: VisualizerEngine): DeviceState {
  return {
    midiStatus: engine.midiStatus,
    devices: engine.devices,
    activeDeviceId: engine.activeDeviceId,
    savedDeviceName: engine.savedDeviceName,
    virtualInputEnabled: engine.virtualInputEnabled,
  };
}

const DEVICE_NOTICE_MS = 6000;

/** The latest hot-plug announcement, cleared after a few seconds. */
function useDeviceNotice(engine: VisualizerEngine): string | null {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let previous = selectDeviceState(engine);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = engine.subscribe(() => {
      const next = selectDeviceState(engine);
      const change = describeDeviceChange(previous, next);
      previous = next;
      if (!change) return;
      setNotice(change);
      clearTimeout(timeout);
      timeout = setTimeout(() => setNotice(null), DEVICE_NOTICE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, [engine]);

  return notice;
}

/** The Sound strip's state, from the engine's sound gates and audio state. */
function useSoundStrip(engine: VisualizerEngine): SoundStripView {
  const soundEnabled = useEngineValue(engine, (e) => e.soundEnabled);
  const deviceSoundEnabled = useEngineValue(engine, (e) => e.deviceSoundEnabled);
  const audioSuspended = useEngineValue(engine, (e) => e.audioSuspended);
  const outputLatencyMs = useEngineValue(engine, (e) => e.audioOutputLatencyMs);
  const toneId = useEngineValue(engine, (e) => e.toneId);
  const toneStatus = useEngineValue(engine, (e) => e.toneStatus);
  const toneProgress = useEngineValue(engine, (e) => e.toneLoadProgress);
  const downloadedToneIds = useEngineValue(engine, (e) => e.downloadedToneIds);
  return describeSoundStrip({
    soundEnabled,
    deviceSoundEnabled,
    audioSuspended,
    outputLatencyMs,
    toneId,
    toneStatus,
    toneProgress,
    downloadedToneIds,
  });
}

/**
 * Always on screen and never collapses, directly under the Device card. Clicking
 * a segment, or picking a Tone, is the gesture that creates and resumes audio.
 */
function SoundStrip({ engine }: { engine: VisualizerEngine }) {
  const strip = useSoundStrip(engine);
  return (
    <section className="sound-strip" aria-label="Sound">
      <span className="sound-strip-label" aria-hidden="true">
        Sound
      </span>
      <RadioChoices
        name="sound-mode"
        label="Sound"
        layout="segmented"
        options={SOUND_MODE_OPTIONS}
        value={strip.mode}
        onChange={(mode) => engine.setSoundGates(gatesForSoundMode(mode))}
      />
      {strip.tonePicker && (
        <label className="field sound-strip-tone">
          <span className="field-label">Tone</span>
          <select
            value={strip.tonePicker.selected}
            onChange={(event) => {
              engine.selectTone(event.target.value);
              // A focused dropdown would keep the computer keyboard from playing
              // the Tone just picked (see isEditableTarget in the engine).
              event.target.blur();
            }}
          >
            <option value={strip.tonePicker.menu.first.id}>
              {strip.tonePicker.menu.first.label}
            </option>
            {strip.tonePicker.menu.groups.map((group) => (
              <optgroup key={group.genre} label={group.genre}>
                {group.tones.map((tone) => (
                  <option key={tone.id} value={tone.id}>
                    {tone.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      {strip.credit && (
        <p className="field-hint sound-strip-credit">
          {strip.credit.before}
          {strip.credit.licence && (
            <a href={strip.credit.licence.href} target="_blank" rel="noreferrer">
              {strip.credit.licence.label}
            </a>
          )}
          {strip.credit.after}
        </p>
      )}
      {strip.download?.kind === 'progress' && (
        <div className="sound-strip-download">
          <div
            className="sound-strip-progress"
            role="progressbar"
            aria-label="Tone download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(strip.download.fraction * 100)}
            style={{ '--fraction': strip.download.fraction } as CSSProperties}
          />
          <p className="field-hint" aria-live="polite">
            {strip.download.text}
          </p>
        </div>
      )}
      {strip.download?.kind === 'failed' && (
        <p className="field-hint sound-strip-failed" role="alert">
          {strip.download.text}{' '}
          <button type="button" className="text-button" onClick={() => engine.retryTone()}>
            Retry
          </button>
        </p>
      )}
      {strip.latencyHint && <p className="field-hint">{strip.latencyHint}</p>}
    </section>
  );
}

const ACTIVITY_PULSE_MS = 200;

/** Always on screen, so whether a keyboard is connected never depends on what is expanded. */
function DeviceCard({ engine, notice }: { engine: VisualizerEngine; notice: string | null }) {
  const midiStatus = useEngineValue(engine, (e) => e.midiStatus);
  const devices = useEngineValue(engine, (e) => e.devices);
  const activeDeviceId = useEngineValue(engine, (e) => e.activeDeviceId);
  const savedDeviceName = useEngineValue(engine, (e) => e.savedDeviceName);
  const virtualInputEnabled = useEngineValue(engine, (e) => e.virtualInputEnabled);
  const activityTick = useEngineValue(engine, (e) => e.activityTick);
  const { deviceHint } = useSoundStrip(engine);

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

  const status = describeDeviceStatus({
    midiStatus,
    devices,
    activeDeviceId,
    savedDeviceName,
    virtualInputEnabled,
  });

  return (
    <section className={`device-card device-card--${status.tone}`} aria-label="MIDI keyboard">
      <div className="device-card-status" role="status">
        <span
          className={`status-light${pulsing ? ' status-light--pulsing' : ''}`}
          aria-hidden="true"
        />
        <strong className="device-card-title">{status.title}</strong>
      </div>
      <p className="device-card-detail">{status.detail}</p>
      {deviceHint && <p className="device-card-notice">{deviceHint}</p>}
      {status.offerVirtualInput && (
        <button
          type="button"
          className="button button--wide"
          onClick={() => engine.setVirtualInputEnabled(true)}
        >
          Play with my computer keyboard
        </button>
      )}
      {notice && (
        <p className="device-card-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

// Section expansion persistence lives in `sidebarExpansion.ts` (React, not the
// engine — ADR 0002). This context threads it to the sections.
interface ExpansionContextValue {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

const ExpansionContext = createContext<ExpansionContextValue | null>(null);

function useExpansion(id: string) {
  const ctx = useContext(ExpansionContext);
  if (!ctx) throw new Error('Section must be rendered inside an ExpansionProvider');
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

// One level only: a section's current value shows in its header, so what it
// controls stays readable even while collapsed.
function Section({
  id,
  title,
  summary,
  description,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  description?: string;
  children: ReactNode;
}) {
  const { open, toggle } = useExpansion(id);

  return (
    <section className="section">
      <h2 className="section-heading">
        <button type="button" className="section-header" onClick={toggle} aria-expanded={open}>
          <span className="section-title">{title}</span>
          <span className="section-summary">{summary}</span>
          <span
            className={`section-chevron${open ? ' section-chevron--open' : ''}`}
            aria-hidden="true"
          >
            ›
          </span>
        </button>
      </h2>
      {open && (
        <div className="section-content">
          {description && <p className="section-description">{description}</p>}
          {children}
        </div>
      )}
    </section>
  );
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

function RadioChoices<T extends string>({
  name,
  label,
  layout,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  layout: 'tiles' | 'segmented' | 'rows';
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div className={`choices choices--${layout}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label
          key={option.value}
          className={`choice${option.value === value ? ' choice--selected' : ''}`}
        >
          <input
            type="radio"
            name={name}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

function SubsectionHeader({
  title,
  resetLabel,
  onReset,
}: {
  title: string;
  resetLabel: string;
  onReset?: () => void;
}) {
  return (
    <div className="subsection-header">
      <h3 className="subsection-title">{title}</h3>
      {onReset && (
        <button type="button" className="text-button" onClick={onReset} aria-label={resetLabel}>
          Reset
        </button>
      )}
    </div>
  );
}

function SceneSection({ engine }: { engine: VisualizerEngine }) {
  const activeSceneId = useEngineValue(engine, (e) => e.activeSceneId);
  const params = useEngineValue(engine, (e) => e.params);
  const scenes = engine.scenes;
  const activeLabel = scenes.find((scene) => scene.id === activeSceneId)?.label ?? '';
  const changed = params.some(({ spec, value }) => value !== spec.default);

  return (
    <Section id="scene" title="Scene" summary={activeLabel}>
      <RadioChoices
        name="scene"
        label="Scene"
        layout="tiles"
        options={scenes.map((scene) => ({ value: scene.id, label: scene.label }))}
        value={activeSceneId}
        onChange={(id) => engine.selectScene(id)}
      />
      {activeSceneId === NO_SCENE_ID ? (
        <p className="section-description">
          Just the background, Crystals, and Keyboard band. Pick a Scene to see its options.
        </p>
      ) : (
        <>
          <SubsectionHeader
            title={`${activeLabel} options`}
            resetLabel={`Reset ${activeLabel} options`}
            onReset={changed ? () => engine.resetSceneParams(activeSceneId) : undefined}
          />
          <div className="controls">
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
      )}
    </Section>
  );
}

/** A range's value at its step's precision, hiding float noise like 1.2000000000000002. */
function formatRangeValue(value: number, step = 1): string {
  const decimals = (String(step).split('.')[1] ?? '').length;
  return value.toFixed(decimals);
}

function SliderField({
  label,
  display,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  display: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <label className="field">
      <span className="field-label">
        {label}
        <span className="field-value">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field field--row">
      <span className="field-label">{label}</span>
      <span className="color-field">
        <span className="field-value">{value.toUpperCase()}</span>
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      </span>
    </label>
  );
}

function SwitchField({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="field field--row">
      <span className="switch-text">
        <span className="field-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
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
        <SliderField
          label={spec.label}
          display={formatRangeValue(Number(value), spec.step)}
          min={spec.min ?? 0}
          max={spec.max ?? 100}
          step={spec.step ?? 1}
          value={Number(value)}
          onChange={onChange}
        />
      );
    case 'toggle':
      return <SwitchField label={spec.label} checked={Boolean(value)} onChange={onChange} />;
    case 'color':
      return <ColorField label={spec.label} value={String(value)} onChange={onChange} />;
    case 'select':
      return (
        <label className="field">
          <span className="field-label">{spec.label}</span>
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

function CrystalsSection({ engine }: { engine: VisualizerEngine }) {
  const visible = useEngineValue(engine, (e) => e.crystalsVisible);
  const opacity = useEngineValue(engine, (e) => e.crystalsOpacity);
  const leftColor = useEngineValue(engine, (e) => e.crystalsLeftColor);
  const rightColor = useEngineValue(engine, (e) => e.crystalsRightColor);
  const atDefaults = useEngineValue(engine, (e) => e.crystalsAtDefaults);
  const opacityPercent = `${Math.round(opacity * 100)}%`;

  return (
    <Section
      id="crystals"
      title="Crystals"
      summary={visible ? `On · ${opacityPercent}` : 'Off'}
      description="Glowing rods that grow from each key you press, on every Scene."
    >
      <div className="controls">
        <SwitchField
          label="Show Crystals"
          checked={visible}
          onChange={(checked) => engine.setCrystalsVisible(checked)}
        />
        {visible && (
          <>
            <SliderField
              label="Opacity"
              display={opacityPercent}
              min={0}
              max={1}
              step={0.01}
              value={opacity}
              onChange={(next) => engine.setCrystalsOpacity(next)}
            />
            <ColorField
              label="Left half color"
              value={leftColor}
              onChange={(next) => engine.setCrystalsLeftColor(next)}
            />
            <ColorField
              label="Right half color"
              value={rightColor}
              onChange={(next) => engine.setCrystalsRightColor(next)}
            />
          </>
        )}
      </div>
      {!atDefaults && (
        <button
          type="button"
          className="text-button text-button--block"
          onClick={() => engine.resetCrystals()}
          aria-label="Reset Crystals"
        >
          Reset
        </button>
      )}
    </Section>
  );
}

// Piano Preview and the Chroma Key green share one keyboard band, so they are a
// single mutually-exclusive choice — None / Piano Preview / Chroma Key — not two
// independent toggles (see issue #22).
const KEYBOARD_BAND_OPTIONS: { value: KeyboardBand; label: string; hint: string }[] = [
  {
    value: 'piano',
    label: 'Piano Preview',
    hint: 'A keyboard that lights up as you play, for framing a shot.',
  },
  {
    value: 'chroma',
    label: 'Chroma Key',
    hint: 'Solid green, to replace with hands footage in a video editor.',
  },
  { value: 'none', label: 'None', hint: 'Nothing drawn in the band.' },
];

function KeyboardBandSection({ engine }: { engine: VisualizerEngine }) {
  const band = useEngineValue(engine, (e) => e.keyboardBand);
  const selected = KEYBOARD_BAND_OPTIONS.find((option) => option.value === band);

  return (
    <Section
      id="keyboard-band"
      title="Keyboard band"
      summary={selected?.label ?? ''}
      description="What fills the bottom third of the canvas."
    >
      <RadioChoices
        name="keyboard-band"
        label="Keyboard band"
        layout="segmented"
        options={KEYBOARD_BAND_OPTIONS}
        value={band}
        onChange={(next) => engine.setKeyboardBand(next)}
      />
      {selected && <p className="field-hint">{selected.hint}</p>}
    </Section>
  );
}

function InputSection({ engine }: { engine: VisualizerEngine }) {
  const midiStatus = useEngineValue(engine, (e) => e.midiStatus);
  const devices = useEngineValue(engine, (e) => e.devices);
  const activeDeviceId = useEngineValue(engine, (e) => e.activeDeviceId);
  const virtualInputEnabled = useEngineValue(engine, (e) => e.virtualInputEnabled);
  const octaveLabel = useEngineValue(engine, (e) => e.virtualInputOctaveLabel);
  // Clicking a Piano Preview key only plays while that band is showing, so the
  // hint is only truthful then (see issue #22).
  const pianoPreviewVisible = useEngineValue(engine, (e) => e.pianoPreviewVisible);

  const summaryParts = [
    ...(activeDeviceId ? ['MIDI'] : []),
    ...(virtualInputEnabled ? ['Computer keyboard'] : []),
  ];

  return (
    <Section
      id="input"
      title="Input"
      summary={summaryParts.join(' + ') || 'None'}
      description="How notes reach the app."
    >
      <h3 className="subsection-title">MIDI keyboards</h3>
      {devices.length > 0 ? (
        <RadioChoices
          name="device"
          label="MIDI keyboard"
          layout="rows"
          options={devices.map((device) => ({ value: device.id, label: device.label }))}
          value={activeDeviceId}
          onChange={(id) => engine.selectDevice(id)}
        />
      ) : (
        <p className="field-hint">
          {midiStatus === 'unavailable' ? "Can't list keyboards without MIDI." : 'None connected.'}
        </p>
      )}
      <h3 className="subsection-title">Virtual Input</h3>
      <div className="controls">
        <SwitchField
          label="Play without a MIDI keyboard"
          checked={virtualInputEnabled}
          onChange={(checked) => engine.setVirtualInputEnabled(checked)}
        />
        {virtualInputEnabled && (
          <>
            <dl className="key-legend">
              <div>
                <dt>White keys</dt>
                <dd>
                  <kbd>A S D F G H J K</kbd>
                </dd>
              </div>
              <div>
                <dt>Black keys</dt>
                <dd>
                  <kbd>W E T Y U</kbd>
                </dd>
              </div>
              <div>
                <dt>Octave down / up</dt>
                <dd>
                  <kbd>Z</kbd> <kbd>X</kbd>
                </dd>
              </div>
              <div>
                <dt>Current octave</dt>
                <dd>{octaveLabel}</dd>
              </div>
            </dl>
            {pianoPreviewVisible && (
              <p className="field-hint">You can also click keys on the Piano Preview.</p>
            )}
          </>
        )}
      </div>
    </Section>
  );
}

function ResolutionSection({ engine }: { engine: VisualizerEngine }) {
  const preset = useEngineValue(engine, (e) => e.resolutionPreset);
  const formatPreset = (id: ResolutionPresetId) => id.replace('x', ' × ');

  return (
    <Section
      id="resolution"
      title="Canvas size"
      summary={formatPreset(preset)}
      description="The pixel size you record at. The canvas scales to fit your window."
    >
      <RadioChoices
        name="resolution"
        label="Canvas size"
        layout="segmented"
        options={engine.resolutionPresets.map((id) => ({ value: id, label: formatPreset(id) }))}
        value={preset}
        onChange={(next) => engine.setResolutionPreset(next)}
      />
    </Section>
  );
}

const SAVED_FLASH_MS = 1600;

/** Says that changes are kept, confirms each one, and is the way back to the defaults. */
function SettingsFooter({ engine }: { engine: VisualizerEngine }) {
  const saveCount = useEngineValue(engine, (e) => e.settingsSaveCount);
  const saveFailed = useEngineValue(engine, (e) => e.settingsSaveFailed);
  const [justSaved, setJustSaved] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const lastSaveCount = useRef(saveCount);

  useEffect(() => {
    if (saveCount === lastSaveCount.current) return;
    lastSaveCount.current = saveCount;
    setJustSaved(true);
    const timeout = setTimeout(() => setJustSaved(false), SAVED_FLASH_MS);
    return () => clearTimeout(timeout);
  }, [saveCount]);

  if (confirmingReset) {
    return (
      <footer className="sidebar-footer">
        <p className="footer-message">
          Reset every setting to its default? Your saved MIDI keyboard stays.
        </p>
        <div className="footer-actions">
          <button
            type="button"
            className="button button--danger"
            onClick={() => {
              engine.resetAllSettings();
              setConfirmingReset(false);
            }}
          >
            Reset everything
          </button>
          <button type="button" className="button" onClick={() => setConfirmingReset(false)}>
            Cancel
          </button>
        </div>
      </footer>
    );
  }

  let message = 'Changes save automatically in this browser.';
  if (saveFailed) message = "Couldn't save. Changes will be lost when you reload.";
  else if (justSaved) message = '✓ Saved';

  return (
    <footer className="sidebar-footer sidebar-footer--row">
      <p
        className={`footer-message${saveFailed ? ' footer-message--warning' : ''}${
          justSaved && !saveFailed ? ' footer-message--saved' : ''
        }`}
        role="status"
      >
        {message}
      </p>
      <button type="button" className="text-button" onClick={() => setConfirmingReset(true)}>
        Reset all
      </button>
    </footer>
  );
}

export default App;
