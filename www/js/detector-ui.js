import {
  MosquitoTracker,
  analyzeMosquito,
  MOSQUITO_BAND,
  AircraftTracker,
  EnvelopeTracker,
  StreamAligner,
  confidenceBand,
  bandLevelDb,
  median,
} from "./detectors.js";

const ANALYSIS_MS = 100;
const $ = (id) => document.getElementById(id);

function panelActive(tool) {
  const el = document.querySelector(`[data-tool-panel="${tool}"]`);
  return !!el && !el.hidden && !$("panel-toys")?.hidden;
}

function setText(id, text) {
  const el = $(id);
  if (el && el.textContent !== text) el.textContent = text;
}

/**
 * UI glue for the mosquito and aircraft detectors. Reads frames from the shared
 * AudioEngine analyser (no extra mic stream) and only runs the panel that is visible.
 */
export class DetectorsUI {
  constructor(engine) {
    this.engine = engine;
    this.mosquito = new MosquitoTracker();
    this.aircraft = new AircraftTracker();
    this.aligner = new StreamAligner();
    this.envelope = null;
    this.envelopeRate = 0;
    this.lastMq = 0;
    this.lastAc = 0;
    this.prevMqLevel = "none";
    this.lastAlertAt = -1e9;
    this.mqLog = [];
    this._bind();
  }

  _bind() {
    $("mq-clear")?.addEventListener("click", () => {
      this.mqLog = [];
      this._renderLog();
    });
    for (const id of ["mq-vibrate", "mq-beep"]) {
      $(id)?.addEventListener("change", (e) => {
        if (e.target.checked && id === "mq-beep") this._beep(0.05);
        if (e.target.checked && id === "mq-vibrate") navigator.vibrate?.(60);
      });
    }
  }

  onToolSelected(id) {
    if (id === "mosquito") {
      this.mosquito.reset();
      this.prevMqLevel = "none";
    }
    if (id === "aircraft") {
      this.aircraft.reset();
      this.aligner.reset();
      this.envelope?.reset();
    }
  }

  tick(frame) {
    const mq = panelActive("mosquito");
    const ac = panelActive("aircraft");
    if (!mq && !ac) return;
    const now = performance.now();
    if (!frame) {
      if (mq) this._idle("mq");
      if (ac) this._idle("ac");
      return;
    }
    if (ac) {
      this._feedEnvelope(frame, now / 1000);
    }
    if (mq && now - this.lastMq >= ANALYSIS_MS) {
      this.lastMq = now;
      this._tickMosquito(frame, now / 1000);
    }
    if (ac && now - this.lastAc >= ANALYSIS_MS) {
      this.lastAc = now;
      this._tickAircraft(frame, now / 1000);
    }
  }

  _idle(kind) {
    if (kind === "mq") {
      setText("mq-result", "Enable mic to start");
      this._setMeter("none", 0);
    } else {
      setText("ac-result", "Enable mic to start");
      setText("ac-conf", "Listening…");
    }
  }

  _feedEnvelope(frame, nowSec) {
    if (!this.envelope || this.envelopeRate !== frame.sampleRate) {
      this.envelope = new EnvelopeTracker(frame.sampleRate);
      this.envelopeRate = frame.sampleRate;
      this.aligner.reset();
    }
    this.envelope.push(this.aligner.push(frame.timeFloat || frame.time, frame.sampleRate, nowSec));
  }

  /* ---------------- Mosquito ---------------- */

  _tickMosquito(frame, nowSec) {
    const binHz = frame.sampleRate / frame.fftSize;
    const analysis = analyzeMosquito(frame.freqFloat, binHz);
    const r = this.mosquito.update(analysis, nowSec);

    this._setMeter(r.level, r.confidence);
    const label = { none: "No mosquito-like tone", possible: "Possible mosquito", likely: "Likely mosquito" }[r.level];
    setText("mq-result", label);
    setText("mq-hz", r.level === "none" ? "— Hz" : `${r.hz.toFixed(0)} Hz`);
    setText("mq-snr", r.snrDb > 0 ? `${r.snrDb.toFixed(0)} dB` : "— dB");
    setText("mq-stab", r.candidateHz ? `${Math.round(r.stability * 100)}%` : "—");
    setText("mq-harm", r.candidateHz ? `${r.harmonics} of 2 (2x, 3x)` : "—");

    let note = "";
    if (r.mains) note = "Looks like 50/60 Hz mains hum (fan, charger, transformer) — confidence reduced.";
    else if (r.level === "possible" && !r.harmonics) note = "Steady tone found but no harmonics — could be a whistle, beep or electronics.";
    setText("mq-note", note);

    this._drawMosquito(frame, binHz, r);

    if (r.level === "likely" && this.prevMqLevel !== "likely") this._onLikely(r, nowSec);
    this.prevMqLevel = r.level;
  }

  _onLikely(r, nowSec) {
    if (nowSec - this.lastAlertAt < 5) return;
    this.lastAlertAt = nowSec;
    const d = new Date();
    const hh = [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
    this.mqLog.unshift(`${hh} · likely · ${r.hz.toFixed(0)} Hz · ${Math.round(r.confidence * 100)}% · ${r.harmonics} harmonic${r.harmonics === 1 ? "" : "s"}`);
    this.mqLog.length = Math.min(this.mqLog.length, 25);
    this._renderLog();
    if ($("mq-vibrate")?.checked) navigator.vibrate?.([120, 80, 120]);
    if ($("mq-beep")?.checked) this._beep(0.12);
  }

  _renderLog() {
    const ol = $("mq-log");
    if (!ol) return;
    ol.innerHTML = this.mqLog.length
      ? this.mqLog.map((t) => `<li>${t}</li>`).join("")
      : '<li class="empty">No detections yet.</li>';
  }

  _beep(dur) {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1400;
    const t0 = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.15, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _setMeter(level, conf) {
    for (const k of ["none", "possible", "likely"]) $(`mq-seg-${k}`)?.classList.toggle("on", k === level);
    const bar = $("mq-bar");
    if (bar) bar.style.width = `${Math.round(Math.min(1, conf) * 100)}%`;
  }

  _drawMosquito(frame, binHz, r) {
    const canvas = $("mq-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const lo = Math.ceil(MOSQUITO_BAND.min / binHz);
    const hi = Math.floor(MOSQUITO_BAND.max / binHz);
    const vals = [];
    for (let i = lo; i <= hi; i++) vals.push(Number.isFinite(frame.freqFloat[i]) ? frame.freqFloat[i] : -140);
    const floor = median(vals);
    const top = Math.max(floor + 40, Math.max(...vals) + 3);
    ctx.fillStyle = "#1a2922";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#2a4036";
    ctx.lineWidth = 1;
    for (const hz of [400, 500, 600, 700, 800]) {
      const x = ((hz - MOSQUITO_BAND.min) / (MOSQUITO_BAND.max - MOSQUITO_BAND.min)) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    const yOf = (db) => h - 4 - ((db - floor + 6) / (top - floor + 6)) * (h - 14);
    ctx.beginPath();
    ctx.moveTo(0, h);
    vals.forEach((v, i) => ctx.lineTo((i / (vals.length - 1)) * w, yOf(v)));
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(62, 207, 142, 0.35)";
    ctx.fill();
    ctx.strokeStyle = "#3ecf8e";
    ctx.beginPath();
    vals.forEach((v, i) => {
      const x = (i / (vals.length - 1)) * w;
      if (i) ctx.lineTo(x, yOf(v));
      else ctx.moveTo(x, yOf(v));
    });
    ctx.stroke();

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#8aa396";
    ctx.beginPath();
    ctx.moveTo(0, yOf(floor));
    ctx.lineTo(w, yOf(floor));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#8aa396";
    ctx.font = "11px IBM Plex Mono, monospace";
    ctx.fillText("noise floor", 6, yOf(floor) - 4);

    if (r.candidateHz >= MOSQUITO_BAND.min && r.candidateHz <= MOSQUITO_BAND.max && r.stability >= 0.5) {
      const x = ((r.candidateHz - MOSQUITO_BAND.min) / (MOSQUITO_BAND.max - MOSQUITO_BAND.min)) * w;
      ctx.strokeStyle = r.level === "likely" ? "#e26d5a" : "#e8a54b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      const txt = `${r.candidateHz.toFixed(0)} Hz`;
      ctx.fillText(txt, x > w - 70 ? x - 62 : x + 6, 14);
    }
  }

  /* ---------------- Aircraft ---------------- */

  _tickAircraft(frame, nowSec) {
    const binHz = frame.sampleRate / frame.fftSize;
    const levelDb = bandLevelDb(frame.freqFloat, binHz, 30, 8000);
    const r = this.aircraft.update({
      t: nowSec,
      levelDb,
      freqDb: frame.freqFloat,
      binHz,
      env: this.envelope ? this.envelope.get() : null,
      envRate: this.envelope ? this.envelope.envRate : 0,
    });

    setText("ac-result", r.type === "none" ? "No aircraft-like sound" : r.label);
    setText(
      "ac-conf",
      r.type === "none"
        ? "Listening… (needs a sustained pattern above the room noise)"
        : `Confidence ${Math.round(r.confidence * 100)}% (${confidenceBand(r.confidence)}) · sound pattern only`
    );
    const bar = $("ac-bar");
    if (bar) bar.style.width = `${Math.round(r.confidence * 100)}%`;

    const a = r.approach;
    const badge = $("ac-trend");
    if (badge) {
      badge.textContent = r.type === "none" ? "—" : a.state;
      badge.className = `trend-badge ${r.type === "none" ? "steady" : a.state}`;
    }
    setText(
      "ac-trend-detail",
      `${a.levelSlopeDbPerSec >= 0 ? "+" : "−"}${Math.abs(a.levelSlopeDbPerSec).toFixed(2)} dB/s over ~10 s · trend confidence ${Math.round(a.confidence * 100)}%`
    );
    setText("ac-dom", r.dominantHz ? `${r.dominantHz.toFixed(0)} Hz` : "— Hz");
    setText("ac-mod", r.modHz && r.modDepth >= 0.05 ? `${r.modHz.toFixed(1)} Hz · ${Math.round(r.modDepth * 100)}%` : "—");
    setText("ac-f0", r.f0Hz ? `${r.f0Hz.toFixed(0)} Hz · ${r.harmonics} harm.` : "—");
    setText("ac-level", `${r.levelDb.toFixed(1)} dB (+${r.aboveFloorDb.toFixed(1)})`);
    setText("ac-slope", `${a.levelSlopeDbPerSec >= 0 ? "+" : "−"}${Math.abs(a.levelSlopeDbPerSec).toFixed(2)} dB/s`);
    setText(
      "ac-pslope",
      r.tonalHz ? `${a.pitchSlopeHzPerSec >= 0 ? "+" : "−"}${Math.abs(a.pitchSlopeHzPerSec).toFixed(1)} Hz/s` : "—"
    );
    this._drawSparkline(nowSec, r);
  }

  _drawSparkline(nowSec, r) {
    const canvas = $("ac-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#1a2922";
    ctx.fillRect(0, 0, w, h);
    const span = 20;
    const pts = this.aircraft.levelSeries().filter((p) => nowSec - p.t <= span);
    if (pts.length < 2) return;
    let lo = Math.min(...pts.map((p) => p.db), r.floorDb);
    let hi = Math.max(...pts.map((p) => p.db));
    if (hi - lo < 6) {
      const mid = (hi + lo) / 2;
      lo = mid - 3;
      hi = mid + 3;
    }
    const x = (t) => w - ((nowSec - t) / span) * w;
    const y = (db) => h - 8 - ((db - lo) / (hi - lo)) * (h - 16);

    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#8aa396";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y(r.floorDb));
    ctx.lineTo(w, y(r.floorDb));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(x(pts[0].t), h);
    pts.forEach((p) => ctx.lineTo(x(p.t), y(p.db)));
    ctx.lineTo(x(pts[pts.length - 1].t), h);
    ctx.closePath();
    ctx.fillStyle = "rgba(62, 207, 142, 0.25)";
    ctx.fill();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(x(p.t), y(p.db)) : ctx.moveTo(x(p.t), y(p.db))));
    ctx.strokeStyle = "#3ecf8e";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#8aa396";
    ctx.font = "11px IBM Plex Mono, monospace";
    ctx.fillText(`${hi.toFixed(0)} dB`, 6, 12);
    ctx.fillText(`${lo.toFixed(0)} dB`, 6, h - 4);
  }
}
