import { loadSettings, saveSettings } from "./storage.js";
import {
  TIME_DIVS_MS,
  GAINS,
  TRIGGER_MODES,
  H_DIVS,
  V_DIVS,
  DEFAULT_CONFIG,
  unitsPerDiv,
  clamp,
  formatNumber,
  formatTimeDiv,
  formatFrequency,
} from "./scope.js";

const MODE_LABELS = { auto: "Auto", normal: "Normal", off: "Off" };

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

function field(label, control) {
  return el("label", { class: "scope-field" }, [el("span", { text: label }), control]);
}

function select(options, selected) {
  const s = el("select");
  for (const [value, text] of options) {
    const o = el("option", { value: String(value), text });
    if (String(value) === String(selected)) o.selected = true;
    s.appendChild(o);
  }
  return s;
}

/**
 * Builds the compact scope control strip under the visualizer canvas. It is shown only while the
 * Oscilloscope view is selected and registers no listeners on the canvas, so GRAPH gestures
 * (pan / pinch) are left untouched.
 */
export function initScopeUI({ host, vizSelect, stage, canvas }) {
  const saved = loadSettings().scope || {};
  const cfg = { ...DEFAULT_CONFIG, ...saved };
  if (!TIME_DIVS_MS.includes(cfg.timeDivMs)) cfg.timeDivMs = DEFAULT_CONFIG.timeDivMs;
  if (!GAINS.includes(cfg.gain)) cfg.gain = DEFAULT_CONFIG.gain;
  if (!TRIGGER_MODES.includes(cfg.triggerMode)) cfg.triggerMode = DEFAULT_CONFIG.triggerMode;
  host.scope.setConfig(cfg);

  const timeSel = select(TIME_DIVS_MS.map((t) => [t, `${t} ms`]), cfg.timeDivMs);
  const gainSel = select(GAINS.map((g) => [g, `x${g}`]), cfg.gain);
  const modeSel = select(TRIGGER_MODES.map((m) => [m, MODE_LABELS[m]]), cfg.triggerMode);
  const freezeBtn = el("button", { type: "button", class: "btn scope-freeze", "aria-pressed": "false", text: "Freeze" });

  const levelIn = el("input", { type: "range", "aria-label": "Trigger level" });
  const levelOut = el("output", { class: "scope-out" });
  const persistIn = el("input", { type: "range", min: "0", max: "1", step: "0.01", "aria-label": "Phosphor persistence" });
  persistIn.value = String(cfg.persistence);
  const persistOut = el("output", { class: "scope-out" });
  const peakIn = el("input", { type: "checkbox", "aria-label": "Peak hold envelope" });
  peakIn.checked = !!cfg.peakHold;

  const readF = el("span", { class: "scope-read-val", text: "—" });
  const readV = el("span", { class: "scope-read-val", text: "—" });
  const readR = el("span", { class: "scope-read-val", text: "—" });
  const readTrig = el("span", { class: "scope-read-val", text: "—" });
  const readout = el("div", { class: "scope-readout" }, [
    el("span", {}, [document.createTextNode("f "), readF]),
    el("span", {}, [document.createTextNode("Vpp "), readV]),
    el("span", {}, [document.createTextNode("RMS "), readR]),
    el("span", {}, [document.createTextNode("Trig "), readTrig]),
  ]);
  const clampNote = el("p", { class: "scope-clamp", hidden: "" });
  const note = el("p", {
    class: "scope-note",
    text: `${H_DIVS}×${V_DIVS} div. Amplitude is normalized (full scale = ±1) and uncalibrated, not volts. Level and readouts use the same units (u).`,
  });

  const root = el("div", { class: "scope-controls", hidden: "", id: "scope-controls" }, [
    el("div", { class: "scope-row scope-row-main" }, [
      field("Time/div", timeSel),
      field("Gain", gainSel),
      field("Trigger", modeSel),
      freezeBtn,
    ]),
    el("label", { class: "scope-slider" }, [el("span", { text: "Level" }), levelIn, levelOut]),
    el("div", { class: "scope-row scope-row-persist" }, [
      el("label", { class: "scope-slider" }, [el("span", { text: "Persist" }), persistIn, persistOut]),
      el("label", { class: "scope-check" }, [peakIn, el("span", { text: "Peak hold" })]),
    ]),
    readout,
    clampNote,
    note,
  ]);
  canvas.after(root);

  function persist() {
    const { timeDivMs, gain, triggerMode, level, persistence, peakHold } = host.scope.config;
    saveSettings({ scope: { timeDivMs, gain, triggerMode, level, persistence, peakHold } });
  }

  function syncLevelRange() {
    const half = (V_DIVS / 2) * unitsPerDiv(host.scope.config.gain);
    const step = unitsPerDiv(host.scope.config.gain) / 50;
    levelIn.min = String(-half);
    levelIn.max = String(half);
    levelIn.step = String(step);
    const level = clamp(host.scope.config.level, -half, half);
    host.scope.setConfig({ level });
    levelIn.value = String(level);
    levelOut.textContent = formatNumber(level, 2);
  }

  function syncPersistLabel() {
    persistOut.textContent = host.scope.config.persistence > 0 ? `${Math.round(host.scope.config.persistence * 100)}%` : "off";
  }

  timeSel.addEventListener("change", () => {
    host.scope.setConfig({ timeDivMs: Number(timeSel.value) });
    persist();
  });
  gainSel.addEventListener("change", () => {
    host.scope.setConfig({ gain: Number(gainSel.value) });
    syncLevelRange();
    persist();
  });
  modeSel.addEventListener("change", () => {
    host.scope.setConfig({ triggerMode: modeSel.value });
    persist();
  });
  levelIn.addEventListener("input", () => {
    host.scope.setConfig({ level: Number(levelIn.value) });
    levelOut.textContent = formatNumber(Number(levelIn.value), 2);
    persist();
  });
  persistIn.addEventListener("input", () => {
    host.scope.setConfig({ persistence: Number(persistIn.value) });
    syncPersistLabel();
    persist();
  });
  peakIn.addEventListener("change", () => {
    host.scope.setConfig({ peakHold: peakIn.checked });
    if (peakIn.checked) host.scope.resetPeak();
    persist();
  });
  freezeBtn.addEventListener("click", () => {
    const on = !host.scope.frozen;
    host.scope.setFrozen(on);
    freezeBtn.setAttribute("aria-pressed", on ? "true" : "false");
    freezeBtn.textContent = on ? "Run" : "Freeze";
  });

  host.scope.onUpdate = (s) => {
    readF.textContent = s.hz == null ? "—" : formatFrequency(s.hz);
    readF.title = s.periodMs == null ? "" : `period ${formatNumber(s.periodMs, 3)} ms`;
    readV.textContent = `${s.vpp.toFixed(3)} u`;
    readR.textContent = `${s.rms.toFixed(3)} u`;
    readTrig.textContent = s.trigLabel;
    if (s.clamped) {
      clampNote.hidden = false;
      clampNote.textContent = `${formatTimeDiv(s.requestedMs)} exceeds the ${s.bufferLength}-sample buffer at ${Math.round(s.sampleRate)} Hz; showing ${formatTimeDiv(s.timeDivMs)} (max).`;
    } else {
      clampNote.hidden = true;
    }
  };

  function applyMode() {
    const on = vizSelect.value === "oscilloscope";
    root.hidden = !on;
    stage.classList.toggle("scope-on", on);
    if (!on && host.scope.frozen) {
      host.scope.setFrozen(false);
      freezeBtn.setAttribute("aria-pressed", "false");
      freezeBtn.textContent = "Freeze";
    }
  }

  vizSelect.addEventListener("change", applyMode);
  syncLevelRange();
  syncPersistLabel();
  applyMode();
}
