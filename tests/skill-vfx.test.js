import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVES } from '../dist/js/balance.js';
import { drawSkillEffect, drawBladeWard } from '../dist/js/skill-vfx.js';
import { drawMeleeVisuals, MELEE_VISUAL_TIMING } from '../dist/js/melee-vfx.js';

// Model real save/restore semantics and reject invalid geometry without Canvas dependencies.
function canvasMock() {
  const calls = [];
  const stack = [];
  const context = {
    globalAlpha: .63,
    fillStyle: '#123456',
    strokeStyle: '#654321',
    lineWidth: 7,
    calls,
    get depth() { return stack.length; },
    save() { stack.push(style()); calls.push(['save']); },
    restore() {
      assert.ok(stack.length, 'restore without a matching save');
      Object.assign(context, stack.pop());
      calls.push(['restore']);
    },
  };
  function style() {
    return {
      globalAlpha: context.globalAlpha,
      fillStyle: context.fillStyle,
      strokeStyle: context.strokeStyle,
      lineWidth: context.lineWidth,
    };
  }
  for (const method of ['translate', 'rotate', 'moveTo', 'lineTo', 'fillRect']) {
    context[method] = (...args) => {
      assert.ok(args.every(Number.isFinite), `${method} received invalid geometry: ${args}`);
      assert.ok(Number.isFinite(context.globalAlpha), 'non-finite alpha');
      if (method === 'fillRect') assert.ok(args[2] >= 0 && args[3] >= 0, 'negative rectangle size');
      calls.push([method, ...args]);
    };
  }
  for (const method of ['beginPath', 'closePath', 'fill', 'stroke']) {
    context[method] = () => calls.push([method]);
  }
  return { context, style };
}

function paintCount(context) {
  return context.calls.filter(([method]) => ['fill', 'stroke', 'fillRect'].includes(method)).length;
}

function freezeDeep(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function assertReadOnlyDraw(input, draw) {
  const before = structuredClone(input);
  freezeDeep(input);
  const { context, style } = canvasMock();
  const originalStyle = style();
  const result = draw(context, input);
  assert.deepEqual(input, before, 'drawing changed its simulation input');
  assert.equal(context.depth, 0, 'drawing leaked a saved context');
  assert.deepEqual(style(), originalStyle, 'drawing leaked alpha or paint styles');
  return { context, result };
}

function skillEffect(kind, age) {
  const lifetime = ACTIVES[kind].effectTtl;
  return {
    kind, x: 100, y: 120, radius: 125, color: ACTIVES[kind].color,
    ttl: lifetime - age, maxTtl: lifetime,
    ...(kind === 'chainLightning' ? {
      points: [{ x: 100, y: 120 }, { x: 180, y: 80 }, { x: 240, y: 145 }],
    } : {}),
  };
}

function thrustActor(overrides = {}) {
  return {
    x: 100, y: 120, aimAngle: .3, isPlayer: false, meleeAction: null,
    meleeVisuals: [{
      id: 'thrust-1', kind: 'piercingThrust', angle: .3,
      range: 170, arc: Math.PI / 6, windup: ACTIVES.piercingThrust.windup,
      startedAt: 10, originX: 100, originY: 120, x: 100, y: 120,
      impactX: 105, impactY: 125, impactAt: 10.22,
    }],
    ...overrides,
  };
}

test('new transient skills draw multiple keyframes without mutating events or leaking Canvas state', () => {
  for (const kind of ['chainLightning', 'frostNova', 'bladeWard']) {
    const signatures = [];
    for (const age of [.03, .16, .32, .5]) {
      const { context, result } = assertReadOnlyDraw(skillEffect(kind, age),
        (ctx, effect) => drawSkillEffect(ctx, effect));
      assert.equal(result, true, `${kind} was not recognized`);
      assert.ok(paintCount(context) > 0, `${kind} drew nothing at ${age}s`);
      signatures.push(JSON.stringify(context.calls));
    }
    assert.ok(new Set(signatures).size > 1, `${kind} never animated across its keyframes`);
  }
});

test('transient dispatch identifies supported events, ignores unrelated effects, and ends expired visuals', () => {
  const unknown = assertReadOnlyDraw({ kind: 'text', text: 'unchanged' }, drawSkillEffect);
  assert.equal(unknown.result, false);
  assert.equal(unknown.context.calls.length, 0, 'unknown kinds should be left for other renderers');
  for (const kind of ['chainLightning', 'frostNova', 'bladeWard']) {
    for (const ttl of [0, -.2]) {
      const effect = { ...skillEffect(kind, 0), ttl };
      const { context, result } = assertReadOnlyDraw(effect, drawSkillEffect);
      assert.equal(result, true);
      assert.equal(paintCount(context), 0, `${kind} painted after expiry`);
    }
  }
});

test('zero radius and omitted optional event fields remain finite and preserve Canvas state', () => {
  const effects = [
    { kind: 'chainLightning', ttl: .4 },
    { kind: 'chainLightning', points: [{}, { x: NaN, y: 1 }], ttl: .4 },
    { kind: 'frostNova', radius: 0, ttl: .5 },
    { kind: 'frostNova', ttl: .5 },
    { kind: 'bladeWard', radius: 0, ttl: .5 },
    { kind: 'bladeWard', ttl: .5 },
  ];
  for (const effect of effects) {
    const { context, result } = assertReadOnlyDraw(effect, drawSkillEffect);
    assert.equal(result, true);
    if (effect.kind === 'chainLightning') {
      assert.equal(paintCount(context), 0, 'no valid chain segment should produce a stray bolt');
    } else {
      assert.ok(paintCount(context) > 0, 'optional fields should use drawable finite defaults');
    }
  }
});

test('piercing thrust draws windup, strike and unlocked linger, then ends at .9 seconds', () => {
  assert.equal(MELEE_VISUAL_TIMING.piercingThrust.duration, .9);
  for (const age of [.06, .21, .27, .46, .72, .89]) {
    const { context, result } = assertReadOnlyDraw(thrustActor(),
      (ctx, actor) => drawMeleeVisuals(ctx, actor, 10 + age));
    assert.ok(Number.isFinite(result));
    assert.ok(paintCount(context) > 0, `thrust drew nothing at ${age}s`);
  }
  for (const age of [.9, .91, 1.3]) {
    const { context, result } = assertReadOnlyDraw(thrustActor(),
      (ctx, actor) => drawMeleeVisuals(ctx, actor, 10 + age));
    assert.equal(result, .3, 'expired thrust should return idle aim');
    assert.equal(context.calls.length, 0, 'expired thrust still drew after its .9s lifetime');
  }
});

test('piercing thrust accepts zero range and incomplete optional snapshot fields', () => {
  for (const age of [.1, .3, .7]) {
    const actor = thrustActor({
      meleeVisuals: [{ kind: 'piercingThrust', startedAt: 10, range: 0 }],
    });
    const { context, result } = assertReadOnlyDraw(actor,
      (ctx, input) => drawMeleeVisuals(ctx, input, 10 + age));
    assert.ok(Number.isFinite(result));
    assert.ok(paintCount(context) > 0);
  }
});

test('ward persists only while both shield HP and time are positive', () => {
  for (const values of [
    { shieldHp: 0, shieldT: 3 }, { shieldHp: -1, shieldT: 3 },
    { shieldHp: 36, shieldT: 0 }, { shieldHp: 36, shieldT: -1 }, {},
  ]) {
    const { context } = assertReadOnlyDraw({ x: 50, y: 60, ...values },
      (ctx, actor) => drawBladeWard(ctx, actor, .3));
    assert.equal(context.calls.length, 0, 'inactive shield should produce no visual');
  }
  for (const time of [.1, .7, 2.2]) {
    const actor = { x: 50, y: 60, radius: 12, shieldHp: 36, shieldT: 3.5 - time };
    const layers = [false, true].map(front => assertReadOnlyDraw(structuredClone(actor),
      (ctx, input) => drawBladeWard(ctx, input, time, { front })).context);
    for (const layer of layers) assert.ok(paintCount(layer) > 0, 'both ward layers must be visible');
    assert.notDeepEqual(layers[0].calls, layers[1].calls, 'front and back drew identical blades');
    const complete = assertReadOnlyDraw(actor, (ctx, input) => {
      drawBladeWard(ctx, input, time, { front: false });
      drawBladeWard(ctx, input, time, { front: true });
    }).context;
    assert.equal(paintCount(complete), paintCount(layers[0]) + paintCount(layers[1]),
      'composing the two layers lost or duplicated shield geometry');
  }
});
