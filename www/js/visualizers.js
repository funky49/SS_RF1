import { BANDS, parseZoom } from "./metrics.js";
import { OscilloscopeView } from "./scope.js";
import { chooseFftSize, resampleSpectrum, findSpectrumPeaks } from "./spectrum-res.js";

/** CSS pixels per bin from which FFT bars become a smooth curve with peak labels. */
const SMOOTH_PX_PER_BIN = 2;
const WATERFALL_ROWS = 64;

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { w, h, dpr };
}

export const FREQ_LIMIT_MIN = 20;
const MIN_SPAN_HZ = 10;
const ANIM_MS = 320;
const BG = [14, 22, 19];

function freqToX(hz, minHz, maxHz, width) {
  const t = (hz - minHz) / (maxHz - minHz);
  return Math.max(0, Math.min(width, t * width));
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function formatHz(hz) {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(k < 10 ? 2 : 1).replace(/\.?0+$/, "")}k`;
  }
  return `${Math.round(hz * 10) / 10}`;
}

function niceStep(raw) {
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * pow;
}

function binRange(sampleRate, fftSize, binCount, minHz, maxHz) {
  const binHz = sampleRate / fftSize;
  const i0 = Math.max(0, Math.floor(minHz / binHz));
  const i1 = Math.min(binCount - 1, Math.ceil(maxHz / binHz));
  return { i0, i1, binHz };
}

/** Draws colored band regions. `vertical` puts frequency on the y axis (low at bottom). */
export function drawBandMarkers(ctx, width, height, minHz, maxHz, vertical = false) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const len = vertical ? height : width;
  ctx.save();
  ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "top";
  for (const band of BANDS) {
    if (band.max < minHz || band.min > maxHz) continue;
    const a = freqToX(Math.max(band.min, minHz), minHz, maxHz, len);
    const b = freqToX(Math.min(band.max, maxHz), minHz, maxHz, len);
    ctx.fillStyle = band.color + "18";
    ctx.strokeStyle = band.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
    if (vertical) {
      const yTop = height - b;
      const yEdge = height - a;
      ctx.fillRect(0, yTop, width, Math.max(1, yEdge - yTop));
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(0, yEdge - 0.5);
      ctx.lineTo(width, yEdge - 0.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (yEdge - yTop > 14 * dpr) {
        ctx.fillStyle = band.color;
        ctx.fillText(band.name, width - ctx.measureText(band.name).width - 4 * dpr, yTop + 2 * dpr);
      }
    } else {
      ctx.fillRect(a, 0, Math.max(1, b - a), height);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(a + 0.5, 0);
      ctx.lineTo(a + 0.5, height);
      ctx.stroke();
      ctx.globalAlpha = 1;
      if (b - a > ctx.measureText(band.name).width + 6 * dpr) {
        ctx.fillStyle = band.color;
        ctx.fillText(band.name, a + 3 * dpr, 2 * dpr);
      }
    }
  }
  ctx.restore();
}

/** Frequency tick labels for the current view range. */
export function drawFreqAxis(ctx, width, height, minHz, maxHz, vertical = false) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const len = vertical ? height : width;
  const step = niceStep((maxHz - minHz) / Math.max(3, Math.floor(len / (vertical ? 60 : 90) / dpr)));
  ctx.save();
  ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = "rgba(14,22,19,0.85)";
  ctx.fillStyle = "#b8cfc2";
  for (let hz = Math.ceil(minHz / step) * step; hz <= maxHz; hz += step) {
    const p = freqToX(hz, minHz, maxHz, len);
    const label = formatHz(Math.round(hz * 1000) / 1000);
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#8aa396";
    ctx.fillRect(vertical ? 0 : p, vertical ? height - p : height - 5 * dpr, vertical ? 5 * dpr : 1, vertical ? 1 : 5 * dpr);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#b8cfc2";
    const tw = ctx.measureText(label).width;
    if (vertical) {
      const y = clamp(height - p, 6 * dpr, height - 3 * dpr);
      ctx.textBaseline = "middle";
      ctx.strokeText(label, 7 * dpr, y);
      ctx.fillText(label, 7 * dpr, y);
    } else {
      const x = clamp(p - tw / 2, 2 * dpr, width - tw - 2 * dpr);
      ctx.textBaseline = "bottom";
      ctx.strokeText(label, x, height - 6 * dpr);
      ctx.fillText(label, x, height - 6 * dpr);
    }
  }
  ctx.restore();
}

function drawRangeReadout(ctx, width, minHz, maxHz) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const label = `${formatHz(minHz)}–${formatHz(maxHz)} Hz`;
  ctx.save();
  ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  ctx.textBaseline = "bottom";
  ctx.fillStyle = "#8aa396";
  ctx.fillText(label, 6 * dpr, 28 * dpr);
  ctx.restore();
}

export const ALL_BAND_KEY = "all";

export function renderBandButtons(el, onPick) {
  el.innerHTML = "";
  const make = (key, text, range, color) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "band-btn";
    btn.dataset.band = key;
    btn.style.setProperty("--c", color);
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `<span class="band-btn-name">${text}</span>${range ? `<span class="band-btn-range">${range}</span>` : ""}`;
    btn.addEventListener("click", () => onPick(key));
    el.appendChild(btn);
  };
  make(ALL_BAND_KEY, "All", "", "#8aa396");
  for (const b of BANDS) {
    make(b.name, b.name, `${formatHz(b.min)}–${formatHz(b.max)}`, b.color);
  }
}

export class VisualizerHost {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = "fft";
    this.zoom = "20-20000";
    this.limitMax = 20000;
    this.presetRange = { minHz: 20, maxHz: 20000 };
    this.view = { minHz: 20, maxHz: 20000 };
    this.anim = null;
    this.activeBand = ALL_BAND_KEY;
    this.onActiveBandChange = null;
    this.spectrogram = null;
    this.specHist = [];
    this.specKey = "";
    this.waterfallRows = [];
    this.peakBins = null;
    this.peakDecay = 0.92;
    this.fftSize = 0;
    this.lastPeaks = null;
    this.waterfallKey = "";
    this.waterfallImg = null;
    this.waterfallCanvas = null;
    canvas.dataset.mode = this.mode;
    this.scope = new OscilloscopeView();
  }

  /** fftSize the GRAPH spectrum should use for the current mode and (target) view range. */
  desiredFftSize(sampleRate) {
    const { minHz, maxHz } = this.anim ? this.anim.to : this.view;
    return chooseFftSize({ minHz, maxHz, sampleRate, mode: this.mode, current: this.fftSize });
  }

  setMode(mode) {
    this.mode = mode;
    this.spectrogram = null;
    this.specHist = [];
    this.specKey = "";
    this.waterfallRows = [];
    this.canvas.dataset.mode = mode;
  }

  /** Frequency axis orientation for the current mode, or null when no frequency axis applies. */
  freqAxis() {
    if (this.mode === "spectrogram") return "y";
    if (this.mode === "waveform" || this.mode === "oscilloscope") return null;
    return "x";
  }

  setZoom(zoom, animate = false) {
    this.zoom = zoom;
    const { minHz, maxHz } = parseZoom(zoom);
    this.presetRange = { minHz, maxHz };
    this.limitMax = maxHz;
    this.setView(minHz, maxHz, { animate, key: ALL_BAND_KEY });
  }

  resetPeak() {
    this.peakBins = null;
    this.scope.resetPeak();
  }

  bandRange(band) {
    return {
      minHz: Math.max(band.min, FREQ_LIMIT_MIN),
      maxHz: Math.min(band.max, this.limitMax),
    };
  }

  bandAvailable(band) {
    const r = this.bandRange(band);
    return r.maxHz - r.minHz >= MIN_SPAN_HZ / 2;
  }

  clampView(minHz, maxHz) {
    const maxSpan = Math.max(MIN_SPAN_HZ, this.limitMax - FREQ_LIMIT_MIN);
    const span = clamp(maxHz - minHz, MIN_SPAN_HZ, maxSpan);
    const lo = clamp(minHz, FREQ_LIMIT_MIN, Math.max(FREQ_LIMIT_MIN, this.limitMax - span));
    return { minHz: lo, maxHz: lo + span };
  }

  setActiveBand(key) {
    if (this.activeBand === key) return;
    this.activeBand = key;
    this.onActiveBandChange?.(key);
  }

  /** Set the visible range; `key` marks the active band button (omit/null for manual changes). */
  setView(minHz, maxHz, { animate = false, key = null } = {}) {
    const target = this.clampView(minHz, maxHz);
    if (animate) {
      this.anim = { from: { ...this.getView() }, to: target, start: performance.now() };
    } else {
      this.anim = null;
      this.view = target;
    }
    this.setActiveBand(key);
  }

  /** Current (animated) view range. */
  getView() {
    if (this.anim) {
      const t = clamp((performance.now() - this.anim.start) / ANIM_MS, 0, 1);
      const { from, to } = this.anim;
      if (t >= 1) {
        this.view = to;
        this.anim = null;
      } else {
        const e = easeOutCubic(t);
        const geo = (a, b) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * e);
        this.view = { minHz: geo(from.minHz, to.minHz), maxHz: geo(from.maxHz, to.maxHz) };
      }
    }
    return this.view;
  }

  zoomToBand(key) {
    if (key === ALL_BAND_KEY) return this.resetView();
    const band = BANDS.find((b) => b.name === key);
    if (!band || !this.bandAvailable(band)) return;
    const r = this.bandRange(band);
    this.setView(r.minHz, r.maxHz, { animate: true, key });
  }

  resetView() {
    const { minHz, maxHz } = this.presetRange;
    this.setView(minHz, maxHz, { animate: true, key: ALL_BAND_KEY });
  }

  /** Zoom by `scale` (>1 zooms in) keeping the frequency under `frac` (0..1 along the axis) fixed. */
  zoomAt(frac, scale) {
    const { minHz, maxHz } = this.getView();
    const span = maxHz - minHz;
    const anchor = minHz + frac * span;
    const newSpan = span / scale;
    const lo = anchor - frac * newSpan;
    this.setView(lo, lo + newSpan);
  }

  /** Shift the window by a fraction of its span (positive = toward higher frequencies). */
  panBy(windowFrac) {
    const { minHz, maxHz } = this.getView();
    const shift = windowFrac * (maxHz - minHz);
    const clamped = this.clampView(minHz + shift, maxHz + shift);
    const same = clamped.minHz === minHz && clamped.maxHz === maxHz;
    this.setView(clamped.minHz, clamped.maxHz, { key: same ? this.activeBand : null });
  }

  draw(frame) {
    const ctx = this.canvas.getContext("2d");
    const { w, h } = resizeCanvas(this.canvas);
    const { minHz, maxHz } = this.getView();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0e1613";
    ctx.fillRect(0, 0, w, h);

    if (!frame) {
      ctx.fillStyle = "#8aa396";
      ctx.font = `${12 * (window.devicePixelRatio || 1)}px "IBM Plex Mono", monospace`;
      ctx.fillText("Enable mic to visualize", 16, h / 2);
      return;
    }

    if (this.mode === "oscilloscope") {
      this.drawOscilloscope(ctx, w, h, frame);
      return;
    }

    if (frame.fftSize !== this.fftSize) {
      this.fftSize = frame.fftSize;
      this.peakBins = null;
      this.lastPeaks = null;
    }

    switch (this.mode) {
      case "waveform":
        this.drawWaveform(ctx, w, h, frame);
        break;
      case "fft":
        drawBandMarkers(ctx, w, h, minHz, maxHz);
        this.drawFft(ctx, w, h, frame, minHz, maxHz);
        drawFreqAxis(ctx, w, h, minHz, maxHz);
        drawRangeReadout(ctx, w, minHz, maxHz);
        break;
      case "spectrogram":
        this.drawSpectrogram(ctx, w, h, frame, minHz, maxHz);
        drawBandMarkers(ctx, w, h, minHz, maxHz, true);
        drawFreqAxis(ctx, w, h, minHz, maxHz, true);
        drawRangeReadout(ctx, w, minHz, maxHz);
        break;
      case "circular":
        this.drawCircular(ctx, w, h, frame, minHz, maxHz);
        drawRangeReadout(ctx, w, minHz, maxHz);
        break;
      case "waterfall":
        this.drawWaterfall(ctx, w, h, frame, minHz, maxHz);
        drawBandMarkers(ctx, w, h, minHz, maxHz);
        drawFreqAxis(ctx, w, h, minHz, maxHz);
        drawRangeReadout(ctx, w, minHz, maxHz);
        break;
      default:
        this.drawFft(ctx, w, h, frame, minHz, maxHz);
    }
  }

  drawWaveform(ctx, w, h, frame) {
    const data = frame.time;
    ctx.strokeStyle = "#3ecf8e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = ((data[i] - 128) / 128) * (h * 0.42) + h / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // peak hold envelope
    let peak = 0;
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i] - 128) / 128);
    }
    const yPeak = h / 2 - peak * h * 0.42;
    ctx.strokeStyle = "#e26d5a";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, yPeak);
    ctx.lineTo(w, yPeak);
    ctx.moveTo(0, h - yPeak);
    ctx.lineTo(w, h - yPeak);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawOscilloscope(ctx, w, h, frame) {
    this.scope.draw(ctx, w, h, frame);
  }

  drawFft(ctx, w, h, frame, minHz, maxHz) {
    const { sampleRate, fftSize, binCount, freq } = frame;
    const binHz = sampleRate / fftSize;
    const span = maxHz - minHz;
    if (!this.peakBins || this.peakBins.length !== binCount) {
      this.peakBins = new Float32Array(binCount);
    }
    for (let i = 0; i < binCount; i++) {
      this.peakBins[i] = Math.max(freq[i] / 255, this.peakBins[i] * this.peakDecay);
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const smooth = (binHz / span) * (w / dpr) >= SMOOTH_PX_PER_BIN;
    if (smooth) {
      this.drawFftCurve(ctx, w, h, frame, minHz, maxHz);
    } else {
      this.lastPeaks = null;
      const first = Math.max(0, Math.floor(minHz / binHz - 0.5));
      const last = Math.min(binCount - 1, Math.ceil(maxHz / binHz + 0.5));
      for (let i = first; i <= last; i++) {
        const x0 = Math.max(0, ((i - 0.5) * binHz - minHz) / span * w);
        const x1 = Math.min(w, ((i + 0.5) * binHz - minHz) / span * w);
        if (x1 <= x0) continue;
        const bw = Math.max(1, x1 - x0 - (x1 - x0 > 3 ? 1 : 0));
        const bh = (freq[i] / 255) * (h - 8);
        const ph = this.peakBins[i] * (h - 8);
        ctx.fillStyle = "#3ecf8e";
        ctx.fillRect(x0, h - bh, bw, bh);
        ctx.fillStyle = "#e8a54b";
        ctx.fillRect(x0, h - ph - 2, bw, 2);
      }
    }
  }

  /** Zoomed-in FFT: interpolated area + line, peak-hold line, and labels on the strongest peaks. */
  drawFftCurve(ctx, w, h, frame, minHz, maxHz) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const binHz = frame.sampleRate / frame.fftSize;
    const cols = Math.max(2, Math.round(w / dpr));
    this.curve = resampleSpectrum(frame.freq, binHz, minHz, maxHz, cols, this.curve?.length === cols ? this.curve : undefined);
    this.peakCurve = resampleSpectrum(this.peakBins, binHz, minHz, maxHz, cols, this.peakCurve?.length === cols ? this.peakCurve : undefined);
    const yOf = (v) => h - (v / 255) * (h - 8);
    const xOf = (i) => ((i + 0.5) / cols) * w;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < cols; i++) ctx.lineTo(xOf(i), yOf(this.curve[i]));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(62, 207, 142, 0.35)";
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < cols; i++) ctx[i ? "lineTo" : "moveTo"](xOf(i), yOf(this.curve[i]));
    ctx.strokeStyle = "#3ecf8e";
    ctx.lineWidth = 2 * dpr;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < cols; i++) ctx[i ? "lineTo" : "moveTo"](xOf(i), yOf(this.peakCurve[i] * 255) - 1);
    ctx.strokeStyle = "#e8a54b";
    ctx.lineWidth = 1.5 * dpr;
    ctx.stroke();

    const peaks = frame.freqFloat ? findSpectrumPeaks(frame.freqFloat, binHz, minHz, maxHz) : [];
    this.lastPeaks = peaks;
    ctx.font = `${11 * dpr}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = "bottom";
    let prevRight = -Infinity;
    let prevY = Infinity;
    for (const p of peaks) {
      const x = ((p.hz - minHz) / (maxHz - minHz)) * w;
      const yCurve = yOf(this.curve[Math.max(0, Math.min(cols - 1, Math.floor((x / w) * cols)))]);
      const label = `${p.hz.toFixed(1)} Hz`;
      const tw = ctx.measureText(label).width;
      const lx = clamp(x - tw / 2, 2 * dpr, w - tw - 2 * dpr);
      let ly = Math.max(30 * dpr, yCurve - 8 * dpr);
      if (lx < prevRight + 4 * dpr) ly = Math.min(ly, prevY - 14 * dpr);
      ctx.fillStyle = "#f2f7f4";
      ctx.beginPath();
      ctx.moveTo(x, yCurve - 2 * dpr);
      ctx.lineTo(x - 4 * dpr, yCurve - 8 * dpr);
      ctx.lineTo(x + 4 * dpr, yCurve - 8 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = "rgba(14,22,19,0.9)";
      ctx.strokeText(label, lx, ly - 2 * dpr);
      ctx.fillText(label, lx, ly - 2 * dpr);
      prevRight = lx + tw;
      prevY = ly;
    }
    ctx.restore();
  }

  /** `entry` is a history column `{ data, binHz }` (or null for empty); `rowHz` maps each y to Hz. */
  paintSpectrogramColumn(img, x, w, h, entry, rowHz) {
    const col = entry?.data;
    const binCount = col ? col.length : 0;
    for (let y = 0; y < h; y++) {
      let mag = 0;
      const pos = col ? rowHz[y] / entry.binHz : -1;
      if (col && pos >= 0 && pos <= binCount - 1) {
        const i = Math.floor(pos);
        const t = pos - i;
        const a = col[i];
        const b = col[Math.min(binCount - 1, i + 1)];
        mag = (a + (b - a) * t) / 255;
      }
      const idx = (y * w + x) * 4;
      if (!col) {
        img.data[idx] = BG[0];
        img.data[idx + 1] = BG[1];
        img.data[idx + 2] = BG[2];
      } else {
        img.data[idx] = Math.floor(mag * 40 + mag * mag * 200);
        img.data[idx + 1] = Math.floor(mag * 180);
        img.data[idx + 2] = Math.floor(80 + mag * 100);
      }
      img.data[idx + 3] = 255;
    }
  }

  drawSpectrogram(ctx, w, h, frame, minHz, maxHz) {
    const binHz = frame.sampleRate / frame.fftSize;
    this.specHist.push({ data: Uint8Array.from(frame.freq), binHz });
    while (this.specHist.length > Math.max(w, 256)) this.specHist.shift();

    const key = `${minHz.toFixed(4)}|${maxHz.toFixed(4)}|${w}|${h}`;
    const rebuild = !this.spectrogram || this.spectrogram.width !== w || this.spectrogram.height !== h || key !== this.specKey;
    if (rebuild) {
      this.specKey = key;
      this.spectrogram = ctx.createImageData(w, h);
      this.specRowHz = new Float32Array(h);
      for (let y = 0; y < h; y++) {
        this.specRowHz[y] = minHz + (1 - (y + 0.5) / h) * (maxHz - minHz);
      }
      const hist = this.specHist;
      for (let x = 0; x < w; x++) {
        const hi = hist.length - w + x;
        this.paintSpectrogramColumn(this.spectrogram, x, w, h, hi >= 0 ? hist[hi] : null, this.specRowHz);
      }
    } else {
      const img = this.spectrogram;
      for (let y = 0; y < h; y++) {
        const row = y * w * 4;
        img.data.copyWithin(row, row + 4, row + w * 4);
      }
      this.paintSpectrogramColumn(img, w - 1, w, h, this.specHist[this.specHist.length - 1], this.specRowHz);
    }
    ctx.putImageData(this.spectrogram, 0, 0);
  }

  drawWaterfall(ctx, w, h, frame, minHz, maxHz) {
    const rows = WATERFALL_ROWS;
    const binHz = frame.sampleRate / frame.fftSize;
    const cols = w;
    const key = `${minHz.toFixed(4)}|${maxHz.toFixed(4)}|${cols}`;
    if (key !== this.waterfallKey) {
      this.waterfallKey = key;
      for (const row of this.waterfallRows) row.px = resampleSpectrum(row.data, row.binHz, minHz, maxHz, cols);
    }
    const data = Uint8Array.from(frame.freq);
    this.waterfallRows.unshift({ data, binHz, px: resampleSpectrum(data, binHz, minHz, maxHz, cols) });
    if (this.waterfallRows.length > rows) this.waterfallRows.pop();

    if (!this.waterfallImg || this.waterfallImg.width !== cols) {
      this.waterfallImg = new ImageData(cols, rows);
      this.waterfallCanvas = document.createElement("canvas");
      this.waterfallCanvas.width = cols;
      this.waterfallCanvas.height = rows;
    }
    const px = this.waterfallImg.data;
    px.fill(0);
    for (let r = 0; r < this.waterfallRows.length; r++) {
      const vals = this.waterfallRows[r].px;
      for (let x = 0; x < cols; x++) {
        const shade = (vals[x] / 255) * 220;
        const o = (r * cols + x) * 4;
        px[o] = shade * 0.3;
        px[o + 1] = shade;
        px[o + 2] = shade * 0.55;
        px[o + 3] = 255;
      }
    }
    this.waterfallCanvas.getContext("2d").putImageData(this.waterfallImg, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.waterfallCanvas, 0, 0, cols, rows, 0, 0, w, h);
    ctx.restore();
  }

  drawCircular(ctx, w, h, frame, minHz, maxHz) {
    const { i0, i1, binHz } = binRange(frame.sampleRate, frame.fftSize, frame.binCount, minHz, maxHz);
    let span = Math.max(1, i1 - i0);
    let mags = frame.freq.subarray(i0, i0 + span);
    if (span < 360) {
      span = 360;
      mags = resampleSpectrum(frame.freq, binHz, minHz, maxHz, span, this.ringPts?.length === span ? this.ringPts : undefined);
      this.ringPts = mags;
    }
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.28;

    ctx.strokeStyle = "#2a4036";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < span; i++) {
      const mag = mags[i] / 255;
      const ang = (i / span) * Math.PI * 2 - Math.PI / 2;
      const r = radius + mag * radius * 1.1;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = "#3ecf8e";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "rgba(62, 207, 142, 0.12)";
    ctx.fill();
  }
}

export function drawStripWave(canvas, timeData) {
  const ctx = canvas.getContext("2d");
  const { w, h } = resizeCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(14, 22, 19, 0.9)";
  ctx.fillRect(0, 0, w, h);
  if (!timeData) return;
  ctx.strokeStyle = "#3ecf8e";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const step = Math.max(1, Math.floor(timeData.length / w));
  for (let x = 0; x < w; x++) {
    const i = Math.min(timeData.length - 1, x * step);
    const y = ((timeData[i] - 128) / 128) * (h * 0.4) + h / 2;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
