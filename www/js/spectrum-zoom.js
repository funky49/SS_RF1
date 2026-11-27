const DOUBLE_TAP_MS = 350;
const TAP_SLOP_PX = 12;
const DOUBLE_TAP_DIST_PX = 40;

/**
 * Pinch / drag / wheel / double-tap navigation of the frequency axis on the visualizer canvas.
 * The host owns the view range; this only translates input into zoomAt / panBy / resetView.
 */
export function attachSpectrumGestures(canvas, host) {
  const pointers = new Map();
  let pinchDist = 0;
  let tap = null;
  let lastTap = null;

  const axis = () => host.freqAxis();

  const fracOf = (x, y) => {
    const r = canvas.getBoundingClientRect();
    return axis() === "y" ? 1 - (y - r.top) / r.height : (x - r.left) / r.width;
  };

  const panFromDelta = (dx, dy) => {
    const r = canvas.getBoundingClientRect();
    host.panBy(axis() === "y" ? dy / r.height : -dx / r.width);
  };

  const pair = () => {
    const [a, b] = [...pointers.values()];
    return { a, b, dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  canvas.addEventListener("pointerdown", (ev) => {
    if (!axis()) return;
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    canvas.classList.add("dragging");
    if (pointers.size === 1) {
      tap = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, t: performance.now(), moved: false };
    } else {
      tap = null;
      pinchDist = pair().dist;
    }
  });

  canvas.addEventListener("pointermove", (ev) => {
    const p = pointers.get(ev.pointerId);
    if (!p || !axis()) return;
    if (pointers.size >= 2) {
      const before = pair();
      p.x = ev.clientX;
      p.y = ev.clientY;
      const now = pair();
      if (pinchDist > 0 && now.dist > 0) {
        host.zoomAt(fracOf(now.mx, now.my), now.dist / pinchDist);
      }
      pinchDist = now.dist;
      panFromDelta(now.mx - before.mx, now.my - before.my);
      return;
    }
    const dx = ev.clientX - p.x;
    const dy = ev.clientY - p.y;
    p.x = ev.clientX;
    p.y = ev.clientY;
    if (tap && Math.hypot(ev.clientX - tap.x, ev.clientY - tap.y) > TAP_SLOP_PX) tap.moved = true;
    if (!tap || tap.moved) panFromDelta(dx, dy);
  });

  const release = (ev) => {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (!pointers.size) canvas.classList.remove("dragging");
    if (pointers.size === 1) pinchDist = 0;

    if (ev.type === "pointerup" && tap && tap.id === ev.pointerId && !tap.moved && ev.pointerType !== "mouse") {
      const now = performance.now();
      if (
        lastTap &&
        now - lastTap.t < DOUBLE_TAP_MS &&
        Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < DOUBLE_TAP_DIST_PX
      ) {
        host.resetView();
        lastTap = null;
      } else {
        lastTap = { t: now, x: ev.clientX, y: ev.clientY };
      }
    }
    tap = null;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("lostpointercapture", release);

  canvas.addEventListener("dblclick", (ev) => {
    if (!axis()) return;
    ev.preventDefault();
    host.resetView();
  });

  canvas.addEventListener(
    "wheel",
    (ev) => {
      if (!axis()) return;
      ev.preventDefault();
      const r = canvas.getBoundingClientRect();
      const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? r.height : 1;
      if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) && axis() === "x") {
        host.panBy((ev.deltaX * unit) / r.width);
        return;
      }
      const k = ev.ctrlKey ? 0.01 : 0.0015;
      host.zoomAt(fracOf(ev.clientX, ev.clientY), Math.exp(-ev.deltaY * unit * k));
    },
    { passive: false }
  );

  canvas.addEventListener("contextmenu", (ev) => {
    if (pointers.size) ev.preventDefault();
  });
}
