/* =========================================================
   ROOK & ROLL sound — all synthesised with Web Audio (no files).
   Songs:
   · menu   — kart-select bounce: bright major, slap bass, claps (128 bpm)
   · candy  — bubblegum pop: marimba + glockenspiel, bouncy bass (118 bpm)
   · spooky — cute haunted swing: pizzicato walking bass, organ, celesta (96 bpm, swung)
   · galaxy — rainbow-road synthwave: arps, pads, four-on-the-floor (124 bpm)
   ========================================================= */
let ctx = null, master, musicBus, sfxBus, verb, noiseBuf;
let musicOn = true, sfxOn = true, current = null, timer = null;

export function setMusic(on) { musicOn = on; if (musicBus) musicBus.gain.setTargetAtTime(on ? 0.36 : 0, ctx.currentTime, 0.1); }
export function setSfx(on) { sfxOn = on; if (sfxBus) sfxBus.gain.setTargetAtTime(on ? 0.7 : 0, ctx.currentTime, 0.05); }
export function unlock() { if (!ctx) init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }

function init() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);
  verb = ctx.createConvolver(); verb.buffer = impulse(2.0); verb.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = musicOn ? 0.36 : 0; musicBus.connect(master);
  sfxBus = ctx.createGain(); sfxBus.gain.value = sfxOn ? 0.7 : 0; sfxBus.connect(master);
  const ms = ctx.createGain(); ms.gain.value = 0.3; musicBus.connect(ms).connect(verb);
  const ss = ctx.createGain(); ss.gain.value = 0.12; sfxBus.connect(ss).connect(verb);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.suspend(); else ctx.resume(); });
}
function impulse(sec) {
  const n = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) { const ch = b.getChannelData(c); for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
  return b;
}
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- voices
function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}
function osc(type, f, t, dur, peak, out, { a = 0.005, detune = 0, glide = null, lp = null } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  env(g, t, a, peak, dur);
  let node = o;
  if (lp) { const f2 = ctx.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = lp; o.connect(f2); node = f2; }
  node.connect(g).connect(out);
  o.start(t); o.stop(t + a + dur + 0.05);
}
function bell(m, t, dur, peak, out, ratio = 3.5) {
  const c = ctx.createOscillator(), mo = ctx.createOscillator(), mg = ctx.createGain(), g = ctx.createGain();
  c.frequency.value = hz(m); mo.frequency.value = hz(m) * ratio;
  mg.gain.setValueAtTime(hz(m) * 2.2, t); mg.gain.exponentialRampToValueAtTime(1, t + dur);
  mo.connect(mg).connect(c.frequency);
  env(g, t, 0.003, peak, dur);
  c.connect(g).connect(out);
  c.start(t); mo.start(t); c.stop(t + dur + 0.1); mo.stop(t + dur + 0.1);
}
function marimba(m, t, peak, out = musicBus) { bell(m, t, 0.35, peak, out, 4); osc('sine', hz(m), t, 0.3, peak * 0.8, out); }
function noise(t, dur, peak, out, { type = 'highpass', f = 6000, q = 0.7, a = 0.002 } = {}) {
  const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf; fl.type = type; fl.frequency.value = f; fl.Q.value = q;
  env(g, t, a, peak, dur);
  s.connect(fl).connect(g).connect(out);
  s.start(t, Math.random()); s.stop(t + a + dur + 0.05);
}
function kick(t, peak = 0.8) { osc('sine', 130, t, 0.28, peak, musicBus, { glide: 40 }); }
function snare(t, peak = 0.3) { noise(t, 0.15, peak, musicBus, { type: 'bandpass', f: 1900, q: 0.8 }); osc('triangle', 200, t, 0.07, peak * 0.5, musicBus); }
function clap(t, peak = 0.25) { for (let j = 0; j < 3; j++) noise(t + j * 0.012, 0.09, peak, musicBus, { type: 'bandpass', f: 1400, q: 1.2 }); }
function hat(t, peak = 0.08) { noise(t, 0.035, peak, musicBus, { f: 8000 }); }
function pad(ms, t, dur, peak, type = 'sawtooth', lp = 1000) {
  for (const m of ms) for (const d of [-8, 8]) osc(type, hz(m), t, dur, peak, musicBus, { a: dur * 0.3, detune: d, lp });
}
function organ(ms, t, dur, peak) { for (const m of ms) { osc('sine', hz(m), t, dur, peak, musicBus, { a: 0.02 }); osc('sine', hz(m + 12), t, dur, peak * 0.5, musicBus, { a: 0.02 }); osc('sine', hz(m + 19), t, dur, peak * 0.25, musicBus, { a: 0.02 }); } }

// ---------------------------------------------------------------- songs (step = one 16th)
const SONGS = {
  menu: {
    bpm: 128,
    step(i, t, s) {
      const k = i % 16, bar = Math.floor(i / 16) % 4;
      const roots = [48, 53, 55, 53], chords = [[60, 64, 67], [60, 65, 69], [59, 62, 67], [60, 65, 69]];
      if (k === 0 || k === 8) kick(t, 0.6);
      if (k === 4 || k === 12) clap(t, 0.2);
      if (k % 2 === 1) hat(t, 0.05);
      if ([0, 3, 6, 8, 11, 14].includes(k)) osc('square', hz(roots[bar] - 12 + (k === 11 ? 7 : k === 14 ? 12 : 0)), t, s * 1.6, 0.12, musicBus, { lp: 700 });
      if (k === 2 || k === 10) pad(chords[bar], t, s * 3, 0.016, 'square', 1800);
      const mel = [[72, 0, 76, 79, 0, 76, 74, 72], [77, 0, 76, 74, 0, 72, 74, 76], [74, 0, 79, 77, 76, 74, 71, 74], [72, 76, 79, 84, 0, 79, 81, 84]][bar];
      if (k % 2 === 0 && mel[k / 2]) osc('triangle', hz(mel[k / 2]), t, s * 1.6, 0.09, musicBus);
    },
  },
  candy: {
    bpm: 118,
    step(i, t, s) {
      const k = i % 16, bar = Math.floor(i / 16) % 8;
      const prog = [[53, 57, 60, 64], [55, 59, 62, 65], [52, 55, 59, 64], [57, 60, 64, 67], [50, 53, 57, 60], [55, 59, 62, 67], [53, 57, 60, 64], [55, 59, 62, 65]][bar];
      if (k === 0 || k === 10) kick(t, 0.55);
      if (k === 4 || k === 12) snare(t, 0.18);
      if (k % 2 === 0) hat(t, k % 4 ? 0.035 : 0.06);
      if (k === 0) pad(prog, t, s * 14, 0.012, 'triangle', 2400);
      if ([0, 6, 8, 14].includes(k)) osc('sine', hz(prog[0] - 12), t, s * 1.8, 0.28, musicBus);
      if (k % 2 === 0) { const arp = [prog[0] + 12, prog[1] + 12, prog[2] + 12, prog[3] + 12]; marimba(arp[(k / 2) % 4], t, 0.06); }
      const glock = [[84, 0, 0, 81, 0, 79, 0, 0], [83, 0, 79, 0, 81, 0, 0, 0], [84, 0, 0, 86, 0, 84, 81, 0], [79, 0, 0, 0, 76, 0, 79, 0]][bar % 4];
      if (k % 2 === 0 && glock[k / 2] && bar >= 2) bell(glock[k / 2], t, 0.9, 0.05, musicBus, 3.5);
    },
  },
  spooky: {
    bpm: 96,
    step(i, t, s) {
      const k = i % 16, bar = Math.floor(i / 16) % 4;
      const sw = (k % 4 === 2) ? s * 0.33 : 0;       // swing the off-beats
      const roots = [45, 41, 43, 40], chords = [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 56, 59]];
      if (k % 4 === 0) osc('triangle', hz(roots[bar] - 12 + [0, 3, 7, 10][k / 4]), t, s * 2, 0.22, musicBus, { lp: 900 });
      if (k === 0 || k === 8) kick(t, 0.45);
      if (k === 4 || k === 12) noise(t, 0.08, 0.1, musicBus, { type: 'bandpass', f: 2500, q: 2 });
      if (k % 4 === 2) hat(t + sw, 0.05);
      if (k === 0) organ(chords[bar], t, s * 7, 0.025);
      if (k === 8) organ(chords[bar], t, s * 6, 0.02);
      const cel = [[81, 0, 84, 83, 81, 0, 76, 0], [77, 0, 81, 0, 84, 83, 81, 0], [79, 0, 83, 0, 86, 0, 83, 79], [80, 0, 83, 0, 88, 86, 83, 80]][bar];
      if (k % 2 === 0 && cel[k / 2]) bell(cel[k / 2], t + (k % 4 === 2 ? sw : 0), 0.8, 0.045, musicBus, 5);
      if (k === 14 && bar === 3) osc('sine', 900, t, 0.6, 0.03, musicBus, { glide: 500 });
    },
  },
  galaxy: {
    bpm: 124,
    step(i, t, s) {
      const k = i % 16, bar = Math.floor(i / 16) % 4;
      const prog = [[57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 66], [52, 55, 59, 62]][bar];
      if (k % 4 === 0) kick(t, 0.7);
      if (k === 4 || k === 12) clap(t, 0.18);
      if (k % 2 === 1) hat(t, 0.05);
      osc('sawtooth', hz(prog[0] - 24 + (k % 2 ? 12 : 0)), t, s * 0.9, 0.08, musicBus, { lp: 600 });
      if (k === 0) pad(prog, t, s * 15, 0.014, 'sawtooth', 1400);
      const arp = [prog[0], prog[1], prog[2], prog[3], prog[2] + 12, prog[3], prog[1] + 12, prog[2]];
      osc('square', hz(arp[k % 8] + 12), t, s * 0.8, 0.035, musicBus, { lp: 2600 });
      const lead = [[76, 0, 0, 79, 0, 0, 81, 0], [77, 0, 0, 76, 0, 0, 72, 0], [74, 0, 0, 79, 0, 81, 0, 83], [79, 0, 76, 0, 74, 0, 71, 0]][bar];
      if (i >= 64 && k % 2 === 0 && lead[k / 2]) osc('triangle', hz(lead[k / 2]), t, s * 2.5, 0.08, musicBus);
    },
  },
};

export function music(name) {
  if (!ctx) init();
  if (!ctx || current === name) return;
  stopMusic();
  current = name;
  const song = SONGS[name]; if (!song) return;
  const s = 60 / song.bpm / 4;
  let i = 0, next = ctx.currentTime + 0.1;
  timer = setInterval(() => { while (next < ctx.currentTime + 0.18) { song.step(i++, next, s); next += s; } }, 50);
}
export function stopMusic() { if (timer) clearInterval(timer); timer = null; current = null; }
export function duck(on) { if (musicBus && musicOn) musicBus.gain.setTargetAtTime(on ? 0.12 : 0.36, ctx.currentTime, 0.15); }

export function voice(pitch = 1) {
  if (!ctx) init();
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02, n = 3 + Math.floor(Math.random() * 3);
  for (let j = 0; j < n; j++) {
    const t = t0 + j * 0.07, f = 300 * pitch * (0.9 + Math.random() * 0.45) * (j === n - 1 ? 1.3 : 1);
    osc('triangle', f, t, 0.055, 0.08, sfxBus, { glide: f * (0.85 + Math.random() * 0.3) });
    noise(t, 0.035, 0.025, sfxBus, { type: 'bandpass', f: 1400 * pitch + Math.random() * 900, q: 4 });
  }
}

// ---------------------------------------------------------------- effects
export function sfx(name, pitch = 1) {
  if (!ctx) init();
  if (!ctx) return;
  const t = ctx.currentTime + 0.005, o = sfxBus;
  switch (name) {
    case 'hop': osc('sine', 260 * pitch, t, 0.12, 0.16, o, { glide: 520 * pitch }); break;
    case 'land': osc('sine', 140, t, 0.08, 0.14, o, { glide: 70 }); break;
    case 'select': osc('triangle', 660, t, 0.06, 0.1, o, { glide: 990 }); break;
    case 'deselect': osc('triangle', 700, t, 0.06, 0.07, o, { glide: 450 }); break;
    case 'bonk': osc('square', 520, t, 0.12, 0.12, o, { glide: 140, lp: 1800 }); bell(91, t + 0.02, 0.3, 0.08, o, 1.4); noise(t, 0.1, 0.18, o, { type: 'bandpass', f: 1500 }); break;
    case 'box': for (let j = 0; j < 5; j++) noise(t + j * 0.02, 0.06, 0.12, o, { type: 'bandpass', f: 3000 + j * 900, q: 3 }); bell(88, t, 0.3, 0.08, o, 2); break;
    case 'tick': osc('square', 1400 + Math.random() * 400, t, 0.03, 0.05, o, { lp: 4000 }); break;
    case 'got': [79, 84, 88, 91].forEach((m, j) => bell(m, t + j * 0.05, 0.5, 0.09, o, 2)); break;
    case 'spawn': osc('sine', 500, t, 0.25, 0.08, o, { glide: 1200 }); bell(96, t + 0.1, 0.3, 0.04, o, 2); break;
    case 'shield': osc('sine', 300, t, 0.5, 0.15, o, { glide: 900 }); noise(t, 0.4, 0.05, o, { type: 'bandpass', f: 2500, q: 2, a: 0.1 }); break;
    case 'pop': osc('sine', 900, t, 0.06, 0.2, o, { glide: 300 }); break;
    case 'freeze': for (let j = 0; j < 6; j++) bell(96 - j * 2, t + j * 0.04, 0.4, 0.05, o, 7); noise(t, 0.5, 0.08, o, { f: 6000, a: 0.05 }); break;
    case 'melt': osc('sine', 600, t, 0.4, 0.08, o, { glide: 200 }); noise(t, 0.3, 0.05, o, { type: 'lowpass', f: 1500 }); break;
    case 'throw': noise(t, 0.4, 0.12, o, { type: 'bandpass', f: 900, q: 1, a: 0.1 }); break;
    case 'fuse': noise(t, 0.6, 0.1, o, { f: 5000, a: 0.02 }); break;
    case 'boom': osc('sine', 110, t, 0.8, 0.9, o, { glide: 30 }); noise(t, 0.9, 0.5, o, { type: 'lowpass', f: 900, a: 0.005 }); break;
    case 'warp': osc('sine', 200, t, 0.9, 0.14, o, { glide: 1600 }); osc('sine', 1600, t + 0.45, 0.6, 0.1, o, { glide: 300 }); break;
    case 'zap': noise(t, 0.25, 0.25, o, { f: 3000 }); osc('sawtooth', 1200, t, 0.25, 0.08, o, { glide: 200, lp: 3000 }); break;
    case 'dash': noise(t, 0.25, 0.2, o, { type: 'bandpass', f: 1200, q: 0.6, a: 0.02 }); osc('sawtooth', 180, t, 0.3, 0.07, o, { glide: 700, lp: 1500 }); break;
    case 'promote': [72, 76, 79, 84, 88, 91].forEach((m, j) => bell(m, t + j * 0.06, 0.5, 0.08, o, 2)); break;
    case 'check': osc('square', 880, t, 0.09, 0.08, o, { lp: 3000 }); osc('square', 1175, t + 0.11, 0.12, 0.08, o, { lp: 3000 }); break;
    case 'mate': [67, 64, 60, 55, 48].forEach((m, j) => osc('triangle', hz(m), t + j * 0.12, 0.3, 0.14, o)); break;
    case 'win': [[60, 0], [64, 0.1], [67, 0.2], [72, 0.3], [76, 0.45], [79, 0.55], [84, 0.7]].forEach(([m, d]) => { osc('square', hz(m), t + d, 0.25, 0.07, o, { lp: 2600 }); bell(m + 12, t + d, 0.5, 0.05, o, 2); }); break;
    case 'lose': [67, 66, 65, 64].forEach((m, j) => osc('triangle', hz(m), t + j * 0.28, 0.45, 0.14, o, { glide: hz(m - 0.5) })); break;
    case 'draw': [72, 67, 72].forEach((m, j) => bell(m, t + j * 0.18, 0.6, 0.08, o, 2)); break;
    case 'click': osc('triangle', 900, t, 0.04, 0.08, o); break;
    case 'error': osc('square', 160, t, 0.2, 0.1, o, { lp: 900 }); osc('square', 150, t, 0.2, 0.1, o, { lp: 900 }); break;
    case 'go': [72, 79].forEach((m, j) => osc('square', hz(m), t + j * 0.5, 0.35, 0.09, o, { lp: 2400 })); osc('square', hz(84), t + 1.0, 0.6, 0.1, o, { lp: 3000 }); break;
    case 'count': osc('square', hz(72), t, 0.3, 0.09, o, { lp: 2400 }); break;
  }
}
