import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttackInput } from '../dist/js/controls.js';

class PointerEventLike extends Event {
  constructor(type, { button = 0, pointerId = 1 } = {}) {
    super(type, { cancelable: true });
    this.button = button;
    this.pointerId = pointerId;
  }
}

class FakeCanvas extends EventTarget {
  captures = new Set();
  setPointerCapture(pointerId) { this.captures.add(pointerId); }
  hasPointerCapture(pointerId) { return this.captures.has(pointerId); }
  releasePointerCapture(pointerId) { this.captures.delete(pointerId); }
  pointerDown(options) { this.dispatchEvent(new PointerEventLike('pointerdown', options)); }
  loseCapture(pointerId = 1) {
    this.captures.delete(pointerId);
    this.dispatchEvent(new PointerEventLike('lostpointercapture', { pointerId }));
  }
}

function harness(enabled = true) {
  const canvas = new FakeCanvas();
  const host = new EventTarget();
  let starts = 0;
  const input = createAttackInput(canvas, host, () => typeof enabled === 'function' ? enabled() : enabled, () => starts++);
  return {
    canvas, host, input,
    get starts() { return starts; },
    hostEvent(type, options) { host.dispatchEvent(new PointerEventLike(type, options)); },
  };
}

test('a short click between simulation frames produces exactly one pressed sample', () => {
  const state = harness();
  const { canvas, hostEvent, input } = state;
  canvas.pointerDown({ pointerId: 3 });
  hostEvent('pointerup', { pointerId: 3 });
  assert.deepEqual(input.read(), { attackHeld: false, attackPressed: true });
  assert.deepEqual(input.read(), { attackHeld: false, attackPressed: false });
  assert.equal(state.starts, 1);
});

test('holding keeps held true across reads while pressed is consumed once', () => {
  const { canvas, hostEvent, input } = harness();
  canvas.pointerDown({ pointerId: 5 });
  assert.deepEqual(input.read(), { attackHeld: true, attackPressed: true });
  assert.deepEqual(input.read(), { attackHeld: true, attackPressed: false });
  hostEvent('pointerup', { pointerId: 5 });
  assert.deepEqual(input.read(), { attackHeld: false, attackPressed: false });
});

test('window release, pointer cancellation, blur, and explicit clear all stop held input', () => {
  for (const release of [
    ({ hostEvent }) => hostEvent('pointerup', { pointerId: 7 }),
    ({ hostEvent }) => hostEvent('pointercancel', { pointerId: 7 }),
    ({ hostEvent }) => hostEvent('blur'),
    ({ input }) => input.clear(),
  ]) {
    const state = harness();
    state.canvas.pointerDown({ pointerId: 7 });
    assert.equal(state.input.read().attackHeld, true);
    release(state);
    assert.deepEqual(state.input.read(), { attackHeld: false, attackPressed: false });
    assert.equal(state.canvas.hasPointerCapture(7), false);
  }
});

test('lost pointer capture ends held input but preserves an unconsumed click edge', () => {
  const { canvas, input } = harness();
  canvas.pointerDown({ pointerId: 11 });
  canvas.loseCapture(11);
  assert.deepEqual(input.read(), { attackHeld: false, attackPressed: true });
  assert.deepEqual(input.read(), { attackHeld: false, attackPressed: false });
});

test('disabled input and non-left or off-canvas clicks never start an attack', () => {
  for (const stateName of ['paused', 'dead', 'classic', 'menu']) {
    let allowed = true;
    const disabled = harness(() => allowed);
    allowed = false;
    disabled.canvas.pointerDown({ button: 0, pointerId: 2 });
    assert.deepEqual(disabled.input.read(), { attackHeld: false, attackPressed: false }, `${stateName} state accepted an attack`);
    assert.equal(disabled.starts, 0, `${stateName} state fired onStart`);
  }

  const rightClick = harness();
  rightClick.canvas.pointerDown({ button: 2, pointerId: 4 });
  assert.deepEqual(rightClick.input.read(), { attackHeld: false, attackPressed: false });
  assert.equal(rightClick.starts, 0);

  const outside = harness();
  outside.host.dispatchEvent(new PointerEventLike('pointerdown', { button: 0, pointerId: 6 }));
  assert.deepEqual(outside.input.read(), { attackHeld: false, attackPressed: false });
  assert.equal(outside.starts, 0, 'a skill-card or other off-canvas click started an attack');
});
