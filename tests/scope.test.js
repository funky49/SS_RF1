import test from "node:test";
import assert from "node:assert/strict";
import {
  TIME_DIVS_MS,
  spanSamples,
  maxTimeDivMs,
  resolveTimeDiv,
  findRisingTrigger,
  findAllRisingCrossings,
  periodFromCrossings,
  estimateFrequency,
  vppAndRms,
  bytesToFloat,
  sampleAt,
  unitsPerDiv,
  hysteresisFor,
  persistenceTauMs,
  decayStep,
  formatTimeDiv,
  formatUnitsPerDiv,
  formatFrequency,
} from "../www/js/scope.js";

const SR = 48000;

function sine(freq, n = 4096, phase = 0, amp = 0.5) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freq * (i / SR) + phase);
  return out;
}

function square(freq, n = 4096, amp = 0.5) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin(2 * Math.PI * freq * (i / SR)) >= 0 ? amp : -amp;
  return out;
}

function lcg(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

test("spanSamples: 10 divisions at the given time/div", () => {
  assert.equal(spanSamples(1, 48000), 480);
  assert.equal(spanSamples(0.2, 48000), 96);
  assert.equal(spanSamples(10, 44100), 4410);
});

test("maxTimeDivMs leaves search room in the buffer", () => {
  const max = maxTimeDivMs(4096, 48000);
  assert.ok(Math.abs(max - ((4096 - 512) / 48000) * 100) < 1e-9);
  assert.ok(max > 7 && max < 7.6);
  assert.equal(maxTimeDivMs(100, 48000), 0);
});

test("resolveTimeDiv passes through short spans and clamps long ones", () => {
  const ok = resolveTimeDiv(2, 4096, SR);
  assert.equal(ok.clamped, false);
  assert.equal(ok.timeDivMs, 2);
  assert.equal(ok.spanSamples, 960);
  assert.equal(ok.preSamples, 96);

  const big = resolveTimeDiv(10, 4096, SR);
  assert.equal(big.clamped, true);
  assert.equal(big.requestedMs, 10);
  assert.ok(big.timeDivMs < 10);
  assert.ok(big.spanSamples + 512 <= 4096 + 1e-6);

  assert.equal(resolveTimeDiv(10, 4096 * 4, SR).clamped, false);
  assert.ok(TIME_DIVS_MS.includes(0.2) && TIME_DIVS_MS.includes(10));
});

test("findRisingTrigger finds an interpolated zero crossing on a sine", () => {
  const data = sine(440);
  const idx = findRisingTrigger(data, 0, 0.01, 0);
  const period = SR / 440;
  assert.ok(idx >= 0);
  const k = Math.round(idx / period);
  assert.ok(Math.abs(idx - k * period) < 0.02, `idx ${idx} should sit on a period multiple`);
});

test("trigger phase is stable between differently shifted buffers", () => {
  const f = 440;
  const period = SR / f;
  const a = findRisingTrigger(sine(f, 4096, 0), 0, 0.01, 0);
  const b = findRisingTrigger(sine(f, 4096, 1.3), 0, 0.01, 0);
  const sa = a % period;
  const sb = (b + (1.3 / (2 * Math.PI)) * period) % period;
  const d = Math.min(Math.abs(sa - sb), period - Math.abs(sa - sb));
  assert.ok(d < 0.05, `phase mismatch ${d}`);
});

test("trigger honours level and returns -1 when the level is never crossed", () => {
  const data = sine(440, 4096, 0, 0.5);
  const idx = findRisingTrigger(data, 0.25, 0.01, 0);
  assert.ok(idx >= 0);
  assert.ok(Math.abs(sampleAt(data, idx) - 0.25) < 0.01);
  assert.equal(findRisingTrigger(data, 0.8, 0.01, 0), -1);
  assert.equal(findRisingTrigger(data, -0.8, 0.01, 0), -1);
});

test("falling edges never trigger and minIndex/maxIndex bound the search", () => {
  const down = new Float32Array([1, 0.8, 0.4, -0.4, -0.8, -1, -1]);
  assert.equal(findRisingTrigger(down, 0, 0.1), -1);

  const data = sine(440);
  const period = SR / 440;
  const first = findRisingTrigger(data, 0, 0.01, 0);
  const second = findRisingTrigger(data, 0, 0.01, first + 1);
  assert.ok(Math.abs(second - first - period) < 0.05);
  assert.equal(findRisingTrigger(data, 0, 0.01, 0, Math.floor(first) - 1), -1);
});

test("hysteresis rejects noise chatter around the level", () => {
  const rand = lcg(7);
  const n = 2000;
  const noisy = new Float32Array(n);
  for (let i = 0; i < n; i++) noisy[i] = (rand() - 0.5) * 0.02;
  assert.ok(findAllRisingCrossings(noisy, 0, 0).length > 100);
  assert.equal(findAllRisingCrossings(noisy, 0, 0.05).length, 0);

  const wobble = sine(440, 4096, 0, 0.5);
  for (let i = 0; i < wobble.length; i++) wobble[i] += (rand() - 0.5) * 0.02;
  const crossings = findAllRisingCrossings(wobble, 0, 0.05);
  const expected = Math.floor((4096 / SR) * 440);
  assert.ok(Math.abs(crossings.length - expected) <= 1);
});

test("hysteresis scales with the display gain", () => {
  assert.ok(hysteresisFor(16) < hysteresisFor(1));
  assert.equal(unitsPerDiv(1), 0.25);
  assert.equal(unitsPerDiv(8), 0.03125);
});

test("estimateFrequency: 440 Hz sine has a ~2.27 ms period", () => {
  const est = estimateFrequency(sine(440), SR, 0, 0.01);
  assert.ok(est);
  assert.ok(Math.abs(est.hz - 440) < 0.5, `hz ${est.hz}`);
  assert.ok(Math.abs(est.periodMs - 2.2727) < 0.01, `period ${est.periodMs}`);
});

test("estimateFrequency handles a square wave and rejects noise", () => {
  const sq = estimateFrequency(square(1000), SR, 0, 0.02);
  assert.ok(sq && Math.abs(sq.hz - 1000) < 5);

  const rand = lcg(3);
  const noise = new Float32Array(4096);
  for (let i = 0; i < noise.length; i++) noise[i] = (rand() - 0.5) * 0.8;
  assert.equal(estimateFrequency(noise, SR, 0, 0.0125), null);
});

test("periodFromCrossings needs consistent intervals", () => {
  assert.equal(periodFromCrossings([5]), null);
  assert.equal(periodFromCrossings([]), null);
  assert.equal(periodFromCrossings([0, 100, 150, 400]), null);
  const p = periodFromCrossings([10, 110, 210, 310]);
  assert.equal(p.periodSamples, 100);
  assert.equal(p.count, 4);
});

test("vppAndRms on a known signal", () => {
  const s = vppAndRms(sine(440, 48000, 0, 0.5));
  assert.ok(Math.abs(s.vpp - 1) < 1e-3);
  assert.ok(Math.abs(s.rms - 0.5 / Math.SQRT2) < 1e-3);
  assert.deepEqual(vppAndRms(new Float32Array(0)), { min: 0, max: 0, vpp: 0, rms: 0 });
});

test("bytesToFloat maps 128 to zero and the ends to roughly ±1", () => {
  const out = bytesToFloat(new Uint8Array([0, 128, 255]));
  assert.equal(out[0], -1);
  assert.equal(out[1], 0);
  assert.ok(Math.abs(out[2] - 127 / 128) < 1e-9);
});

test("sampleAt interpolates and clamps", () => {
  const d = new Float32Array([0, 1, 0]);
  assert.equal(sampleAt(d, 0.5), 0.5);
  assert.equal(sampleAt(d, -3), 0);
  assert.equal(sampleAt(d, 9), 0);
});

test("persistence tau and stepped decay", () => {
  assert.equal(persistenceTauMs(0), 0);
  assert.ok(persistenceTauMs(0.5) > persistenceTauMs(0.1));
  assert.equal(decayStep(0, 16).alpha, 1);
  assert.equal(decayStep(0, 16).apply, true);
  const tiny = decayStep(1, 16);
  assert.equal(tiny.apply, false);
  const later = decayStep(1, 400);
  assert.equal(later.apply, true);
  assert.ok(later.alpha >= 0.08 && later.alpha < 1);
});

test("label formatting", () => {
  assert.equal(formatTimeDiv(0.2), "0.2 ms/div");
  assert.equal(formatTimeDiv(6.4012), "6.4 ms/div");
  assert.equal(formatUnitsPerDiv(0.25), "0.25 u/div");
  assert.equal(formatUnitsPerDiv(0.25 / 16), "0.0156 u/div");
  assert.equal(formatFrequency(440.04), "440.0 Hz");
  assert.equal(formatFrequency(1234.6), "1.235 kHz");
  assert.equal(formatFrequency(null), "—");
});
