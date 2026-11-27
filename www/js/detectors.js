/**
 * Sound-pattern detectors (mosquito wingbeat, approaching aircraft).
 *
 * Everything here is pure DSP / state machines with no DOM or Web Audio
 * dependency so it can be unit-tested under node. Spectra are expected in dB
 * (AnalyserNode.getFloatFrequencyData style); time data as float samples.
 *
 * These are heuristics. They spot sound *patterns*; they do not identify
 * anything reliably.
 */

export const FLOOR_DB = -140;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);
const fin = (v) => (Number.isFinite(v) ? v : FLOOR_DB);

export function median(values) {
  if (!values.length) return 0;
  const a = Array.from(values).sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function linearTrend(t, v) {
  const n = Math.min(t.length, v.length);
  if (n < 3) return { slope: 0, intercept: n ? v[0] : 0, r2: 0, resStd: 0, n };
  let mt = 0;
  let mv = 0;
  for (let i = 0; i < n; i++) {
    mt += t[i];
    mv += v[i];
  }
  mt /= n;
  mv /= n;
  let stt = 0;
  let stv = 0;
  let svv = 0;
  for (let i = 0; i < n; i++) {
    const dt = t[i] - mt;
    const dv = v[i] - mv;
    stt += dt * dt;
    stv += dt * dv;
    svv += dv * dv;
  }
  const slope = stt > 0 ? stv / stt : 0;
  const intercept = mv - slope * mt;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const r = v[i] - (intercept + slope * t[i]);
    ss += r * r;
  }
  return {
    slope,
    intercept,
    r2: svv > 0 ? clamp01(1 - ss / svv) : 0,
    resStd: Math.sqrt(ss / n),
    n,
  };
}

/* ------------------------------------------------------------------ */
/* Spectrum helpers                                                    */
/* ------------------------------------------------------------------ */

function binLimits(n, binHz, fMin, fMax) {
  return {
    lo: Math.max(1, Math.ceil(fMin / binHz)),
    hi: Math.min(n - 2, Math.floor(fMax / binHz)),
  };
}

/** Median of dB values around bin `i` (±spanBins), skipping ±skipBins. */
export function localFloorDb(db, i, spanBins, skipBins = 3) {
  const vals = [];
  const lo = Math.max(0, i - spanBins);
  const hi = Math.min(db.length - 1, i + spanBins);
  for (let k = lo; k <= hi; k++) {
    if (Math.abs(k - i) <= skipBins) continue;
    vals.push(fin(db[k]));
  }
  return vals.length ? median(vals) : FLOOR_DB;
}

/** Local maxima with parabolic interpolation, prominence over local floor, and -6 dB width. */
export function findPeaks(db, binHz, fMin, fMax, { minProminenceDb = 6, floorSpanHz = 200 } = {}) {
  const { lo, hi } = binLimits(db.length, binHz, fMin, fMax);
  const span = Math.max(6, Math.round(floorSpanHz / binHz));
  const out = [];
  for (let i = lo; i <= hi; i++) {
    const b = fin(db[i]);
    const a = fin(db[i - 1]);
    const c = fin(db[i + 1]);
    if (!(b > a && b >= c)) continue;
    const denom = a - 2 * b + c;
    const delta = denom < 0 ? clamp((0.5 * (a - c)) / denom, -0.5, 0.5) : 0;
    const peakDb = b - 0.25 * (a - c) * delta;
    const prominenceDb = peakDb - localFloorDb(db, i, span);
    if (prominenceDb < minProminenceDb) continue;
    let w = 1;
    for (let k = i - 1; k >= 0 && fin(db[k]) >= b - 6 && i - k < 24; k--) w++;
    for (let k = i + 1; k < db.length && fin(db[k]) >= b - 6 && k - i < 24; k++) w++;
    out.push({
      hz: (i + delta) * binHz,
      bin: i,
      db: peakDb,
      prominenceDb,
      widthBins: w,
      widthHz: w * binHz,
    });
  }
  out.sort((x, y) => y.db - x.db);
  return out;
}

/** Strongest interpolated peak in a band regardless of prominence. */
export function dominantPeak(db, binHz, fMin, fMax) {
  const { lo, hi } = binLimits(db.length, binHz, fMin, fMax);
  let bi = -1;
  let bv = -Infinity;
  for (let i = lo; i <= hi; i++) {
    const v = fin(db[i]);
    if (v > bv) {
      bv = v;
      bi = i;
    }
  }
  if (bi < 0) return null;
  const a = fin(db[bi - 1]);
  const c = fin(db[bi + 1]);
  const denom = a - 2 * bv + c;
  const delta = denom < 0 ? clamp((0.5 * (a - c)) / denom, -0.5, 0.5) : 0;
  return { hz: (bi + delta) * binHz, db: bv - 0.25 * (a - c) * delta };
}

export function bandPowerRatio(db, binHz, lo1, hi1, lo2, hi2) {
  const p = (fa, fb) => {
    const { lo, hi } = binLimits(db.length, binHz, fa, fb);
    let s = 0;
    for (let i = lo; i <= hi; i++) s += Math.pow(10, fin(db[i]) / 10);
    return s;
  };
  const total = p(lo2, hi2);
  return total > 0 ? clamp01(p(lo1, hi1) / total) : 0;
}

/** Total power (dB, relative) in a band of a dB spectrum — keeps dynamic range below the 8-bit time-domain floor. */
export function bandLevelDb(db, binHz, fMin, fMax) {
  const { lo, hi } = binLimits(db.length, binHz, fMin, fMax);
  let s = 0;
  for (let i = lo; i <= hi; i++) s += Math.pow(10, fin(db[i]) / 10);
  return 10 * Math.log10(s + 1e-14);
}

/* ------------------------------------------------------------------ */
/* Mosquito                                                            */
/* ------------------------------------------------------------------ */

export const MOSQUITO_BAND = { min: 300, max: 900 };

function harmonicAt(db, binHz, target, floorSpanHz = 250) {
  const n = db.length;
  if (target + binHz * 2 >= (n - 1) * binHz) return { present: false, snrDb: 0, hz: target };
  const tol = Math.max(2 * binHz, 0.03 * target);
  const lo = Math.max(1, Math.floor((target - tol) / binHz));
  const hi = Math.min(n - 2, Math.ceil((target + tol) / binHz));
  let bi = lo;
  for (let i = lo; i <= hi; i++) if (fin(db[i]) > fin(db[bi])) bi = i;
  const floor = localFloorDb(db, bi, Math.round(floorSpanHz / binHz));
  const snr = fin(db[bi]) - floor;
  return { present: snr >= 6, snrDb: snr, hz: bi * binHz };
}

/**
 * True when the low band looks like a 50/60 Hz mains hum comb (fan, transformer,
 * charger). Bins are ~12 Hz wide, so compare against a low percentile of the
 * 30-1000 Hz spectrum instead of a local median.
 */
export function looksLikeMainsHum(db, binHz) {
  const { lo, hi } = binLimits(db.length, binHz, 30, 1000);
  const vals = [];
  for (let i = lo; i <= hi; i++) vals.push(fin(db[i]));
  if (vals.length < 8) return false;
  vals.sort((a, b) => a - b);
  const floor = vals[Math.floor(vals.length * 0.2)];
  for (const base of [50, 60]) {
    let hits = 0;
    for (let k = 1; k <= 7; k++) {
      const f = base * k;
      const c = Math.round(f / binHz);
      let m = -Infinity;
      for (let i = Math.max(0, c - 1); i <= Math.min(db.length - 1, c + 1); i++) m = Math.max(m, fin(db[i]));
      if (m - floor >= 15) hits++;
    }
    if (hits >= 5) return true;
  }
  return false;
}

export function analyzeMosquito(db, binHz) {
  const peaks = findPeaks(db, binHz, MOSQUITO_BAND.min, MOSQUITO_BAND.max, {
    minProminenceDb: 8,
    floorSpanHz: 250,
  });
  if (!peaks.length) {
    return { found: false, hz: 0, snrDb: 0, widthHz: 0, harmonics: [], harmCount: 0, mains: false };
  }
  const best = peaks.reduce((m, p) => (p.prominenceDb > m.prominenceDb ? p : m), peaks[0]);
  const harmonics = [2, 3].map((k) => ({ k, ...harmonicAt(db, binHz, best.hz * k) }));
  return {
    found: true,
    hz: best.hz,
    snrDb: best.prominenceDb,
    widthHz: best.widthHz,
    harmonics,
    harmCount: harmonics.filter((h) => h.present).length,
    mains: looksLikeMainsHum(db, binHz),
  };
}

/**
 * Needs a candidate peak that stays (within ±driftHz) for ~windowSec, is well
 * above the local floor, is narrow, and ideally shows 2x / 3x harmonics.
 */
export class MosquitoTracker {
  constructor({ windowSec = 1, driftHz = 25, minSnrDb = 12 } = {}) {
    this.windowSec = windowSec;
    this.driftHz = driftHz;
    this.minSnrDb = minSnrDb;
    this.reset();
  }

  reset() {
    this.hist = [];
    this.level = "none";
    this.confidence = 0;
    this.hz = 0;
    this.last = null;
  }

  update(analysis, t) {
    this.hist.push({ t, a: analysis });
    while (this.hist.length && t - this.hist[0].t > this.windowSec) this.hist.shift();
    const span = this.hist.length ? t - this.hist[0].t : 0;
    const frames = this.hist.length;

    const cands = this.hist.filter(
      (h) => h.a.found && h.a.snrDb >= this.minSnrDb && h.a.widthHz <= 90
    );
    let presence = 0;
    let medHz = 0;
    let medSnr = 0;
    let harmFrac = 0;
    let harmMed = 0;
    let mains = false;
    if (cands.length) {
      medHz = median(cands.map((h) => h.a.hz));
      const stable = cands.filter((h) => Math.abs(h.a.hz - medHz) <= this.driftHz);
      presence = span >= this.windowSec * 0.85 ? stable.length / frames : 0;
      if (stable.length) {
        medSnr = median(stable.map((h) => h.a.snrDb));
        harmFrac = stable.filter((h) => h.a.harmCount >= 1).length / stable.length;
        harmMed = median(stable.map((h) => h.a.harmCount));
        mains = stable.filter((h) => h.a.mains).length / stable.length > 0.5;
        medHz = median(stable.map((h) => h.a.hz));
      }
    }

    const snrScore = clamp01((medSnr - this.minSnrDb) / 12);
    const harmScore = harmFrac >= 0.5 ? (harmMed >= 2 ? 1 : 0.7) : 0;
    let conf = presence * (0.35 + 0.3 * snrScore + 0.35 * harmScore);
    if (mains) conf *= 0.4;

    let level = "none";
    if (presence >= 0.7 && conf >= 0.35) level = "possible";
    if (presence >= 0.8 && conf >= 0.7 && harmScore > 0 && medSnr >= 18) level = "likely";
    if (this.level === "likely" && level === "possible" && conf >= 0.55 && presence >= 0.7) level = "likely";

    this.level = level;
    this.confidence = conf;
    this.hz = level === "none" ? 0 : medHz;
    this.last = {
      level,
      confidence: conf,
      hz: this.hz,
      candidateHz: medHz,
      stability: presence,
      snrDb: medSnr,
      harmonics: harmMed,
      mains,
    };
    return this.last;
  }
}

/* ------------------------------------------------------------------ */
/* Time-domain stream helpers                                          */
/* ------------------------------------------------------------------ */

/**
 * AnalyserNode returns the *latest* window each call, so consecutive pulls
 * overlap. Find how far the window advanced by matching the overlapping part
 * (byte data is identical in the overlap). Falls back to `estimate` when no
 * confident match exists (silence, gap larger than the window).
 */
export function alignShift(prev, cur, estimate, { range = 1500, probe = 160, stride = 3, tol = 0.6 } = {}) {
  const N = cur.length;
  const est = clamp(Math.round(estimate), 0, N);
  let best = -1;
  let bestCost = Infinity;
  let bestCount = 1;
  for (let d = 0; d <= range; d++) {
    for (let sgn = 0; sgn < (d === 0 ? 1 : 2); sgn++) {
      const s = sgn === 0 ? est + d : est - d;
      if (s < 0 || s >= N - 256) continue;
      const m = Math.min(probe * stride, N - s);
      let cost = 0;
      let count = 0;
      for (let j = 0; j < m; j += stride) {
        cost += Math.abs(cur[j] - prev[j + s]);
        count++;
        if (cost >= bestCost) break;
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = s;
        bestCount = count;
        if (cost === 0) return best;
      }
    }
  }
  if (best >= 0 && bestCost / bestCount <= tol) return best;
  return est;
}

/**
 * Turns overlapping analyser windows into a gap-free stream of new float samples.
 * Accepts Float32Array (getFloatTimeDomainData, preferred: no 8-bit floor) or
 * Uint8Array (getByteTimeDomainData).
 */
export class StreamAligner {
  constructor() {
    this.prev = null;
    this.lastT = 0;
  }

  reset() {
    this.prev = null;
  }

  /** @returns Float32Array of samples new since the last call. */
  push(win, sampleRate, nowSec) {
    const N = win.length;
    const isFloat = win instanceof Float32Array;
    let shift = N;
    if (this.prev && this.prev.length === N && this.isFloat === isFloat) {
      shift = alignShift(this.prev, win, (nowSec - this.lastT) * sampleRate, { tol: isFloat ? 1e-6 : 0.6 });
    }
    if (!this.prev || this.prev.length !== N || this.isFloat !== isFloat) {
      this.prev = isFloat ? new Float32Array(N) : new Uint8Array(N);
      this.isFloat = isFloat;
    }
    this.prev.set(win);
    this.lastT = nowSec;
    const out = new Float32Array(shift);
    for (let i = 0; i < shift; i++) out[i] = isFloat ? win[N - shift + i] : (win[N - shift + i] - 128) / 128;
    return out;
  }
}

/**
 * Amplitude envelope: x² → 2-pole low-pass (~80 Hz) → decimate to ~400 Hz → sqrt.
 * Input is first low-passed (default 800 Hz) so the envelope follows the low
 * "thump" band rather than hiss.
 */
export class EnvelopeTracker {
  constructor(sampleRate, { envRate = 400, inputLpHz = 800, envLpHz = 80, seconds = 2.5 } = {}) {
    this.sampleRate = sampleRate;
    this.block = Math.max(1, Math.round(sampleRate / envRate));
    this.envRate = sampleRate / this.block;
    this.aIn = 1 - Math.exp((-2 * Math.PI * inputLpHz) / sampleRate);
    this.aEnv = 1 - Math.exp((-2 * Math.PI * envLpHz) / sampleRate);
    this.size = Math.round(seconds * this.envRate);
    this.ring = new Float32Array(this.size);
    this.reset();
  }

  reset() {
    this.y1 = 0;
    this.y2 = 0;
    this.e1 = 0;
    this.e2 = 0;
    this.count = 0;
    this.filled = 0;
    this.head = 0;
    this.ring.fill(0);
  }

  push(samples) {
    for (let i = 0; i < samples.length; i++) {
      this.y1 += this.aIn * (samples[i] - this.y1);
      this.y2 += this.aIn * (this.y1 - this.y2);
      const p = this.y2 * this.y2;
      this.e1 += this.aEnv * (p - this.e1);
      this.e2 += this.aEnv * (this.e1 - this.e2);
      if (++this.count >= this.block) {
        this.count = 0;
        this.ring[this.head] = Math.sqrt(Math.max(0, this.e2));
        this.head = (this.head + 1) % this.size;
        if (this.filled < this.size) this.filled++;
      }
    }
  }

  /** Oldest → newest. */
  get() {
    const out = new Float32Array(this.filled);
    const start = (this.head - this.filled + this.size) % this.size;
    for (let i = 0; i < this.filled; i++) out[i] = this.ring[(start + i) % this.size];
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Amplitude-modulation (rotor thump) analysis                         */
/* ------------------------------------------------------------------ */

/**
 * Modulation spectrum of an envelope. `depth` is relative to the mean (1.0 =
 * 100 % AM). Looks for the strongest component in 10–40 Hz, its prominence
 * over the median of the 6–80 Hz modulation spectrum, and 2x / 3x harmonics.
 */
export function analyzeModulation(env, envRate, { minHz = 10, maxHz = 40, stepHz = 0.5 } = {}) {
  const n = env.length;
  const empty = { hz: 0, depth: 0, prominence: 0, harmCount: 0, valid: false };
  if (n < envRate * 1.0) return empty;

  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n;
  if (!(mean > 1e-7)) return empty;

  const t = new Float32Array(n);
  for (let i = 0; i < n; i++) t[i] = i / envRate;
  const tr = linearTrend(t, env);
  const x = new Float32Array(n);
  let wsum = 0;
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    x[i] = (env[i] - (tr.intercept + tr.slope * t[i])) * w;
    wsum += w;
  }

  const lo = 6;
  const hi = Math.min(80, envRate / 2 - 2);
  const freqs = [];
  const depths = [];
  for (let f = lo; f <= hi; f += stepHz) {
    const wc = (2 * Math.PI * f) / envRate;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += x[i] * Math.cos(wc * i);
      im += x[i] * Math.sin(wc * i);
    }
    freqs.push(f);
    depths.push((2 * Math.hypot(re, im)) / wsum / mean);
  }

  let bi = -1;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] < minHz || freqs[i] > maxHz) continue;
    if (bi < 0 || depths[i] > depths[bi]) bi = i;
  }
  if (bi < 0) return empty;
  const med = median(depths) || 1e-9;
  const peak = depths[bi];
  const at = (f) => {
    let m = 0;
    for (let i = 0; i < freqs.length; i++) if (Math.abs(freqs[i] - f) <= 1.2) m = Math.max(m, depths[i]);
    return m;
  };
  let harmCount = 0;
  for (const k of [2, 3]) {
    const f = freqs[bi] * k;
    if (f <= hi && at(f) >= Math.max(0.25 * peak, 3 * med)) harmCount++;
  }
  return { hz: freqs[bi], depth: peak, prominence: peak / med, harmCount, valid: true };
}

/* ------------------------------------------------------------------ */
/* Tonal harmonic series (drone / prop)                                */
/* ------------------------------------------------------------------ */

export function findHarmonicSeries(db, binHz, { f0Min = 60, f0Max = 400, maxHz = 4000 } = {}) {
  const peaks = findPeaks(db, binHz, 40, maxHz, { minProminenceDb: 6, floorSpanHz: 200 }).slice(0, 40);
  if (peaks.length < 3) return null;
  const cands = [];
  for (const p of peaks) {
    if (p.hz >= f0Min && p.hz <= f0Max) cands.push(p.hz);
    if (p.hz / 2 >= f0Min && p.hz / 2 <= f0Max) cands.push(p.hz / 2);
  }
  let best = null;
  for (const f0 of cands) {
    const present = [];
    let maxK = 0;
    for (let k = 1; k <= 8 && f0 * k <= maxHz; k++) {
      const tol = Math.max(1.5 * binHz, 0.02 * k * f0);
      const hit = peaks.find((p) => Math.abs(p.hz - k * f0) <= tol);
      present.push(hit || null);
      if (hit) maxK = k;
    }
    let n = 0;
    let gaps = 0;
    for (let k = 1; k <= maxK; k++) {
      if (present[k - 1]) n++;
      else gaps++;
    }
    const score = n - 0.5 * gaps;
    if (n >= 3 && (!best || score > best.score + 1e-9)) {
      const hits = present.filter(Boolean);
      const refined = hits.reduce((s, p, i) => s + p.hz / (present.indexOf(p) + 1), 0) / hits.length;
      best = { f0: refined, n, score, strengthDb: median(hits.map((p) => p.prominenceDb)) };
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Aircraft scoring                                                    */
/* ------------------------------------------------------------------ */

export const AIRCRAFT_TYPES = {
  helicopter: "Helicopter",
  drone: "Drone / multirotor",
  prop: "Propeller airplane",
  jet: "Jet airplane",
};

/**
 * features: { am, series, wobble, whine, lowFraction, maxPromDb, aboveFloorDb, levelTrendStrong }
 * returns scores 0..1 per class (not probabilities).
 */
export function scoreAircraft(f) {
  const s = { helicopter: 0, drone: 0, prop: 0, jet: 0 };
  const am = f.am;
  const lowDom = f.lowFraction >= 0.45;

  if (am && am.valid && am.hz >= 10 && am.hz <= 40 && am.depth >= 0.15 && am.prominence >= 4) {
    s.helicopter =
      (0.35 +
        0.25 * clamp01((am.depth - 0.15) / 0.35) +
        0.15 * clamp01((am.prominence - 4) / 8) +
        0.25 * (am.harmCount >= 1 ? 1 : 0)) *
      (lowDom ? 1 : 0.6);
  }

  const sr = f.series;
  if (sr && sr.n >= 3) {
    const extra = Math.min(sr.n - 3, 3);
    if (sr.f0 >= 100 && sr.f0 <= 400) {
      s.drone = clamp01(0.35 + 0.08 * extra + (f.wobble ? 0.2 : 0) + (f.whine ? 0.2 : 0));
    }
    if (sr.f0 >= 60 && sr.f0 <= 200) {
      s.prop = clamp01(0.3 + 0.07 * extra + (f.wobble ? -0.1 : 0.2) + (sr.f0 <= 150 ? 0.1 : 0));
    }
  }

  const am0 = !am || !am.valid || am.depth < 0.15;
  if (lowDom && f.maxPromDb < 12 && am0 && f.aboveFloorDb >= 8) {
    s.jet = Math.min(
      0.6,
      0.3 +
        0.25 * clamp01((f.lowFraction - 0.55) / 0.35) +
        0.25 * clamp01((f.aboveFloorDb - 8) / 20) +
        (f.levelTrendStrong ? 0.2 : 0)
    );
  }
  return s;
}

export function trendLabel(state) {
  return state === "approaching" ? "approaching" : state === "receding" ? "receding" : "steady";
}

/**
 * Level-over-time trend (dB/s) plus, for tonal sources, pitch trend as a weak
 * Doppler cue (falling pitch → receding, rising → approaching).
 */
export function estimateApproach({ levelT, levelDb, pitchT = [], pitchHz = [] }) {
  let levelSigned = 0;
  let levelSlope = 0;
  let levelSpan = 0;
  if (levelT.length >= 20) {
    const tr = linearTrend(levelT, levelDb);
    levelSlope = tr.slope;
    levelSpan = levelT[levelT.length - 1] - levelT[0];
    const change = tr.slope * levelSpan;
    if (levelSpan >= 4 && Math.abs(change) >= 3 && tr.r2 >= 0.4) {
      levelSigned = Math.sign(tr.slope) * clamp01(Math.abs(change) / 10) * Math.min(1, 0.4 + tr.r2);
    }
  }

  let pitchSigned = 0;
  let pitchSlope = 0;
  if (pitchT.length >= 15 && pitchT[pitchT.length - 1] - pitchT[0] >= 3) {
    const tr = linearTrend(pitchT, pitchHz);
    pitchSlope = tr.slope;
    const span = pitchT[pitchT.length - 1] - pitchT[0];
    const change = tr.slope * span;
    const meanHz = pitchHz.reduce((a, b) => a + b, 0) / pitchHz.length;
    if (Math.abs(change) >= Math.max(2 * tr.resStd, 0.015 * meanHz)) {
      pitchSigned = Math.sign(tr.slope) * clamp01(Math.abs(change) / (0.06 * meanHz)) * 0.8;
    }
  }

  const total = levelSigned + 0.5 * pitchSigned;
  let state = "steady";
  if (total >= 0.3) state = "approaching";
  else if (total <= -0.3) state = "receding";
  const confidence = state === "steady" ? clamp01(1 - Math.abs(total) / 0.3) * 0.5 : clamp01(Math.abs(total));
  return { state, confidence, levelSlopeDbPerSec: levelSlope, pitchSlopeHzPerSec: pitchSlope, levelSigned, pitchSigned };
}

export class AircraftTracker {
  constructor({ scoreAlpha = 0.12, levelWindowSec = 10, floorWindowSec = 30 } = {}) {
    this.scoreAlpha = scoreAlpha;
    this.levelWindowSec = levelWindowSec;
    this.floorWindowSec = floorWindowSec;
    this.reset();
  }

  reset() {
    this.levelSm = null;
    this.lastT = null;
    this.levelHist = [];
    this.pitchHist = [];
    this.scores = { helicopter: 0, drone: 0, prop: 0, jet: 0 };
    this.last = null;
  }

  update({ t, levelDb, freqDb, binHz, env, envRate }) {
    const dt = this.lastT == null ? 0.1 : Math.max(0.001, t - this.lastT);
    this.lastT = t;
    const lvl = Math.max(-120, fin(levelDb));
    this.levelSm = this.levelSm == null ? lvl : this.levelSm + (1 - Math.exp(-dt / 0.6)) * (lvl - this.levelSm);
    const lh = this.levelHist;
    if (!lh.length || t - lh[lh.length - 1].t >= 0.1) lh.push({ t, db: this.levelSm });
    while (lh.length && t - lh[0].t > this.floorWindowSec) lh.shift();
    const floorDb = lh.reduce((m, h) => Math.min(m, h.db), Infinity);
    const aboveFloorDb = this.levelSm - floorDb;

    const recent = lh.filter((h) => t - h.t <= this.levelWindowSec);
    const lt = recent.map((h) => h.t);
    const lv = recent.map((h) => h.db);
    const lvTr = linearTrend(lt, lv);

    const dom = dominantPeak(freqDb, binHz, 40, 8000);
    const series = findHarmonicSeries(freqDb, binHz);
    const mid = findPeaks(freqDb, binHz, 60, 2000, { minProminenceDb: 6, floorSpanHz: 250 });
    const maxPromDb = mid.length ? Math.max(...mid.map((p) => p.prominenceDb)) : 0;
    const whine = findPeaks(freqDb, binHz, 1500, 8000, { minProminenceDb: 12, floorSpanHz: 400 }).length > 0;
    const lowFraction = bandPowerRatio(freqDb, binHz, 30, 500, 30, 8000);
    const am = env && env.length ? analyzeModulation(env, envRate) : null;

    let tonalHz = 0;
    if (series) tonalHz = series.f0;
    else {
      const tp = findPeaks(freqDb, binHz, 80, 1500, { minProminenceDb: 14, floorSpanHz: 250 })[0];
      if (tp && tp.widthHz <= 90) tonalHz = tp.hz;
    }
    const ph = this.pitchHist;
    if (tonalHz > 0 && (!ph.length || t - ph[ph.length - 1].t >= 0.2)) ph.push({ t, hz: tonalHz });
    while (ph.length && t - ph[0].t > 8) ph.shift();
    const wobble = this._wobble(ph);

    const strong = aboveFloorDb >= 3 && Math.abs(lvTr.slope * (lt.length ? lt[lt.length - 1] - lt[0] : 0)) >= 4;
    const raw = scoreAircraft({
      am,
      series,
      wobble,
      whine,
      lowFraction,
      maxPromDb,
      aboveFloorDb,
      levelTrendStrong: strong,
    });
    const quiet = !dom || dom.db < -85;
    for (const k of Object.keys(this.scores)) {
      const target = quiet ? 0 : raw[k];
      this.scores[k] += this.scoreAlpha * (target - this.scores[k]);
    }

    let type = "none";
    let confidence = 0;
    const entries = Object.entries(this.scores).sort((a, b) => b[1] - a[1]);
    if (entries[0][1] >= 0.4) {
      type = entries[0][0];
      confidence = entries[0][1];
    } else if (!quiet && aboveFloorDb >= 8 && (lowFraction >= 0.45 || entries[0][1] >= 0.2)) {
      type = "unknown";
      confidence = Math.max(entries[0][1], 0.2);
    }

    const approach = estimateApproach({
      levelT: lt,
      levelDb: lv,
      pitchT: ph.map((p) => p.t),
      pitchHz: ph.map((p) => p.hz),
    });

    this.last = {
      type,
      label: type === "none" ? "No aircraft-like sound" : type === "unknown" ? "Unknown aircraft-like sound" : AIRCRAFT_TYPES[type],
      confidence,
      scores: { ...this.scores },
      approach,
      levelDb: this.levelSm,
      floorDb,
      aboveFloorDb,
      dominantHz: dom ? dom.hz : 0,
      dominantDb: dom ? dom.db : FLOOR_DB,
      modHz: am && am.valid ? am.hz : 0,
      modDepth: am && am.valid ? am.depth : 0,
      modProminence: am && am.valid ? am.prominence : 0,
      f0Hz: series ? series.f0 : 0,
      harmonics: series ? series.n : 0,
      tonalHz,
      whine,
      wobble,
      lowFraction,
    };
    return this.last;
  }

  _wobble(ph) {
    if (ph.length < 12 || ph[ph.length - 1].t - ph[0].t < 2) return false;
    const tr = linearTrend(ph.map((p) => p.t), ph.map((p) => p.hz));
    const mean = ph.reduce((s, p) => s + p.hz, 0) / ph.length;
    return mean > 0 && tr.resStd / mean >= 0.015;
  }

  levelSeries() {
    return this.levelHist.map((h) => ({ t: h.t, db: h.db }));
  }
}

export function confidenceBand(c) {
  return c >= 0.7 ? "high" : c >= 0.4 ? "medium" : "low";
}
