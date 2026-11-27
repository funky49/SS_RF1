import { BANDS, parseZoom } from "./metrics.js";
import { OscilloscopeView } from "./scope.js";

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

function freqToX(hz, minHz, maxHz, width) {
  const t = (hz - minHz) / (maxHz - minHz);
  return Math.max(0, Math.min(width, t * width));
}

function binRange(sampleRate, fftSize, binCount, minHz, maxHz) {
  const binHz = sampleRate / fftSize;
  const i0 = Math.max(0, Math.floor(minHz / binHz));
  const i1 = Math.min(binCount - 1, Math.ceil(maxHz / binHz));
  return { i0, i1, binHz };
}

export function drawBandMarkers(ctx, width, height, minHz, maxHz) {
  ctx.save();
  for (const band of BANDS) {
    if (band.max < minHz || band.min > maxHz) continue;
    const x0 = freqToX(Math.max(band.min, minHz), minHz, maxHz, width);
    const x1 = freqToX(Math.min(band.max, maxHz), minHz, maxHz, width);
    ctx.fillStyle = band.color + "18";
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height);
    ctx.strokeStyle = band.color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0 + 0.5, 0);
    ctx.lineTo(x0 + 0.5, height);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

export function renderBandLegend(el) {
  el.innerHTML = BANDS.map(
    (b) => `<span style="--c:${b.color}">${b.name} (${b.min}–${b.max})</span>`
  ).join("");
}

export class VisualizerHost {
  constructor(canvas) {
    this.canvas = canvas;
    this.mode = "fft";
    this.zoom = "20-20000";
    this.spectrogram = null;
    this.waterfall = null;
    this.peakBins = null;
    this.peakDecay = 0.92;
    this.scope = new OscilloscopeView();
  }

  setMode(mode) {
    this.mode = mode;
    this.spectrogram = null;
    this.waterfall = null;
  }

  setZoom(zoom) {
    this.zoom = zoom;
  }

  resetPeak() {
    this.peakBins = null;
    this.scope.resetPeak();
  }

  draw(frame) {
    const ctx = this.canvas.getContext("2d");
    const { w, h } = resizeCanvas(this.canvas);
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

    const { minHz, maxHz } = parseZoom(this.zoom);
    const drawBands = this.mode !== "waveform" && this.mode !== "circular";

    switch (this.mode) {
      case "waveform":
        this.drawWaveform(ctx, w, h, frame);
        break;
      case "fft":
        if (drawBands) drawBandMarkers(ctx, w, h, minHz, maxHz);
        this.drawFft(ctx, w, h, frame, minHz, maxHz);
        break;
      case "spectrogram":
        if (drawBands) drawBandMarkers(ctx, w, h, minHz, maxHz);
        this.drawSpectrogram(ctx, w, h, frame, minHz, maxHz);
        break;
      case "circular":
        this.drawCircular(ctx, w, h, frame, minHz, maxHz);
        break;
      case "waterfall":
        if (drawBands) drawBandMarkers(ctx, w, h, minHz, maxHz);
        this.drawWaterfall(ctx, w, h, frame, minHz, maxHz);
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
    const { i0, i1 } = binRange(frame.sampleRate, frame.fftSize, frame.binCount, minHz, maxHz);
    const span = Math.max(1, i1 - i0);
    if (!this.peakBins || this.peakBins.length !== span) {
      this.peakBins = new Float32Array(span);
    }

    const barW = w / span;
    for (let i = 0; i < span; i++) {
      const mag = frame.freq[i0 + i] / 255;
      this.peakBins[i] = Math.max(mag, this.peakBins[i] * this.peakDecay);
      const bh = mag * (h - 8);
      const ph = this.peakBins[i] * (h - 8);
      const x = i * barW;
      ctx.fillStyle = "#3ecf8e";
      ctx.fillRect(x, h - bh, Math.max(1, barW - 1), bh);
      ctx.fillStyle = "#e8a54b";
      ctx.fillRect(x, h - ph - 2, Math.max(1, barW - 1), 2);
    }
  }

  drawSpectrogram(ctx, w, h, frame, minHz, maxHz) {
    const { i0, i1 } = binRange(frame.sampleRate, frame.fftSize, frame.binCount, minHz, maxHz);
    const span = Math.max(1, i1 - i0);
    if (!this.spectrogram || this.spectrogram.width !== w || this.spectrogram.height !== h) {
      this.spectrogram = ctx.createImageData(w, h);
    }
    const img = this.spectrogram;
    // scroll left
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      img.data.copyWithin(row, row + 4, row + w * 4);
    }
    const x = w - 1;
    for (let y = 0; y < h; y++) {
      const bin = i0 + Math.floor((1 - y / h) * (span - 1));
      const mag = frame.freq[bin] / 255;
      const idx = (y * w + x) * 4;
      const r = Math.floor(mag * 40 + mag * mag * 200);
      const g = Math.floor(mag * 180);
      const b = Math.floor(80 + mag * 100);
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  drawWaterfall(ctx, w, h, frame, minHz, maxHz) {
    const { i0, i1 } = binRange(frame.sampleRate, frame.fftSize, frame.binCount, minHz, maxHz);
    const span = Math.max(1, i1 - i0);
    const rows = 64;
    if (!this.waterfall || this.waterfall[0]?.length !== span) {
      this.waterfall = Array.from({ length: rows }, () => new Float32Array(span));
    }
    // shift down
    for (let r = rows - 1; r > 0; r--) {
      this.waterfall[r].set(this.waterfall[r - 1]);
    }
    for (let i = 0; i < span; i++) {
      this.waterfall[0][i] = frame.freq[i0 + i] / 255;
    }

    const rowH = h / rows;
    const colW = w / span;
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < span; i++) {
        const mag = this.waterfall[r][i];
        const shade = Math.floor(mag * 220);
        ctx.fillStyle = `rgb(${shade * 0.3}, ${shade}, ${shade * 0.55})`;
        ctx.fillRect(i * colW, r * rowH, colW + 0.5, rowH + 0.5);
      }
    }
  }

  drawCircular(ctx, w, h, frame, minHz, maxHz) {
    const { i0, i1 } = binRange(frame.sampleRate, frame.fftSize, frame.binCount, minHz, maxHz);
    const span = Math.max(1, i1 - i0);
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.28;

    ctx.strokeStyle = "#2a4036";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i < span; i++) {
      const mag = frame.freq[i0 + i] / 255;
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
