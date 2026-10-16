import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../dist/js/simulation.js';
import { createActor, castSkill, configureActorForMode, updateCombat, damage } from '../dist/js/combat.js';
import { MELEE_VISUAL_TIMING, drawMeleeVisuals, drawMeleeImpact } from '../dist/js/melee-vfx.js';

const DT = 1 / 60;
const map = { width: 600, height: 400, obstacles: [], traps: [] };

function duel() {
  const game = createGame('melee-vfx-contract', { mode: 'melee' });
  const actor = createActor('visual-attacker', '刀手', 200, 200, true, '#fff');
  const target = createActor('visual-target', '受击者', 250, 200, false, '#f00');
  configureActorForMode(actor, 'melee');
  configureActorForMode(target, 'melee');
  Object.assign(game, { map, phase: 'hunt', time: 100, actors: [actor, target], monsters: [], gems: [], bullets: [], effects: [], events: [] });
  target.attackTimer = Number.POSITIVE_INFINITY;
  return { game, actor, target };
}

function equip(actor, id, rank = 1) {
  actor.skills[id] = rank;
  actor.activeSkills = [id];
  actor.cooldowns[id] = 0;
}

function canvasMock() {
  const calls = [];
  let depth = 0;
  const gradient = { addColorStop(...args) { calls.push(['addColorStop', ...args]); } };
  const target = {};
  const ctx = new Proxy(target, {
    get(object, property) {
      if (property === 'depth') return depth;
      if (property === 'calls') return calls;
      if (property === 'createLinearGradient' || property === 'createRadialGradient') return (...args) => { calls.push([property, ...args]); return gradient; };
      if (property === 'measureText') return text => ({ width: String(text).length * 6 });
      if (property in object) return object[property];
      return (...args) => {
        calls.push([property, ...args]);
        if (property === 'save') depth++;
        if (property === 'restore') depth--;
      };
    },
    set(object, property, value) { object[property] = value; return true; },
  });
  return ctx;
}

test('casting active melee skills records origins, locked aim, timing, and a bounded visual history', () => {
  const { game, actor } = duel();
  const required = ['id', 'kind', 'angle', 'range', 'arc', 'startedAt', 'windup', 'originX', 'originY', 'x', 'y'];
  actor.attackPressed = true;
  updateCombat(game, DT);
  assert.equal(actor.meleeAction.kind, 'basic');
  assert.equal(actor.meleeVisuals.length, 0, 'basic swings should not create special-skill visuals');
  actor.meleeAction = null;
  actor.attackTimer = 0;
  const casts = [
    ['lunge', 450, 200],
    ['whirlwind', 200, 300],
    ['heavySlash', 200, 100],
    ['lunge', 450, 200],
  ];
  for (const [id, aimX, aimY] of casts) {
    equip(actor, id, id === 'lunge' && actor.skills.lunge ? actor.skills.lunge + 1 : 1);
    const before = { x: actor.x, y: actor.y, time: game.time };
    assert.equal(castSkill(game, actor, 0, aimX, aimY), true, `${id} cast failed`);
    const visual = actor.meleeVisuals.at(-1);
    assert.ok(visual, `${id} did not record a visual`);
    for (const field of required) assert.ok(Object.hasOwn(visual, field), `${id} visual omitted ${field}`);
    assert.equal(visual.kind, id);
    assert.equal(visual.startedAt, before.time);
    assert.equal(visual.originX, before.x);
    assert.equal(visual.originY, before.y);
    assert.ok(Number.isFinite(visual.angle) && Number.isFinite(visual.range) && Number.isFinite(visual.arc));
    assert.ok(Number.isFinite(visual.x) && Number.isFinite(visual.y));
    if (id === 'lunge') {
      assert.ok(Math.hypot(visual.x - visual.originX, visual.y - visual.originY) > 0, 'lunge did not preserve its pre-move origin');
      assert.equal(visual.x, actor.x, 'lunge visual endpoint did not follow its post-move actor position');
      assert.equal(visual.y, actor.y);
    }
    actor.meleeAction = null;
  }
  assert.equal(actor.meleeVisuals.length, 3, 'visual history should retain only three entries');
  assert.deepEqual(actor.meleeVisuals.map(visual => visual.kind), ['whirlwind', 'heavySlash', 'lunge']);

  actor.hp = 1;
  damage(game, actor, 10, null);
  assert.equal(actor.alive, false);
  assert.deepEqual(actor.meleeVisuals, [], 'death did not clear melee visual history');
});

test('heavy slash freezes its first valid impact point before knockback', () => {
  const { game, actor, target } = duel();
  equip(actor, 'heavySlash');
  const targetBefore = { x: target.x, y: target.y };
  const actorBefore = { x: actor.x, y: actor.y };
  assert.equal(castSkill(game, actor, 0, target.x, target.y), true);
  const visual = actor.meleeVisuals.at(-1);
  assert.equal(Object.hasOwn(visual, 'impactX'), false, 'heavy slash recorded impact before its first hit');
  updateCombat(game, 0.36);
  assert.ok(Number.isFinite(visual.impactAt), 'first heavy hit did not record its impact time');
  assert.equal(visual.impactX, actorBefore.x);
  assert.equal(visual.impactY, actorBefore.y);
  assert.notEqual(target.x, targetBefore.x, 'test target was not knocked back');
  const frozen = [visual.impactAt, visual.impactX, visual.impactY];
  actor.x += 30;
  actor.y += 10;
  updateCombat(game, 0.5);
  assert.deepEqual([visual.impactAt, visual.impactX, visual.impactY], frozen, 'later actor motion rewrote the recorded hit point');
});

test('visual linger adds no damage or action lock; active windows, cooldowns, and unlock times stay fixed', () => {
  for (const [id, expectedCooldown, ticksToUnlock] of [['lunge', 7, 20], ['whirlwind', 8, 20], ['heavySlash', 8, 41]]) {
    const { game, actor, target } = duel();
    equip(actor, id);
    assert.equal(castSkill(game, actor, 0, target.x, target.y), true);
    assert.equal(actor.meleeAction.active, 0.08);
    assert.equal(actor.cooldowns[id], expectedCooldown);
    const duration = id === 'heavySlash' ? 0.35 + 0.08 + 0.25 : 0.08 + 0.25;
    assert.ok(Math.abs(duration - (id === 'heavySlash' ? 0.68 : 0.33)) < 1e-9);

    for (let i = 0; i < ticksToUnlock - 1; i++) updateCombat(game, DT);
    assert.ok(actor.meleeAction, `${id} unlocked before its action duration`);
    updateCombat(game, DT);
    assert.equal(actor.meleeAction, null, `${id} action remained locked after ${duration}s`);

    const hpAfterAction = target.hp;
    const visual = actor.meleeVisuals.at(-1);
    assert.ok(visual, `${id} visual was lost when the action unlocked`);
    for (let i = 0; i < Math.ceil(MELEE_VISUAL_TIMING[id].duration / DT); i++) updateCombat(game, DT);
    assert.equal(target.hp, hpAfterAction, `${id} visual linger caused extra damage`);
    assert.equal(actor.meleeAction, null, `${id} visual linger extended the combat lock`);
  }
});

test('canvas visuals render at start and after action unlock, disappear when expired, and restore state', () => {
  for (const id of ['lunge', 'whirlwind', 'heavySlash']) {
    const { actor, target, game } = duel();
    equip(actor, id);
    assert.equal(castSkill(game, actor, 0, target.x, target.y), true);
    const visual = actor.meleeVisuals.at(-1);
    const unlockTicks = id === 'heavySlash' ? 41 : 20;
    for (let i = 0; i < unlockTicks; i++) updateCombat(game, DT);
    assert.equal(actor.meleeAction, null, `${id} combat action was not unlocked before its visual linger`);
    actor.isPlayer = false;
    const ctx = canvasMock();
    const stateBefore = structuredClone({ x: actor.x, y: actor.y, action: actor.meleeAction, visuals: actor.meleeVisuals });

    game.time = visual.startedAt;
    const startAngle = drawMeleeVisuals(ctx, actor, game.time);
    assert.ok(Number.isFinite(startAngle), `${id} returned a non-finite sword angle at its start`);
    const startCalls = ctx.calls.length;
    assert.ok(startCalls > 0, `${id} produced no start-frame canvas calls`);
    assert.equal(ctx.depth, 0, `${id} leaked a canvas save at its start`);

    game.time = visual.startedAt + MELEE_VISUAL_TIMING[id].bodyDuration + 0.01;
    const lingerAngle = drawMeleeVisuals(ctx, actor, game.time);
    assert.ok(Number.isFinite(lingerAngle), `${id} returned a non-finite sword angle during visual linger`);
    assert.ok(ctx.calls.length > startCalls, `${id} did not draw visible linger after combat unlocked`);
    assert.equal(ctx.depth, 0, `${id} leaked canvas state during visual linger`);

    const beforeExpired = ctx.calls.length;
    game.time = visual.startedAt + MELEE_VISUAL_TIMING[id].duration + 0.01;
    const expiredAngle = drawMeleeVisuals(ctx, actor, game.time);
    assert.ok(Number.isFinite(expiredAngle), `${id} returned a non-finite angle after expiry`);
    assert.equal(ctx.calls.length, beforeExpired, `${id} continued drawing after visual expiry`);
    assert.equal(ctx.depth, 0);
    assert.deepEqual({ x: actor.x, y: actor.y, action: actor.meleeAction, visuals: actor.meleeVisuals }, stateBefore,
      `${id} renderer mutated combat state`);
  }
});

test('impact drawing accepts the renderer effect lifetime and restores canvas state', () => {
  const ctx = canvasMock();
  const effect = { x: 32, y: 48, ttl: 0.28, maxTtl: 0.28, kind: 'meleeImpact', color: '#ffd98a' };
  drawMeleeImpact(ctx, effect);
  assert.ok(ctx.calls.length > 0, 'impact renderer made no canvas calls');
  assert.equal(ctx.depth, 0, 'impact renderer leaked a canvas save');
  assert.deepEqual(effect, { x: 32, y: 48, ttl: 0.28, maxTtl: 0.28, kind: 'meleeImpact', color: '#ffd98a' },
    'impact renderer mutated its input effect');
});
