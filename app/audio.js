/**
 * Synthesized sound effects (Web Audio): no files to download. The audio context
 * starts on the first tap, as mobile browsers require.
 */
let context = null;
let master = null;
let noiseBuffer = null;
let enabled = true;

export function setSoundEnabled(on) {
  enabled = on;
}

/** Call from a user gesture (the app does on the first pointerdown). */
export function unlockAudio() {
  if (context) {
    if (context.state === 'suspended') context.resume();
    return;
  }
  const AudioContext = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContext) return;
  context = new AudioContext();
  master = context.createGain();
  master.gain.value = 0.22;
  const compressor = context.createDynamicsCompressor();
  master.connect(compressor).connect(context.destination);
  noiseBuffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function tone({ freq = 440, to = freq, type = 'sine', duration = 0.15, gain = 1, delay = 0, attack = 0.005 }) {
  const t = context.currentTime + delay;
  const osc = context.createOscillator();
  const env = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(env).connect(master);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise({ duration = 0.15, gain = 0.6, freq = 2000, to = freq, q = 1, delay = 0 }) {
  const t = context.currentTime + delay;
  const source = context.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (to !== freq) filter.frequency.exponentialRampToValueAtTime(to, t + duration);
  const env = context.createGain();
  env.gain.setValueAtTime(gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  source.connect(filter).connect(env).connect(master);
  source.start(t);
  source.stop(t + duration + 0.02);
}

const SOUNDS = {
  tap: () => tone({ freq: 1400, duration: 0.03, gain: 0.25, type: 'triangle' }),
  select: () => tone({ freq: 880, to: 1200, duration: 0.06, gain: 0.25, type: 'triangle' }),
  draw: () => noise({ duration: 0.14, gain: 0.35, freq: 3000, to: 6000, q: 0.8 }),
  land: () => {
    tone({ freq: 120, to: 60, duration: 0.18, gain: 0.8 });
    noise({ duration: 0.08, gain: 0.3, freq: 800 });
  },
  cast: () => {
    tone({ freq: 420, to: 880, duration: 0.25, gain: 0.35, type: 'triangle' });
    tone({ freq: 630, to: 1320, duration: 0.3, gain: 0.2, type: 'sine', delay: 0.04 });
  },
  enter: () => {
    tone({ freq: 160, to: 70, duration: 0.2, gain: 0.9 });
    noise({ duration: 0.1, gain: 0.25, freq: 600 });
  },
  attack: () => noise({ duration: 0.25, gain: 0.5, freq: 400, to: 2400, q: 0.7 }),
  hit: () => {
    noise({ duration: 0.12, gain: 0.7, freq: 1200, to: 300 });
    tone({ freq: 140, to: 60, duration: 0.15, gain: 0.6, type: 'square' });
  },
  die: () => {
    tone({ freq: 320, to: 50, duration: 0.45, gain: 0.35, type: 'sawtooth' });
    noise({ duration: 0.4, gain: 0.3, freq: 900, to: 150 });
  },
  burn: () => noise({ duration: 0.35, gain: 0.45, freq: 5000, to: 900, q: 2 }),
  gain: () => {
    tone({ freq: 660, duration: 0.18, gain: 0.3 });
    tone({ freq: 990, duration: 0.25, gain: 0.25, delay: 0.08 });
  },
  lose: () => tone({ freq: 300, to: 180, duration: 0.25, gain: 0.35, type: 'triangle' }),
  turn: () => {
    tone({ freq: 523, duration: 0.6, gain: 0.25 });
    tone({ freq: 784, duration: 0.7, gain: 0.18, delay: 0.05 });
  },
  victory: () => [523, 659, 784, 1046].forEach((freq, i) => tone({ freq, duration: 0.5, gain: 0.3, delay: i * 0.12, type: 'triangle' })),
  defeat: () => [392, 349, 311, 262].forEach((freq, i) => tone({ freq, duration: 0.55, gain: 0.3, delay: i * 0.16, type: 'triangle' })),
  reward: () => [784, 988, 1175].forEach((freq, i) => tone({ freq, duration: 0.35, gain: 0.22, delay: i * 0.07 })),
};

/** Plays a named sound if sound is on and the context has started. */
export function play(name) {
  if (!enabled || !context || context.state !== 'running') return;
  SOUNDS[name]?.();
}
