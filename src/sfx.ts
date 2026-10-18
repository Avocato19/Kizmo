let context: AudioContext | null = null;
const MUTED_KEY = 'kizmo-sound-muted';

export const DING_MS = 320;
export const BUZZER_MS = 330;
export const FANFARE_MS = 750;

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const getContext = () => {
  if (!context) {
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;
    context = new AudioCtor();
  }
  if (context.state === 'suspended') void context.resume();
  return context;
};

export const isSoundMuted = () => {
  try { return localStorage.getItem(MUTED_KEY) === '1'; } catch { return false; }
};

export const setSoundMuted = (muted: boolean) => {
  try { muted ? localStorage.setItem(MUTED_KEY, '1') : localStorage.removeItem(MUTED_KEY); } catch { /* storage unavailable */ }
};

const ping = (start: number, frequency: number, duration: number, volume: number, type: OscillatorType = 'triangle') => {
  const ctx = getContext();
  if (!ctx) return;
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
};

export const playDing = (): Promise<void> => {
  if (isSoundMuted()) return Promise.resolve();
  const ctx = getContext();
  if (!ctx) return Promise.resolve();
  const now = ctx.currentTime;
  ping(now, 988, 0.12, 0.22);
  ping(now + 0.09, 1319, 0.22, 0.2);
  return wait(DING_MS);
};
export const playBuzzer = (): Promise<void> => {
  if (isSoundMuted()) return Promise.resolve();
  const ctx = getContext();
  if (!ctx) return Promise.resolve();
  const now = ctx.currentTime;

  // Main tone (triangle)
  const oscillator = ctx.createOscillator();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(280, now);
  oscillator.frequency.exponentialRampToValueAtTime(190, now + 0.28);

  // Soft body layer (sine, one octave lower)
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.setValueAtTime(140, now);
  sub.frequency.exponentialRampToValueAtTime(95, now + 0.28);

  // Low-pass filter to keep it mellow
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1200, now);
  filter.Q.setValueAtTime(0.7, now);

  // Envelope: louder peak, gentle attack and release
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.28, now + 0.04);
  gain.gain.setValueAtTime(0.28, now + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

  // Sub layer is quieter than the main tone
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.5, now);

  oscillator.connect(filter);
  sub.connect(subGain).connect(filter);
  filter.connect(gain).connect(ctx.destination);

  oscillator.start(now);
  sub.start(now);
  oscillator.stop(now + 0.34);
  sub.stop(now + 0.34);

  return wait(BUZZER_MS);
};

export const playFanfare = (): Promise<void> => {
  if (isSoundMuted()) return Promise.resolve();
  const ctx = getContext();
  if (!ctx) return Promise.resolve();
  const now = ctx.currentTime;
  [523, 659, 784, 1047].forEach((frequency, index) => {
    ping(now + index * 0.11, frequency, 0.22, 0.18);
  });
  ping(now + 0.44, 1568, 0.3, 0.1);
  ping(now + 0.44, 2093, 0.3, 0.07);
  return wait(FANFARE_MS);
};
