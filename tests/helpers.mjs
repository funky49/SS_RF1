export const SR = 48000;

export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rand) {
  return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
}

export function noise(seconds, amp, seed = 1) {
  const r = rng(seed);
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * gauss(r);
  return out;
}

/** Sum of phase-continuous partials; `f(t)` may vary in time. */
export function tones(seconds, partials, freqOf = (t) => 1) {
  const n = Math.round(seconds * SR);
  const out = new Float32Array(n);
  const phase = partials.map(() => 0);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = freqOf(t);
    for (let p = 0; p < partials.length; p++) {
      const { hz, amp } = partials[p];
      phase[p] += (2 * Math.PI * hz * f) / SR;
      out[i] += amp * Math.sin(phase[p]);
    }
  }
  return out;
}

export function mix(...arrs) {
  const out = new Float32Array(arrs[0].length);
  for (const a of arrs) for (let i = 0; i < out.length; i++) out[i] += a[i];
  return out;
}

export function applyGain(x, gainOf) {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] * gainOf(i / SR);
  return out;
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
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Mimics AnalyserNode (fft 4096, Blackman, smoothing 0.7, dB output). */
export class AnalyserSim {
  constructor(fftSize = 4096, smoothing = 0.7) {
    this.n = fftSize;
    this.smoothing = smoothing;
    this.mag = new Float32Array(fftSize / 2);
    this.win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      this.win[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize) + 0.08 * Math.cos((4 * Math.PI * i) / fftSize);
    }
    this.binHz = SR / fftSize;
  }

  step(x, end) {
    const re = new Float32Array(this.n);
    const im = new Float32Array(this.n);
    const start = end - this.n;
    for (let i = 0; i < this.n; i++) re[i] = (start + i >= 0 ? x[start + i] : 0) * this.win[i];
    fft(re, im);
    for (let k = 0; k < this.mag.length; k++) {
      const m = Math.hypot(re[k], im[k]) / this.n;
      this.mag[k] = this.smoothing * this.mag[k] + (1 - this.smoothing) * m;
    }
  }

  /** Run several sub-frames up to `end`, return dB spectrum. */
  spectrum(x, end, frames = 6, hop = 800) {
    for (let f = frames - 1; f >= 0; f--) this.step(x, end - f * hop);
    const db = new Float32Array(this.mag.length);
    for (let k = 0; k < db.length; k++) db[k] = 20 * Math.log10(this.mag[k] + 1e-12);
    return db;
  }
}

export function rmsDb(x, end, len = 4096) {
  let s = 0;
  const start = Math.max(0, end - len);
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return 10 * Math.log10(s / Math.max(1, end - start) + 1e-12);
}

export function toBytes(x, from, to) {
  const out = new Uint8Array(to - from);
  for (let i = from; i < to; i++) out[i - from] = Math.max(0, Math.min(255, Math.round(x[i] * 128 + 128)));
  return out;
}
