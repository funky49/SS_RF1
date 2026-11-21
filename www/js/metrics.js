/** DSP helpers + real-world loudness comparisons (relative, uncalibrated). */

const NOTE_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export const BANDS = [
  { name: "Sub-bass", min: 20, max: 60, color: "#6b5cff" },
  { name: "Bass", min: 60, max: 250, color: "#3d8bfd" },
  { name: "Low mid", min: 250, max: 500, color: "#2ec4b6" },
  { name: "Mid", min: 500, max: 2000, color: "#3ecf8e" },
  { name: "High mid", min: 2000, max: 4000, color: "#e8c547" },
  { name: "Presence", min: 4000, max: 6000, color: "#e8a54b" },
  { name: "Brilliance", min: 6000, max: 20000, color: "#e26d5a" },
];

/** Approximate dB SPL examples for relative orientation (not calibrated). */
const LOUDNESS_EXAMPLES = [
  { db: 20, label: "whisper / rustling leaves" },
  { db: 30, label: "quiet library" },
  { db: 40, label: "quiet home" },
  { db: 50, label: "refrigerator hum" },
  { db: 60, label: "normal conversation" },
  { db: 70, label: "vacuum cleaner" },
  { db: 80, label: "busy street / alarm clock" },
  { db: 85, label: "motorcycle (nearby)" },
  { db: 90, label: "lawnmower" },
  { db: 100, label: "subway / power tools" },
  { db: 110, label: "rock concert (front)" },
  { db: 120, label: "siren / thunderclap" },
];

export function compareLoudness(approxDb) {
  if (!Number.isFinite(approxDb)) return "—";
  let best = LOUDNESS_EXAMPLES[0];
  let bestDist = Infinity;
  for (const ex of LOUDNESS_EXAMPLES) {
    const d = Math.abs(ex.db - approxDb);
    if (d < bestDist) {
      bestDist = d;
      best = ex;
    }
  }
  return `~${best.db} dB · ${best.label}`;
}

export function rmsFromTime(timeBytes) {
  let sum = 0;
  for (let i = 0; i < timeBytes.length; i++) {
    const v = (timeBytes[i] - 128) / 128;
    sum += v * v;
  }
  return Math.sqrt(sum / timeBytes.length);
}

export function peakFromTime(timeBytes) {
  let peak = 0;
  for (let i = 0; i < timeBytes.length; i++) {
    const v = Math.abs((timeBytes[i] - 128) / 128);
    if (v > peak) peak = v;
  }
  return peak;
}

export function zcrFromTime(timeBytes) {
  let crosses = 0;
  let prev = timeBytes[0] - 128;
  for (let i = 1; i < timeBytes.length; i++) {
    const cur = timeBytes[i] - 128;
    if ((prev >= 0 && cur < 0) || (prev < 0 && cur >= 0)) crosses++;
    prev = cur;
  }
  return crosses / timeBytes.length;
}

export function spectralCentroid(freqBytes, sampleRate, fftSize) {
  const binHz = sampleRate / fftSize;
  let num = 0;
  let den = 0;
  for (let i = 0; i < freqBytes.length; i++) {
    const mag = freqBytes[i];
    num += mag * i * binHz;
    den += mag;
  }
  return den > 0 ? num / den : 0;
}

/** Autocorrelation pitch estimate (Hz). */
export function estimatePitch(timeBytes, sampleRate, minHz = 50, maxHz = 1500) {
  const n = timeBytes.length;
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = (timeBytes[i] - 128) / 128;

  const minLag = Math.floor(sampleRate / maxHz);
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / minHz));
  let bestLag = 0;
  let bestCorr = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let norm = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += buf[i] * buf[i + lag];
      norm += buf[i] * buf[i];
    }
    const c = norm > 0 ? corr / norm : 0;
    if (c > bestCorr) {
      bestCorr = c;
      bestLag = lag;
    }
  }

  if (bestCorr < 0.3 || bestLag === 0) return { hz: 0, confidence: bestCorr };
  return { hz: sampleRate / bestLag, confidence: bestCorr };
}

export function hzToNote(hz) {
  if (!hz || hz <= 0) return { name: "—", octave: "", cents: 0 };
  const midi = 69 + 12 * Math.log2(hz / 440);
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  const cents = Math.round((midi - rounded) * 100);
  return { name, octave, cents, midi: rounded };
}

/** Map relative RMS to approximate dB SPL-ish scale for UI (uncalibrated). */
export function relativeDb(rms) {
  if (rms <= 1e-8) return -80;
  // Assume full-scale ~94 dB-ish for phone mic ballpark; offset for display
  const dbfs = 20 * Math.log10(rms);
  return Math.max(-80, Math.min(120, dbfs + 94));
}

export function parseZoom(zoom) {
  const [a, b] = zoom.split("-").map(Number);
  return { minHz: a, maxHz: b };
}

export class PeakHold {
  constructor(decayPerSec = 0.35) {
    this.value = -Infinity;
    this.decayPerSec = decayPerSec;
    this.lastTs = performance.now();
  }

  update(v) {
    const now = performance.now();
    const dt = (now - this.lastTs) / 1000;
    this.lastTs = now;
    if (v > this.value) {
      this.value = v;
    } else if (Number.isFinite(this.value)) {
      this.value -= this.decayPerSec * dt * Math.max(1, Math.abs(this.value) * 0.05 + 1);
    }
    return this.value;
  }

  reset() {
    this.value = -Infinity;
  }
}

/** Simple onset-flux BPM estimator */
export class BpmTracker {
  constructor() {
    this.prev = null;
    this.onsets = [];
    this.tapTimes = [];
  }

  resetTaps() {
    this.tapTimes = [];
  }

  tap() {
    const t = performance.now();
    this.tapTimes.push(t);
    if (this.tapTimes.length > 12) this.tapTimes.shift();
    return this.tapBpm();
  }

  tapBpm() {
    if (this.tapTimes.length < 2) return 0;
    const intervals = [];
    for (let i = 1; i < this.tapTimes.length; i++) {
      intervals.push(this.tapTimes[i] - this.tapTimes[i - 1]);
    }
    const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (avg <= 0) return 0;
    return Math.round(60000 / avg);
  }

  feed(freqBytes) {
    let energy = 0;
    // Focus mid-high for onsets
    const start = Math.floor(freqBytes.length * 0.05);
    const end = Math.floor(freqBytes.length * 0.5);
    for (let i = start; i < end; i++) energy += freqBytes[i];
    energy /= end - start;

    if (this.prev != null) {
      const flux = Math.max(0, energy - this.prev);
      if (flux > 12) {
        const t = performance.now();
        if (!this.onsets.length || t - this.onsets[this.onsets.length - 1] > 180) {
          this.onsets.push(t);
          if (this.onsets.length > 24) this.onsets.shift();
        }
      }
    }
    this.prev = energy;
    return this.autoBpm();
  }

  autoBpm() {
    if (this.onsets.length < 4) return 0;
    const intervals = [];
    for (let i = 1; i < this.onsets.length; i++) {
      intervals.push(this.onsets[i] - this.onsets[i - 1]);
    }
    intervals.sort((a, b) => a - b);
    const mid = intervals[Math.floor(intervals.length / 2)];
    if (mid <= 0) return 0;
    let bpm = 60000 / mid;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return Math.round(bpm);
  }
}

export class DoseMeter {
  constructor() {
    this.running = false;
    this.startedAt = 0;
    this.elapsedMs = 0;
    this.lastTick = 0;
    this.weightedSum = 0;
    this.samples = 0;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTick = performance.now();
    if (!this.startedAt) this.startedAt = this.lastTick;
  }

  pause() {
    if (!this.running) return;
    this.running = false;
    this.elapsedMs += performance.now() - this.lastTick;
  }

  reset() {
    this.running = false;
    this.startedAt = 0;
    this.elapsedMs = 0;
    this.lastTick = 0;
    this.weightedSum = 0;
    this.samples = 0;
  }

  feed(approxDb) {
    if (!this.running) return this.summary(approxDb);
    const now = performance.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.elapsedMs += dt * 1000;
    // NIOSH-ish exchange: dose grows faster above 85
    const excess = Math.max(0, approxDb - 85);
    const weight = Math.pow(2, excess / 3);
    this.weightedSum += weight * dt;
    this.samples++;
    return this.summary(approxDb);
  }

  summary(approxDb) {
    const hours = this.elapsedMs / 3600000;
    // Rough % of 85 dB 8-hour dose
    const dosePct = Math.min(999, (this.weightedSum / (8 * 3600)) * 100);
    return {
      running: this.running,
      hours,
      dosePct,
      currentDb: approxDb,
      advice:
        approxDb >= 100
          ? "Very loud — limit exposure; use protection."
          : approxDb >= 85
            ? "Above ~85 dB — hearing protection recommended for long exposure."
            : "Below ~85 dB relative — still uncalibrated; take breaks.",
    };
  }
}
