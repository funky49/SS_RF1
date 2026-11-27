import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_FFT,
  MAX_FFT,
  binWidthHz,
  binToHz,
  hzToBin,
  fftCapFor,
  chooseFftSize,
  resampleSpectrum,
  parabolicPeak,
  findSpectrumPeaks,
} from "../www/js/spectrum-res.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} expected ${b} ± ${tol}, got ${a}`);

/** dB magnitude spectrum of a sum of sines, Blackman window (as AnalyserNode uses), via direct DFT on the bins we need. */
function sineSpectrumDb(tones, sampleRate, fftSize, maxBin) {
  const x = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / fftSize) + 0.08 * Math.cos((4 * Math.PI * i) / fftSize);
    let s = 0;
    for (const { hz, amp } of tones) s += amp * Math.sin((2 * Math.PI * hz * i) / sampleRate);
    x[i] = s * w;
  }
  const db = new Float32Array(fftSize / 2).fill(-140);
  for (let k = 0; k <= maxBin; k++) {
    let re = 0;
    let im = 0;
    const step = (2 * Math.PI * k) / fftSize;
    for (let i = 0; i < fftSize; i++) {
      re += x[i] * Math.cos(step * i);
      im -= x[i] * Math.sin(step * i);
    }
    const mag = Math.hypot(re, im) / fftSize;
    db[k] = 20 * Math.log10(mag + 1e-12);
  }
  return db;
}

test("bin <-> frequency math", () => {
  assert.equal(binWidthHz(48000, 4096), 48000 / 4096);
  near(binWidthHz(48000, 4096), 11.72, 0.01);
  near(binWidthHz(48000, 32768), 1.465, 0.001);
  near(binWidthHz(44100, 32768), 1.346, 0.001);
  assert.equal(binToHz(10, 48000, 4096), 117.1875);
  assert.equal(hzToBin(117.1875, 48000, 4096), 10);
  near(hzToBin(binToHz(123.4, 44100, 16384), 44100, 16384), 123.4, 1e-9);
});

test("fftCapFor: biggest FFT only for bass-range views; scrolling views stop at 16384", () => {
  assert.equal(fftCapFor("fft", 80), MAX_FFT);
  assert.equal(fftCapFor("fft", 250), MAX_FFT);
  assert.equal(fftCapFor("circular", 60), MAX_FFT);
  assert.equal(fftCapFor("fft", 500), 16384);
  assert.equal(fftCapFor("fft", 3000), 8192);
  assert.equal(fftCapFor("spectrogram", 80), 16384);
  assert.equal(fftCapFor("waterfall", 80), 16384);
  assert.equal(fftCapFor("waveform", 80), MIN_FFT);
  assert.equal(fftCapFor("oscilloscope", 80), MIN_FFT);
});

test("chooseFftSize: low-frequency zooms get fine bins, wide views stay at 4096", () => {
  const pick = (minHz, maxHz, mode = "fft", sampleRate = 48000) => chooseFftSize({ minHz, maxHz, sampleRate, mode });
  assert.equal(pick(20, 80), 32768);
  assert.equal(pick(20, 60), 32768);
  assert.equal(pick(60, 250), 32768);
  assert.equal(pick(250, 500), 16384);
  assert.equal(pick(500, 2000), 4096);
  assert.equal(pick(80, 3000), 4096);
  assert.equal(pick(20, 20000), 4096);
  assert.equal(pick(20, 64000), 4096);
  assert.equal(pick(20, 80, "spectrogram"), 16384);
  assert.equal(pick(20, 80, "waterfall"), 16384);
  assert.equal(pick(20, 80, "waveform"), 4096);
  assert.equal(pick(20, 80, "oscilloscope"), 4096);
  assert.equal(pick(20, 80, "fft", 44100), 32768);
  for (const [lo, hi] of [[20, 80], [20, 60], [60, 250], [250, 500], [500, 2000], [20, 20000]]) {
    const size = pick(lo, hi);
    assert.ok(size >= MIN_FFT && size <= MAX_FFT && (size & (size - 1)) === 0, `${lo}-${hi}: ${size}`);
  }
});

test("chooseFftSize: 20–80 Hz bin width drops from ~11.7 Hz to ~1.5 Hz", () => {
  const size = chooseFftSize({ minHz: 20, maxHz: 80, sampleRate: 48000, mode: "fft" });
  near(binWidthHz(48000, 4096), 11.72, 0.01);
  near(binWidthHz(48000, size), 1.46, 0.01);
  assert.ok((80 - 20) / binWidthHz(48000, size) >= 40);
});

test("chooseFftSize: hysteresis keeps the larger FFT just past the threshold, caps still apply", () => {
  const base = { sampleRate: 48000, mode: "fft" };
  const span = (48000 * 128) / 8192;
  assert.equal(chooseFftSize({ ...base, minHz: 100, maxHz: 100 + span * 1.1 }), 8192);
  assert.equal(chooseFftSize({ ...base, minHz: 100, maxHz: 100 + span * 1.1, current: 16384 }), 16384);
  assert.equal(chooseFftSize({ ...base, minHz: 100, maxHz: 100 + span * 1.3, current: 16384 }), 8192);
  assert.equal(chooseFftSize({ ...base, minHz: 250, maxHz: 500, current: 32768 }), 16384);
  assert.equal(chooseFftSize({ ...base, minHz: 20, maxHz: 80, mode: "waveform", current: 32768 }), 4096);
});

test("resampleSpectrum: interpolates between bins without overshoot", () => {
  const bins = Float32Array.from([0, 0, 100, 0, 0, 0]);
  const out = resampleSpectrum(bins, 10, 0, 50, 50);
  assert.equal(out.length, 50);
  for (const v of out) assert.ok(v >= 0 && v <= 100);
  const peakX = out.indexOf(Math.max(...out));
  near(peakX, 20, 1, "peak pixel at 20 Hz");
  assert.ok(out[15] > 0 && out[15] < 100, "smooth shoulder between bins");
  near(out[20], 100, 1);
});

test("resampleSpectrum: max-pools when many bins share a pixel and zero-fills outside", () => {
  const bins = new Float32Array(1000);
  bins[537] = 200;
  const out = resampleSpectrum(bins, 1, 0, 1000, 100);
  assert.equal(Math.max(...out), 200, "narrow peak survives downsampling");
  const outside = resampleSpectrum(Float32Array.from([5, 5, 5]), 10, 100, 200, 10);
  assert.ok(outside.every((v) => v === 0));
});

test("parabolicPeak: recovers an off-bin peak", () => {
  const db = Float32Array.from([-40, -10, -4, -16, -40]);
  const p = parabolicPeak(db, 2);
  assert.ok(p.bin > 1.5 && p.bin < 2.5);
  assert.ok(p.bin < 2, "skews toward the larger neighbour");
  assert.ok(p.db >= -4);
});

test("findSpectrumPeaks: 40 + 60 Hz resolved and labeled within 1 Hz at 32768 points", () => {
  const sr = 48000;
  const fft = 32768;
  const binHz = binWidthHz(sr, fft);
  const db = sineSpectrumDb([{ hz: 40, amp: 0.3 }, { hz: 60, amp: 0.3 }], sr, fft, Math.ceil(100 / binHz));
  const peaks = findSpectrumPeaks(db, binHz, 20, 80);
  assert.equal(peaks.length, 2, JSON.stringify(peaks));
  near(peaks[0].hz, 40, 0.5);
  near(peaks[1].hz, 60, 0.5);
});

test("findSpectrumPeaks: the same tones at 4096 points are not resolved accurately", () => {
  const sr = 48000;
  const fft = 4096;
  const binHz = binWidthHz(sr, fft);
  const db = sineSpectrumDb([{ hz: 40, amp: 0.3 }, { hz: 60, amp: 0.3 }], sr, fft, 12);
  const peaks = findSpectrumPeaks(db, binHz, 20, 80);
  const ok = peaks.length === 2 && Math.abs(peaks[0].hz - 40) < 1 && Math.abs(peaks[1].hz - 60) < 1;
  assert.ok(!ok, `4096-point FFT unexpectedly resolved both tones: ${JSON.stringify(peaks)}`);
});

test("findSpectrumPeaks: ignores quiet and non-prominent bumps, limits count, sorts by Hz", () => {
  const db = new Float32Array(200).fill(-100);
  db[50] = -20;
  db[49] = db[51] = -40;
  db[120] = -30;
  db[119] = db[121] = -45;
  db[150] = -95;
  db[80] = -60;
  db[79] = db[81] = -62;
  const peaks = findSpectrumPeaks(db, 1, 0, 199, { maxPeaks: 2 });
  assert.deepEqual(peaks.map((p) => Math.round(p.hz)), [50, 120]);
  const all = findSpectrumPeaks(db, 1, 0, 199, { maxPeaks: 5, minProminenceDb: 1 });
  assert.ok(all.some((p) => Math.round(p.hz) === 80));
  assert.ok(!all.some((p) => Math.round(p.hz) === 150), "below minDb");
});
