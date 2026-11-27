/**
 * Oscilloscope view for the GRAPH tab.
 * Pure helpers (trigger finder, time/div math, stats) are DOM-free and unit tested;
 * OscilloscopeView does the canvas drawing.
 */

export const TIME_DIVS_MS = [0.2, 0.5, 1, 2, 5, 10];
export const GAINS = [1, 2, 4, 8, 16];
export const TRIGGER_MODES = ["auto", "normal", "off"];
export const H_DIVS = 10;
export const V_DIVS = 8;
/** Normalized units per vertical division at gain x1 (full scale ±1 spans all 8 divisions). */
export const BASE_UNITS_PER_DIV = 0.25;
/** Trigger point sits this many divisions in from the left edge. */
export const PRE_TRIGGER_DIVS = 1;
/** Samples of the buffer reserved for searching a trigger edge after the displayed window. */
export const MIN_SEARCH_SAMPLES = 512;
/** Hysteresis in divisions: signal must dip this far below the level before a rise can trigger. */
export const HYSTERESIS_DIVS = 0.1;

export const DEFAULT_CONFIG = Object.freeze({
  timeDivMs: 2,
  gain: 1,
  triggerMode: "auto",
  level: 0,
  persistence: 0.35,
  peakHold: false,
});

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

export function unitsPerDiv(gain) {
  return BASE_UNITS_PER_DIV / gain;
}

export function hysteresisFor(gain) {
  return HYSTERESIS_DIVS * unitsPerDiv(gain);
}

/** Total samples (float) shown across the full 10-division window. */
export function spanSamples(timeDivMs, sampleRate) {
  return (H_DIVS * timeDivMs * sampleRate) / 1000;
}

export function preTriggerSamples(timeDivMs, sampleRate) {
  return (PRE_TRIGGER_DIVS * timeDivMs * sampleRate) / 1000;
}

/** Longest time/div for which the buffer still leaves MIN_SEARCH_SAMPLES to look for a trigger. */
export function maxTimeDivMs(bufferLength, sampleRate, minSearch = MIN_SEARCH_SAMPLES) {
  const usable = Math.max(0, bufferLength - minSearch);
  return ((usable / sampleRate) * 1000) / H_DIVS;
}

/** Clamp a requested time/div to what the buffer can show. */
export function resolveTimeDiv(requestedMs, bufferLength, sampleRate) {
  const limit = maxTimeDivMs(bufferLength, sampleRate);
  const clamped = requestedMs > limit;
  const timeDivMs = clamped ? limit : requestedMs;
  return {
    requestedMs,
    timeDivMs,
    clamped,
    spanSamples: spanSamples(timeDivMs, sampleRate),
    preSamples: preTriggerSamples(timeDivMs, sampleRate),
  };
}

/** Window start (fractional sample index) when the trigger edge is at `triggerIndex`. */
export function windowStart(triggerIndex, preSamples) {
  return triggerIndex - preSamples;
}

/**
 * Find the first rising-edge crossing of `level` in data[0..maxIndex].
 * The trigger arms only after the signal has been below `level - hysteresis`, so noise around the
 * level cannot re-trigger. Returns the fractional sample index of the crossing or -1.
 */
export function findRisingTrigger(data, level, hysteresis, minIndex = 0, maxIndex = data.length - 1) {
  const last = Math.min(maxIndex, data.length - 1);
  const armBelow = level - hysteresis;
  let armed = false;
  for (let i = 0; i <= last; i++) {
    const v = data[i];
    if (v < armBelow) {
      armed = true;
    } else if (armed && v >= level && i > 0) {
      const prev = data[i - 1];
      const idx = i - 1 + (level - prev) / (v - prev);
      if (idx >= minIndex) return idx;
      armed = false;
    }
  }
  return -1;
}

/** All hysteresis-qualified rising crossings across the whole buffer (fractional indices). */
export function findAllRisingCrossings(data, level, hysteresis) {
  const out = [];
  const armBelow = level - hysteresis;
  let armed = false;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < armBelow) {
      armed = true;
    } else if (armed && v >= level && i > 0) {
      const prev = data[i - 1];
      out.push(i - 1 + (level - prev) / (v - prev));
      armed = false;
    }
  }
  return out;
}

/**
 * Period in samples from consecutive trigger crossings. Requires at least two crossings and
 * intervals that agree with the median within `tolerance` (rejects noise).
 */
export function periodFromCrossings(crossings, tolerance = 0.15) {
  if (crossings.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < crossings.length; i++) intervals.push(crossings[i] - crossings[i - 1]);
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!(median > 0)) return null;
  for (const iv of intervals) {
    if (Math.abs(iv - median) > tolerance * median) return null;
  }
  const mean = (crossings[crossings.length - 1] - crossings[0]) / intervals.length;
  return { periodSamples: mean, count: crossings.length };
}

/** Frequency estimate from trigger period, or null. */
export function estimateFrequency(data, sampleRate, level, hysteresis) {
  const p = periodFromCrossings(findAllRisingCrossings(data, level, hysteresis));
  if (!p) return null;
  return { hz: sampleRate / p.periodSamples, periodMs: (p.periodSamples / sampleRate) * 1000, crossings: p.count };
}

export function vppAndRms(data) {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v * v;
  }
  if (!data.length) return { min: 0, max: 0, vpp: 0, rms: 0 };
  return { min, max, vpp: max - min, rms: Math.sqrt(sum / data.length) };
}

/** Byte time-domain buffer (0..255, 128 = 0) to normalized floats. */
export function bytesToFloat(bytes, out = new Float32Array(bytes.length)) {
  for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] - 128) / 128;
  return out;
}

/** Linear interpolation of data at a fractional index (clamped to the buffer). */
export function sampleAt(data, pos) {
  if (pos <= 0) return data[0];
  const last = data.length - 1;
  if (pos >= last) return data[last];
  const i = Math.floor(pos);
  const f = pos - i;
  return data[i] + (data[i + 1] - data[i]) * f;
}

/** Phosphor decay time constant for a 0..1 persistence setting (0 = off). */
export function persistenceTauMs(p) {
  if (!(p > 0)) return 0;
  return 60 * Math.pow(50, clamp(p, 0, 1));
}

/**
 * Decay is applied in steps of at least `minStep` because 8-bit canvas alpha cannot represent tiny
 * per-frame fades (they would round to no change and leave a permanent ghost).
 */
export function decayStep(p, accumulatedMs, minStep = 0.08) {
  const tau = persistenceTauMs(p);
  if (tau <= 0) return { apply: true, alpha: 1 };
  const alpha = 1 - Math.exp(-accumulatedMs / tau);
  return { apply: alpha >= minStep, alpha };
}

export function formatNumber(v, digits = 3) {
  return Number(v.toPrecision(digits)).toString();
}

export function formatTimeDiv(ms) {
  return `${formatNumber(ms, 2)} ms/div`;
}

export function formatUnitsPerDiv(upd) {
  return `${formatNumber(upd, 3)} u/div`;
}

export function formatFrequency(hz) {
  if (hz == null) return "—";
  return hz >= 1000 ? `${(hz / 1000).toFixed(3)} kHz` : `${hz.toFixed(hz < 100 ? 2 : 1)} Hz`;
}

const GREEN = "62, 207, 142";
const CORE = "176, 255, 214";
const AMBER = "232, 165, 75";
const PEAK_COLS = 400;
const PEAK_TAU_MS = 5000;

export class OscilloscopeView {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.frozen = false;
    this.snapshot = null;
    this.held = null;
    this.phosphor = null;
    this.decayAccMs = 0;
    this.lastT = 0;
    this.peakMax = new Float32Array(PEAK_COLS);
    this.peakMin = new Float32Array(PEAK_COLS);
    this.peakValid = false;
    this.clearPending = false;
    this.status = null;
    this.onUpdate = null;
    this.lastEmit = 0;
    this.floatScratch = null;
  }

  setConfig(partial) {
    const prev = this.config;
    this.config = { ...prev, ...partial };
    if (partial.timeDivMs !== undefined && partial.timeDivMs !== prev.timeDivMs) this.resetPeak();
    if (
      (partial.timeDivMs !== undefined && partial.timeDivMs !== prev.timeDivMs) ||
      (partial.gain !== undefined && partial.gain !== prev.gain)
    ) {
      this.clearPending = true;
    }
  }

  setFrozen(on) {
    this.frozen = !!on;
    if (!on) this.snapshot = null;
  }

  resetPeak() {
    this.peakValid = false;
  }

  frameData(frame) {
    if (frame.timeFloat && frame.timeFloat.length) return frame.timeFloat;
    if (!this.floatScratch || this.floatScratch.length !== frame.time.length) {
      this.floatScratch = new Float32Array(frame.time.length);
    }
    return bytesToFloat(frame.time, this.floatScratch);
  }

  draw(ctx, w, h, frame) {
    const cfg = this.config;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const now = performance.now();
    const dt = this.lastT ? Math.min(250, now - this.lastT) : 16;
    this.lastT = now;

    let data = this.frameData(frame);
    const sampleRate = frame.sampleRate;
    if (this.frozen) {
      if (!this.snapshot || this.snapshot.data.length !== data.length) {
        this.snapshot = { data: Float32Array.from(data), sampleRate };
      }
      data = this.snapshot.data;
    }

    const tdv = resolveTimeDiv(cfg.timeDivMs, data.length, sampleRate);
    const hyst = hysteresisFor(cfg.gain);
    const maxTrig = data.length - 1 - (tdv.spanSamples - tdv.preSamples);

    let trigIndex = -1;
    if (cfg.triggerMode !== "off") {
      trigIndex = findRisingTrigger(data, cfg.level, hyst, tdv.preSamples, maxTrig);
    }

    let view; // { data, start, label }
    let freshTrace = true;
    let trigLabel;
    if (this.frozen) {
      view = { data, start: trigIndex >= 0 ? windowStart(trigIndex, tdv.preSamples) : data.length - tdv.spanSamples };
      trigLabel = "STOP";
      freshTrace = false;
    } else if (trigIndex >= 0) {
      view = { data: Float32Array.from(data), start: windowStart(trigIndex, tdv.preSamples) };
      this.held = view;
      trigLabel = "TRIG'D";
    } else if (cfg.triggerMode === "normal") {
      view = this.held;
      trigLabel = "WAIT";
      freshTrace = false;
    } else {
      view = { data, start: data.length - tdv.spanSamples };
      trigLabel = cfg.triggerMode === "auto" ? "AUTO" : "FREE";
    }

    const buf = this.ensurePhosphor(w, h);
    const bctx = buf.getContext("2d");
    const persistent = cfg.persistence > 0 && freshTrace && !this.frozen;
    if (this.clearPending) {
      bctx.clearRect(0, 0, w, h);
      this.clearPending = false;
    }
    if (persistent) {
      this.decayAccMs += dt;
      const step = decayStep(cfg.persistence, this.decayAccMs);
      if (step.apply) {
        bctx.globalCompositeOperation = "destination-out";
        bctx.fillStyle = `rgba(0,0,0,${step.alpha})`;
        bctx.fillRect(0, 0, w, h);
        bctx.globalCompositeOperation = "source-over";
        this.decayAccMs = 0;
      }
    } else {
      bctx.clearRect(0, 0, w, h);
      this.decayAccMs = 0;
    }
    if (view) {
      this.drawTrace(bctx, w, h, view, tdv, cfg, dpr, persistent);
      if (cfg.peakHold && freshTrace) this.updatePeak(view, tdv, dt, sampleRate);
    }

    this.drawGraticule(ctx, w, h, dpr);
    if (cfg.peakHold && this.peakValid) this.drawPeak(ctx, w, h, cfg.gain);
    ctx.drawImage(buf, 0, 0);
    this.drawTriggerMarker(ctx, w, h, cfg, tdv, dpr, trigIndex >= 0 || cfg.triggerMode === "off");
    this.drawLabels(ctx, w, h, cfg, tdv, trigLabel, dpr);

    const whole = vppAndRms(data);
    const freq = estimateFrequency(data, sampleRate, cfg.level, hyst);
    this.status = {
      trigLabel,
      timeDivMs: tdv.timeDivMs,
      requestedMs: tdv.requestedMs,
      clamped: tdv.clamped,
      maxTimeDivMs: maxTimeDivMs(data.length, sampleRate),
      bufferLength: data.length,
      sampleRate,
      unitsPerDiv: unitsPerDiv(cfg.gain),
      hz: freq ? freq.hz : null,
      periodMs: freq ? freq.periodMs : null,
      vpp: whole.vpp,
      rms: whole.rms,
    };
    if (this.onUpdate && now - this.lastEmit > 120) {
      this.lastEmit = now;
      this.onUpdate(this.status);
    }
  }

  ensurePhosphor(w, h) {
    if (!this.phosphor) this.phosphor = document.createElement("canvas");
    if (this.phosphor.width !== w || this.phosphor.height !== h) {
      this.phosphor.width = w;
      this.phosphor.height = h;
    }
    return this.phosphor;
  }

  yFor(v, h, gain) {
    return h / 2 - (v * gain * (h / V_DIVS)) / BASE_UNITS_PER_DIV;
  }

  drawGraticule(ctx, w, h, dpr) {
    const dx = w / H_DIVS;
    const dy = h / V_DIVS;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(${GREEN}, 0.16)`;
    ctx.beginPath();
    for (let i = 1; i < H_DIVS; i++) {
      const x = Math.round(i * dx) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let j = 1; j < V_DIVS; j++) {
      const y = Math.round(j * dy) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();

    ctx.strokeStyle = `rgba(${GREEN}, 0.34)`;
    ctx.beginPath();
    const cx = Math.round(w / 2) + 0.5;
    const cy = Math.round(h / 2) + 0.5;
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();

    // minor ticks: 5 per division along both center lines
    ctx.strokeStyle = `rgba(${GREEN}, 0.5)`;
    ctx.beginPath();
    const tick = 3 * dpr;
    for (let i = 0; i < H_DIVS * 5; i++) {
      const x = Math.round((i * dx) / 5) + 0.5;
      const len = i % 5 === 0 ? tick * 1.6 : tick;
      ctx.moveTo(x, cy - len);
      ctx.lineTo(x, cy + len);
    }
    for (let j = 0; j < V_DIVS * 5; j++) {
      const y = Math.round((j * dy) / 5) + 0.5;
      const len = j % 5 === 0 ? tick * 1.6 : tick;
      ctx.moveTo(cx - len, y);
      ctx.lineTo(cx + len, y);
    }
    ctx.stroke();

    ctx.strokeStyle = `rgba(${GREEN}, 0.4)`;
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
    ctx.restore();
  }

  tracePoints(view, tdv, w, h, gain) {
    const { data, start } = view;
    const span = tdv.spanSamples;
    const pts = [];
    const first = Math.max(0, Math.ceil(start));
    const last = Math.min(data.length - 1, Math.floor(start + span));
    const step = Math.max(1, Math.floor((last - first) / (w * 2)));
    const xFor = (idx) => ((idx - start) / span) * w;
    if (start < 0 || first > start) {
      const p = Math.max(0, start);
      pts.push(xFor(p), this.yFor(sampleAt(data, p), h, gain));
    }
    for (let i = first; i <= last; i += step) pts.push(xFor(i), this.yFor(data[i], h, gain));
    const end = Math.min(data.length - 1, start + span);
    if (end > last) pts.push(xFor(end), this.yFor(sampleAt(data, end), h, gain));
    return pts;
  }

  tracePath(ctx, pts, smooth) {
    ctx.beginPath();
    if (pts.length < 4) return;
    ctx.moveTo(pts[0], pts[1]);
    if (!smooth) {
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      return;
    }
    for (let i = 2; i < pts.length - 2; i += 2) {
      const mx = (pts[i] + pts[i + 2]) / 2;
      const my = (pts[i + 1] + pts[i + 3]) / 2;
      ctx.quadraticCurveTo(pts[i], pts[i + 1], mx, my);
    }
    ctx.lineTo(pts[pts.length - 2], pts[pts.length - 1]);
  }

  drawTrace(bctx, w, h, view, tdv, cfg, dpr, persistent) {
    const pts = this.tracePoints(view, tdv, w, h, cfg.gain);
    const sparse = pts.length / 2 < w / 8;
    bctx.save();
    bctx.lineJoin = "round";
    bctx.lineCap = "round";
    const k = persistent ? 0.8 : 1;
    this.tracePath(bctx, pts, sparse);
    bctx.strokeStyle = `rgba(${GREEN}, ${0.16 * k})`;
    bctx.lineWidth = 7 * dpr;
    bctx.stroke();
    bctx.strokeStyle = `rgba(${GREEN}, ${0.35 * k})`;
    bctx.lineWidth = 3.5 * dpr;
    bctx.stroke();
    bctx.strokeStyle = `rgba(${CORE}, ${0.95 * k})`;
    bctx.lineWidth = 1.4 * dpr;
    bctx.stroke();
    bctx.restore();
  }

  updatePeak(view, tdv, dt, sampleRate) {
    const { data, start } = view;
    const span = tdv.spanSamples;
    const keep = Math.exp(-dt / PEAK_TAU_MS);
    for (let c = 0; c < PEAK_COLS; c++) {
      const a = start + (c / PEAK_COLS) * span;
      const b = start + ((c + 1) / PEAK_COLS) * span;
      let hi = sampleAt(data, a);
      let lo = hi;
      const vb = sampleAt(data, b);
      if (vb > hi) hi = vb;
      if (vb < lo) lo = vb;
      const i0 = Math.max(0, Math.ceil(a));
      const i1 = Math.min(data.length - 1, Math.floor(b));
      for (let i = i0; i <= i1; i++) {
        if (data[i] > hi) hi = data[i];
        if (data[i] < lo) lo = data[i];
      }
      if (!this.peakValid) {
        this.peakMax[c] = hi;
        this.peakMin[c] = lo;
      } else {
        this.peakMax[c] = hi >= this.peakMax[c] ? hi : hi + (this.peakMax[c] - hi) * keep;
        this.peakMin[c] = lo <= this.peakMin[c] ? lo : lo + (this.peakMin[c] - lo) * keep;
      }
    }
    this.peakValid = true;
  }

  drawPeak(ctx, w, h, gain) {
    ctx.save();
    ctx.beginPath();
    for (let c = 0; c < PEAK_COLS; c++) {
      const x = ((c + 0.5) / PEAK_COLS) * w;
      const y = this.yFor(this.peakMax[c], h, gain);
      if (c === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let c = PEAK_COLS - 1; c >= 0; c--) {
      ctx.lineTo(((c + 0.5) / PEAK_COLS) * w, this.yFor(this.peakMin[c], h, gain));
    }
    ctx.closePath();
    ctx.fillStyle = `rgba(${AMBER}, 0.1)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(${AMBER}, 0.35)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawTriggerMarker(ctx, w, h, cfg, tdv, dpr, active) {
    const rawY = this.yFor(cfg.level, h, cfg.gain);
    const y = clamp(rawY, 4 * dpr, h - 4 * dpr);
    ctx.save();
    ctx.strokeStyle = `rgba(${AMBER}, ${active ? 0.75 : 0.4})`;
    ctx.fillStyle = `rgba(${AMBER}, ${active ? 0.95 : 0.55})`;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.setLineDash([5 * dpr, 5 * dpr]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    const s = 5 * dpr;
    ctx.beginPath();
    ctx.moveTo(w, y);
    ctx.lineTo(w - 1.6 * s, y - s);
    ctx.lineTo(w - 1.6 * s, y + s);
    ctx.closePath();
    ctx.fill();
    if (cfg.triggerMode !== "off") {
      const tx = (PRE_TRIGGER_DIVS / H_DIVS) * w;
      ctx.beginPath();
      ctx.moveTo(tx, y - 2 * s);
      ctx.lineTo(tx - s, y - 3.2 * s);
      ctx.lineTo(tx + s, y - 3.2 * s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawLabels(ctx, w, h, cfg, tdv, trigLabel, dpr) {
    const fs = 11 * dpr;
    const pad = 6 * dpr;
    ctx.save();
    ctx.font = `${fs}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = "alphabetic";
    const halo = (text, x, y, color, align = "left") => {
      ctx.textAlign = align;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = "rgba(14,22,19,0.9)";
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    const dim = "rgba(184, 207, 194, 0.95)";
    halo(`${formatTimeDiv(tdv.timeDivMs)}${tdv.clamped ? " (max)" : ""}`, pad, h - pad, tdv.clamped ? `rgb(${AMBER})` : dim);
    halo(`${formatUnitsPerDiv(unitsPerDiv(cfg.gain))} · x${cfg.gain}`, pad, fs + pad, dim);
    const trigColor = trigLabel === "TRIG'D" ? `rgb(${GREEN})` : trigLabel === "WAIT" ? `rgb(${AMBER})` : dim;
    halo(trigLabel, w - pad - 10 * dpr, fs + pad, trigColor, "right");
    halo("uncalibrated", w - pad, h - pad, "rgba(138,163,150,0.9)", "right");
    if (tdv.clamped) {
      halo(`${formatTimeDiv(tdv.requestedMs)}: buffer too short, clamped`, w / 2, h - pad - fs * 1.3, `rgb(${AMBER})`, "center");
    }
    ctx.restore();
  }
}
