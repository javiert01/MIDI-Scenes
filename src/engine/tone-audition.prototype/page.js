// PROTOTYPE (#45), throwaway page shell around player.js: loading, sample
// preparation, MIDI, readouts and the acoustic latency test.
import { TonePlayer, sampledTone, warmAnalog, villeraLead, testClick, dbToGain, VILLERA_VARIANTS } from './player.js';

const $ = (id) => document.getElementById(id);

const TONES = [
  { id: 'warm', name: 'Warm Analog', genre: 'Default', synth: warmAnalog, set: "Today's Preview Synth. No download." },
  { id: 'piano', name: 'Grand Piano', genre: 'Classical', dir: 'piano', releaseTime: 0.35, velTrack: 0.45, set: 'Salamander Grand Piano V3 (CC BY 3.0)' },
  { id: 'strings', name: 'Strings', genre: 'Classical', dir: 'strings', releaseTime: 0.6, velTrack: 0.35, attack: 0.008, set: 'VSCO 2 CE, cello + violin sections (CC0)' },
  { id: 'guitar', name: 'Overdriven Guitar', genre: 'Rock', dir: 'guitar', releaseTime: 0.25, velTrack: 0.3, set: 'FSBS Distorted #2, drive baked in (CC0)' },
  { id: 'guitar-clean', name: 'Overdriven Guitar, B', genre: 'Rock', dir: 'guitar-clean', bus: 'drive', releaseTime: 0.25, velTrack: 0.5, set: 'FSBS Clean small + one shared drive (CC0)' },
  { id: 'organ', name: 'Rock Organ', genre: 'Rock', dir: 'organ', releaseTime: 0.08, velTrack: 0, set: 'FreePats Rock Organ Emulation (CC0)' },
  { id: 'accordion', name: 'Accordion', genre: 'Cumbia', dir: 'accordion', releaseTime: 0.13, velTrack: 0.4, attack: 0.03, set: 'FreePats Button Accordion HN (CC0)' },
  ...Object.entries(VILLERA_VARIANTS).map(([k, v]) => ({ id: `villera-${k}`, name: `Villera Lead ${k}`, genre: 'Cumbia', synth: () => villeraLead(k), set: v.label.slice(3) })),
  { id: 'click', name: 'Test click', genre: 'Latency test', synth: testClick, set: 'A 1 ms burst for the acoustic test' },
];

const state = {
  selected: 'warm',
  loading: null, // tone id being loaded
  cache: new Map(), // tone id -> { regions (raw), stats } ; holds only the selected sampled Tone
  prepared: null, // { toneId, regions, mem }
  trims: {}, // tone id -> dB
  progress: {}, // tone id -> text
  octave: 60,
  handler: { last: 0, max: 0 },
  late: 0,
  level: { peakHold: 0, rmsHold: 0 },
};

// ---------- audio graph ----------

let ctx, player, master, analyser, toneBus, toneInput, driveIn, reverbSend, convolver;

function buildAudio(hint) {
  const opts = hint === 'interactive' ? { latencyHint: 'interactive' } : { latencyHint: Number(hint) };
  ctx = new (window.AudioContext || window.webkitAudioContext)(opts);
  master = ctx.createGain();
  master.gain.value = 0.8;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  master.connect(analyser);
  analyser.connect(ctx.destination);

  toneBus = ctx.createGain();
  toneBus.connect(master);
  reverbSend = ctx.createGain();
  reverbSend.gain.value = Number($('reverb').value);
  convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(2.2);
  toneBus.connect(reverbSend);
  reverbSend.connect(convolver);
  convolver.connect(master);

  // Shared drive for the clean-guitar A/B: every voice goes through one amp, so chords intermodulate.
  driveIn = ctx.createGain();
  driveIn.gain.value = 5;
  const shaper = ctx.createWaveShaper();
  shaper.curve = driveCurve(3.2);
  shaper.oversample = '4x';
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 90;
  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 900;
  mid.Q.value = 0.8;
  mid.gain.value = 4;
  const cab = ctx.createBiquadFilter();
  cab.type = 'lowpass';
  cab.frequency.value = 4600;
  cab.Q.value = 0.9;
  const post = ctx.createGain();
  post.gain.value = 0.28;
  driveIn.connect(shaper);
  shaper.connect(hp);
  hp.connect(mid);
  mid.connect(cab);
  cab.connect(post);
  post.connect(toneBus);

  toneInput = ctx.createGain();
  player = new TonePlayer(ctx, toneInput, { maxVoices: Number($('cap').value), bendRange: Number($('bendRange').value) });
  routeTone();
  applyCurrentTone();
  window.__proto = { ctx, player, state }; // for poking at it from the console
}

function routeTone() {
  const def = TONES.find((t) => t.id === state.selected);
  toneInput.disconnect();
  toneInput.connect(def.bus === 'drive' ? driveIn : toneBus);
  toneBus.gain.value = dbToGain(state.trims[state.selected] ?? 0);
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
    for (let i = pre; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-6.9 * (i - pre)) / len);
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
  const map = await (await fetch(`./samples/${def.dir}/map.json`)).json();
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
      const res = await fetch(`./samples/${def.dir}/${encodeURIComponent(file)}`);
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
  const regions = map.regions.map((r) => ({ ...r, ...decoded.get(r.file) }));
  state.cache.set(def.id, { regions, notes: map.notes, stats: { files: files.length, bytes, wallMs, decodeMs, ...stalls } });
  state.progress[def.id] = `ready, ${(wallMs / 1000).toFixed(1)} s`;
  state.loading = null;
  renderTones();
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
    obs = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((e) => e.duration)));
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
      return { maxFrameGap: maxGap, longTasks: obs ? longTasks.length : null, longestTask: longTasks.length ? Math.max(...longTasks) : 0 };
    },
  };
}

const PIANO_LAYERS = { 1: ['v12'], 2: ['v8', 'v16'], 3: ['v4', 'v12', 'v16'], 4: ['v4', 'v8', 'v12', 'v16'] };

function applyCurrentTone() {
  const def = TONES.find((t) => t.id === state.selected);
  if (def.synth) {
    player.setTone(def.synth());
    state.prepared = { toneId: def.id, mem: null };
    renderMem();
    return;
  }
  const cached = state.cache.get(def.id);
  if (!cached) return;
  const p0 = performance.now();
  let regions = cached.regions;
  if (def.id === 'piano') {
    const active = PIANO_LAYERS[$('layers').value];
    regions = regions
      .filter((r) => active.includes(r.layer))
      .map((r) => {
        const i = active.indexOf(r.layer);
        return { ...r, vlo: Math.floor((i * 127) / active.length) + 1, vhi: Math.floor(((i + 1) * 127) / active.length) };
      });
  }
  const cap = Number($('tailCap').value);
  const trim = $('trim').checked;
  const bake = $('bakeLoop').checked && def.id === 'strings';
  const silences = [];
  const prepared = regions.map((r) => {
    const out = prepareBuffer(r, { cap, trim, bake });
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
  const mem = {
    files: seen.size,
    seconds,
    stereoSeconds,
    decodedMB: floatBytes / 1e6,
    mp3MiB: (stereoSeconds * 16000) / 2 ** 20,
    rawMiB: cached.stats.bytes / 2 ** 20,
    leadAvg: silences.reduce((a, b) => a + b, 0) / silences.length,
    leadMax: Math.max(...silences),
    prepMs,
    ...cached.stats,
  };
  state.prepared = { toneId: def.id, regions: prepared, mem };
  player.setTone(sampledTone({ id: def.id, regions: prepared, releaseTime: def.releaseTime, velTrack: def.velTrack, attack: Number($('attack').value) > (def.attack ?? 0) ? Number($('attack').value) : def.attack }));
  renderMem();
}

/** Trims leading silence, caps the tail with a fade, or bakes a crossfade loop. Returns a new region. */
function prepareBuffer(r, { cap, trim, bake }) {
  const src = r.buffer;
  const rate = src.sampleRate;
  const chans = [...Array(src.numberOfChannels)].map((_, c) => src.getChannelData(c));
  const thr = 0.004; // about -48 dBFS
  let onset = 0;
  outer: for (let i = 0; i < src.length; i++) for (const d of chans) if (Math.abs(d[i]) > thr) { onset = i; break outer; }
  const start = trim ? Math.max(0, onset - Math.floor(0.001 * rate)) : 0;
  const leadMs = (onset / rate) * 1000;

  let loop = null;
  let end = src.length;
  let fade = 0;
  let bakeAt = null;
  if (r.loop) {
    const toS = (f) => f / (r.fileRate || rate) - start / rate;
    loop = [toS(r.loop[0]), toS(r.loop[1])];
    end = Math.min(src.length, start + Math.ceil((loop[1] + 0.05) * rate));
  } else if (bake && src.duration > 4) {
    const a = Math.floor(1.5 * rate);
    const b = Math.floor((src.duration - 0.6) * rate);
    const xf = Math.min(Math.floor(0.5 * rate), Math.floor((b - a) / 3));
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
        o[b - xf + i - start] = d[b - xf + i] * Math.cos((t * Math.PI) / 2) + d[a - xf + i] * Math.sin((t * Math.PI) / 2);
      }
    }
    for (let i = 0; i < fade; i++) o[len - fade + i] *= 1 - i / fade;
  });
  return { region: { ...r, buffer: out, loop }, leadMs };
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
  else if (cmd === 14) player.bend(Math.max(-1, (((data[2] << 7) | data[1]) - 8192) / 8191), ctx.currentTime);
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
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    await this.attach(stream);
    this.stream = stream;
    this.armed = true;
    $('armState').textContent = 'Armed: strike one key sharply, about one per second';
  },

  async attach(stream) {
    const code = `class Rec extends AudioWorkletProcessor { process(inputs) { const ch = inputs[0][0]; if (ch) this.port.postMessage({ t: currentTime, d: ch.slice(0) }); return true; } } registerProcessor('rec', Rec);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const src = ctx.createMediaStreamSource(stream);
    const rec = new AudioWorkletNode(ctx, 'rec');
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(rec);
    rec.connect(mute);
    mute.connect(ctx.destination);
    rec.port.onmessage = (e) => {
      this.blocks.push(e.data);
      const keep = 3 * ctx.sampleRate / 128;
      if (this.blocks.length > keep) this.blocks.splice(0, this.blocks.length - keep);
    };
  },

  onStrike(when, wait) {
    if (!this.armed || this.pending) return;
    this.pending = { when, wait, tone: TONES.find((t) => t.id === state.selected).name, config: `${$('output').value} / ${$('hint').value} / ${$('sched').value}` };
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
    const sound = env.findIndex((v) => v >= 0.5 * max);
    const head = [...env.slice(0, Math.floor(60 / msPerHop))].sort((a, b) => a - b);
    const floor = head[Math.floor(head.length / 2)] || 1e-4;
    const thr = Math.max(floor * 6, 0.01 * max);
    let thump = -1;
    for (let i = Math.max(0, sound - Math.floor(250 / msPerHop)); i < sound - Math.floor(1 / msPerHop); i++) {
      if (env[i] > thr) { thump = i; break; }
    }
    const trial = { ...p, env, msPerHop, sound, thump, thr, ms: thump >= 0 ? (sound - thump) * msPerHop : null };
    this.trials.push(trial);
    this.view = trial;
    drawWave();
    renderLatTable();
  },

  /** Lets you correct a marker by clicking the waveform: click = key thump, shift-click = sound. */
  adjust(fraction, isSound) {
    const t = this.view;
    if (!t) return;
    const i = Math.round(fraction * t.env.length);
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
  const max = t.env.reduce((a, b) => Math.max(a, b), 1e-6);
  g.fillStyle = '#9aa0a6';
  for (let i = 0; i < t.env.length; i++) {
    const h = Math.sqrt(t.env[i] / max) * (c.height - 20);
    const x = (i / t.env.length) * c.width;
    g.fillRect(x, c.height - h, Math.max(1, c.width / t.env.length), h);
  }
  const mark = (i, color, label) => {
    if (i < 0) return;
    const x = (i / t.env.length) * c.width;
    g.fillStyle = color;
    g.fillRect(x - 1, 0, 2, c.height);
    g.font = '22px system-ui';
    g.fillText(label, x + 6, 24);
  };
  mark(t.thump, '#2563eb', 'key');
  mark(t.sound, '#c2410c', 'sound');
  g.fillStyle = '#1d1d1f';
  g.font = '22px system-ui';
  g.fillText(t.ms != null ? `${t.ms.toFixed(1)} ms` : 'no key thump found, click to place it', c.width - 360, c.height - 14);
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
    .map((t, i) => `<tr><td>${i + 1}</td><td>${t.tone}</td><td>${t.config}</td><td>${t.ms != null ? t.ms.toFixed(1) + ' ms' : '–'}</td><td>${t.wait.toFixed(1)} ms</td></tr>`)
    .reverse()
    .join('');
  const groups = {};
  for (const t of lat.trials) if (t.ms != null) (groups[`${t.tone} · ${t.config}`] ??= []).push(t.ms);
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
            (t) => `<label class="tone ${t.id === state.selected ? 'sel' : ''}"><input type="radio" name="tone" value="${t.id}" ${t.id === state.selected ? 'checked' : ''}/>
            <span>${t.name}<br><small>${t.set}</small></span>
            <span class="st">${t.synth ? 'synth' : state.cache.has(t.id) ? 'in memory' : state.progress[t.id] && state.loading === t.id ? state.progress[t.id] : 'not loaded'}</span></label>`,
          )
          .join(''),
    )
    .join('');
}
$('tones').addEventListener('change', (e) => selectTone(e.target.value));

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
  const over = m.stereoSeconds > 240;
  kv($('mem'), [
    ['Distinct samples', m.files],
    ['Audio held', `${m.stereoSeconds.toFixed(0)} s stereo-equivalent <span class="${over ? 'bad' : 'good'}">(${over ? 'over' : 'within'} the 240 s budget)</span>`],
    ['Decoded memory', `${m.decodedMB.toFixed(0)} MB at ${ctx.sampleRate / 1000} kHz`],
    ['Download as MP3 (est.)', `${m.mp3MiB.toFixed(1)} MiB`],
    ['Fetched here (FLAC/WAV, all layers)', `${m.rawMiB.toFixed(1)} MiB`],
    ['Load: fetch + decode wall time', `${(m.wallMs / 1000).toFixed(2)} s (decode calls summed ${(m.decodeMs / 1000).toFixed(2)} s)`],
    ['Main thread during load', `longest frame gap ${m.maxFrameGap.toFixed(0)} ms${m.longTasks != null ? `, ${m.longTasks} long tasks, longest ${m.longestTask.toFixed(0)} ms` : ''}`],
    ['Preparation (trim, cap, loop)', `${m.prepMs.toFixed(0)} ms on the main thread`],
    ['Leading silence in files', `avg ${m.leadAvg.toFixed(1)} ms, max ${m.leadMax.toFixed(1)} ms${$('trim').checked ? ' (trimmed)' : ' (NOT trimmed: adds to latency)'}`],
  ]);
}

function renderLive() {
  const s = player.stats();
  const n = player.lastNote;
  const name = (x) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][x % 12] + (Math.floor(x / 12) - 1);
  const stretch = n?.keycentre != null ? n.stretch : null;
  const stretchCls = stretch == null ? '' : Math.abs(stretch) > 6 ? 'bad' : Math.abs(stretch) > 3 ? 'warn' : 'good';
  kv($('live'), [
    ['Tone', TONES.find((t) => t.id === state.selected).name + (state.loading ? ' <span class="warn">(loading, Warm Analog sounds meanwhile)</span>' : '')],
    ['Last note', n ? `${name(n.note)} (${n.note}), velocity ${n.velocity}` : '–'],
    ['Sample used', n?.file ? `${n.file}${n.layer ? `, layer ${n.layer}` : ''}` : '–'],
    ['Stretch from keycentre', stretch == null ? '–' : `<span class="${stretchCls}">${stretch > 0 ? '+' : ''}${stretch} semitones</span> (keycentre ${name(n.keycentre)})`],
    ['Pedal', s.pedalDown ? '<b>down</b>' : 'up'],
    ['Pitch bend', `${s.bendCents > 0 ? '+' : ''}${s.bendCents.toFixed(0)} cents (range ±${player.bendRange})`],
    ['Voices', `${s.total} of ${s.max}: ${s.key} key-held, ${s.pedal} pedal-held, ${s.release} in release`],
    ['Steals', `${s.steals} (release ${s.stealsByState.release}, pedal ${s.stealsByState.pedal}, key ${s.stealsByState.key})`],
    ['Retriggers of a held note', s.retriggers],
    ['Notes played', s.notes],
    ['Level since selecting', `peak ${dbfs(state.level.peakHold)}, loudest 300 ms RMS ${dbfs(state.level.rmsHold)}`],
  ]);
  $('voiceBar').style.width = `${Math.min(100, (s.total / s.max) * 100)}%`;
}

function dbfs(x) {
  return x > 0 ? `${(20 * Math.log10(x)).toFixed(1)} dBFS` : '–';
}

function renderInput() {
  kv($('input'), [
    ['Devices', midi.error ? `<span class="warn">${midi.error}</span>` : midi.inputs.length ? midi.inputs.map((i) => `${i.name} <small>(${i.state})</small>`).join('<br>') : '<span class="warn">no MIDI Device found</span>'],
    ['Last MIDI message', midi.lastMsg || '–'],
    ['Computer-key octave', `C${state.octave / 12 - 1}`],
    ['Audio', ctx.state === 'running' ? '<span class="good">running</span>' : '<span class="warn">suspended: click anywhere to start</span>'],
  ]);
}

function renderLat() {
  const o = ctx.getOutputTimestamp?.();
  const ahead = o?.performanceTime ? (ctx.currentTime - (o.contextTime + (performance.now() - o.performanceTime) / 1000)) * 1000 : null;
  const stats = ctx.playbackStats;
  kv($('lat'), [
    ['Sample rate', `${ctx.sampleRate} Hz`],
    ['baseLatency / outputLatency', `${((ctx.baseLatency ?? 0) * 1000).toFixed(1)} ms / ${((ctx.outputLatency ?? 0) * 1000).toFixed(1)} ms`],
    ['Clock ahead of the speaker', ahead != null ? `${ahead.toFixed(1)} ms` : '–'],
    ['MIDI handler wait', `last ${state.handler.last.toFixed(1)} ms, max ${state.handler.max.toFixed(1)} ms`],
    ['Timestamp starts that arrived late', state.late],
    ['Underruns reported by Chrome', stats ? `${stats.underrunEvents ?? '?'} events, ${((stats.underrunDuration ?? 0) * 1000).toFixed(0)} ms` : 'not exposed: listen for crackle'],
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

for (const id of ['layers', 'tailCap', 'trim', 'bakeLoop', 'attack']) $(id).addEventListener('change', applyCurrentTone);
$('trimDb').addEventListener('input', (e) => {
  state.trims[state.selected] = Number(e.target.value);
  toneBus.gain.value = dbToGain(Number(e.target.value));
  $('trimDbOut').textContent = `${e.target.value} dB`;
});
$('tones').addEventListener('change', () => {
  const v = state.trims[state.selected] ?? 0;
  $('trimDb').value = v;
  $('trimDbOut').textContent = `${v} dB`;
});
$('reverb').addEventListener('input', (e) => {
  reverbSend.gain.value = Number(e.target.value);
  $('reverbOut').textContent = Number(e.target.value) ? e.target.value : 'off';
});
$('bendRange').addEventListener('change', (e) => (player.bendRange = Number(e.target.value)));
$('cap').addEventListener('change', (e) => (player.maxVoices = Number(e.target.value)));
$('panic').addEventListener('click', () => player.allOff());
$('resetCounters').addEventListener('click', () => {
  Object.assign(player.counters, { steals: 0, stealsByState: { release: 0, pedal: 0, key: 0 }, retriggers: 0, notes: 0 });
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
$('arm').addEventListener('click', () => lat.arm().catch((err) => ($('armState').textContent = `Mic refused: ${err.message}`)));
$('clearLat').addEventListener('click', () => {
  lat.trials = [];
  lat.view = null;
  drawWave();
  renderLatTable();
});

buildAudio('interactive');
renderTones();
initMidi();
requestAnimationFrame(frame);
