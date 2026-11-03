/**
 * PROTOTYPE — throwaway, lives only on the `prototype/sound-sidebar` branch.
 *
 * Question (issue #44): how should the sidebar present Tone picking grouped by
 * Genre, download progress and fallback, and the opt-in for Device sound?
 *
 * Three variants of the existing sidebar, switchable via `?variant=A|B|C` and the
 * floating bar at the bottom. Everything sound-related is a stub held in memory
 * (no Tone Player exists yet), except Virtual Input sound, which still drives the
 * real Preview Synth. The panel in the top right fakes the hard cases.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { VisualizerEngine } from '@/engine/VisualizerEngine';
import { Section, SliderField, SwitchField } from '@/App';
import './soundSidebar.prototype.css';

// ---------------------------------------------------------------------------
// Catalogue (sizes are the research estimates, file counts are invented)

type Genre = 'Classical' | 'Rock' | 'Cumbia';

interface ToneEntry {
  id: string;
  label: string;
  genre: Genre | null;
  sizeMb: number;
  files: number;
  credit?: string;
}

const TONES: ToneEntry[] = [
  { id: 'warm-analog', label: 'Warm Analog', genre: null, sizeMb: 0, files: 0 },
  {
    id: 'grand-piano',
    label: 'Grand Piano',
    genre: 'Classical',
    sizeMb: 7,
    files: 30,
    credit: 'Salamander Grand Piano by Alexander Holm, CC BY 3.0, trimmed and re-encoded',
  },
  { id: 'strings', label: 'Strings', genre: 'Classical', sizeMb: 8, files: 24 },
  { id: 'overdriven-guitar', label: 'Overdriven Guitar', genre: 'Rock', sizeMb: 4, files: 20 },
  { id: 'rock-organ', label: 'Rock Organ', genre: 'Rock', sizeMb: 5, files: 16 },
  { id: 'accordion', label: 'Accordion', genre: 'Cumbia', sizeMb: 2, files: 22 },
  { id: 'villera-lead', label: 'Villera Lead', genre: 'Cumbia', sizeMb: 0, files: 0 },
];
const GENRES: Genre[] = ['Classical', 'Rock', 'Cumbia'];
const DEFAULT_TONE = TONES[0];
const toneById = (id: string) => TONES.find((t) => t.id === id) ?? DEFAULT_TONE;
const needsDownload = (tone: ToneEntry) => tone.files > 0;

// ---------------------------------------------------------------------------
// Stub state

interface ProtoState {
  /** Mirrors `engine.soundEnabled`, the real Virtual Input sound gate. */
  virtualSound: boolean;
  deviceSound: boolean;
  toneId: string;
  loading: { toneId: string; filesDone: number; filesTotal: number; preparing: boolean } | null;
  failed: string | null;
  cached: string[];
  awaitingGesture: boolean;
  latencyMs: number;
  volume: number;
  pretendDevice: boolean;
  failNextDownload: boolean;
}

let state: ProtoState = {
  virtualSound: true,
  deviceSound: false,
  toneId: DEFAULT_TONE.id,
  loading: null,
  failed: null,
  cached: [],
  awaitingGesture: false,
  latencyMs: 25,
  volume: 0.8,
  pretendDevice: true,
  failNextDownload: false,
};
const listeners = new Set<() => void>();
function set(patch: Partial<ProtoState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}
function useProto(): ProtoState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

let downloadTimer: ReturnType<typeof setInterval> | undefined;
function selectTone(id: string) {
  clearInterval(downloadTimer);
  const tone = toneById(id);
  if (!needsDownload(tone) || state.cached.includes(id)) {
    set({ toneId: id, loading: null, failed: null });
    return;
  }
  const willFail = state.failNextDownload;
  set({
    toneId: id,
    failed: null,
    failNextDownload: false,
    loading: { toneId: id, filesDone: 0, filesTotal: tone.files, preparing: false },
  });
  downloadTimer = setInterval(() => {
    const loading = state.loading;
    if (!loading) return clearInterval(downloadTimer);
    if (willFail && loading.filesDone >= Math.floor(loading.filesTotal / 3)) {
      clearInterval(downloadTimer);
      set({ loading: null, failed: id });
      return;
    }
    if (loading.filesDone < loading.filesTotal) {
      set({ loading: { ...loading, filesDone: loading.filesDone + 1 } });
    } else if (!loading.preparing) {
      set({ loading: { ...loading, preparing: true } });
    } else {
      clearInterval(downloadTimer);
      set({ loading: null, cached: [...state.cached, id] });
    }
  }, 140);
}

function setVirtualSound(engine: VisualizerEngine, on: boolean) {
  engine.setSoundEnabled(on);
  set({ virtualSound: on, awaitingGesture: on ? false : state.awaitingGesture });
}
function setDeviceSound(on: boolean) {
  // A real click on the toggle is the gesture that starts audio.
  set({ deviceSound: on, awaitingGesture: false });
}

/** What actually sounds right now, for the state readout and the hints. */
function sounding(s: ProtoState): string {
  if (s.loading || s.failed) return DEFAULT_TONE.label;
  return toneById(s.toneId).label;
}

// ---------------------------------------------------------------------------
// Pieces the variants share (copy only, never layout)

function LoadingLine({ s }: { s: ProtoState }) {
  if (s.failed) {
    return (
      <p className="proto-line proto-line--warning">
        Couldn't download {toneById(s.failed).label}. Warm Analog is playing.{' '}
        <button type="button" className="text-button" onClick={() => selectTone(s.failed!)}>
          Retry
        </button>
      </p>
    );
  }
  if (!s.loading) return null;
  const tone = toneById(s.loading.toneId);
  const pct = (s.loading.filesDone / s.loading.filesTotal) * 100;
  return (
    <div className="proto-progress">
      <div className="proto-progress-bar" style={{ '--pct': `${pct}%` } as CSSProperties} />
      <p className="proto-line">
        {s.loading.preparing
          ? `Preparing ${tone.label}…`
          : `Downloading ${tone.label}: ${s.loading.filesDone} of ${s.loading.filesTotal} files`}
        {' · '}Warm Analog plays until it's ready.
      </p>
    </div>
  );
}

function GestureHint({ compact }: { compact?: boolean }) {
  return (
    <p className="proto-line proto-line--warning proto-gesture">
      {compact
        ? 'Click anywhere to turn sound on'
        : 'MIDI keyboard sound is on but waiting: click anywhere or press a key to start it.'}
    </p>
  );
}

function LatencyHint({ s }: { s: ProtoState }) {
  if (s.latencyMs <= 60 || !(s.deviceSound || s.virtualSound)) return null;
  return (
    <p className="proto-line proto-line--muted">
      Sound may lag about {s.latencyMs} ms behind your keys. Wired headphones or speakers help.
    </p>
  );
}

function Credit({ s }: { s: ProtoState }) {
  const credit = toneById(s.toneId).credit;
  if (!credit) return null;
  return <p className="proto-credit">{credit}.</p>;
}

function toneMeta(s: ProtoState, tone: ToneEntry): string {
  if (s.loading?.toneId === tone.id)
    return `${Math.round((s.loading.filesDone / s.loading.filesTotal) * 100)}%`;
  if (!needsDownload(tone)) return 'Built in';
  if (s.cached.includes(tone.id)) return 'Ready';
  return `${tone.sizeMb} MB`;
}

// ---------------------------------------------------------------------------
// Variant A: one "Sound" section, two switches, Genre-grouped rows, volume

function VariantA_SoundSection({ engine }: { engine: VisualizerEngine }) {
  const s = useProto();
  const parts = [...(s.deviceSound ? ['MIDI'] : []), ...(s.virtualSound ? ['Computer'] : [])];
  const summary = s.awaitingGesture
    ? 'Click to start'
    : parts.length
      ? `${sounding(s)} · ${parts.join(' + ')}`
      : 'Off';

  return (
    <Section id="proto-sound" title="Sound" summary={summary}>
      {s.awaitingGesture && <GestureHint />}
      <h3 className="subsection-title">Play sound for</h3>
      <div className="controls">
        <SwitchField
          label="MIDI keyboard"
          hint={
            s.pretendDevice
              ? 'Off keeps your playing silent while you record.'
              : 'No MIDI keyboard connected.'
          }
          checked={s.deviceSound}
          onChange={setDeviceSound}
        />
        <SwitchField
          label="Computer keyboard"
          hint="Virtual Input and Piano Preview clicks."
          checked={s.virtualSound}
          onChange={(on) => setVirtualSound(engine, on)}
        />
      </div>
      <h3 className="subsection-title">Tone</h3>
      <div className="proto-tone-rows" role="radiogroup" aria-label="Tone">
        <ToneRow s={s} tone={DEFAULT_TONE} />
        {GENRES.map((genre) => (
          <div key={genre}>
            <p className="proto-genre">{genre}</p>
            {TONES.filter((t) => t.genre === genre).map((tone) => (
              <ToneRow key={tone.id} s={s} tone={tone} />
            ))}
          </div>
        ))}
      </div>
      <LoadingLine s={s} />
      <div className="controls proto-gap">
        <SliderField
          label="Volume"
          display={`${Math.round(s.volume * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          value={s.volume}
          onChange={(volume) => set({ volume })}
        />
      </div>
      <LatencyHint s={s} />
      <Credit s={s} />
    </Section>
  );
}

function ToneRow({ s, tone }: { s: ProtoState; tone: ToneEntry }) {
  const selected = s.toneId === tone.id;
  const loading = s.loading?.toneId === tone.id;
  const pct = loading ? (s.loading!.filesDone / s.loading!.filesTotal) * 100 : 0;
  return (
    <label
      className={`proto-tone-row${selected ? ' proto-tone-row--selected' : ''}`}
      style={{ '--pct': `${pct}%` } as CSSProperties}
    >
      <input
        type="radio"
        name="proto-tone-a"
        checked={selected}
        onChange={() => selectTone(tone.id)}
      />
      <span>{tone.label}</span>
      <span className="proto-tone-meta">{toneMeta(s, tone)}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Variant B: always-visible strip under the Device card; one control for both
// gates, a native <select> with <optgroup>s, no volume

type SoundMode = 'off' | 'computer' | 'all';

function modeOf(s: ProtoState): SoundMode {
  if (s.deviceSound) return 'all';
  return s.virtualSound ? 'computer' : 'off';
}

function VariantB_SoundStrip({ engine }: { engine: VisualizerEngine }) {
  const s = useProto();
  const mode = modeOf(s);
  const setMode = (next: SoundMode) => {
    setVirtualSound(engine, next !== 'off');
    setDeviceSound(next === 'all');
  };
  const options: { value: SoundMode; label: string; title: string }[] = [
    { value: 'off', label: 'Off', title: 'No sound at all' },
    { value: 'computer', label: 'Computer', title: 'Only Virtual Input notes sound' },
    { value: 'all', label: 'All notes', title: 'Your MIDI keyboard sounds too' },
  ];

  return (
    <section
      className={`proto-strip${s.awaitingGesture ? ' proto-strip--waiting' : ''}`}
      aria-label="Sound"
    >
      <div className="proto-strip-row">
        <span className="proto-strip-icon" aria-hidden="true">
          {mode === 'off' ? '🔇' : '🔊'}
        </span>
        <div className="choices choices--segmented proto-strip-modes" role="radiogroup">
          {options.map((o) => (
            <label
              key={o.value}
              title={o.title}
              className={`choice${o.value === mode ? ' choice--selected' : ''}`}
            >
              <input type="radio" checked={o.value === mode} onChange={() => setMode(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </div>
      {s.awaitingGesture && <GestureHint compact />}
      {mode !== 'off' && (
        <label className="field proto-strip-tone">
          <span className="field-label">
            Tone
            {toneById(s.toneId).credit && (
              <span className="field-value" title={toneById(s.toneId).credit}>
                ⓘ credit
              </span>
            )}
          </span>
          <select value={s.toneId} onChange={(e) => selectTone(e.target.value)}>
            <option value={DEFAULT_TONE.id}>{DEFAULT_TONE.label}</option>
            {GENRES.map((genre) => (
              <optgroup key={genre} label={genre}>
                {TONES.filter((t) => t.genre === genre).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                    {needsDownload(t) && !s.cached.includes(t.id) ? ` (${t.sizeMb} MB)` : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}
      <LoadingLine s={s} />
      <LatencyHint s={s} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Variant C: each source owns its sound switch (in Input); a separate "Tone"
// section with Genre tabs and tiles; sound status lives in the Device card

function VariantC_DeviceCardBadge() {
  const s = useProto();
  if (s.awaitingGesture) return <GestureHint compact />;
  const on = s.deviceSound || s.virtualSound;
  return (
    <p className="proto-badge">
      {on ? `🔊 ${sounding(s)}` : '🔇 Sound off'}
      {s.deviceSound && s.virtualSound
        ? ''
        : s.deviceSound
          ? ' · MIDI only'
          : on
            ? ' · computer only'
            : ''}
    </p>
  );
}

export function VariantC_DeviceSoundSwitch() {
  const s = useProto();
  return (
    <div className="controls proto-gap">
      <SwitchField
        label="Sound"
        hint="Hear your MIDI keyboard through the Tone. Off keeps recordings silent."
        checked={s.deviceSound}
        onChange={setDeviceSound}
      />
    </div>
  );
}

export function VariantC_VirtualSoundSwitch({ engine }: { engine: VisualizerEngine }) {
  const s = useProto();
  return (
    <SwitchField
      label="Sound"
      hint="Hear these notes through the Tone."
      checked={s.virtualSound}
      onChange={(on) => setVirtualSound(engine, on)}
    />
  );
}

function VariantC_ToneSection() {
  const s = useProto();
  const current = toneById(s.toneId);
  const [genre, setGenre] = useState<Genre>(current.genre ?? 'Classical');

  return (
    <Section
      id="proto-tone"
      title="Tone"
      summary={s.loading ? `${toneById(s.loading.toneId).label}…` : current.label}
      description="The instrument your notes play through. Genres only group the list."
    >
      <label
        className={`choice proto-tile-default${s.toneId === DEFAULT_TONE.id ? ' choice--selected' : ''}`}
      >
        <input
          type="radio"
          checked={s.toneId === DEFAULT_TONE.id}
          onChange={() => selectTone(DEFAULT_TONE.id)}
        />
        <span>{DEFAULT_TONE.label} · built in</span>
      </label>
      <div className="choices choices--segmented proto-gap" role="tablist">
        {GENRES.map((g) => (
          <label key={g} className={`choice${g === genre ? ' choice--selected' : ''}`}>
            <input type="radio" checked={g === genre} onChange={() => setGenre(g)} />
            <span>{g}</span>
          </label>
        ))}
      </div>
      <div className="choices choices--tiles proto-gap">
        {TONES.filter((t) => t.genre === genre).map((tone) => {
          const loading = s.loading?.toneId === tone.id;
          const pct = loading ? (s.loading!.filesDone / s.loading!.filesTotal) * 100 : 0;
          return (
            <label
              key={tone.id}
              className={`choice proto-tile${s.toneId === tone.id ? ' choice--selected' : ''}`}
              style={{ '--pct': `${pct}%` } as CSSProperties}
            >
              <input
                type="radio"
                checked={s.toneId === tone.id}
                onChange={() => selectTone(tone.id)}
              />
              <span>{tone.label}</span>
              <small className="proto-tone-meta">{toneMeta(s, tone)}</small>
            </label>
          );
        })}
      </div>
      <LoadingLine s={s} />
      <div className="controls proto-gap">
        <SliderField
          label="Volume"
          display={`${Math.round(s.volume * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          value={s.volume}
          onChange={(volume) => set({ volume })}
        />
      </div>
      <LatencyHint s={s} />
      <Credit s={s} />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Slots App.tsx mounts. Each variant decides which slots render anything.

export type SoundVariant = 'A' | 'B' | 'C';
const VARIANTS: { key: SoundVariant; name: string }[] = [
  { key: 'A', name: 'Sound section' },
  { key: 'B', name: 'Strip under Device card' },
  { key: 'C', name: 'Per-source switches + Tone section' },
];

export function useSoundVariant(): SoundVariant | null {
  if (!(import.meta as unknown as { env: { DEV: boolean } }).env.DEV) return null;
  const v = new URLSearchParams(window.location.search).get('variant');
  return v === 'A' || v === 'B' || v === 'C' ? v : null;
}

export function SoundSlotUnderDeviceCard({
  variant,
  engine,
}: {
  variant: SoundVariant;
  engine: VisualizerEngine;
}) {
  if (variant === 'B') return <VariantB_SoundStrip engine={engine} />;
  return null;
}

export function SoundSlotInDeviceCard({ variant }: { variant: SoundVariant }) {
  if (variant === 'C') return <VariantC_DeviceCardBadge />;
  return null;
}

export function SoundSlotInBody({
  variant,
  engine,
}: {
  variant: SoundVariant;
  engine: VisualizerEngine;
}) {
  if (variant === 'A') return <VariantA_SoundSection engine={engine} />;
  if (variant === 'C') return <VariantC_ToneSection />;
  return null;
}

// ---------------------------------------------------------------------------
// Scenario panel + floating switcher (not part of the design being judged)

function PrototypeChrome({ variant, engine }: { variant: SoundVariant; engine: VisualizerEngine }) {
  const s = useProto();
  useEffect(() => set({ virtualSound: engine.soundEnabled }), [engine]);
  const index = VARIANTS.findIndex((v) => v.key === variant);
  const go = (step: number) => {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length];
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next.key);
    window.location.href = url.toString();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The first click or key press outside this panel is the gesture that starts audio.
  useEffect(() => {
    if (!s.awaitingGesture) return;
    const onGesture = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest('.proto-panel, .proto-switcher')) return;
      set({ awaitingGesture: false });
    };
    window.addEventListener('pointerdown', onGesture, true);
    window.addEventListener('keydown', onGesture, true);
    return () => {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    };
  }, [s.awaitingGesture]);

  const { cached, ...shown } = s;
  return (
    <>
      <aside className="proto-panel">
        <strong>Prototype scenarios</strong>
        <button
          type="button"
          className="button"
          onClick={() => set({ deviceSound: true, awaitingGesture: true })}
        >
          Fake a reload with MIDI sound saved on
        </button>
        <button
          type="button"
          className="button"
          onClick={() => set({ failNextDownload: true })}
          disabled={s.failNextDownload}
        >
          {s.failNextDownload ? 'Next download will fail' : 'Make next download fail'}
        </button>
        <button type="button" className="button" onClick={() => set({ cached: [] })}>
          Clear download cache
        </button>
        <label className="proto-panel-check">
          <input
            type="checkbox"
            checked={s.latencyMs > 60}
            onChange={(e) => set({ latencyMs: e.target.checked ? 85 : 25 })}
          />
          High output latency (85 ms)
        </label>
        <label className="proto-panel-check">
          <input
            type="checkbox"
            checked={s.pretendDevice}
            onChange={(e) => set({ pretendDevice: e.target.checked })}
          />
          Pretend a MIDI keyboard is connected
        </label>
        <pre>
          {JSON.stringify({ ...shown, cached: cached.join(', '), sounding: sounding(s) }, null, 1)}
        </pre>
      </aside>
      <nav className="proto-switcher" aria-label="Prototype variants">
        <button type="button" onClick={() => go(-1)} aria-label="Previous variant">
          ←
        </button>
        <span>
          {variant} ({VARIANTS[index].name})
        </span>
        <button type="button" onClick={() => go(1)} aria-label="Next variant">
          →
        </button>
      </nav>
    </>
  );
}

export function SoundPrototypeChrome({
  variant,
  engine,
}: {
  variant: SoundVariant | null;
  engine: VisualizerEngine;
}): ReactNode {
  if (!variant) return null;
  return <PrototypeChrome variant={variant} engine={engine} />;
}
