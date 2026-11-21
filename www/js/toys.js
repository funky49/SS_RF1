import {
  estimatePitch,
  hzToNote,
  relativeDb,
  BpmTracker,
  DoseMeter,
  PeakHold,
} from "./metrics.js";

function speedOfSound(tempC) {
  return 331.3 + 0.606 * tempC;
}

export class ToysController {
  constructor(engine) {
    this.engine = engine;
    this.bpm = new BpmTracker();
    this.dose = new DoseMeter();
    this.leakHold = new PeakHold(0.15);
    this.flashAt = 0;
    this.flashArmed = false;
    this.roomArmed = false;
    this.roomBaseline = 0;
    this.roomPeakAt = 0;
    this._bind();
  }

  _bind() {
    document.querySelectorAll(".toy-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.selectTool(btn.dataset.tool));
    });

    document.querySelectorAll("[data-sound]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const kind = btn.dataset.sound;
        if (kind === "stop") return this.engine.stopGenerators();
        if (kind === "sweep") return this.engine.playSweep();
        if (kind === "quindar") return this.engine.playQuindar();
        if (kind === "bird") return this.engine.playBird();
        if (kind === "noise") return this.engine.playNoiseHpf();
      });
    });

    document.getElementById("fb-flash")?.addEventListener("click", () => {
      this.flashAt = performance.now();
      document.getElementById("fb-result").textContent = "Flash marked — waiting for bang…";
    });

    document.getElementById("fb-bang")?.addEventListener("click", () => this.resolveFlashBang());
    document.getElementById("fb-arm")?.addEventListener("click", () => {
      this.flashArmed = true;
      document.getElementById("fb-result").textContent = "Auto-thunder armed (after Flash).";
    });

    document.getElementById("room-arm")?.addEventListener("click", () => {
      this.roomArmed = true;
      this.roomBaseline = 0;
      this.roomPeakAt = 0;
      document.getElementById("room-result").textContent = "Armed — clap now.";
    });
    document.getElementById("room-reset")?.addEventListener("click", () => {
      this.roomArmed = false;
      document.getElementById("room-result").textContent = "—";
    });

    document.getElementById("leak-reset")?.addEventListener("click", () => {
      this.leakHold.reset();
    });

    document.getElementById("dose-start")?.addEventListener("click", () => this.dose.start());
    document.getElementById("dose-pause")?.addEventListener("click", () => this.dose.pause());
    document.getElementById("dose-reset")?.addEventListener("click", () => {
      this.dose.reset();
      document.getElementById("dose-result").textContent = "—";
    });

    document.getElementById("bpm-tap")?.addEventListener("click", () => {
      const tap = this.bpm.tap();
      this._renderBpm(this.bpm.autoBpm(), tap);
    });
    document.getElementById("bpm-reset")?.addEventListener("click", () => {
      this.bpm.resetTaps();
      this._renderBpm(this.bpm.autoBpm(), 0);
    });
  }

  selectTool(id) {
    document.querySelectorAll(".toy-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === id);
    });
    document.querySelectorAll(".toy-panel").forEach((p) => {
      const on = p.dataset.toolPanel === id;
      p.classList.toggle("active", on);
      p.hidden = !on;
    });
    return id;
  }

  resolveFlashBang(now = performance.now()) {
    if (!this.flashAt) {
      document.getElementById("fb-result").textContent = "Tap Flash first.";
      return;
    }
    const dt = (now - this.flashAt) / 1000;
    const temp = Number(document.getElementById("fb-temp")?.value || 20);
    const c = speedOfSound(temp);
    const meters = c * dt;
    const miles = meters / 1609.34;
    document.getElementById("fb-result").textContent =
      `${dt.toFixed(2)} s · ${meters.toFixed(0)} m · ${miles.toFixed(2)} mi ` +
      `(c≈${c.toFixed(1)} m/s @ ${temp}°C)`;
    this.flashArmed = false;
  }

  updateDeviceInfo() {
    const dl = document.getElementById("device-info");
    if (!dl) return;
    const info = this.engine.trackSettings();
    const rows = info
      ? [
          ["Label", info.label],
          ["Device ID", info.deviceId || "—"],
          ["Sample rate", `${info.sampleRate} Hz`],
          ["Channels", String(info.channelCount ?? "—")],
          ["State", info.readyState],
          ["AGC", String(info.autoGainControl)],
          ["Echo cancel", String(info.echoCancellation)],
          ["Noise suppress", String(info.noiseSuppression)],
          ["UA", navigator.userAgent.slice(0, 80) + "…"],
        ]
      : [["Mic", "not active"]];
    dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }

  tick(frame) {
    if (!frame) return;

    // Flash auto-thunder: sudden level jump after flash
    if (this.flashArmed && this.flashAt) {
      const rms = frame.time.reduce((s, v) => {
        const x = (v - 128) / 128;
        return s + x * x;
      }, 0);
      const level = Math.sqrt(rms / frame.time.length);
      if (performance.now() - this.flashAt > 200 && level > 0.25) {
        this.resolveFlashBang();
      }
    }

    // Room clap / echo
    if (this.roomArmed) {
      let peak = 0;
      for (let i = 0; i < frame.time.length; i++) {
        peak = Math.max(peak, Math.abs(frame.time[i] - 128) / 128);
      }
      const now = performance.now();
      if (!this.roomPeakAt && peak > 0.35) {
        this.roomPeakAt = now;
        this.roomBaseline = peak;
        document.getElementById("room-result").textContent = "Clap heard — listening for echo…";
      } else if (this.roomPeakAt && now - this.roomPeakAt > 30 && peak > this.roomBaseline * 0.35 && peak > 0.12) {
        const dt = (now - this.roomPeakAt) / 1000;
        const dist = (speedOfSound(20) * dt) / 2;
        document.getElementById("room-result").textContent =
          `Echo Δt ${dt.toFixed(3)} s · ≈ ${dist.toFixed(1)} m to reflective surface`;
        this.roomArmed = false;
      } else if (this.roomPeakAt && now - this.roomPeakAt > 2500) {
        document.getElementById("room-result").textContent = "No clear echo detected.";
        this.roomArmed = false;
      }
    }

    // RPM from pitch/hum
    const pitch = estimatePitch(frame.time, frame.sampleRate, 20, 400);
    const poles = Number(document.getElementById("rpm-poles")?.value || 2);
    if (pitch.hz > 0) {
      const rpm = (pitch.hz * 60) / Math.max(1, poles / 2);
      document.getElementById("rpm-result").textContent =
        `${pitch.hz.toFixed(1)} Hz · ≈ ${rpm.toFixed(0)} RPM (poles=${poles})`;
    }

    // Leak / hiss — energy above ~4 kHz
    const binHz = frame.sampleRate / frame.fftSize;
    let hiss = 0;
    let total = 0;
    for (let i = 0; i < frame.freq.length; i++) {
      const hz = i * binHz;
      total += frame.freq[i];
      if (hz >= 4000) hiss += frame.freq[i];
    }
    const ratio = total > 0 ? hiss / total : 0;
    const hold = this.leakHold.update(ratio);
    document.getElementById("leak-result").textContent =
      `HF ratio ${(ratio * 100).toFixed(1)}% · peak hold ${(hold * 100).toFixed(1)}%`;
    this._drawLeak(ratio, hold);

    // Dose
    const rms = Math.sqrt(
      frame.time.reduce((s, v) => {
        const x = (v - 128) / 128;
        return s + x * x;
      }, 0) / frame.time.length
    );
    const db = relativeDb(rms);
    const dose = this.dose.feed(db);
    if (this.dose.running || this.dose.samples) {
      document.getElementById("dose-result").textContent =
        `${db.toFixed(0)} dB · ${dose.hours.toFixed(2)} h · dose≈${dose.dosePct.toFixed(1)}% · ${dose.advice}`;
    }

    // Periodicity
    if (pitch.hz > 0) {
      const periodMs = 1000 / pitch.hz;
      document.getElementById("period-result").textContent =
        `${pitch.hz.toFixed(2)} Hz · period ${periodMs.toFixed(2)} ms · conf ${(pitch.confidence * 100).toFixed(0)}%`;
    }

    // Pitch / note
    const note = hzToNote(pitch.hz);
    const pitchEl = document.getElementById("pitch-result");
    if (pitchEl) {
      pitchEl.textContent = pitch.hz
        ? `${pitch.hz.toFixed(1)} Hz · ${note.name}${note.octave} (${note.cents >= 0 ? "+" : ""}${note.cents}¢)`
        : "—";
    }
    this._drawPitch(pitch.hz, note);

    // BPM
    const auto = this.bpm.feed(frame.freq);
    this._renderBpm(auto, this.bpm.tapBpm());

    // Device info refresh occasionally handled by main
  }

  _renderBpm(auto, tap) {
    const el = document.getElementById("bpm-result");
    if (el) el.textContent = `Auto: ${auto || "—"} · Tap: ${tap || "—"}`;
  }

  _drawLeak(ratio, hold) {
    const canvas = document.getElementById("leak-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#121c18";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#3ecf8e";
    ctx.fillRect(0, h * 0.3, ratio * w, h * 0.4);
    ctx.fillStyle = "#e26d5a";
    ctx.fillRect(hold * w - 2, 8, 2, h - 16);
  }

  _drawPitch(hz, note) {
    const canvas = document.getElementById("pitch-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = "#121c18";
    ctx.fillRect(0, 0, w, h);
    // cents meter -50..+50
    const cents = note.cents || 0;
    const x = ((cents + 50) / 100) * w;
    ctx.strokeStyle = "#2a4036";
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.fillStyle = "#3ecf8e";
    ctx.beginPath();
    ctx.arc(x, h / 2, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8aa396";
    ctx.font = "12px IBM Plex Mono, monospace";
    ctx.fillText("-50¢", 6, h - 8);
    ctx.fillText("+50¢", w - 40, h - 8);
  }
}
