// Pointer handling is separate from simulation so short clicks and lost focus
// have the same behavior at any rendering rate.
export function createAttackInput(canvas, host, enabled, onStart = () => {}) {
  let held = false, pressed = false, pointerId = null;
  function releaseCapture() {
    const previous = pointerId;
    pointerId = null;
    if (previous !== null && canvas.hasPointerCapture(previous)) canvas.releasePointerCapture(previous);
  }
  const input = {
    read() { const result = { attackHeld: held, attackPressed: pressed }; pressed = false; return result; },
    clear() { held = false; pressed = false; releaseCapture(); },
  };
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointerId !== null || !enabled()) return;
    held = true; pressed = true; pointerId = event.pointerId;
    canvas.setPointerCapture(pointerId);
    onStart(event);
    event.preventDefault();
  });
  host.addEventListener('pointerup', event => {
    if (event.button === 0 && event.pointerId === pointerId) { held = false; releaseCapture(); }
  });
  host.addEventListener('pointercancel', event => {
    if (event.pointerId === pointerId) input.clear();
  });
  host.addEventListener('blur', () => input.clear());
  canvas.addEventListener('lostpointercapture', event => {
    if (event.pointerId === pointerId) { held = false; pointerId = null; }
  });
  return input;
}
