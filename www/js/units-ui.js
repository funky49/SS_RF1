import { getSystem, setSystem, onUnitsChange, unitLabel } from "./units.js";

export function bindUnitsUI(root = document) {
  const buttons = root.querySelectorAll("[data-units-set]");
  const sync = (system) => {
    buttons.forEach((btn) => {
      const on = btn.dataset.unitsSet === system;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    root.querySelectorAll("[data-unit]").forEach((el) => {
      el.textContent = unitLabel(el.dataset.unit, system);
    });
  };
  buttons.forEach((btn) => btn.addEventListener("click", () => setSystem(btn.dataset.unitsSet)));
  onUnitsChange(sync);
  sync(getSystem());
}
