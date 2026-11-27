/**
 * Web Audio engine: getUserMedia → AnalyserNode, multi-mic pick, generators.
 */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.stream = null;
    this.source = null;
    this.analyser = null;
    this.gain = null;
    this.deviceId = "";
    this.devices = [];
    this.timeData = null;
    this.freqData = null;
    this.freqFloat = null;
    this.timeFloat = null;
    this.genNodes = [];
    this.onDeviceChange = null;
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  get active() {
    return !!(this.ctx && this.analyser && this.stream);
  }

  async ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    return this.ctx;
  }

  async listMics() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all.filter((d) => d.kind === "audioinput");
    return this.devices;
  }

  /** Prefer labeled non-default mics with higher channel hints; else first. */
  pickBestDevice(devices = this.devices) {
    if (!devices.length) return "";
    const scored = devices.map((d, i) => {
      let score = 0;
      const label = (d.label || "").toLowerCase();
      if (label.includes("default") || label.includes("comunicaciones") || label.includes("communications")) score -= 5;
      if (label.includes("usb") || label.includes("external") || label.includes("headset")) score += 3;
      if (label.includes("built-in") || label.includes("internal") || label.includes("bottom") || label.includes("back")) score += 2;
      if (label.includes("front") || label.includes("earpiece")) score -= 1;
      if (d.deviceId && d.deviceId !== "default") score += 1;
      if (label.length > 0) score += 1;
      return { id: d.deviceId, score, i };
    });
    scored.sort((a, b) => b.score - a.score || a.i - b.i);
    return scored[0].id;
  }

  async start(preferredDeviceId = "") {
    await this.ensureContext();
    await this.stopStreamOnly();

    const constraints = {
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    };

    if (preferredDeviceId) {
      constraints.audio.deviceId = { exact: preferredDeviceId };
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      if (preferredDeviceId) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
      } else {
        throw err;
      }
    }

    this.stream = stream;
    await this.listMics();

    const track = stream.getAudioTracks()[0];
    this.deviceId = track?.getSettings?.().deviceId || preferredDeviceId || "";

    // If no preference, re-open on best device when labels available
    if (!preferredDeviceId && this.devices.length > 1) {
      const best = this.pickBestDevice(this.devices);
      if (best && best !== this.deviceId) {
        await this.start(best);
        return;
      }
    }

    this.source = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.7;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 1;

    this.source.connect(this.analyser);
    // Do not connect mic to destination (feedback)

    const bins = this.analyser.frequencyBinCount;
    this.timeData = new Uint8Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(bins);
    this.freqFloat = new Float32Array(bins);
    this.timeFloat = new Float32Array(this.analyser.fftSize);

    if (typeof this.onDeviceChange === "function") {
      this.onDeviceChange(this.devices, this.deviceId);
    }
  }

  async switchDevice(deviceId) {
    this.deviceId = deviceId;
    await this.start(deviceId);
  }

  async stopStreamOnly() {
    this.stopGenerators();
    if (this.source) {
      try { this.source.disconnect(); } catch { /* */ }
      this.source = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch { /* */ }
      this.analyser = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  async stop() {
    await this.stopStreamOnly();
    if (this.ctx) {
      await this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }

  pull() {
    if (!this.analyser) return null;
    this.analyser.getByteTimeDomainData(this.timeData);
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getFloatFrequencyData(this.freqFloat);
    this.analyser.getFloatTimeDomainData(this.timeFloat);
    return {
      time: this.timeData,
      timeFloat: this.timeFloat,
      freq: this.freqData,
      freqFloat: this.freqFloat,
      sampleRate: this.sampleRate,
      fftSize: this.analyser.fftSize,
      binCount: this.analyser.frequencyBinCount,
    };
  }

  trackSettings() {
    const track = this.stream?.getAudioTracks?.()[0];
    if (!track) return null;
    const settings = track.getSettings?.() || {};
    const constraints = track.getConstraints?.() || {};
    const capabilities = track.getCapabilities?.() || {};
    return {
      label: track.label || "(unnamed)",
      readyState: track.readyState,
      settings,
      constraints,
      capabilities,
      echoCancellation: settings.echoCancellation,
      noiseSuppression: settings.noiseSuppression,
      autoGainControl: settings.autoGainControl,
      sampleRate: settings.sampleRate || this.sampleRate,
      channelCount: settings.channelCount,
      deviceId: settings.deviceId || this.deviceId,
    };
  }

  stopGenerators() {
    for (const n of this.genNodes) {
      try { n.stop?.(); } catch { /* */ }
      try { n.disconnect?.(); } catch { /* */ }
    }
    this.genNodes = [];
  }

  async playSweep() {
    await this.ensureContext();
    this.stopGenerators();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(80, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, this.ctx.currentTime + 4);
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, this.ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 4);
    osc.connect(g);
    g.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 4.05);
    this.genNodes.push(osc, g);
  }

  async playQuindar() {
    await this.ensureContext();
    this.stopGenerators();
    // Classic Quindar: ~2525 Hz intro / 2475 Hz outro short beeps
    const beep = (freq, start, dur) => {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.3, start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
      this.genNodes.push(osc, g);
    };
    const t0 = this.ctx.currentTime;
    beep(2525, t0, 0.25);
    beep(2475, t0 + 0.4, 0.25);
  }

  async playBird() {
    await this.ensureContext();
    this.stopGenerators();
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = "sine";
      const start = t0 + i * 0.18;
      const f0 = 2200 + i * 180;
      osc.frequency.setValueAtTime(f0, start);
      osc.frequency.exponentialRampToValueAtTime(f0 * 1.6, start + 0.08);
      osc.frequency.exponentialRampToValueAtTime(f0 * 0.9, start + 0.14);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.15);
      osc.connect(g);
      g.connect(this.ctx.destination);
      osc.start(start);
      osc.stop(start + 0.18);
      this.genNodes.push(osc, g);
    }
  }

  async playNoiseHpf() {
    await this.ensureContext();
    this.stopGenerators();
    const duration = 3;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * duration, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const hpf = this.ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = 2000;
    hpf.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.value = 0.12;
    src.connect(hpf);
    hpf.connect(g);
    g.connect(this.ctx.destination);
    src.start();
    src.stop(this.ctx.currentTime + duration);
    this.genNodes.push(src, hpf, g);
  }
}
