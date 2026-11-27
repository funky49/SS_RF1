import test from "node:test";
import assert from "node:assert/strict";
import {
  SR, noise, tones, mix, applyGain, AnalyserSim, rmsDb, toBytes, rng,
} from "./helpers.mjs";
import {
  analyzeMosquito, MosquitoTracker, analyzeModulation, EnvelopeTracker,
  findHarmonicSeries, AircraftTracker, estimateApproach, linearTrend,
  alignShift, StreamAligner, looksLikeMainsHum, findPeaks, bandLevelDb,
} from "../www/js/detectors.js";

function runMosquito(signal, seconds = 3) {
  const sim = new AnalyserSim();
  const tracker = new MosquitoTracker();
  let res;
  let firstLikely = null;
  for (let t = 0.1; t <= seconds + 1e-9; t += 0.1) {
    const db = sim.spectrum(signal, Math.round(t * SR));
    res = tracker.update(analyzeMosquito(db, sim.binHz), t);
    if (res.level === "likely" && firstLikely == null) firstLikely = t;
  }
  return { res, firstLikely };
}

function runAircraft(signal, seconds) {
  const sim = new AnalyserSim();
  const env = new EnvelopeTracker(SR);
  const tracker = new AircraftTracker();
  let res;
  let prev = 0;
  for (let t = 0.1; t <= seconds + 1e-9; t += 0.1) {
    const end = Math.round(t * SR);
    env.push(signal.subarray(prev, end));
    prev = end;
    const db = sim.spectrum(signal, end);
    res = tracker.update({
      t, levelDb: bandLevelDb(db, sim.binHz, 30, 8000), freqDb: db, binHz: sim.binHz,
      env: env.get(), envRate: env.envRate,
    });
  }
  return res;
}

const wing = (hz = 450, harm = true) =>
  tones(4, [
    { hz, amp: 0.02 },
    ...(harm ? [{ hz: hz * 2, amp: 0.01 }, { hz: hz * 3, amp: 0.005 }] : []),
  ]);

test("mosquito: 450 Hz wingbeat + harmonics over noise -> likely, freq ~450", () => {
  const { res, firstLikely } = runMosquito(mix(wing(), noise(4, 0.002, 3)), 3);
  assert.equal(res.level, "likely");
  assert.ok(Math.abs(res.hz - 450) < 12, `hz=${res.hz}`);
  assert.ok(res.harmonics >= 1);
  assert.ok(firstLikely >= 0.8, `needs ~1 s of stability, got ${firstLikely}`);
});

test("mosquito: slightly drifting wingbeat (±8 Hz) is still detected", () => {
  const sig = mix(
    tones(4, [{ hz: 500, amp: 0.02 }, { hz: 1000, amp: 0.01 }, { hz: 1500, amp: 0.005 }],
      (t) => 1 + 0.016 * Math.sin(2 * Math.PI * 1.5 * t)),
    noise(4, 0.002, 4)
  );
  const { res } = runMosquito(sig, 3);
  assert.equal(res.level, "likely");
  assert.ok(Math.abs(res.hz - 500) < 20);
});

test("mosquito: pure noise -> none", () => {
  const { res } = runMosquito(noise(4, 0.02, 5), 3);
  assert.equal(res.level, "none");
});

test("mosquito: tone without harmonics is at most 'possible'", () => {
  const { res } = runMosquito(mix(wing(450, false), noise(4, 0.002, 6)), 3);
  assert.notEqual(res.level, "likely");
  assert.equal(res.level, "possible");
});

test("mosquito: brief 0.3 s beep is not sustained -> none", () => {
  const sig = mix(
    applyGain(wing(), (t) => (t > 1 && t < 1.3 ? 1 : 0)),
    noise(4, 0.002, 7)
  );
  const { res, firstLikely } = runMosquito(sig, 3);
  assert.equal(firstLikely, null);
  assert.equal(res.level, "none");
});

test("mosquito: sweeping tone (300->900 Hz in 3 s) is not stable -> none", () => {
  const sig = mix(
    tones(4, [{ hz: 1, amp: 0.02 }], (t) => 300 + 200 * t),
    noise(4, 0.002, 8)
  );
  const { res } = runMosquito(sig, 3);
  assert.equal(res.level, "none");
});

test("mosquito: 60 Hz mains hum comb is flagged and not 'likely'", () => {
  const hum = tones(4, [60, 120, 180, 240, 300, 360, 420].map((hz) => ({ hz, amp: 0.02 })));
  const { res } = runMosquito(mix(hum, noise(4, 0.002, 9)), 3);
  assert.notEqual(res.level, "likely");
  const sim = new AnalyserSim();
  assert.equal(looksLikeMainsHum(sim.spectrum(mix(hum, noise(4, 0.002, 9)), 3 * SR), sim.binHz), true);
});

test("findPeaks interpolates frequency within a bin", () => {
  const sim = new AnalyserSim();
  const db = sim.spectrum(tones(2, [{ hz: 437, amp: 0.05 }]), SR);
  const peak = findPeaks(db, sim.binHz, 300, 900)[0];
  assert.ok(Math.abs(peak.hz - 437) < 4, `hz=${peak.hz}`);
});

test("modulation: 20 Hz AM of a 120 Hz tone -> ~20 Hz, strong depth", () => {
  const n = 4;
  const x = new Float32Array(n * SR);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] = 0.1 * (1 + 0.6 * Math.cos(2 * Math.PI * 20 * t)) * Math.sin(2 * Math.PI * 120 * t);
  }
  const env = new EnvelopeTracker(SR);
  env.push(x);
  const am = analyzeModulation(env.get(), env.envRate);
  assert.ok(am.valid);
  assert.ok(Math.abs(am.hz - 20) <= 1, `hz=${am.hz}`);
  assert.ok(am.depth > 0.3, `depth=${am.depth}`);
  assert.ok(am.prominence > 5, `prom=${am.prominence}`);
});

test("modulation: steady tone has no strong modulation", () => {
  const env = new EnvelopeTracker(SR);
  env.push(mix(tones(4, [{ hz: 120, amp: 0.1 }]), noise(4, 0.003, 11)));
  const am = analyzeModulation(env.get(), env.envRate);
  assert.ok(am.depth < 0.05, `depth=${am.depth}`);
});

test("helicopter: low-tone AM at 20 Hz -> helicopter", () => {
  const x = new Float32Array(8 * SR);
  const r = rng(12);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    x[i] =
      0.1 * (1 + 0.7 * Math.cos(2 * Math.PI * 20 * t)) * Math.sin(2 * Math.PI * 110 * t) +
      0.002 * (r() - 0.5);
  }
  const res = runAircraft(x, 8);
  assert.equal(res.type, "helicopter");
  assert.ok(res.confidence >= 0.6, `conf=${res.confidence}`);
  assert.ok(Math.abs(res.modHz - 20) <= 1);
});

test("helicopter: pulsed 'thump' train (13 Hz) with harmonics -> helicopter", () => {
  const x = new Float32Array(8 * SR);
  const r = rng(13);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const ph = (t * 13) % 1;
    const pulse = Math.exp(-ph * 14);
    x[i] = 0.15 * pulse * Math.sin(2 * Math.PI * 90 * t) + 0.003 * (r() - 0.5);
  }
  const res = runAircraft(x, 8);
  assert.equal(res.type, "helicopter");
  assert.ok(Math.abs(res.modHz - 13) <= 1, `modHz=${res.modHz}`);
});

test("drone: 200 Hz harmonic series, pitch wobble and 3 kHz whine -> drone", () => {
  const partials = Array.from({ length: 8 }, (_, k) => ({ hz: 200 * (k + 1), amp: 0.03 / (k + 1) }));
  partials.push({ hz: 3000, amp: 0.004 });
  const sig = mix(
    tones(8, partials, (t) => 1 + 0.04 * Math.sin(2 * Math.PI * 0.7 * t)),
    noise(8, 0.0015, 14)
  );
  const res = runAircraft(sig, 8);
  assert.equal(res.type, "drone", JSON.stringify(res.scores));
  assert.ok(res.f0Hz > 180 && res.f0Hz < 225, `f0=${res.f0Hz}`);
  assert.ok(res.harmonics >= 4);
});

test("harmonic series finder reports f0 and count", () => {
  const sim = new AnalyserSim();
  const partials = Array.from({ length: 6 }, (_, k) => ({ hz: 200 * (k + 1), amp: 0.03 / (k + 1) }));
  const db = sim.spectrum(mix(tones(2, partials), noise(2, 0.001, 15)), SR);
  const s = findHarmonicSeries(db, sim.binHz);
  assert.ok(Math.abs(s.f0 - 200) < 5, `f0=${s.f0}`);
  assert.ok(s.n >= 5);
});

test("approach: rising-level rumble -> approaching, falling -> receding, flat -> steady", () => {
  const base = noise(14, 0.02, 16);
  const rumble = new Float32Array(base.length);
  let lp = 0;
  for (let i = 0; i < base.length; i++) {
    lp += 0.03 * (base[i] - lp);
    rumble[i] = lp * 6;
  }
  const gainDb = (db0, db1) => (t) => Math.pow(10, (db0 + ((db1 - db0) * t) / 12) / 20);
  const quiet = noise(14, 0.0004, 17);
  const rising = mix(applyGain(rumble, gainDb(-12, 6)), quiet);
  const falling = mix(applyGain(rumble, gainDb(6, -12)), quiet);
  const flat = mix(applyGain(rumble, gainDb(0, 0)), quiet);

  const up = runAircraft(rising, 12);
  assert.equal(up.approach.state, "approaching", JSON.stringify(up.approach));
  assert.ok(up.approach.levelSlopeDbPerSec > 0.8);
  assert.ok(up.approach.confidence > 0.4);
  const down = runAircraft(falling, 12);
  assert.equal(down.approach.state, "receding", JSON.stringify(down.approach));
  const same = runAircraft(flat, 12);
  assert.equal(same.approach.state, "steady");
});

test("rising rumble is reported as aircraft-like (jet / unknown), never as tonal classes", () => {
  const base = noise(14, 0.02, 18);
  const rumble = new Float32Array(base.length);
  let lp = 0;
  for (let i = 0; i < base.length; i++) {
    lp += 0.03 * (base[i] - lp);
    rumble[i] = lp * 6;
  }
  const sig = mix(applyGain(rumble, (t) => Math.pow(10, (-12 + (18 * t) / 12) / 20)), noise(14, 0.0004, 19));
  const res = runAircraft(sig, 12);
  assert.ok(res.type === "jet" || res.type === "unknown", `type=${res.type}`);
});

test("quiet room noise -> no aircraft", () => {
  const res = runAircraft(noise(8, 0.0005, 20), 8);
  assert.equal(res.type, "none");
});

test("Doppler: tone gliding down in pitch adds receding evidence", () => {
  const T = Array.from({ length: 50 }, (_, i) => i * 0.2);
  const hz = T.map((t) => 400 - 8 * t);
  const flatLevel = T.map(() => -30);
  const a = estimateApproach({ levelT: T, levelDb: flatLevel, pitchT: T, pitchHz: hz });
  assert.ok(a.pitchSlopeHzPerSec < -5);
  assert.ok(a.pitchSigned < 0);
  const b = estimateApproach({ levelT: T, levelDb: T.map((t) => -30 - 0.8 * t), pitchT: T, pitchHz: hz });
  assert.equal(b.state, "receding");
});

test("linearTrend basics", () => {
  const t = [0, 1, 2, 3, 4];
  const tr = linearTrend(t, t.map((x) => 3 * x + 1));
  assert.ok(Math.abs(tr.slope - 3) < 1e-9);
  assert.ok(tr.r2 > 0.999);
});

test("StreamAligner recovers a gap-free stream from overlapping analyser windows", () => {
  const sig = mix(tones(2, [{ hz: 333, amp: 0.3 }, { hz: 71, amp: 0.2 }]), noise(2, 0.05, 21));
  const N = 4096;
  const aligner = new StreamAligner();
  const r = rng(22);
  let end = N;
  let nowSec = 0;
  const got = [];
  const first = aligner.push(toBytes(sig, 0, N), SR, nowSec);
  got.push(...first);
  let total = N;
  for (let k = 0; k < 40; k++) {
    const hop = 300 + Math.floor(r() * 1100);
    end += hop;
    nowSec += (hop + (r() - 0.5) * 600) / SR; // jittered wall clock
    const out = aligner.push(toBytes(sig, end - N, end), SR, nowSec);
    assert.equal(out.length, hop, `hop ${hop} got ${out.length}`);
    total += hop;
  }
  assert.equal(total, end);
});

test("StreamAligner with float windows recovers quiet signals below the 8-bit floor", () => {
  const sig = mix(tones(2, [{ hz: 200, amp: 0.0005 }]), noise(2, 0.0004, 23));
  const N = 4096;
  const aligner = new StreamAligner();
  const r = rng(24);
  let end = N;
  let nowSec = 0;
  aligner.push(sig.subarray(0, N), SR, nowSec);
  for (let k = 0; k < 30; k++) {
    const hop = 300 + Math.floor(r() * 1100);
    end += hop;
    nowSec += (hop + (r() - 0.5) * 800) / SR;
    const out = aligner.push(sig.subarray(end - N, end), SR, nowSec);
    assert.equal(out.length, hop);
    assert.equal(out[out.length - 1], sig[end - 1]);
  }
});

test("bandLevelDb tracks level changes far below the 8-bit time-domain floor", () => {
  const sim = new AnalyserSim();
  const quiet = sim.spectrum(noise(2, 0.0004, 25), SR);
  const sim2 = new AnalyserSim();
  const louder = sim2.spectrum(noise(2, 0.0016, 25), SR);
  const d = bandLevelDb(louder, sim2.binHz, 30, 8000) - bandLevelDb(quiet, sim.binHz, 30, 8000);
  assert.ok(Math.abs(d - 12) < 1.5, `d=${d}`);
});

test("alignShift falls back to the estimate in silence", () => {
  const a = new Uint8Array(4096).fill(128);
  assert.equal(alignShift(a, a, 700), 700);
});
