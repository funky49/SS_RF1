import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  detectSystem,
  getSystem,
  setSystem,
  onUnitsChange,
  resetUnitsForTests,
  formatDistance,
  formatLength,
  formatSpeed,
  formatTemperature,
  temperature,
  temperatureToCelsius,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  metersToFeet,
  feetToMeters,
  unitLabel,
  METRIC,
  AMERICAN,
} from "../www/js/units.js";

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    data,
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  resetUnitsForTests();
});

test("detectSystem maps US locales to american", () => {
  assert.equal(detectSystem("en-US"), AMERICAN);
  assert.equal(detectSystem("en_US"), AMERICAN);
  assert.equal(detectSystem("en-GB"), METRIC);
  assert.equal(detectSystem("de-DE"), METRIC);
  assert.equal(detectSystem("fr"), METRIC);
  assert.equal(detectSystem(""), METRIC);
});

test("stored choice overrides locale default and persists", () => {
  setSystem(AMERICAN);
  assert.equal(globalThis.localStorage.getItem("soundseer.units.v1"), AMERICAN);
  resetUnitsForTests();
  assert.equal(getSystem(), AMERICAN);
  setSystem(METRIC);
  resetUnitsForTests();
  assert.equal(getSystem(), METRIC);
});

test("invalid values are ignored", () => {
  setSystem(METRIC);
  setSystem("imperial");
  assert.equal(getSystem(), METRIC);
});

test("subscribers fire on change only and can unsubscribe", () => {
  setSystem(METRIC);
  const seen = [];
  const off = onUnitsChange((s) => seen.push(s));
  setSystem(METRIC);
  setSystem(AMERICAN);
  off();
  setSystem(METRIC);
  assert.deepEqual(seen, [AMERICAN]);
});

test("immediate subscription reports the current system", () => {
  setSystem(AMERICAN);
  const seen = [];
  onUnitsChange((s) => seen.push(s), { immediate: true });
  assert.deepEqual(seen, [AMERICAN]);
});

test("temperature conversions round-trip", () => {
  assert.equal(celsiusToFahrenheit(0), 32);
  assert.equal(celsiusToFahrenheit(100), 212);
  assert.equal(fahrenheitToCelsius(-40), -40);
  assert.ok(Math.abs(temperatureToCelsius(68, AMERICAN) - 20) < 1e-9);
  assert.equal(temperatureToCelsius(20, METRIC), 20);
  assert.equal(temperature(20, AMERICAN).value, 68);
  assert.equal(formatTemperature(20, { system: AMERICAN }), "68.0°F");
  assert.equal(formatTemperature(20, { system: METRIC, digits: 0 }), "20°C");
});

test("distance switches between small and large units", () => {
  assert.equal(formatDistance(343, { system: METRIC }), "343 m");
  assert.equal(formatDistance(1500, { system: METRIC }), "1.50 km");
  assert.equal(formatDistance(100, { system: AMERICAN }), "328 ft");
  assert.equal(formatDistance(1609.344, { system: AMERICAN }), "1.00 mi");
});

test("length for room-size results", () => {
  assert.equal(formatLength(4.25, { system: METRIC }), "4.3 m");
  assert.equal(formatLength(0.5, { system: METRIC }), "50 cm");
  assert.equal(formatLength(3.048, { system: AMERICAN }), "10.0 ft");
  assert.equal(formatLength(0.1016, { system: AMERICAN }), "4 in");
});

test("speed in m/s, ft/s, km/h and mph", () => {
  assert.equal(formatSpeed(343, { system: METRIC }), "343.0 m/s");
  assert.equal(formatSpeed(343, { system: AMERICAN }), "1125.3 ft/s");
  assert.equal(formatSpeed(10, { system: METRIC, large: true }), "36.0 km/h");
  assert.equal(formatSpeed(10, { system: AMERICAN, large: true }), "22.4 mph");
});

test("formatters follow the current system by default", () => {
  setSystem(METRIC);
  assert.equal(formatDistance(10), "10 m");
  setSystem(AMERICAN);
  assert.equal(formatDistance(10), "33 ft");
});

test("length conversions and labels", () => {
  assert.ok(Math.abs(feetToMeters(metersToFeet(5)) - 5) < 1e-12);
  assert.equal(unitLabel("temperature", METRIC), "°C");
  assert.equal(unitLabel("temperature", AMERICAN), "°F");
  assert.equal(unitLabel("length", AMERICAN), "ft");
  assert.equal(unitLabel("speed", AMERICAN), "ft/s");
});

test("negative zero is not shown", () => {
  assert.equal(formatTemperature(-0.0001, { system: METRIC, digits: 0 }), "0°C");
});
