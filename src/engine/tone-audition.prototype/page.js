// PROTOTYPE (#45, extended for #50). Kept by the owner as the Tone tuning bench, not
// production code. A page shell around player.js: loading,
// sample preparation to #49's settings, MIDI, readouts, the loudness balance, and the
// acoustic latency test.
import {
  TonePlayer,
  sampledTone,
  warmAnalog,
  villeraLead,
  drawbarOrgan,
  withOrganExtras,
  testClick,
  dbToGain,
  VILLERA_VARIANTS,
} from './player.js';

const $ = (id) => document.getElementById(id);

/** The keyboard band every Tone must cover (#49): C2–B6. */
const BOARD = [36, 95];

// The catalogue as #45 settled it, each with #49's preparation recipe.
const TONES = [
  {
    id: 'warm',
    name: 'Warm Analog',
    genre: 'Default',
    synth: warmAnalog,
    set: "Today's Preview Synth. No download.",
  },
  {
    id: 'piano',
    name: 'Grand Piano',
    genre: 'Classical',
    dir: 'piano',
    layers: ['v4', 'v12', 'v16'],
    tailCap: 5,
    releaseTime: 0.35,
    velTrack: 0.45,
    set: 'Salamander V3 (CC BY 3.0): v4, v12, v16 in even thirds, 5 s tails',
  },
  {
    id: 'strings',
    name: 'Strings',
    genre: 'Classical',
    dir: 'strings',
    bakeLoop: 2,
    releaseTime: 0.6,
    velTrack: 0.35,
    attack: 0.008,
    set: 'VSCO 2 CE cello + violin sections (CC0), 2 s equal-power loop',
  },
  {
    id: 'guitar',
    name: 'Overdriven Guitar',
    genre: 'Rock',
    dirs: ['guitar', 'guitar-clean'],
    hybrid: 60,
    // #49 gives the guitar no tail cap, but its files run 25–37 s (458 s held, over budget).
    // #45 auditioned it with an 8 s cap, so this keeps that.
    tailCap: 8,
    releaseTime: 0.25,
    velTrack: 0.35,
    set: 'Distorted #2 below C4; from C4, Clean #1 small with drive and EQ tilt baked in (CC0)',
  },
  {
    id: 'organ',
    name: 'Rock Organ',
    genre: 'Rock',
    dir: 'organ',
    mergeLR: true,
    organ: true,
    releaseTime: 0.08,
    velTrack: 0,
    set: 'FreePats Rock Organ Emulation (CC0), left + right merged to one stereo voice',
  },
  {
    id: 'organ-synth',
    name: 'Rock Organ, synth',
    genre: 'Rock',
    synth: () => drawbarOrgan(state.organ.registration),
    organ: true,
    set: 'Replacement candidate: synthesised drawbars, no download',
  },
  {
    id: 'accordion',
    name: 'Accordion',
    genre: 'Cumbia',
    dir: 'accordion',
    releaseTime: 0.13,
    velTrack: 0.4,
    attack: 0.03,
    set: 'FreePats Button Accordion HN (CC0)',
  },
  {
    id: 'villera',
    name: 'Villera Lead',
    genre: 'Cumbia',
    synth: () => villeraLead(state.villera),
    set: 'Variant D, fine-tuned with the controls below',
  },
  {
    id: 'click',
    name: 'Test click',
    genre: 'Latency test',
    synth: testClick,
    set: 'A 1 ms burst for the acoustic test',
  },
];

const VILLERA_D = { ...VILLERA_VARIANTS.D, glideSemis: 1, peak2: 2900, peak2Db: 0 };
const ORGAN_DEFAULT = {
  registration: '888000000',
  lowCut: 0,
  presence: 0,
  perc: 0,
  percHarm: 3,
  percDecay: 0.25,
  click: 0,
  drive: 0,
  rotary: 'off',
};
const GUITAR_DEFAULT = { tilt: 0, pivot: 1200 };

// The fixed gains #50 decided, against Warm Analog at 0 dB, measured at velocity 80.
const DECIDED_GAINS = {
  warm: 0,
  piano: -7,
  strings: -10.5,
  guitar: -19,
  organ: -19,
  'organ-synth': -6.5,
  accordion: -17,
  villera: -3,
};

const saved = loadSaved();
const state = {
  selected: 'warm',
  loading: null, // tone id being loaded
  cache: new Map(), // tone id -> { raw, regions, stats } ; holds only the selected sampled Tone
  prepared: null, // { toneId, regions, mem }
  toneObj: null, // the Tone the player holds for the selection, so the A/B can hand it back
  ab: false, // true while Warm Analog stands in for the A/B
  trims: { ...DECIDED_GAINS, ...saved.trims }, // tone id -> dB
  reverb: { mode: 'off', shared: 0.15, perTone: {}, ir: 2.2, ...saved.reverb },
  villera: { ...VILLERA_D, ...saved.villera },
  organ: { ...ORGAN_DEFAULT, ...saved.organ },
  guitar: { ...GUITAR_DEFAULT, ...saved.guitar },
  refVel: saved.refVel ?? 80,
  loudness: saved.loudness ?? {}, // tone id -> { lufs, peak, vel, at }
  edges: saved.edges ?? {}, // tone id -> note -> 'ok' | 'wrong'
  seam: null, // guitar seam readout
  progress: {}, // tone id -> text
  octave: 60,
  handler: { last: 0, max: 0 },
  late: 0,
  level: { peakHold: 0, rmsHold: 0 },
};

function loadSaved() {
  try {
    return JSON.parse(localStorage.getItem('tone-audition-50') ?? '{}');
  } catch {
    return {};
  }
}

function decisions() {
  const { trims, reverb, villera, organ, guitar, refVel, loudness, edges } = state;
  return { trims, reverb, villera, organ, guitar, refVel, loudness, edges };
}

function save() {
  try {
    localStorage.setItem('tone-audition-50', JSON.stringify(decisions()));
  } catch {
    /* private window: the export box still works */
  }
  const box = $('export');
  if (box && document.activeElement !== box) box.value = JSON.stringify(decisions(), null, 1);
}

// ---------- audio graph ----------

let ctx, player, master, analyser, toneBus, toneInput, organIn, organChain, reverbSend, convolver;

function buildAudio(hint) {
  const opts =
    hint === 'interactive' ? { latencyHint: 'interactive' } : { latencyHint: Number(hint) };
  ctx = new (window.AudioContext || window.webkitAudioContext)(opts);
  master = ctx.createGain();
  master.gain.value = 0.8;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  master.connect(analyser);
  analyser.connect(ctx.destination);

  toneBus = ctx.createGain(); // carries the Tone's fixed gain
  toneBus.connect(master);
  reverbSend = ctx.createGain();
  convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(state.reverb.ir);
  toneBus.connect(reverbSend);
  reverbSend.connect(convolver);
  convolver.connect(master);

  organIn = ctx.createGain();
  rebuildOrganChain();

  toneInput = ctx.createGain();
  player = new TonePlayer(ctx, toneInput, {
    maxVoices: Number($('cap').value),
    bendRange: Number($('bendRange').value),
  });
  routeTone();
  applyCurrentTone();
  window.__proto = { ctx, player, state, lat }; // for poking at it from the console
}

/** The Rock Organ options (#50): low shelf, presence, optional drive, optional rotary. */
function buildOrganChain(c, o) {
  const input = c.createGain();
  const output = c.createGain();
  const low = c.createBiquadFilter();
  low.type = 'lowshelf';
  low.frequency.value = 250;
  low.gain.value = o.lowCut;
  const pres = c.createBiquadFilter();
  pres.type = 'peaking';
  pres.frequency.value = 2500;
  pres.Q.value = 0.9;
  pres.gain.value = o.presence;
  input.connect(low);
  low.connect(pres);
  let node = pres;
  if (o.drive > 0) {
    const pre = c.createGain();
    pre.gain.value = 1 + 4 * o.drive;
    const shaper = c.createWaveShaper();
    shaper.curve = driveCurve(1 + 2 * o.drive);
    shaper.oversample = '4x';
    const post = c.createGain();
    post.gain.value = 1 / Math.sqrt(pre.gain.value);
    node.connect(pre);
    pre.connect(shaper);
    shaper.connect(post);
    node = post;
  }
  if (o.rotary !== 'off') {
    // Two delays and gains wobbled in opposite phase, as in #45's rotary, without its drive.
    const lfo = c.createOscillator();
    lfo.frequency.value = o.rotary === 'fast' ? 6.4 : 0.8;
    lfo.start();
    const merger = c.createChannelMerger(2);
    [1, -1].forEach((sign, ch) => {
      const delay = c.createDelay(0.02);
      delay.delayTime.value = 0.004;
      const dDepth = c.createGain();
      dDepth.gain.value = 0.0008 * sign;
      lfo.connect(dDepth);
      dDepth.connect(delay.delayTime);
      const amp = c.createGain();
      amp.gain.value = 0.8;
      const aDepth = c.createGain();
      aDepth.gain.value = 0.2 * sign;
      lfo.connect(aDepth);
      aDepth.connect(amp.gain);
      node.connect(delay);
      delay.connect(amp);
      amp.connect(merger, 0, ch);
    });
    merger.connect(output);
    const dry = c.createGain();
    dry.gain.value = 0.35;
    node.connect(dry);
    dry.connect(output);
  } else node.connect(output);
  return { input, output };
}

function rebuildOrganChain() {
  if (organChain) {
    organIn.disconnect();
    organChain.output.disconnect();
  }
  organChain = buildOrganChain(ctx, state.organ);
  organIn.connect(organChain.input);
  organChain.output.connect(toneBus);
}

function currentDef() {
  return TONES.find((t) => t.id === state.selected);
}

function routeTone() {
  const def = state.ab ? TONES[0] : currentDef();
  toneInput.disconnect();
  toneInput.connect(def.organ ? organIn : toneBus);
  toneBus.gain.value = dbToGain(state.trims[def.id] ?? 0);
  reverbSend.gain.value = reverbLevel(def.id);
}

function reverbLevel(id) {
  const r = state.reverb;
  if (r.mode === 'shared') return r.shared;
  if (r.mode === 'perTone') return r.perTone[id] ?? 0;
  return 0;
}

function driveCurve(k) {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}

function makeImpulse(seconds) {
  const len = Math.floor(seconds * ctx.sampleRate);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  const pre = Math.floor(0.012 * ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = pre; i < len; i++)
      d[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * (i - pre)) / len);
  }
  return b;
}

function resumeAudio() {
  if (ctx && ctx.state !== 'running') ctx.resume();
}
addEventListener('pointerdown', resumeAudio);
addEventListener('keydown', resumeAudio);

// ---------- loading and preparation ----------

async function selectTone(id) {
  state.selected = id;
  state.level = { peakHold: 0, rmsHold: 0 };
  const def = TONES.find((t) => t.id === id);
  routeTone();
  renderTones();
  syncControls();
  if (def.synth) {
    dropSampledCache();
    applyCurrentTone();
    return;
  }
  if (!state.cache.has(id)) {
    // Until the download is ready, Warm Analog sounds (as the map settled).
    player.setTone(warmAnalog());
    dropSampledCache();
    await loadTone(def);
    if (state.selected !== id) return;
  }
  applyCurrentTone();
}

function dropSampledCache() {
  // Hold one Tone: the previous Tone's buffers go once it's deselected.
  for (const key of state.cache.keys()) if (key !== state.selected) state.cache.delete(key);
  if (state.prepared && state.prepared.toneId !== state.selected) state.prepared = null;
}

async function loadTone(def) {
  state.loading = def.id;
  const stall = startStallMonitor();
  const t0 = performance.now();
  const dirs = def.dirs ?? [def.dir];
  const maps = await Promise.all(
    dirs.map(async (d) => (await fetch(`./samples/${d}/map.json`)).json()),
  );
  const map = {
    notes: maps.map((m) => m.notes).join(' '),
    regions: maps.flatMap((m, i) =>
      m.regions.map((r) => ({ ...r, part: dirs[i], file: `${dirs[i]}/${r.file}` })),
    ),
  };
  const files = [...new Set(map.regions.map((r) => r.file))];
  const decoded = new Map();
  let done = 0;
  let bytes = 0;
  let decodeMs = 0;
  let firstByte = null;
  const queue = [...files];
  async function worker() {
    while (queue.length) {
      const file = queue.shift();
      const res = await fetch(`./samples/${file.split('/').map(encodeURIComponent).join('/')}`);
      const ab = await res.arrayBuffer();
      firstByte ??= performance.now() - t0;
      bytes += ab.byteLength;
      const fileRate = fileSampleRate(ab);
      const d0 = performance.now();
      const buffer = await ctx.decodeAudioData(ab);
      decodeMs += performance.now() - d0;
      decoded.set(file, { buffer, fileRate });
      done++;
      state.progress[def.id] = `loading ${Math.round((done / files.length) * 100)}%`;
      renderTones();
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const wallMs = performance.now() - t0;
  const stalls = stall.stop();
  let raw = map.regions.map((r) => ({ ...r, ...decoded.get(r.file) }));
  if (def.mergeLR) raw = mergeLR(raw);
  const regions = def.hybrid ? await buildHybrid(raw, def.hybrid) : raw;
  state.cache.set(def.id, {
    raw,
    regions,
    notes: map.notes,
    stats: { files: files.length, bytes, wallMs, decodeMs, ...stalls },
  });
  state.progress[def.id] = '';
  state.loading = null;
  renderTones();
}

/**
 * #49: each organ note's left and right mono files become one stereo buffer, so a note costs
 * one voice. The two sides loop at different starts, so the merged loop starts at the later
 * one and a short equal-power crossfade is baked in at the seam.
 */
function mergeLR(regions) {
  const pairs = new Map();
  for (const r of regions) {
    const k = r.file.replace(/[LR]\.wav$/i, '');
    if (!pairs.has(k)) pairs.set(k, {});
    pairs.get(k)[r.pan < 0 ? 'L' : 'R'] = r;
  }
  return [...pairs.values()].map(({ L, R }) => {
    if (!L || !R) return { ...(L ?? R), pan: 0 };
    const len = Math.max(L.buffer.length, R.buffer.length);
    const b = ctx.createBuffer(2, len, L.buffer.sampleRate);
    b.copyToChannel(L.buffer.getChannelData(0), 0);
    b.copyToChannel(R.buffer.getChannelData(0), 1);
    return {
      ...L,
      file: L.file.replace(/L(\.wav)$/i, 'L+R$1'),
      buffer: b,
      pan: 0,
      loop: [Math.max(L.loop[0], R.loop[0]), Math.min(L.loop[1], R.loop[1])],
      loopXfade: 0.1,
    };
  });
}

/**
 * Overdriven Guitar (#49): Distorted #2 below `split`; from `split` up, Clean #1 small with the
 * drive chain and the #50 EQ tilt rendered into each note. Levels match on the average RMS of
 * the 3 loud-layer notes each side of the split.
 */
const bakedCache = new Map(); // `${file}|${tilt}|${pivot}` -> AudioBuffer
async function buildHybrid(regions, split) {
  const { tilt, pivot } = state.guitar;
  const low = regions
    .filter((r) => r.part === 'guitar' && r.lo < split)
    .map((r) => ({ ...r, hi: Math.min(r.hi, split - 1) }));
  const highRaw = regions
    .filter((r) => r.part === 'guitar-clean' && r.hi >= split)
    .map((r) => ({ ...r, lo: Math.max(r.lo, split) }));
  for (const r of highRaw) {
    const k = `${r.file}|${tilt}|${pivot}`;
    if (!bakedCache.has(k)) bakedCache.set(k, await bakeDrive(r.buffer, tilt, pivot));
  }
  const high = highRaw.map((r) => ({
    ...r,
    buffer: bakedCache.get(`${r.file}|${tilt}|${pivot}`),
    fileRate: null,
  }));
  const loud = (pool) => {
    const l = pool.filter((r) => r.vhi >= 100);
    return l.length ? l : pool;
  };
  const nearest3 = (pool, below) => {
    const keys = [...new Set(loud(pool).map((r) => r.key))].sort((a, b) =>
      below ? b - a : a - b,
    );
    const pick = keys.slice(0, 3);
    return pick.map((k) => loud(pool).find((r) => r.key === k));
  };
  const a = nearest3(low, true);
  const b = nearest3(high, false);
  const avg = (xs, f) => xs.reduce((s, x) => s + f(x), 0) / xs.length;
  const offset = 20 * Math.log10(avg(a, (r) => rms(r.buffer)) / avg(b, (r) => rms(r.buffer)));
  state.seam = {
    offsetDb: offset,
    lowKeys: a.map((r) => r.key),
    highKeys: b.map((r) => r.key),
    lowCentroid: avg(a, (r) => centroid(r.buffer)),
    highCentroid: avg(b, (r) => centroid(r.buffer)),
  };
  return [...low, ...high.map((r) => ({ ...r, gainDb: r.gainDb + offset }))];
}

async function bakeDrive(buffer, tilt = 0, pivot = 1200) {
  const oc = new OfflineAudioContext(2, buffer.length, buffer.sampleRate);
  const src = oc.createBufferSource();
  src.buffer = buffer;
  const pre = oc.createGain();
  pre.gain.value = 5 * 0.85;
  const shaper = oc.createWaveShaper();
  shaper.curve = driveCurve(3.2);
  shaper.oversample = '4x';
  const hp = oc.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 90;
  const mid = oc.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 900;
  mid.Q.value = 0.8;
  mid.gain.value = 4;
  const cab = oc.createBiquadFilter();
  cab.type = 'lowpass';
  cab.frequency.value = 4600;
  cab.Q.value = 0.9;
  const post = oc.createGain();
  post.gain.value = 0.28;
  // The tilt: half the dB as a low-shelf cut and half as a high-shelf lift, pivoting at `pivot`.
  const ls = oc.createBiquadFilter();
  ls.type = 'lowshelf';
  ls.frequency.value = pivot;
  ls.gain.value = -tilt / 2;
  const hs = oc.createBiquadFilter();
  hs.type = 'highshelf';
  hs.frequency.value = pivot;
  hs.gain.value = tilt / 2;
  [src, pre, shaper, hp, mid, cab, post, ls, hs]
    .reduce((x, y) => (x.connect(y), y))
    .connect(oc.destination);
  src.start();
  return oc.startRendering();
}

async function rebakeGuitar() {
  const cached = state.cache.get('guitar');
  if (!cached) return;
  state.progress.guitar = 'baking';
  renderTones();
  cached.regions = await buildHybrid(cached.raw, 60);
  state.progress.guitar = '';
  if (state.selected === 'guitar') applyCurrentTone();
  renderGuitar();
}

/** Spectral centroid in Hz over 50 ms–1.05 s, a rough number to back the ear on brightness. */
function centroid(buffer) {
  const N = 4096;
  const d = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const win = new Float32Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  let num = 0;
  let den = 0;
  for (let at = Math.floor(0.05 * rate); at + N < Math.min(d.length, 1.05 * rate); at += N / 2) {
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = d[at + i] * win[i];
    fft(re, im);
    for (let k = 1; k < N / 2; k++) {
      const mag = Math.hypot(re[k], im[k]);
      num += mag * ((k * rate) / N);
      den += mag;
    }
  }
  return den ? num / den : 0;
}

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < len / 2; j++) {
        const wr = Math.cos(ang * j);
        const wi = Math.sin(ang * j);
        const a = i + j;
        const b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** RMS of the first 1.5 s, across channels. */
function rms(buffer) {
  const n = Math.min(buffer.length, Math.floor(1.5 * buffer.sampleRate));
  let sum = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) sum += d[i] * d[i];
  }
  return Math.sqrt(sum / (n * buffer.numberOfChannels)) || 1e-6;
}

/** Sample rate stored in a FLAC or WAV header, so SFZ loop frames convert to seconds. */
function fileSampleRate(ab) {
  const b = new Uint8Array(ab, 0, Math.min(ab.byteLength, 4096));
  const tag = String.fromCharCode(...b.slice(0, 4));
  if (tag === 'fLaC') return (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
  if (tag === 'RIFF') {
    const v = new DataView(ab);
    let p = 12;
    while (p + 8 < b.length) {
      const id = String.fromCharCode(...b.slice(p, p + 4));
      const size = v.getUint32(p + 4, true);
      if (id === 'fmt ') return v.getUint32(p + 12, true);
      p += 8 + size + (size % 2);
    }
  }
  return null;
}

function startStallMonitor() {
  let last = performance.now();
  let maxGap = 0;
  let running = true;
  const longTasks = [];
  let obs = null;
  try {
    obs = new PerformanceObserver((list) =>
      longTasks.push(...list.getEntries().map((e) => e.duration)),
    );
    obs.observe({ type: 'longtask', buffered: false });
  } catch {
    obs = null;
  }
  const tick = () => {
    if (!running) return;
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    stop() {
      running = false;
      obs?.disconnect();
      return {
        maxFrameGap: maxGap,
        longTasks: obs ? longTasks.length : null,
        longestTask: longTasks.length ? Math.max(...longTasks) : 0,
      };
    },
  };
}

function applyCurrentTone() {
  const def = currentDef();
  if (def.synth) {
    setPlayerTone(def, def.synth());
    state.prepared = { toneId: def.id, mem: null };
    renderMem();
    return;
  }
  const cached = state.cache.get(def.id);
  if (!cached) return;
  const p0 = performance.now();
  let regions = cached.regions;
  if (def.layers) {
    // #49: the active layers split velocity evenly: 1–42, 43–84, 85–127 for three.
    regions = regions
      .filter((r) => def.layers.includes(r.layer))
      .map((r) => {
        const i = def.layers.indexOf(r.layer);
        return {
          ...r,
          vlo: Math.floor((i * 127) / def.layers.length) + 1,
          vhi: Math.floor(((i + 1) * 127) / def.layers.length),
        };
      });
  }
  regions = widenToBoard(regions);
  const silences = [];
  const prepared = regions.map((r) => {
    const out = prepareBuffer(r, { cap: def.tailCap ?? 0, bakeLoop: def.bakeLoop ?? 0 });
    silences.push(out.leadMs);
    return out.region;
  });
  const prepMs = performance.now() - p0;

  // Memory as shipped: every distinct buffer once.
  const seen = new Set();
  let frames = 0;
  let floatBytes = 0;
  let seconds = 0;
  for (const r of prepared) {
    if (seen.has(r.file)) continue;
    seen.add(r.file);
    const b = r.buffer;
    floatBytes += b.length * b.numberOfChannels * 4;
    frames += (b.length * b.numberOfChannels) / 2;
    seconds += b.duration;
  }
  const stereoSeconds = frames / ctx.sampleRate;
  const play = prepared.filter((r) => !r.release);
  const mem = {
    ...cached.stats,
    files: seen.size,
    seconds,
    stereoSeconds,
    decodedMB: floatBytes / 1e6,
    mp3MiB: (stereoSeconds * 16000) / 2 ** 20,
    rawMiB: cached.stats.bytes / 2 ** 20,
    leadAvg: silences.reduce((a, b) => a + b, 0) / silences.length,
    leadMax: Math.max(...silences),
    prepMs,
    range: [Math.min(...play.map((r) => r.lo)), Math.max(...play.map((r) => r.hi))],
    keys: [Math.min(...play.map((r) => r.key)), Math.max(...play.map((r) => r.key))],
  };
  state.prepared = { toneId: def.id, regions: prepared, mem };
  setPlayerTone(
    def,
    sampledTone({
      id: def.id,
      regions: prepared,
      releaseTime: def.releaseTime,
      velTrack: def.velTrack,
      attack:
        Number($('attack').value) > (def.attack ?? 0) ? Number($('attack').value) : def.attack,
    }),
  );
  renderMem();
}

function setPlayerTone(def, tone) {
  state.toneObj = def.organ ? withOrganExtras(tone, state.organ) : tone;
  if (!state.ab) player.setTone(state.toneObj);
}

/**
 * #49: every Tone covers at least C2–B6, by widening its outermost regions where needed.
 * Past that, a note sounds only as far as the source's own key ranges reach.
 */
function widenToBoard(regions) {
  const widen = (pool) => {
    if (!pool.length) return pool;
    const lo = Math.min(...pool.map((r) => r.lo));
    const hi = Math.max(...pool.map((r) => r.hi));
    return pool.map((r) => ({
      ...r,
      lo: r.lo === lo ? Math.min(lo, BOARD[0]) : r.lo,
      hi: r.hi === hi ? Math.max(hi, BOARD[1]) : r.hi,
    }));
  };
  return [...widen(regions.filter((r) => !r.release)), ...widen(regions.filter((r) => r.release))];
}

/**
 * #49's preparation: trim to the first sample above −48 dBFS less 1 ms, then cap the tail with
 * a 60 ms linear fade, or bake an equal-power crossfade loop. Returns a new region.
 */
function prepareBuffer(r, { cap, bakeLoop }) {
  const src = r.buffer;
  const rate = src.sampleRate;
  const chans = [...Array(src.numberOfChannels)].map((_, c) => src.getChannelData(c));
  const thr = 0.004; // about -48 dBFS
  let onset = 0;
  outer: for (let i = 0; i < src.length; i++)
    for (const d of chans)
      if (Math.abs(d[i]) > thr) {
        onset = i;
        break outer;
      }
  const start = Math.max(0, onset - Math.floor(0.001 * rate));
  const leadMs = (onset / rate) * 1000;

  let loop = null;
  let end = src.length;
  let fade = 0;
  let bakeAt = null;
  if (r.loop) {
    const toFrame = (f) => Math.round((f / (r.fileRate || rate)) * rate);
    const a = toFrame(r.loop[0]);
    const b = Math.min(src.length, toFrame(r.loop[1]));
    if (r.loopXfade) {
      bakeAt = { a, b, xf: Math.min(Math.floor(r.loopXfade * rate), a) };
      end = b;
    } else end = Math.min(src.length, b + Math.ceil(0.05 * rate));
    loop = [(a - start) / rate, (b - start) / rate];
  } else if (bakeLoop && src.duration > 4) {
    // The loop ends 0.6 s before the file ends and starts 0.5 s after the fade.
    const b = Math.floor((src.duration - 0.6) * rate);
    const xf = Math.min(Math.floor(bakeLoop * rate), Math.floor(b / 3));
    const a = xf + Math.floor(0.5 * rate);
    bakeAt = { a, b, xf };
    end = b;
    loop = [(a - start) / rate, (b - start) / rate];
  } else if (cap > 0 && src.duration - start / rate > cap) {
    end = start + Math.floor(cap * rate);
    fade = Math.floor(0.06 * rate);
  }

  const len = end - start;
  const out = ctx.createBuffer(src.numberOfChannels, len, rate);
  chans.forEach((d, c) => {
    const o = out.getChannelData(c);
    o.set(d.subarray(start, end));
    if (bakeAt) {
      const { a, b, xf } = bakeAt;
      for (let i = 0; i < xf; i++) {
        const t = i / xf;
        o[b - xf + i - start] =
          d[b - xf + i] * Math.cos((t * Math.PI) / 2) + d[a - xf + i] * Math.sin((t * Math.PI) / 2);
      }
    }
    for (let i = 0; i < fade; i++) o[len - fade + i] *= 1 - i / fade;
  });
  return { region: { ...r, buffer: out, loop }, leadMs };
}

// ---------- loudness balance (#50) ----------

/**
 * Renders a fixed phrase on the selected Tone offline, before its fixed gain, and returns
 * approximate K-weighted gated loudness (BS.1770-style, in LUFS) and the sample peak.
 * Phrase at the reference velocity: C3, C4, C5 for 0.8 s each, then a C4–E4–G4 triad for 1.6 s.
 */
async function measureSelected() {
  const def = currentDef();
  const tone = state.toneObj;
  if (!tone || (!def.synth && !state.cache.has(def.id))) return null;
  const rate = 48000;
  const oc = new OfflineAudioContext(4, Math.floor(rate * 6), rate);
  const sum = oc.createGain();
  sum.channelCount = 2;
  sum.channelCountMode = 'explicit';
  sum.channelInterpretation = 'speakers';
  const shelf = oc.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 1681;
  shelf.gain.value = 4;
  const hp = oc.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 38;
  hp.Q.value = 0.5;
  const merger = oc.createChannelMerger(4);
  const rawSplit = oc.createChannelSplitter(2);
  const kSplit = oc.createChannelSplitter(2);
  sum.connect(rawSplit);
  sum.connect(shelf);
  shelf.connect(hp);
  hp.connect(kSplit);
  rawSplit.connect(merger, 0, 0);
  rawSplit.connect(merger, 1, 1);
  kSplit.connect(merger, 0, 2);
  kSplit.connect(merger, 1, 3);
  merger.connect(oc.destination);

  const toneIn = oc.createGain();
  if (def.organ) {
    const chain = buildOrganChain(oc, state.organ);
    toneIn.connect(chain.input);
    chain.output.connect(sum);
  } else toneIn.connect(sum);
  const p = new TonePlayer(oc, toneIn, { maxVoices: 32 });
  p.setTone(tone);
  const v = state.refVel;
  const phrase = [
    [[48], 0.1, 0.8],
    [[60], 1.1, 0.8],
    [[72], 2.1, 0.8],
    [[60, 64, 67], 3.1, 1.6],
  ];
  for (const [notes, t, len] of phrase) {
    for (const n of notes) p.noteOn(n, v, t);
    for (const n of notes) p.noteOff(n, t + len);
  }
  const out = await oc.startRendering();
  const [l, r, kl, kr] = [0, 1, 2, 3].map((c) => out.getChannelData(c));
  let peak = 0;
  for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
  // 400 ms blocks, 75 % overlap; absolute gate −70 LUFS, relative gate −10 LU.
  const block = Math.floor(0.4 * rate);
  const hop = Math.floor(0.1 * rate);
  const powers = [];
  for (let at = 0; at + block <= kl.length; at += hop) {
    let e = 0;
    for (let i = at; i < at + block; i++) e += kl[i] * kl[i] + kr[i] * kr[i];
    powers.push(e / block);
  }
  const lufs = (z) => -0.691 + 10 * Math.log10(z);
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const abs = powers.filter((z) => lufs(z) > -70);
  if (!abs.length) return null;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((z) => lufs(z) > rel);
  return { lufs: lufs(mean(gated)), peak: 20 * Math.log10(peak || 1e-9), vel: v };
}

async function measureAndRecord() {
  const res = await measureSelected();
  if (!res) return;
  state.loudness[state.selected] = { ...res, at: Date.now() };
  save();
  renderLoudness();
}

let measuringAll = false;
async function measureAll() {
  if (measuringAll) return;
  measuringAll = true;
  const back = state.selected;
  try {
    for (const t of TONES) {
      if (t.id === 'click') continue;
      $('measureState').textContent = `measuring ${t.name}…`;
      await selectTone(t.id);
      await measureAndRecord();
    }
  } finally {
    measuringAll = false;
    $('measureState').textContent = 'done';
    await selectTone(back);
  }
}

function suggestedTrim(id) {
  const ref = state.loudness.warm;
  const m = state.loudness[id];
  if (!ref || !m) return null;
  return Math.round((ref.lufs + (state.trims.warm ?? 0) - m.lufs) * 2) / 2;
}

// ---------- input ----------

const midi = { access: null, inputs: [], error: null, lastMsg: '' };

async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    midi.error = 'This browser has no Web MIDI (Safari). Use the computer keys.';
    return;
  }
  try {
    midi.access = await navigator.requestMIDIAccess();
    const bind = () => {
      midi.inputs = [...midi.access.inputs.values()];
      for (const input of midi.inputs) input.onmidimessage = (e) => onMidi(e.data, e.timeStamp);
    };
    bind();
    midi.access.onstatechange = bind;
  } catch (e) {
    midi.error = `MIDI refused: ${e.message}`;
  }
}

function onMidi(data, ts) {
  const cmd = data[0] >> 4;
  const wait = performance.now() - ts;
  if (cmd === 9 && data[2] > 0) {
    state.handler.last = wait;
    state.handler.max = Math.max(state.handler.max, wait);
    noteOn(data[1], data[2], ts, wait);
  } else if (cmd === 8 || cmd === 9) player.noteOff(data[1], startTime(ts));
  else if (cmd === 11 && data[1] === 64) player.pedal(data[2] >= 64, startTime(ts));
  else if (cmd === 11 && (data[1] === 123 || data[1] === 120)) player.allOff();
  else if (cmd === 14)
    player.bend(Math.max(-1, (((data[2] << 7) | data[1]) - 8192) / 8191), ctx.currentTime);
  midi.lastMsg = [...data].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

// Timestamp scheduling: map the event's performance time onto the audio clock and add a fixed lead,
// so every note carries the same delay instead of whatever the render quantum leaves.
const pipe = { est: 0, samples: [] };
function startTime(ts) {
  if ($('sched').value !== 'stamp' || !ctx.getOutputTimestamp) return ctx.currentTime;
  const o = ctx.getOutputTimestamp();
  if (!o.performanceTime) return ctx.currentTime;
  const heard = (perf) => o.contextTime + (perf - o.performanceTime) / 1000;
  const ahead = ctx.currentTime - heard(performance.now());
  pipe.samples.push(ahead);
  if (pipe.samples.length > 64) pipe.samples.shift();
  pipe.est = Math.max(...pipe.samples);
  const when = heard(ts) + pipe.est + ctx.baseLatency + Number($('lead').value) / 1000;
  if (when < ctx.currentTime) {
    state.late++;
    return ctx.currentTime;
  }
  return when;
}

function noteOn(note, velocity, ts, wait = 0) {
  resumeAudio();
  const when = startTime(ts);
  player.noteOn(note, velocity, when);
  lat.onStrike(when, wait);
}

const KEYS = 'awsedftgyhujk';
const down = new Set();
addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat) player.pedal(true);
    return;
  }
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'z') state.octave = Math.max(24, state.octave - 12);
  if (k === 'x') state.octave = Math.min(96, state.octave + 12);
  const i = KEYS.indexOf(k);
  if (i < 0 || down.has(k)) return;
  down.add(k);
  noteOn(state.octave + i, 100, performance.now());
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space') return player.pedal(false);
  const k = e.key.toLowerCase();
  const i = KEYS.indexOf(k);
  if (i < 0 || !down.has(k)) return;
  down.delete(k);
  player.noteOff(state.octave + i);
});

// ---------- acoustic latency test ----------

const lat = {
  armed: false,
  blocks: [], // { t, d } from the mic worklet, last ~3 s
  pending: null,
  trials: [],
  view: null, // last analysed window for the canvas

  async arm() {
    if (this.armed) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    await this.attach(stream);
    this.stream = stream;
    this.armed = true;
    $('armState').textContent = 'Armed: strike one key sharply, about one per second';
  },

  async attach(stream) {
    const code = `class Rec extends AudioWorkletProcessor { process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage({ t: currentTime, d: ch.slice(0) }); return true; } } registerProcessor('rec', Rec);`;
    await ctx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([code], { type: 'application/javascript' })),
    );
    const src = ctx.createMediaStreamSource(stream);
    const rec = new AudioWorkletNode(ctx, 'rec');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(rec);
    rec.connect(mute);
    mute.connect(ctx.destination);
    rec.port.onmessage = (e) => {
      this.blocks.push(e.data);
      const keep = (3 * ctx.sampleRate) / 128;
      if (this.blocks.length > keep) this.blocks.splice(0, this.blocks.length - keep);
    };
  },

  onStrike(when, wait) {
    if (!this.armed || this.pending) return;
    this.pending = {
      when,
      wait,
      tone: TONES.find((t) => t.id === state.selected).name,
      config: `${$('output').value} / ${$('hint').value} / ${$('sched').value}`,
    };
    setTimeout(() => this.analyse(), 650);
  },

  analyse() {
    const p = this.pending;
    this.pending = null;
    const rate = ctx.sampleRate;
    const from = p.when - 0.3;
    const to = p.when + 0.32;
    const parts = this.blocks.filter((b) => b.t >= from && b.t <= to);
    if (!parts.length) return;
    const samples = new Float32Array(parts.length * 128);
    parts.forEach((b, i) => samples.set(b.d, i * 128));
    const hop = Math.max(1, Math.round(rate / 2000)); // 0.5 ms
    const env = new Float32Array(Math.floor(samples.length / hop));
    for (let i = 0; i < env.length; i++) {
      let m = 0;
      for (let j = 0; j < hop; j++) m = Math.max(m, Math.abs(samples[i * hop + j]));
      env[i] = m;
    }
    const msPerHop = (hop / rate) * 1000;
    const max = env.reduce((a, b) => Math.max(a, b), 0);
    // An onset is a sharp rise: well above the average of the 5–10 ms before it.
    const before = (i, n) => {
      let sum = 0;
      for (let j = Math.max(0, i - n); j < i; j++) sum += env[j];
      return sum / Math.max(1, Math.min(n, i));
    };
    const rises = (i, n) => env[i] > 4 * before(i, n) + 1e-5;
    let sound = env.findIndex((v, i) => v >= 0.3 * max && rises(i, 20));
    if (sound < 0) sound = env.findIndex((v) => v >= 0.3 * max);
    const head = [...env.slice(0, Math.floor(60 / msPerHop))].sort((a, b) => a - b);
    const floor = head[Math.floor(head.length / 2)] || 1e-4;
    const thr = Math.max(floor * 4, 0.005 * max);
    // The key bottoms out shortly before the sound: look no further back than 120 ms.
    let thump = -1;
    for (let i = Math.max(1, sound - Math.floor(120 / msPerHop)); i < sound - Math.floor(2 / msPerHop); i++) {
      if (env[i] > thr && rises(i, 10)) {
        thump = i;
        break;
      }
    }
    // Only hand-confirmed strikes count: the mic often hears the key too faintly to trust a guess.
    const trial = {
      ...p,
      env,
      msPerHop,
      sound,
      thump,
      auto: thump >= 0 ? (sound - thump) * msPerHop : null,
      ms: null,
      v0: Math.max(0, sound - Math.floor(160 / msPerHop)),
      v1: Math.min(env.length, sound + Math.floor(40 / msPerHop)),
    };
    this.trials.push(trial);
    this.view = trial;
    drawWave();
    renderLatTable();
  },

  /** Lets you correct a marker by clicking the waveform: click = key thump, shift-click = sound. */
  adjust(fraction, isSound) {
    const t = this.view;
    if (!t) return;
    const i = Math.round(t.v0 + fraction * (t.v1 - t.v0));
    if (isSound) t.sound = i;
    else t.thump = i;
    t.ms = t.thump >= 0 ? (t.sound - t.thump) * t.msPerHop : null;
    drawWave();
    renderLatTable();
  },
};

function drawWave() {
  const c = $('wave');
  const g = c.getContext('2d');
  const t = lat.view;
  g.clearRect(0, 0, c.width, c.height);
  if (!t) return;
  // Zoomed to the 160 ms before the sound, in decibels, so a faint key thump shows as a bump.
  const span = t.v1 - t.v0;
  const xOf = (i) => ((i - t.v0) / span) * c.width;
  const max = t.env.reduce((a, b) => Math.max(a, b), 1e-6);
  g.fillStyle = '#e5e7eb';
  for (let ms = 0; ms <= span * t.msPerHop; ms += 10) g.fillRect(xOf(t.v0 + ms / t.msPerHop), 0, 1, c.height);
  g.fillStyle = '#9aa0a6';
  for (let i = t.v0; i < t.v1; i++) {
    const db = 20 * Math.log10(Math.max(t.env[i], 1e-7) / max);
    const h = Math.min(1, Math.max(0, (db + 60) / 60)) * (c.height - 30);
    g.fillRect(xOf(i), c.height - h, Math.max(1, c.width / span), h);
  }
  const mark = (i, color, label, dashed) => {
    if (i < 0) return;
    const x = xOf(i);
    g.fillStyle = color;
    if (dashed) for (let y = 0; y < c.height; y += 12) g.fillRect(x - 1, y, 2, 6);
    else g.fillRect(x - 1, 0, 2, c.height);
    g.font = '22px system-ui';
    g.fillText(label, x + 6, 24);
  };
  mark(t.thump, '#2563eb', t.ms != null ? 'key' : 'key? (guess)', t.ms == null);
  mark(t.sound, '#c2410c', 'sound');
  g.fillStyle = '#1d1d1f';
  g.font = '22px system-ui';
  g.fillText(t.ms != null ? `${t.ms.toFixed(1)} ms (confirmed)` : 'click the key thump to confirm', c.width - 420, c.height - 10);
}

$('wave').addEventListener('click', (e) => {
  const r = e.target.getBoundingClientRect();
  lat.adjust((e.clientX - r.left) / r.width, e.shiftKey);
});

function band(ms) {
  if (ms <= 30) return ['good', 'good'];
  if (ms <= 50) return ['acceptable', 'warn'];
  if (ms <= 60) return ['marginal', 'warn'];
  return ['failing', 'bad'];
}

function renderLatTable() {
  const body = $('latTable').tBodies[0];
  body.innerHTML = lat.trials
    .map(
      (t, i) =>
        `<tr><td>${i + 1}</td><td>${t.tone}</td><td>${t.config}</td><td>${t.ms != null ? t.ms.toFixed(1) + ' ms' : t.auto != null ? `<span class="hint">guess ${t.auto.toFixed(1)}, unconfirmed</span>` : '–'}</td><td>${t.wait.toFixed(1)} ms</td></tr>`,
    )
    .reverse()
    .join('');
  const groups = {};
  for (const t of lat.trials)
    if (t.ms != null) (groups[`${t.tone} · ${t.config}`] ??= []).push(t.ms);
  $('latSummary').innerHTML = Object.entries(groups)
    .map(([k, v]) => {
      const mean = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
      const [word, cls] = band(mean);
      return `<div><b>${k}</b>: n=${v.length}, mean <b class="${cls}">${mean.toFixed(1)} ms (${word})</b>, sd ${sd.toFixed(1)}, range ${Math.min(...v).toFixed(1)}–${Math.max(...v).toFixed(1)}</div>`;
    })
    .join('');
}

// ---------- rendering ----------

function renderTones() {
  const groups = [...new Set(TONES.map((t) => t.genre))];
  $('tones').innerHTML = groups
    .map(
      (g) =>
        `<div class="genre">${g}</div>` +
        TONES.filter((t) => t.genre === g)
          .map(
            (
              t,
            ) => `<label class="tone ${t.id === state.selected ? 'sel' : ''}"><input type="radio" name="tone" value="${t.id}" ${t.id === state.selected ? 'checked' : ''}/>
            <span>${t.name}<br><small>${t.set}</small></span>
            <span class="st">${t.synth ? 'synth' : state.progress[t.id] ? state.progress[t.id] : state.cache.has(t.id) ? 'in memory' : 'not loaded'}</span></label>`,
          )
          .join(''),
    )
    .join('');
}
$('tones').addEventListener('change', (e) => {
  if (e.target.name === 'tone') selectTone(e.target.value);
});

function kv(el, rows) {
  const html = rows.map(([k, v]) => `<dt>${k}</dt><dd data-k="${k}">${v}</dd>`).join('');
  const prev = new Map([...el.querySelectorAll('dd')].map((d) => [d.dataset.k, d.innerHTML]));
  el.innerHTML = html;
  for (const d of el.querySelectorAll('dd')) {
    if (prev.has(d.dataset.k) && prev.get(d.dataset.k) !== d.innerHTML) {
      d.classList.add('changed');
      setTimeout(() => d.classList.remove('changed'), 350);
    }
  }
}

function renderMem() {
  const m = state.prepared?.mem;
  if (!m) {
    kv($('mem'), [['Selected', 'synthesised, so nothing to download or hold']]);
    return;
  }
  const over = m.stereoSeconds > 450;
  const name = noteName;
  const covers = m.range[0] <= BOARD[0] && m.range[1] >= BOARD[1];
  kv($('mem'), [
    [
      'Key range',
      `${name(m.range[0])}–${name(m.range[1])} <span class="${covers ? 'good' : 'bad'}">(${covers ? 'covers' : 'misses'} the C2–B6 board)</span>, keycentres ${name(m.keys[0])}–${name(m.keys[1])}`,
    ],
    ['Distinct samples', m.files],
    [
      'Audio held',
      `${m.stereoSeconds.toFixed(0)} s stereo-equivalent <span class="${over ? 'bad' : 'good'}">(${over ? 'over' : 'within'} the 450 s budget)</span>`,
    ],
    ['Decoded memory', `${m.decodedMB.toFixed(0)} MB at ${ctx.sampleRate / 1000} kHz`],
    ['Download as MP3 (est.)', `${m.mp3MiB.toFixed(1)} MiB`],
    ['Fetched here (FLAC/WAV, all layers)', `${m.rawMiB.toFixed(1)} MiB`],
    [
      'Load: fetch + decode wall time',
      `${(m.wallMs / 1000).toFixed(2)} s (decode calls summed ${(m.decodeMs / 1000).toFixed(2)} s)`,
    ],
    [
      'Main thread during load',
      `longest frame gap ${m.maxFrameGap.toFixed(0)} ms${m.longTasks != null ? `, ${m.longTasks} long tasks, longest ${m.longestTask.toFixed(0)} ms` : ''}`,
    ],
    ['Preparation (trim, cap, loop)', `${m.prepMs.toFixed(0)} ms on the main thread`],
    [
      'Leading silence in files',
      `avg ${m.leadAvg.toFixed(1)} ms, max ${m.leadMax.toFixed(1)} ms (trimmed)`,
    ],
  ]);
}

function noteName(x) {
  return (
    ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][x % 12] +
    (Math.floor(x / 12) - 1)
  );
}

function renderLive() {
  const s = player.stats();
  const n = player.lastNote;
  const name = noteName;
  const stretch = n?.keycentre != null ? n.stretch : null;
  const stretchCls =
    stretch == null ? '' : Math.abs(stretch) > 6 ? 'bad' : Math.abs(stretch) > 3 ? 'warn' : 'good';
  kv($('live'), [
    [
      'Tone',
      (state.ab
        ? '<b class="warn">Warm Analog (A/B)</b> instead of ' + currentDef().name
        : currentDef().name) +
        (state.loading ? ' <span class="warn">(loading, Warm Analog sounds meanwhile)</span>' : ''),
    ],
    ['Last note', n ? `${name(n.note)} (${n.note}), velocity ${n.velocity}` : '–'],
    [
      'Sample used',
      n?.silent
        ? '<span class="warn">none: past the source range, so silent</span>'
        : n?.file
          ? `${n.file}${n.layer ? `, layer ${n.layer}` : ''}`
          : '–',
    ],
    [
      'Stretch from keycentre',
      stretch == null
        ? '–'
        : `<span class="${stretchCls}">${stretch > 0 ? '+' : ''}${stretch} semitones</span> (keycentre ${name(n.keycentre)})`,
    ],
    ['Pedal', s.pedalDown ? '<b>down</b>' : 'up'],
    [
      'Pitch bend',
      `${s.bendCents > 0 ? '+' : ''}${s.bendCents.toFixed(0)} cents (range ±${player.bendRange})`,
    ],
    [
      'Voices',
      `${s.total} of ${s.max}: ${s.key} key-held, ${s.pedal} pedal-held, ${s.release} in release`,
    ],
    [
      'Steals',
      `${s.steals} (release ${s.stealsByState.release}, pedal ${s.stealsByState.pedal}, key ${s.stealsByState.key})`,
    ],
    ['Retriggers of a held note', s.retriggers],
    ['Notes played', s.notes],
    [
      'Level since selecting',
      `peak ${dbfs(state.level.peakHold)}, loudest 43 ms RMS ${dbfs(state.level.rmsHold)}`,
    ],
  ]);
  $('voiceBar').style.width = `${Math.min(100, (s.total / s.max) * 100)}%`;
}

function dbfs(x) {
  return x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : '–';
}

function renderInput() {
  kv($('input'), [
    [
      'Devices',
      midi.error
        ? `<span class="warn">${midi.error}</span>`
        : midi.inputs.length
          ? midi.inputs.map((i) => `${i.name} <small>(${i.state})</small>`).join('<br>')
          : '<span class="warn">no MIDI Device found</span>',
    ],
    ['Last MIDI message', midi.lastMsg || '–'],
    ['Computer-key octave', `C${state.octave / 12 - 1}`],
    [
      'Audio',
      ctx.state === 'running'
        ? '<span class="good">running</span>'
        : '<span class="warn">suspended: click anywhere to start</span>',
    ],
  ]);
}

function renderLat() {
  const o = ctx.getOutputTimestamp?.();
  const ahead = o?.performanceTime
    ? (ctx.currentTime - (o.contextTime + (performance.now() - o.performanceTime) / 1000)) * 1000
    : null;
  const stats = ctx.playbackStats;
  kv($('lat'), [
    ['Sample rate', `${ctx.sampleRate} Hz`],
    [
      'baseLatency / outputLatency',
      `${((ctx.baseLatency ?? 0) * 1000).toFixed(1)} ms / ${((ctx.outputLatency ?? 0) * 1000).toFixed(1)} ms`,
    ],
    ['Clock ahead of the speaker', ahead != null ? `${ahead.toFixed(1)} ms` : '–'],
    [
      'MIDI handler wait',
      `last ${state.handler.last.toFixed(1)} ms, max ${state.handler.max.toFixed(1)} ms`,
    ],
    ['Timestamp starts that arrived late', state.late],
    [
      'Underruns reported by Chrome',
      stats
        ? `${stats.underrunEvents ?? '?'} events, ${((stats.underrunDuration ?? 0) * 1000).toFixed(0)} ms`
        : 'not exposed: listen for crackle',
    ],
  ]);
}

let lastRender = 0;
const td = new Float32Array(2048);
function frame(now) {
  analyser.getFloatTimeDomainData(td);
  let peak = 0;
  let sum = 0;
  for (const v of td) {
    peak = Math.max(peak, Math.abs(v));
    sum += v * v;
  }
  const rms = Math.sqrt(sum / td.length);
  state.level.peakHold = Math.max(state.level.peakHold, peak);
  state.level.rmsHold = Math.max(state.level.rmsHold, rms);
  const bar = $('peakBar');
  bar.style.width = `${Math.min(100, peak * 100)}%`;
  bar.style.background = peak >= 1 ? 'var(--bad)' : 'var(--ok)';
  if (now - lastRender > 70) {
    lastRender = now;
    renderLive();
    renderInput();
    renderLat();
  }
  requestAnimationFrame(frame);
}

// ---------- controls ----------

$('attack').addEventListener('change', applyCurrentTone);

// --- level and reverb ---
$('trimDb').addEventListener('input', (e) => {
  const id = state.ab ? 'warm' : state.selected;
  state.trims[id] = Number(e.target.value);
  routeTone();
  $('trimDbOut').textContent = `${e.target.value} dB`;
  save();
  renderLoudness();
});
$('reverbMode').addEventListener('change', (e) => {
  state.reverb.mode = e.target.value;
  routeTone();
  syncControls();
  save();
});
$('reverb').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  if (state.reverb.mode === 'perTone') state.reverb.perTone[state.ab ? 'warm' : state.selected] = v;
  else state.reverb.shared = v;
  routeTone();
  $('reverbOut').textContent = v ? v.toFixed(2) : 'off';
  save();
});
$('reverbIr').addEventListener('change', (e) => {
  state.reverb.ir = Number(e.target.value);
  convolver.buffer = makeImpulse(state.reverb.ir);
  save();
});

function syncControls() {
  const id = state.ab ? 'warm' : state.selected;
  const t = state.trims[id] ?? 0;
  $('trimDb').value = t;
  $('trimDbOut').textContent = `${t} dB`;
  $('trimFor').textContent = state.ab ? 'Warm Analog' : currentDef().name;
  const r = state.reverb;
  $('reverbMode').value = r.mode;
  $('reverbIr').value = String(r.ir);
  const v = r.mode === 'perTone' ? (r.perTone[id] ?? 0) : r.shared;
  $('reverb').value = v;
  $('reverb').disabled = r.mode === 'off';
  $('reverbOut').textContent = r.mode === 'off' ? 'off' : v ? v.toFixed(2) : 'off';
  $('reverbFor').textContent =
    r.mode === 'perTone' ? `for ${state.ab ? 'Warm Analog' : currentDef().name}` : r.mode === 'shared' ? 'for every Tone' : '';
  $('ab').checked = state.ab;
  for (const el of document.querySelectorAll('[data-for]')) {
    el.classList.toggle('dim', !el.dataset.for.split(' ').includes(state.selected));
  }
  renderLoudness();
  renderGuitar();
  renderEdges();
  save();
}

// --- A/B against Warm Analog ---
function setAB(on) {
  if (state.ab === on) return;
  state.ab = on;
  player.allOff();
  player.setTone(on ? warmAnalog() : state.toneObj);
  routeTone();
  syncControls();
}
$('ab').addEventListener('change', (e) => setAB(e.target.checked));
addEventListener('keydown', (e) => {
  if (e.code === 'Backquote' && !e.repeat && !e.target.closest('input, select, textarea'))
    setAB(!state.ab);
});

// --- loudness ---
$('refVel').value = String(state.refVel);
$('refVel').addEventListener('change', (e) => {
  state.refVel = Number(e.target.value);
  save();
});
$('measure').addEventListener('click', measureAndRecord);
$('measureAll').addEventListener('click', measureAll);
$('applySuggested').addEventListener('click', () => {
  for (const t of TONES) {
    const s = suggestedTrim(t.id);
    if (s != null && t.id !== 'warm') state.trims[t.id] = s;
  }
  routeTone();
  syncControls();
});

function renderLoudness() {
  const ref = state.loudness.warm;
  const rows = TONES.filter((t) => t.id !== 'click').map((t) => {
    const m = state.loudness[t.id];
    const trim = state.trims[t.id] ?? 0;
    const sug = suggestedTrim(t.id);
    const peakAfter = m ? m.peak + trim + 20 * Math.log10(0.8) : null;
    return `<tr class="${t.id === state.selected ? 'sel' : ''}"><td>${t.name}</td><td>${m ? `${m.lufs.toFixed(1)} LUFS <small class="hint">v${m.vel}</small>` : '–'}</td><td>${sug != null && t.id !== 'warm' ? `${sug > 0 ? '+' : ''}${sug} dB` : t.id === 'warm' ? 'reference' : '–'}</td><td><b>${trim > 0 ? '+' : ''}${trim} dB</b></td><td>${m ? `<span class="${peakAfter > -1 ? 'bad' : peakAfter > -6 ? 'warn' : ''}">${peakAfter.toFixed(1)} dBFS</span>` : '–'}</td></tr>`;
  });
  $('loudTable').tBodies[0].innerHTML = rows.join('');
  $('loudRef').textContent = ref ? '' : 'Measure Warm Analog first: it is the reference.';
}

// --- board edges ---
const EDGE_NOTES = [
  [35, 'B1 (off the board)'],
  [36, 'C2'],
  [95, 'B6'],
  [96, 'C7 (off the board)'],
];
function renderEdges() {
  const marks = state.edges[state.selected] ?? {};
  $('edges').innerHTML = EDGE_NOTES.map(
    ([n, label]) =>
      `<span class="edge"><button data-play="${n}">▶ ${label}</button>${
        n >= BOARD[0] && n <= BOARD[1]
          ? `<label class="opt"><input type="checkbox" data-wrong="${n}" ${marks[n] === 'wrong' ? 'checked' : ''}/> sounds wrong</label>`
          : ''
      }</span>`,
  ).join('');
  const flagged = Object.entries(state.edges)
    .flatMap(([id, m]) =>
      Object.entries(m)
        .filter(([, v]) => v === 'wrong')
        .map(([n]) => `${TONES.find((t) => t.id === id)?.name} at ${noteName(Number(n))}`),
    )
    .join(', ');
  $('edgeFlags').textContent = flagged ? `Flagged: ${flagged}` : 'Nothing flagged yet.';
}
$('edges').addEventListener('click', (e) => {
  const n = Number(e.target.dataset?.play);
  if (!n) return;
  resumeAudio();
  const t = ctx.currentTime + 0.01;
  player.noteOn(n, state.refVel, t);
  player.noteOff(n, t + 1.5);
});
$('edges').addEventListener('change', (e) => {
  const n = e.target.dataset?.wrong;
  if (!n) return;
  const m = (state.edges[state.selected] ??= {});
  if (e.target.checked) m[n] = 'wrong';
  else delete m[n];
  renderEdges();
  save();
});

// --- guitar tilt ---
function renderGuitar() {
  $('tilt').value = state.guitar.tilt;
  $('tiltOut').textContent = `${state.guitar.tilt > 0 ? '+' : ''}${state.guitar.tilt} dB`;
  $('pivot').value = String(state.guitar.pivot);
  const sm = state.seam;
  $('seam').innerHTML = sm
    ? `Brightness (spectral centroid, loud layer): Distorted #2 ${sm.lowKeys.map(noteName).join(' ')} <b>${sm.lowCentroid.toFixed(0)} Hz</b>, baked Clean ${sm.highKeys.map(noteName).join(' ')} <b>${sm.highCentroid.toFixed(0)} Hz</b>. Seam level match ${sm.offsetDb > 0 ? '+' : ''}${sm.offsetDb.toFixed(1)} dB on the Clean side.`
    : 'Select Overdriven Guitar to load it.';
}
$('tilt').addEventListener('input', (e) => {
  state.guitar.tilt = Number(e.target.value);
  $('tiltOut').textContent = `${state.guitar.tilt > 0 ? '+' : ''}${state.guitar.tilt} dB`;
});
$('tilt').addEventListener('change', () => {
  save();
  rebakeGuitar();
});
$('pivot').addEventListener('change', (e) => {
  state.guitar.pivot = Number(e.target.value);
  save();
  rebakeGuitar();
});

// --- Villera Lead D fine-tuning ---
const VILLERA_KNOBS = [
  ['peak', 'Nasal peak', 'Hz', 1000, 3200, 50],
  ['peakDb', 'Peak gain', 'dB', 0, 18, 0.5],
  ['q', 'Peak Q', '', 0.8, 6, 0.1],
  ['peak2', 'Second formant', 'Hz', 2000, 4500, 50],
  ['peak2Db', 'Second formant gain (0 = off)', 'dB', 0, 12, 0.5],
  ['hp', 'High-pass', 'Hz', 100, 900, 10],
  ['lp', 'Low-pass', 'Hz', 4000, 18000, 250],
  ['square', 'Square level', '', 0, 0.8, 0.01],
  ['saw', 'Saw level', '', 0, 0.8, 0.01],
  ['vibCents', 'Vibrato depth', 'cents', 0, 40, 1],
  ['vibRate', 'Vibrato rate', 'Hz', 3, 8, 0.1],
  ['vibDelay', 'Vibrato delay', 's', 0, 0.6, 0.01],
  ['glide', 'Glide in', 's', 0, 0.12, 0.005],
  ['glideSemis', 'Glide from', 'semitones below', 0.25, 2, 0.25],
];
function villeraGet(k) {
  const v = state.villera;
  if (k === 'square') return v.waves[0][2];
  if (k === 'saw') return v.waves[1][2];
  return v[k];
}
function villeraSet(k, x) {
  const v = state.villera;
  if (k === 'square' || k === 'saw') {
    v.waves = v.waves.map((w, i) => (i === (k === 'square' ? 0 : 1) ? [w[0], w[1], x] : w));
  } else v[k] = x;
}
function renderVillera() {
  $('villera').innerHTML = VILLERA_KNOBS.map(
    ([k, label, unit, min, max, step]) =>
      `<label class="knob"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${villeraGet(k)}"/><output>${villeraGet(k)} ${unit}</output></label>`,
  ).join('');
}
$('villera').addEventListener('input', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  const x = Number(e.target.value);
  villeraSet(k, x);
  const knob = VILLERA_KNOBS.find((kn) => kn[0] === k);
  e.target.nextElementSibling.textContent = `${x} ${knob[2]}`;
  if (state.selected === 'villera') applyCurrentTone();
  save();
});
$('villeraReset').addEventListener('click', () => {
  state.villera = structuredClone(VILLERA_D);
  renderVillera();
  if (state.selected === 'villera') applyCurrentTone();
  save();
});

// --- Rock Organ options ---
const ORGAN_KNOBS = [
  ['lowCut', 'Low shelf at 250 Hz', 'dB', -12, 0, 0.5],
  ['presence', 'Presence at 2.5 kHz', 'dB', 0, 10, 0.5],
  ['perc', 'Percussion', '', 0, 1, 0.05],
  ['click', 'Key click', '', 0, 1, 0.05],
  ['drive', 'Drive (no rotary)', '', 0, 1, 0.05],
];
function renderOrgan() {
  const o = state.organ;
  $('organKnobs').innerHTML = ORGAN_KNOBS.map(
    ([k, label, unit, min, max, step]) =>
      `<label class="knob"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${o[k]}"/><output>${o[k]} ${unit}</output></label>`,
  ).join('');
  $('percHarm').value = String(o.percHarm);
  $('percDecay').value = String(o.percDecay);
  $('rotary').value = o.rotary;
  $('registration').value = o.registration;
}
function organChanged() {
  rebuildOrganChain();
  if (currentDef().organ) applyCurrentTone();
  save();
}
$('organKnobs').addEventListener('input', (e) => {
  const k = e.target.dataset.k;
  if (!k) return;
  state.organ[k] = Number(e.target.value);
  const knob = ORGAN_KNOBS.find((kn) => kn[0] === k);
  e.target.nextElementSibling.textContent = `${state.organ[k]} ${knob[2]}`;
});
$('organKnobs').addEventListener('change', organChanged);
for (const [id, num] of [
  ['percHarm', true],
  ['percDecay', true],
  ['rotary', false],
  ['registration', false],
]) {
  $(id).addEventListener('change', (e) => {
    state.organ[id] = num ? Number(e.target.value) : e.target.value;
    organChanged();
  });
}
$('organReset').addEventListener('click', () => {
  state.organ = { ...ORGAN_DEFAULT };
  renderOrgan();
  organChanged();
});

// --- export ---
$('copyExport').addEventListener('click', async () => {
  const text = JSON.stringify(decisions(), null, 1);
  $('export').value = text;
  try {
    await navigator.clipboard.writeText(text);
    $('copyState').textContent = 'copied';
  } catch {
    $('export').select();
    $('copyState').textContent = 'selected: press ⌘C';
  }
});

$('bendRange').addEventListener('change', (e) => (player.bendRange = Number(e.target.value)));
$('cap').addEventListener('change', (e) => (player.maxVoices = Number(e.target.value)));
$('panic').addEventListener('click', () => player.allOff());
$('resetCounters').addEventListener('click', () => {
  Object.assign(player.counters, {
    steals: 0,
    stealsByState: { release: 0, pedal: 0, key: 0 },
    retriggers: 0,
    notes: 0,
  });
  state.level = { peakHold: 0, rmsHold: 0 };
  state.handler.max = 0;
  state.late = 0;
});
$('hint').addEventListener('change', async (e) => {
  player.allOff();
  const wasArmed = lat.armed;
  await ctx.close();
  buildAudio(e.target.value);
  resumeAudio();
  if (wasArmed) {
    lat.blocks = [];
    await lat.attach(lat.stream);
  }
});
$('arm').addEventListener('click', () =>
  lat.arm().catch((err) => ($('armState').textContent = `Mic refused: ${err.message}`)),
);
$('clearLat').addEventListener('click', () => {
  lat.trials = [];
  lat.view = null;
  drawWave();
  renderLatTable();
});

buildAudio('interactive');
renderTones();
renderVillera();
renderOrgan();
syncControls();
initMidi();
requestAnimationFrame(frame);
