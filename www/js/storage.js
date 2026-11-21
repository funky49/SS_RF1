const KEY = "soundseer.settings.v1";

const defaults = {
  tab: "data",
  tool: "info",
  viz: "fft",
  zoom: "20-20000",
  deviceId: "",
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(partial) {
  const next = { ...loadSettings(), ...partial };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
  return next;
}
