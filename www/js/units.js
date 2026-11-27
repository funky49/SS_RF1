const STORAGE_KEY = "soundseer.units.v1";

export const METRIC = "metric";
export const AMERICAN = "american";
export const SYSTEMS = [METRIC, AMERICAN];

const M_PER_FT = 0.3048;
const M_PER_MI = 1609.344;
const M_PER_IN = 0.0254;
const KMH_PER_MPS = 3.6;
const MPH_PER_MPS = 2.2369362920544;

const listeners = new Set();
let current = null;

export function isSystem(value) {
  return SYSTEMS.includes(value);
}

export function detectSystem(language) {
  const lang = language ?? (typeof navigator !== "undefined" ? navigator.language : "");
  return /(^|[-_])US$/i.test(String(lang || "")) ? AMERICAN : METRIC;
}

function readStored() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isSystem(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function getSystem() {
  if (!current) current = readStored() || detectSystem();
  return current;
}

export function setSystem(system) {
  if (!isSystem(system)) return getSystem();
  const changed = system !== getSystem();
  current = system;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, system);
  } catch {
    current = system;
  }
  if (changed) listeners.forEach((fn) => fn(system));
  return system;
}

export function onUnitsChange(fn, { immediate = false } = {}) {
  listeners.add(fn);
  if (immediate) fn(getSystem());
  return () => listeners.delete(fn);
}

export function resetUnitsForTests() {
  current = null;
  listeners.clear();
}

const sys = (system) => (isSystem(system) ? system : getSystem());
const isUS = (system) => sys(system) === AMERICAN;

export function metersToFeet(m) {
  return m / M_PER_FT;
}
export function feetToMeters(ft) {
  return ft * M_PER_FT;
}
export function metersToMiles(m) {
  return m / M_PER_MI;
}
export function celsiusToFahrenheit(c) {
  return (c * 9) / 5 + 32;
}
export function fahrenheitToCelsius(f) {
  return ((f - 32) * 5) / 9;
}

export function distance(meters, system) {
  if (isUS(system)) {
    const ft = metersToFeet(meters);
    return Math.abs(ft) < 1000
      ? { value: ft, unit: "ft", digits: 0 }
      : { value: metersToMiles(meters), unit: "mi", digits: 2 };
  }
  return Math.abs(meters) < 1000
    ? { value: meters, unit: "m", digits: 0 }
    : { value: meters / 1000, unit: "km", digits: 2 };
}

export function length(meters, system) {
  if (isUS(system)) {
    const ft = metersToFeet(meters);
    return Math.abs(ft) < 1
      ? { value: meters / M_PER_IN, unit: "in", digits: 0 }
      : { value: ft, unit: "ft", digits: 1 };
  }
  return Math.abs(meters) < 1
    ? { value: meters * 100, unit: "cm", digits: 0 }
    : { value: meters, unit: "m", digits: 1 };
}

export function speed(metersPerSecond, system, { large = false } = {}) {
  if (large) {
    return isUS(system)
      ? { value: metersPerSecond * MPH_PER_MPS, unit: "mph", digits: 1 }
      : { value: metersPerSecond * KMH_PER_MPS, unit: "km/h", digits: 1 };
  }
  return isUS(system)
    ? { value: metersToFeet(metersPerSecond), unit: "ft/s", digits: 1 }
    : { value: metersPerSecond, unit: "m/s", digits: 1 };
}

export function temperatureUnit(system) {
  return isUS(system) ? "°F" : "°C";
}

export function temperature(celsius, system) {
  return isUS(system)
    ? { value: celsiusToFahrenheit(celsius), unit: "°F", digits: 1 }
    : { value: celsius, unit: "°C", digits: 1 };
}

export function temperatureToCelsius(value, system) {
  return isUS(system) ? fahrenheitToCelsius(value) : value;
}

export function formatQuantity({ value, unit, digits }, opts = {}) {
  let shown = value.toFixed(opts.digits ?? digits);
  if (Number(shown) === 0) shown = shown.replace("-", "");
  return unit.startsWith("°") ? `${shown}${unit}` : `${shown} ${unit}`;
}

export function formatDistance(meters, opts = {}) {
  return formatQuantity(distance(meters, opts.system), opts);
}
export function formatLength(meters, opts = {}) {
  return formatQuantity(length(meters, opts.system), opts);
}
export function formatSpeed(metersPerSecond, opts = {}) {
  return formatQuantity(speed(metersPerSecond, opts.system, opts), opts);
}
export function formatTemperature(celsius, opts = {}) {
  return formatQuantity(temperature(celsius, opts.system), opts);
}

export function unitLabel(kind, system, opts = {}) {
  const s = sys(system);
  if (kind === "temperature") return temperatureUnit(s);
  if (kind === "distance") return s === AMERICAN ? "ft / mi" : "m / km";
  if (kind === "length") return s === AMERICAN ? "ft" : "m";
  if (kind === "speed") return speed(0, s, opts).unit;
  return "";
}
