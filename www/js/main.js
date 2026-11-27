import { AudioEngine, micUnavailableReason } from "./audio-engine.js";
import { loadSettings, saveSettings } from "./storage.js";
import {
  rmsFromTime,
  peakFromTime,
  zcrFromTime,
  spectralCentroid,
  estimatePitch,
  hzToNote,
  relativeDb,
  compareLoudness,
  PeakHold,
  BANDS,
} from "./metrics.js";
import { VisualizerHost, drawStripWave, renderBandButtons } from "./visualizers.js";
import { attachSpectrumGestures } from "./spectrum-zoom.js";
import { ToysController } from "./toys.js";

const engine = new AudioEngine();
const settings = loadSettings();
const viz = new VisualizerHost(document.getElementById("viz-canvas"));
const toys = new ToysController(engine);
const dbHold = new PeakHold(0.5);
const peakHold = new PeakHold(0.4);

const els = {
  app: document.getElementById("app"),
  splash: document.getElementById("splash"),
  micBtn: document.getElementById("btn-mic"),
  micSelect: document.getElementById("mic-select"),
  refreshMics: document.getElementById("btn-refresh-mics"),
  strip: document.getElementById("strip-wave"),
  graphStage: document.getElementById("graph-stage"),
  vizCanvas: document.getElementById("viz-canvas"),
  vizSelect: document.getElementById("viz-select"),
  zoomSelect: document.getElementById("zoom-select"),
  fullscreen: document.getElementById("btn-fullscreen"),
  resetPeak: document.getElementById("btn-reset-peak"),
  graphPeakReset: document.getElementById("btn-graph-peak-reset"),
};

function showApp() {
  els.app.classList.remove("hidden");
  setTimeout(() => els.splash?.classList.add("hidden"), 1600);
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach((p) => {
    const on = p.id === `panel-${name}`;
    p.classList.toggle("active", on);
    p.hidden = !on;
  });
  saveSettings({ tab: name });
}

function fillMicSelect(devices, selectedId) {
  const sel = els.micSelect;
  sel.innerHTML = "";
  if (!devices.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No inputs found";
    sel.appendChild(opt);
    return;
  }
  for (const d of devices) {
    const opt = document.createElement("option");
    opt.value = d.deviceId;
    opt.textContent = d.label || `Mic ${d.deviceId.slice(0, 8)}`;
    if (d.deviceId === selectedId) opt.selected = true;
    sel.appendChild(opt);
  }
}

engine.onDeviceChange = (devices, id) => {
  fillMicSelect(devices, id);
  saveSettings({ deviceId: id });
  toys.updateDeviceInfo();
};

async function enableMic() {
  try {
    els.micBtn.disabled = true;
    els.micBtn.textContent = "Starting…";
    await engine.start(settings.deviceId || "");
    els.micBtn.setAttribute("aria-pressed", "true");
    els.micBtn.textContent = "Mic on";
    toys.updateDeviceInfo();
  } catch (err) {
    console.error(err);
    els.micBtn.setAttribute("aria-pressed", "false");
    els.micBtn.textContent = "Mic blocked";
    const reason = micUnavailableReason();
    alert(reason || "Microphone permission is required. Allow mic access and try again.\n\n" + (err.message || err));
  } finally {
    els.micBtn.disabled = false;
  }
}

els.micBtn.addEventListener("click", async () => {
  if (engine.active) {
    await engine.stop();
    els.micBtn.setAttribute("aria-pressed", "false");
    els.micBtn.textContent = "Enable mic";
    toys.updateDeviceInfo();
    return;
  }
  await enableMic();
});

els.micSelect.addEventListener("change", async () => {
  const id = els.micSelect.value;
  saveSettings({ deviceId: id });
  if (engine.active) await engine.switchDevice(id);
});

els.refreshMics.addEventListener("click", async () => {
  if (micUnavailableReason()) {
    fillMicSelect([], "");
    return;
  }
  if (!engine.active) {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      /* labels may stay empty */
    }
  }
  const devices = await engine.listMics();
  const best = settings.deviceId || engine.pickBestDevice(devices);
  fillMicSelect(devices, best);
});

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => setTab(tab.dataset.tab));
});

els.vizSelect.value = settings.viz;
els.zoomSelect.value = settings.zoom;
viz.setMode(settings.viz);
viz.setZoom(settings.zoom);

const bandZoomEl = document.getElementById("band-zoom");
renderBandButtons(bandZoomEl, (key) => viz.zoomToBand(key));
attachSpectrumGestures(els.vizCanvas, viz);

function syncBandButtons() {
  bandZoomEl.querySelectorAll(".band-btn").forEach((btn) => {
    const key = btn.dataset.band;
    const band = BANDS.find((b) => b.name === key);
    const on = key === viz.activeBand;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.disabled = band ? !viz.bandAvailable(band) : false;
  });
  const active = bandZoomEl.querySelector(".band-btn.active");
  if (active) {
    const { offsetLeft: l, offsetWidth: w } = active;
    const view = bandZoomEl.clientWidth;
    if (l < bandZoomEl.scrollLeft || l + w > bandZoomEl.scrollLeft + view) {
      bandZoomEl.scrollTo({ left: l - (view - w) / 2, behavior: "smooth" });
    }
  }
}
viz.onActiveBandChange = syncBandButtons;
syncBandButtons();

els.vizSelect.addEventListener("change", () => {
  viz.setMode(els.vizSelect.value);
  saveSettings({ viz: els.vizSelect.value });
});
els.zoomSelect.addEventListener("change", () => {
  viz.setZoom(els.zoomSelect.value, true);
  syncBandButtons();
  saveSettings({ zoom: els.zoomSelect.value });
});

els.fullscreen.addEventListener("click", async () => {
  const stage = els.graphStage;
  const entering = !stage.classList.contains("fullscreen");
  stage.classList.toggle("fullscreen", entering);
  els.fullscreen.textContent = entering ? "Exit full" : "Fullscreen";
  try {
    if (entering && stage.requestFullscreen) await stage.requestFullscreen();
    else if (!entering && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* CSS fullscreen still applies */
  }
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) {
    els.graphStage.classList.remove("fullscreen");
    els.fullscreen.textContent = "Fullscreen";
  }
});

function resetHolds() {
  dbHold.reset();
  peakHold.reset();
  viz.resetPeak();
}

els.resetPeak.addEventListener("click", resetHolds);
els.graphPeakReset.addEventListener("click", () => viz.resetPeak());

function updateData(frame) {
  if (!frame) {
    ["m-db", "m-rms", "m-peak", "m-pitch", "m-zcr", "m-centroid"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = el.id === "m-pitch" ? "— Hz" : el.id === "m-centroid" ? "— Hz" : "—";
    });
    return;
  }
  const rms = rmsFromTime(frame.time);
  const peak = peakFromTime(frame.time);
  const zcr = zcrFromTime(frame.time);
  const centroid = spectralCentroid(frame.freq, frame.sampleRate, frame.fftSize);
  const pitch = estimatePitch(frame.time, frame.sampleRate);
  const note = hzToNote(pitch.hz);
  const db = relativeDb(rms);
  const dbH = dbHold.update(db);
  const peakH = peakHold.update(peak);

  document.getElementById("m-db").textContent = `${db.toFixed(1)} dB`;
  document.getElementById("m-db-hold").textContent = `hold ${Number.isFinite(dbH) ? dbH.toFixed(1) : "—"}`;
  document.getElementById("m-rms").textContent = rms.toFixed(4);
  document.getElementById("m-peak").textContent = peak.toFixed(4);
  document.getElementById("m-peak-hold").textContent = `hold ${Number.isFinite(peakH) ? peakH.toFixed(4) : "—"}`;
  document.getElementById("m-pitch").textContent = pitch.hz ? `${pitch.hz.toFixed(1)} Hz` : "— Hz";
  document.getElementById("m-note").textContent = pitch.hz
    ? `${note.name}${note.octave} (${note.cents >= 0 ? "+" : ""}${note.cents}¢)`
    : "—";
  document.getElementById("m-zcr").textContent = zcr.toFixed(3);
  document.getElementById("m-centroid").textContent = `${centroid.toFixed(0)} Hz`;

  const pct = Math.max(0, Math.min(100, ((db + 20) / 120) * 100));
  const holdPct = Math.max(0, Math.min(100, ((dbH + 20) / 120) * 100));
  document.getElementById("loudness-bar").style.width = `${pct}%`;
  document.getElementById("loudness-peak").style.left = `${holdPct}%`;
  document.getElementById("m-loudness").textContent = `${db.toFixed(1)} dB`;
  document.getElementById("m-compare").textContent = `like: ${compareLoudness(db)}`;
}

let lastInfo = 0;
function loop() {
  const frame = engine.active ? engine.pull() : null;
  drawStripWave(els.strip, frame?.time || null);
  updateData(frame);
  viz.draw(frame);
  toys.tick(frame);
  if (frame && performance.now() - lastInfo > 2000) {
    toys.updateDeviceInfo();
    lastInfo = performance.now();
  }
  requestAnimationFrame(loop);
}

// Init UI from settings
const micReason = micUnavailableReason();
if (micReason) {
  const warn = document.getElementById("secure-warning");
  warn.textContent = micReason;
  warn.classList.remove("hidden");
}
setTab(settings.tab || "data");
toys.selectTool(settings.tool || "info");
document.querySelectorAll(".toy-btn").forEach((btn) => {
  btn.addEventListener("click", () => saveSettings({ tool: btn.dataset.tool }));
});

showApp();
loop();

// Expose for debugging on device
window.SoundSeer = { engine, viz, toys, settings: () => loadSettings() };
