import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, CONFIG } from '../dist/js/simulation.js';
import {
  MELEE_SKILLS, SKILLS, getSkills, createActor, castSkill, damage,
  configureActorForMode, chooseSkill,
} from '../dist/js/combat.js';
import { MELEE_BALANCE } from '../dist/js/modes.js';

const DT = 1 / 60;

function makeGame({ phase = 'hunt', obstacles = [] } = {}) {
  const game = createGame('melee-contract', { mode: 'melee' });
  game.map = { width: 600, height: 400, obstacles, traps: [] };
  game.phase = phase;
  game.time = phase === 'grace' ? 10 : 100;
  game.zone = null;
  game.monsters = [];
  game.gems = [];
  game.bullets = [];
  game.effects = [];
  const attacker = createActor('blade', '刀手', 200, 200, true, '#fff');
  configureActorForMode(attacker, 'melee');
  const targets = [
    createActor('target-a', '目标甲', 250, 200, false, '#f00'),
    createActor('target-b', '目标乙', 250, 200, false, '#0f0'),
  ];
  for (const target of targets) configureActorForMode(target, 'melee');
  attacker.attackTimer = 0;
  for (const target of targets) target.attackTimer = Number.POSITIVE_INFINITY;
  game.actors = [attacker, ...targets];
  return { game, attacker, targets };
}

function frame(game, attacker, dt = DT, input = {}) {
  stepGame(game, dt, { autoPlayer: false, mx: 0, my: 0, ...input });
}

function startSwing(game, attacker, angle = 0, extra = {}) {
  frame(game, attacker, DT, {
    attackPressed: true,
    attackHeld: true,
    aimX: attacker.x + Math.cos(angle) * 100,
    aimY: attacker.y + Math.sin(angle) * 100,
    ...extra,
  });
}

function advance(game, attacker, seconds, input = {}) {
  const steps = Math.ceil(seconds / DT);
  for (let i = 0; i < steps; i++) frame(game, attacker, DT, { attackHeld: true, ...input });
}

test('classic remains the default and melee mode is fixed per game with its own skill pool', () => {
  assert.equal(createGame('classic-default').mode, 'classic');
  const melee = createGame('melee-isolated', { mode: 'melee' });
  assert.equal(melee.mode, 'melee');
  assert.deepEqual(Object.keys(getSkills(melee)), Object.keys(MELEE_SKILLS));
  assert.deepEqual(Object.keys(getSkills('classic')), Object.keys(SKILLS));
  for (const id of ['fireball', 'multishot', 'dash', 'quake']) {
    assert.equal(MELEE_SKILLS[id], undefined, `${id} leaked into melee skill pool`);
  }
  assert.ok(Object.hasOwn(SKILLS, 'fireball'), 'classic skill pool lost fireball');
  Reflect.set(melee, 'mode', 'classic');
  assert.equal(melee.mode, 'melee', 'game mode should not be mutable');
});

test('melee does not auto-target and requires an attack input', () => {
  const { game, attacker, targets } = makeGame();
  const hp = targets.map(target => target.hp);
  for (let i = 0; i < 90; i++) frame(game, attacker);
  assert.deepEqual(targets.map(target => target.hp), hp);
  assert.equal(attacker.meleeAction ?? null, null);
  startSwing(game, attacker);
  advance(game, attacker, 0.4);
  assert.ok(targets.some((target, i) => target.hp < hp[i]), 'attack input did not start a melee hit');
});

test('melee locks its aim at attack start and applies windup before the active window', () => {
  const { game, attacker, targets } = makeGame();
  const initialHp = targets.map(target => target.hp);
  startSwing(game, attacker, 0);
  assert.equal(attacker.meleeAction.phase, 'windup');
  assert.equal(attacker.meleeAction.angle, 0);
  advance(game, attacker, MELEE_BALANCE.windup * 0.6, {
    aimX: attacker.x - 100, aimY: attacker.y,
  });
  assert.deepEqual(targets.map(target => target.hp), initialHp, 'target took damage during windup');
  assert.ok(Math.abs(attacker.meleeAction.angle) < 1e-9, 'aim changed during the swing');
  advance(game, attacker, MELEE_BALANCE.windup * 0.8);
  assert.ok(targets.some((target, i) => target.hp < initialHp[i]), 'no damage after windup');
});

test('melee arc checks target-circle intersection at its boundary', () => {
  const { game, attacker, targets } = makeGame();
  const halfArc = MELEE_BALANCE.arc / 2;
  const edge = targets[0];
  const edgeDistance = 75;
  edge.x = attacker.x + edgeDistance * Math.cos(halfArc + Math.asin(edge.radius / edgeDistance));
  edge.y = attacker.y + edgeDistance * Math.sin(halfArc + Math.asin(edge.radius / edgeDistance));
  const outside = targets[1];
  const outsideDistance = 75;
  outside.x = attacker.x + outsideDistance * Math.cos(halfArc + Math.asin(outside.radius / outsideDistance) + 0.08);
  outside.y = attacker.y + outsideDistance * Math.sin(halfArc + Math.asin(outside.radius / outsideDistance) + 0.08);
  const hp = [edge.hp, outside.hp];
  startSwing(game, attacker, 0);
  advance(game, attacker, 0.4);
  assert.ok(edge.hp < hp[0], 'target circle intersecting the arc edge was missed');
  assert.equal(outside.hp, hp[1], 'target wholly outside the arc was hit');
});

test('one swing hits multiple targets once each', () => {
  const { game, attacker, targets } = makeGame();
  const hp = targets.map(target => target.hp);
  startSwing(game, attacker);
  const firstActionId = attacker.meleeAction.id;
  advance(game, attacker, 0.4);
  assert.ok(targets.every((target, i) => target.hp < hp[i]), 'swing did not hit every target in range');
  const after = targets.map(target => target.hp);
  advance(game, attacker, 0.2);
  assert.deepEqual(targets.map(target => target.hp), after, 'same swing hit a target more than once');
  frame(game, attacker, 0.1, { attackHeld: false });
  assert.equal(attacker.meleeAction, null, 'first swing did not finish before the next input');
  startSwing(game, attacker);
  assert.notEqual(attacker.meleeAction.id, firstActionId, 'consecutive legal swings reused an action ID');
});

test('wall blocks melee line of sight and movement does not cancel a swing', () => {
  const blocked = makeGame({ obstacles: [{ x: 220, y: 160, w: 20, h: 80, kind: 'wall' }] });
  const hp = blocked.targets[0].hp;
  startSwing(blocked.game, blocked.attacker);
  advance(blocked.game, blocked.attacker, 0.7);
  assert.equal(blocked.targets[0].hp, hp, 'melee attack passed through wall');

  const moving = makeGame();
  const targetHp = moving.targets[0].hp;
  startSwing(moving.game, moving.attacker);
  frame(moving.game, moving.attacker, 0.1, { mx: 1, my: 0, attackHeld: true });
  advance(moving.game, moving.attacker, 0.7);
  assert.ok(moving.attacker.x > 200, 'actor did not move while attacking');
  assert.ok(moving.targets[0].hp < targetHp, 'movement canceled the active swing');
});

test('death cancels melee, protection blocks actor hits, and active time stays bounded', () => {
  const canceled = makeGame();
  startSwing(canceled.game, canceled.attacker);
  damage(canceled.game, canceled.attacker, canceled.attacker.hp + 1, null);
  advance(canceled.game, canceled.attacker, 1);
  assert.equal(canceled.attacker.meleeAction, null);
  assert.ok(canceled.targets.every(target => target.hp === target.maxHp));

  const protectedGame = makeGame({ phase: 'grace' });
  startSwing(protectedGame.game, protectedGame.attacker);
  advance(protectedGame.game, protectedGame.attacker, 0.8);
  assert.ok(protectedGame.targets.every(target => target.hp === target.maxHp), 'melee hit during protection');

  const bounded = makeGame();
  startSwing(bounded.game, bounded.attacker);
  advance(bounded.game, bounded.attacker, 3);
  assert.ok(bounded.attacker.meleeAction === null || bounded.attacker.meleeAction.phase !== 'active', 'active phase exceeded three seconds');
});

test('melee skill pool exposes bounded actives and the specified passive upgrades', () => {
  for (const id of ['lunge', 'whirlwind', 'heavySlash']) {
    assert.equal(MELEE_SKILLS[id]?.type, 'active');
    assert.equal(MELEE_SKILLS[id]?.maxRank, 4);
  }
  for (const id of ['power', 'haste', 'vitality', 'magnet', 'bladeReach']) {
    assert.equal(MELEE_SKILLS[id]?.type, 'passive');
  }
  assert.equal(MELEE_SKILLS.power.name, '刀锋强化');
  const actor = createActor('configured', 'Configured', 100, 100, true);
  configureActorForMode(actor, 'melee');
  assert.equal(actor.weaponType, 'sword');
});

test('choosing blade reach synchronizes actor range and the next basic swing', () => {
  const { game, attacker } = makeGame();
  assert.equal(attacker.attackRange, MELEE_BALANCE.range);
  attacker.pendingChoices = 1;
  attacker.choices = ['bladeReach'];
  assert.equal(chooseSkill(game, attacker, 'bladeReach'), true);
  assert.equal(attacker.attackRange, MELEE_BALANCE.range + 4);
  startSwing(game, attacker);
  assert.equal(attacker.meleeAction.range, attacker.attackRange);
  assert.equal(attacker.meleeAction.range, MELEE_BALANCE.range + 4);
});

test('failed skill interruption does not spend cooldown and cannot interrupt another active skill', () => {
  const { game, attacker } = makeGame();
  attacker.skills.lunge = 1;
  attacker.activeSkills = ['lunge'];
  attacker.cooldowns = { lunge: 0 };
  startSwing(game, attacker);
  assert.equal(castSkill(game, attacker, 0, attacker.x + 100, attacker.y), true, 'active skill did not interrupt an unlanded basic windup');
  assert.equal(attacker.meleeAction.kind, 'lunge');
  attacker.cooldowns.lunge = 0;

  attacker.meleeAction = { id: 'other', kind: 'heavySlash', phase: 'active', angle: 0, range: 96, arc: 1.4, elapsed: 0, windup: 0.35, active: 0.08, recovery: 0.25, hitIds: new Set(), damage: 10 };
  assert.equal(castSkill(game, attacker, 0, attacker.x + 100, attacker.y), false, 'skill interrupted another active skill');
  assert.equal(attacker.cooldowns.lunge, 0, 'failed cast consumed cooldown');
});

test('lunge and heavy slash movement and knockback stop at walls', () => {
  const blocked = [{ x: 260, y: 0, w: 30, h: 400, kind: 'wall' }];
  const lungeGame = makeGame({ obstacles: blocked });
  lungeGame.attacker.x = 200;
  lungeGame.attacker.y = 200;
  lungeGame.attacker.skills.lunge = 1;
  lungeGame.attacker.activeSkills = ['lunge'];
  lungeGame.attacker.cooldowns = { lunge: 0 };
  assert.equal(castSkill(lungeGame.game, lungeGame.attacker, 0, 500, 200), true);
  assert.ok(lungeGame.attacker.x + lungeGame.attacker.radius <= 260, 'lunge crossed a wall');

  const heavy = makeGame({ obstacles: [{ x: 260, y: 0, w: 30, h: 400, kind: 'wall' }] });
  heavy.attacker.skills.heavySlash = 1;
  heavy.attacker.activeSkills = ['heavySlash'];
  heavy.attacker.cooldowns = { heavySlash: 0 };
  heavy.targets[0].x = 240;
  heavy.targets[0].y = 200;
  assert.equal(castSkill(heavy.game, heavy.attacker, 0, 500, 200), true);
  advance(heavy.game, heavy.attacker, 1);
  assert.ok(heavy.targets[0].x + heavy.targets[0].radius <= 260, 'heavy slash knockback pushed target through wall');
});

test('melee skill selection stays live, permits death, and keeps grace and deadline rules', () => {
  const game = createGame('melee-choice-contract', { mode: 'melee' });
  const player = game.actors.find(actor => actor.isPlayer);
  const source = game.actors.find(actor => actor !== player);
  player.pendingChoices = 1;
  player.choices = ['lunge'];
  const before = game.time;
  stepGame(game, 1 / 30, { autoPlayer: false, mx: 0, my: 0 });
  assert.ok(game.time > before, 'time stopped during a melee skill choice');
  player.hp = 1;
  game.phase = 'hunt';
  damage(game, player, 100, source);
  assert.equal(player.alive, false, 'choice prevented death');

  const protection = makeGame({ phase: 'grace' });
  const target = protection.targets[0];
  const hp = target.hp;
  damage(protection.game, target, 100, protection.attacker);
  assert.equal(target.hp, hp, 'grace did not block melee-mode actor damage');

  const deadline = createGame('melee-deadline-contract', { mode: 'melee' });
  deadline.time = CONFIG.matchLimit - 0.01;
  deadline.phase = 'finale';
  deadline.zone = { x: deadline.map.width / 2, y: deadline.map.height / 2, radius: 0, initialRadius: 0, startedAt: CONFIG.finaleDeadline, reason: 'time' };
  deadline.monsters = [];
  deadline.gems = [];
  for (const actor of deadline.actors.slice(1)) actor.alive = false;
  const survivor = deadline.actors[0];
  survivor.x = deadline.zone.x;
  survivor.y = deadline.zone.y;
  survivor.attackTimer = Number.POSITIVE_INFINITY;
  stepGame(deadline, 0.1, { autoPlayer: false, mx: 0, my: 0 });
  assert.equal(deadline.time, CONFIG.matchLimit);
  assert.equal(deadline.result?.winnerId, survivor.id);
});
