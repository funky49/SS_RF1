/** Frequency-resolution helpers for the GRAPH spectrum views (pure; no DOM / Web Audio). */

export const MIN_FFT = 4096;
export const MAX_FFT = 32768;
/** Bins the visible span should cover before the view looks blocky. */
export const TARGET_BINS = 128;
/** A larger FFT is kept until the smaller one would cover this many times the needed bins. */
const DOWNSIZE_HYSTERESIS = 1.25;

const SPECTRUM_MODES = new Set(["fft", "spectrogram", "waterfall", "circular"]);
const SCROLLING_MODES = new Set(["spectrogram", "waterfall"]);

export function binWidthHz(sampleRate, fftSize) {
  return sampleRate / fftSize;
}

export function binToHz(bin, sampleRate, fftSize) {
  return (bin * sampleRate) / fftSize;
}

export function hzToBin(hz, sampleRate, fftSize) {
  return (hz * fftSize) / sampleRate;
}

/**
 * Largest FFT allowed for a view. Long windows smear time (32768 samples ≈ 0.68 s at 48 kHz), so the
 * biggest size is reserved for views topping out in the bass range, and the scrolling views
 * (spectrogram, waterfall) stop at 16384 (≈ 0.34 s) to keep onsets readable.
 */
export function fftCapFor(mode, maxHz) {
  if (!SPECTRUM_MODES.has(mode)) return MIN_FFT;
  let cap = maxHz <= 300 ? MAX_FFT : maxHz <= 1200 ? 16384 : 8192;
  if (SCROLLING_MODES.has(mode)) cap = Math.min(cap, 16384);
  return cap;
}

/** Power-of-two fftSize giving the visible range about TARGET_BINS bins, within [MIN_FFT, cap]. */
export function chooseFftSize({ minHz, maxHz, sampleRate, mode = "fft", current = 0 }) {
  const cap = fftCapFor(mode, maxHz);
  const span = Math.max(1e-6, maxHz - minHz);
  const needed = (sampleRate * TARGET_BINS) / span;
  let size = MIN_FFT;
  while (size < needed && size < cap) size *= 2;
  if (current > size && current <= cap && needed > current / 2 / DOWNSIZE_HYSTERESIS) return current;
  return size;
}

/**
 * Resamples per-bin values onto `outLen` evenly spaced pixels covering [minHz, maxHz].
 * Pixels narrower than a bin get Catmull-Rom interpolation between bin centres (clamped to the
 * neighbouring values, so no overshoot); pixels spanning several bins take the max so narrow peaks
 * survive. Pixels outside the available bins are 0.
 */
export function resampleSpectrum(bins, binHz, minHz, maxHz, outLen, out = new Float32Array(outLen)) {
  const n = bins.length;
  const span = maxHz - minHz;
  const at = (i) => bins[i < 0 ? 0 : i >= n ? n - 1 : i];
  for (let x = 0; x < outLen; x++) {
    const b0 = (minHz + (x / outLen) * span) / binHz;
    const b1 = (minHz + ((x + 1) / outLen) * span) / binHz;
    if (b1 < 0 || b0 > n - 1) {
      out[x] = 0;
      continue;
    }
    if (b1 - b0 >= 1) {
      let m = -Infinity;
      const lo = Math.max(0, Math.ceil(b0));
      const hi = Math.min(n - 1, Math.floor(b1));
      for (let i = lo; i <= hi; i++) if (bins[i] > m) m = bins[i];
      out[x] = m === -Infinity ? at(Math.round((b0 + b1) / 2)) : m;
      continue;
    }
    const c = Math.min(n - 1, Math.max(0, (b0 + b1) / 2));
    const i = Math.floor(c);
    const t = c - i;
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const v =
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    const lo = Math.min(p1, p2);
    const hi = Math.max(p1, p2);
    out[x] = v < lo ? lo : v > hi ? hi : v;
  }
  return out;
}

/** Sub-bin peak position from a bin and its neighbours (parabolic fit on dB values). */
export function parabolicPeak(db, i) {
  const a = db[i - 1];
  const b = db[i];
  const c = db[i + 1];
  const denom = a - 2 * b + c;
  if (!(denom < 0) || !Number.isFinite(a) || !Number.isFinite(c)) return { bin: i, db: b };
  const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
  return { bin: i + delta, db: b - 0.25 * (a - c) * delta };
}

/**
 * Strongest spectral peaks (dB input) within [minHz, maxHz], each at least `minProminenceDb`
 * above the lowest point between it and the nearest higher bin on either side (searched up to
 * `searchBins`). Returns up to `maxPeaks` peaks sorted by frequency, with interpolated hz / db.
 */
export function findSpectrumPeaks(
  db,
  binHz,
  minHz,
  maxHz,
  { maxPeaks = 3, minDb = -80, minProminenceDb = 10, searchBins = 64 } = {}
) {
  const n = db.length;
  const lo = Math.max(1, Math.ceil(minHz / binHz));
  const hi = Math.min(n - 2, Math.floor(maxHz / binHz));
  const found = [];
  for (let i = lo; i <= hi; i++) {
    const b = db[i];
    if (!(b >= minDb) || !(b > db[i - 1]) || !(b >= db[i + 1])) continue;
    let leftMin = b;
    for (let k = i - 1; k >= 0 && i - k <= searchBins && !(db[k] > b); k--) leftMin = Math.min(leftMin, db[k]);
    let rightMin = b;
    for (let k = i + 1; k < n && k - i <= searchBins && !(db[k] > b); k++) rightMin = Math.min(rightMin, db[k]);
    const prominence = b - Math.max(leftMin, rightMin);
    if (prominence < minProminenceDb) continue;
    const p = parabolicPeak(db, i);
    found.push({ hz: p.bin * binHz, db: p.db, prominence });
  }
  found.sort((x, y) => y.db - x.db);
  return found.slice(0, maxPeaks).sort((x, y) => x.hz - y.hz);
}
