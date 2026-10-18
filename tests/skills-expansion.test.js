import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVES, PASSIVE, focusCooldown, skillCooldown } from '../dist/js/balance.js';
import {
  MELEE_SKILLS, SKILLS, addXp, castSkill, chooseSkill, createActor, configureActorForMode,
  damage, getChoices, getSkills, updateCombat, PROGRESSION,
} from '../dist/js/combat.js';
import { CONFIG, createGame, stepGame } from '../dist/js/simulation.js';

const map = { width: 1000, height: 800, obstacles: [], traps: [] };

function arena(mode = 'classic', { actors = 1, monsters = [] } = {}) {
  const game = createGame(`skill-expansion-${mode}`, { mode });
  const roster = Array.from({ length: actors }, (_, index) => {
    const actor = createActor(`actor-${index}`, `Actor ${index}`, 100 + index * 100, 100, index === 0, '#fff');
    configureActorForMode(actor, mode);
    actor.attackTimer = 100;
    return actor;
  });
  Object.assign(game, {
    map: { ...map, obstacles: [], traps: [] }, phase: 'hunt', time: 100,
    actors: roster, monsters, gems: [], bullets: [], effects: [], events: [],
  });
  return { game, actor: roster[0], actors: roster };
}

function monster(id, x, y, hp = 1000, extra = {}) {
  return { id, type: 'slime', x, y, radius: 8, hp, maxHp: hp, speed: 0, damage: 0, attackTimer: 100, alive: true, xp: 0, ...extra };
}

function equip(actor, id, rank = 1) {
  actor.skills[id] = rank;
  if (!actor.activeSkills.includes(id)) actor.activeSkills.push(id);
  actor.cooldowns[id] = 0;
}

function oneActive(mode, id, rank = 1) {
  const { game, actor } = arena(mode, { monsters: [monster('target', 170, 100)] });
  actor.activeSkills = [];
  equip(actor, id, rank);
  return { game, actor };
}

test('each mode exposes thirteen skills with five actives and eight passives', () => {
  for (const mode of ['classic', 'melee']) {
    const skills = getSkills(mode);
    const entries = Object.values(skills);
    assert.equal(entries.length, 13, `${mode} catalog size`);
    assert.equal(entries.filter(skill => skill.type === 'active').length, 5, `${mode} active count`);
    assert.equal(entries.filter(skill => skill.type === 'passive').length, 8, `${mode} passive count`);
  }
  for (const id of ['chainLightning', 'frostNova']) assert.equal(MELEE_SKILLS[id], undefined);
  for (const id of ['piercingThrust', 'bladeWard']) assert.equal(SKILLS[id], undefined);
});

test('active skill choices cap at three, exclude a full active set, and preserve queued level choices', () => {
  const { game, actor } = arena('classic');
  const activeIds = Object.entries(SKILLS).filter(([, skill]) => skill.type === 'active').map(([id]) => id);
  actor.activeSkills = activeIds.slice(0, PROGRESSION.maxActiveSkills);
  actor.skills = Object.fromEntries(actor.activeSkills.map(id => [id, SKILLS[id].maxRank]));
  actor.pendingChoices = 2;
  actor.choices = [];
  const choices = getChoices(game, actor);
  assert.ok(choices.length > 0, 'full active set should still offer passive upgrades');
  assert.ok(choices.every(id => !activeIds.slice(3).includes(id)), 'a fourth active was offered');
  assert.equal(chooseSkill(game, actor, choices[0]), true);
  assert.equal(actor.pendingChoices, 1, 'one queued level choice should remain');
  assert.ok(actor.choices.length > 0, 'next queued level choice was not generated');
  assert.equal(actor.activeSkills.length, 3, 'choosing from a queued level added a fourth active');

  const melee = arena('melee');
  const meleeActive = Object.entries(MELEE_SKILLS).filter(([, skill]) => skill.type === 'active').map(([id]) => id);
  melee.actor.activeSkills = meleeActive.slice(0, PROGRESSION.maxActiveSkills);
  melee.actor.skills = Object.fromEntries(melee.actor.activeSkills.map(id => [id, MELEE_SKILLS[id].maxRank]));
  melee.actor.pendingChoices = 1;
  melee.actor.choices = [];
  const meleeChoices = getChoices(melee.game, melee.actor);
  assert.ok(meleeChoices.length > 0);
  assert.ok(meleeChoices.every(id => !meleeActive.slice(3).includes(id)), 'melee offered a fourth active');
});

test('chain lightning favors forward targets, chains once per target, and falls off each jump', () => {
  const targets = [
    monster('behind', 40, 170),
    monster('first', 170, 100),
    monster('second', 315, 100),
    monster('third', 460, 100),
    monster('fourth', 605, 100),
  ];
  const { game, actor } = arena('classic', { monsters: targets });
  // The rear target is visible from the caster but hidden from the first jump target.
  game.map.obstacles.push({ x: 88, y: 139, w: 8, h: 8 });
  actor.activeSkills = [];
  equip(actor, 'chainLightning', 3);
  assert.equal(castSkill(game, actor, 0, 300, 100), true);
  const effect = game.effects.find(item => item.kind === 'chainLightning');
  assert.ok(effect, 'chain lightning effect was not recorded');
  assert.deepEqual(effect.points.map(point => targets.find(target => target.x === point.x)?.id).filter(Boolean),
    ['first', 'second', 'third', 'fourth'], 'first target should prefer forward direction and the chain should hit four total');
  assert.equal(effect.points.length, 5, 'rank three should add the fourth target');
  assert.equal(targets[0].hp, 1000, 'behind target should not outrank a forward target');
  assert.equal(targets[1].hp, 1000 - 42);
  assert.equal(targets[2].hp, 1000 - 42 * 0.75);
  assert.equal(targets[3].hp, 1000 - 42 * 0.75 ** 2);
  assert.equal(targets[4].hp, 1000 - 42 * 0.75 ** 3, 'fourth chain hit had the wrong falloff');

  const direction = arena('classic', { monsters: [monster('near-rear', 80, 100), monster('far-forward', 270, 100)] });
  direction.actor.activeSkills = [];
  equip(direction.actor, 'chainLightning', 1);
  castSkill(direction.game, direction.actor, 0, 300, 100);
  assert.equal(direction.game.effects.find(item => item.kind === 'chainLightning').points[1].x, 270,
    'nearest rear target outranked the farther forward target');

  const replay = arena('classic', { monsters: [monster('a', 160, 100), monster('b', 305, 100), monster('c', 450, 100), monster('d', 597, 100)] });
  replay.actor.activeSkills = [];
  equip(replay.actor, 'chainLightning', 1);
  castSkill(replay.game, replay.actor, 0, 300, 100);
  assert.equal(replay.game.effects.find(item => item.kind === 'chainLightning').points.length, 4,
    'rank one should chain to three targets after its origin point');
});

test('chain lightning requires visible first and jump targets within 145 pixels and spends no cooldown without a target', () => {
  const targets = [monster('first', 180, 100), monster('blocked', 300, 100), monster('too-far', 446, 100)];
  const { game, actor } = arena('classic', { monsters: targets });
  game.map.obstacles.push({ x: 140, y: 90, w: 20, h: 20 });
  actor.activeSkills = [];
  equip(actor, 'chainLightning', 1);
  assert.equal(castSkill(game, actor, 0, 300, 100), false);
  assert.equal(actor.cooldowns.chainLightning, 0, 'empty visible-target set spent cooldown');

  game.map.obstacles.length = 0;
  assert.equal(castSkill(game, actor, 0, 300, 100), true);
  const effect = game.effects.find(item => item.kind === 'chainLightning');
  assert.equal(effect.points.length, 3, '145-pixel jump should reach the boundary target');
  assert.equal(targets[2].hp, 1000, 'a target farther than 145 pixels was chained');

  actor.cooldowns.chainLightning = 0;
  game.map.obstacles.push({ x: 230, y: 90, w: 20, h: 20 });
  assert.equal(castSkill(game, actor, 0, 300, 100), true, 'visible first target should still be hit');
  const blockedEffect = game.effects.filter(item => item.kind === 'chainLightning').at(-1);
  assert.equal(blockedEffect.points.length, 2, 'chain crossed a wall to its next target');
});

test('frost nova applies rank radius, LOS damage, and expiring slow to monsters and travelers outside grace', () => {
  const targets = [monster('near', 245, 100), monster('behind-wall', 100, 240)];
  const { game, actor, actors } = arena('classic', { actors: 2, monsters: targets });
  const traveler = actors[1];
  traveler.x = 220;
  targets[0].x = 250;
  game.map.obstacles.push({ x: 90, y: 180, w: 20, h: 25 });
  actor.activeSkills = [];
  equip(actor, 'frostNova', 4);
  actor.x = 100;
  traveler.x = 200;
  targets[0].x = 255;
  assert.equal(castSkill(game, actor, 0, actor.x + 1, actor.y), true);
  assert.equal(targets[0].hp, 1000 - 37, 'near monster missed rank four frost damage');
  assert.equal(targets[0].slowUntil, 100 + 2.75, 'monster slow duration did not scale with rank');
  assert.equal(traveler.slowUntil, 100 + 2.75, 'traveler slow duration did not scale with rank');
  assert.equal(targets[1].hp, 1000, 'frost damage passed through an obstacle');
  assert.equal(targets[1].slowUntil, undefined, 'frost slow passed through an obstacle');

  const movement = arena('classic', { actors: 2 });
  movement.actor.x = 100;
  movement.actor.y = 100;
  movement.actor.slowUntil = 0.75;
  movement.game.time = 0;
  const victim = movement.actor;
  stepGame(movement.game, 0.25, { mx: 1, my: 0 });
  const slowedDistance = victim.x - 100;
  assert.ok(Math.abs(slowedDistance - 100 * 0.65 * 0.25) < 1e-6, `traveler moved ${slowedDistance} while slowed`);
  victim.x = 100;
  stepGame(movement.game, 0.5, { mx: 1, my: 0 });
  assert.ok(Math.abs(victim.x - 100 - 50) < 1e-6, `traveler slow remained after its expiry (moved ${victim.x - 100})`);

  const slowedMonster = targets[0];
  slowedMonster.x = 300;
  slowedMonster.y = 300;
  slowedMonster.speed = 100;
  slowedMonster.slowUntil = 101;
  const before = { x: slowedMonster.x, y: slowedMonster.y };
  updateCombat(game, 0.1);
  assert.ok(Math.abs(Math.hypot(before.x - slowedMonster.x, before.y - slowedMonster.y) - 6.5) < 0.3,
    'monster did not move at frost slowed speed');
  game.time = 102;
  slowedMonster.x = 300;
  slowedMonster.y = 300;
  updateCombat(game, 0.1);
  assert.ok(Math.abs(Math.hypot(300 - slowedMonster.x, 300 - slowedMonster.y) - 10) < 0.3,
    'monster slow remained after its expiry');
});

test('frost nova does not slow travelers during grace, while still slowing monsters', () => {
  const targets = [monster('monster', 180, 100)];
  const { game, actor, actors } = arena('classic', { actors: 2, monsters: targets });
  actor.x = 100;
  actors[1].x = 180;
  game.phase = 'grace';
  actor.activeSkills = [];
  equip(actor, 'frostNova', 1);
  assert.equal(castSkill(game, actor, 0, actor.x + 1, actor.y), true);
  assert.equal(actors[1].slowUntil, undefined, 'grace protected traveler was slowed');
  assert.equal(targets[0].slowUntil, 102, 'monster was incorrectly protected with travelers');
});

test('piercing thrust respects rank range, 30 degree sector, LOS, windup, and per-action hit deduplication', () => {
  const targets = [
    monster('center', 230, 100),
    monster('edge', 225, 130),
    monster('outside-angle', 210, 165),
    monster('outside-range', 270, 100),
  ];
  const { game, actor } = arena('melee', { monsters: targets });
  actor.x = 100;
  actor.y = 100;
  actor.attackDamage = 100;
  actor.activeSkills = [];
  equip(actor, 'piercingThrust', 2);
  assert.equal(castSkill(game, actor, 0, 300, 100), true);
  assert.equal(actor.meleeAction.windup, 0.22);
  assert.equal(actor.meleeAction.range, 150);
  assert.equal(actor.meleeAction.arc, Math.PI / 6);
  assert.equal(targets[0].hp, 1000, 'target was hit before thrust windup completed');
  updateCombat(game, 0.22);
  const expected = 100 * (2.6 + 0.2);
  assert.equal(targets[0].hp, 1000 - expected);
  assert.equal(targets[1].hp, 1000 - expected, 'target within the 30-degree sector was missed');
  assert.equal(targets[2].hp, 1000, 'target outside the 30-degree sector was hit');
  assert.equal(targets[3].hp, 1000, 'target outside rank-two range was hit');
  updateCombat(game, 0.02);
  assert.equal(targets[0].hp, 1000 - expected, 'same thrust action hit the same target twice');

  const blocked = oneActive('melee', 'piercingThrust', 1);
  blocked.game.map.obstacles.push({ x: 135, y: 90, w: 20, h: 20 });
  blocked.actor.attackDamage = 100;
  castSkill(blocked.game, blocked.actor, 0, 300, 100);
  updateCombat(blocked.game, 0.22);
  assert.equal(blocked.game.monsters[0].hp, 1000, 'thrust pierced line of sight');
});

test('melee actives interrupt basic attacks but cannot interrupt another active', () => {
  const { game, actor } = arena('melee');
  actor.meleeAction = { kind: 'basic', elapsed: 0, hitIds: new Set() };
  actor.activeSkills = [];
  equip(actor, 'piercingThrust', 1);
  assert.equal(castSkill(game, actor, 0, actor.x + 100, actor.y), true, 'thrust did not cancel a basic attack');
  const first = actor.meleeAction;
  actor.cooldowns.whirlwind = 0;
  actor.activeSkills.push('whirlwind');
  actor.skills.whirlwind = 1;
  assert.equal(castSkill(game, actor, 1, actor.x + 100, actor.y), false, 'whirlwind interrupted an active thrust');
  assert.equal(actor.meleeAction, first);
  assert.equal(actor.cooldowns.whirlwind, 0, 'rejected active cast spent cooldown');
});

test('blade ward refreshes its rank shield and duration without stacking', () => {
  const { game, actor } = oneActive('melee', 'bladeWard', 1);
  actor.activeSkills[1] = 'bladeWard';
  actor.activeSkills[0] = 'bladeWard';
  actor.skills.bladeWard = 1;
  assert.equal(castSkill(game, actor, 0, actor.x + 1, actor.y), true);
  assert.equal(actor.shieldHp, 36);
  assert.equal(actor.shieldT, 3.5);
  actor.skills.bladeWard = 2;
  actor.cooldowns.bladeWard = 0;
  actor.meleeAction = null;
  assert.equal(castSkill(game, actor, 0, actor.x + 1, actor.y), true);
  assert.equal(actor.shieldHp, 48, 'refresh added shield to the existing pool');
  assert.equal(actor.shieldT, 3.75, 'refresh duration did not use the current rank');
  updateCombat(game, 4);
  assert.equal(actor.shieldT, 0, 'ward duration did not expire');
  assert.equal(actor.shieldHp, 0, 'expired ward retained usable shield');
});

test('blade ward absorbs monster, traveler, and trap damage; storm and deadline damage bypass it; death clears it', () => {
  const { game, actor, actors } = arena('classic', { actors: 2, monsters: [monster('attacker', 120, 100, 1000, { damage: 12, speed: 0, attackTimer: 0 })] });
  actor.shieldHp = 36;
  actor.shieldT = 4;
  const hp = actor.hp;
  updateCombat(game, 1 / 60);
  assert.equal(actor.hp, hp, 'monster damage passed through shield');
  assert.equal(actor.shieldHp, 24);
  const travelerDamage = damage(game, actor, 10, actors[1]);
  assert.equal(travelerDamage, 0, 'traveler damage was not fully absorbed');
  assert.equal(actor.hp, hp);
  assert.equal(actor.shieldHp, 17.5);
  assert.equal(damage(game, actor, 8, { type: 'trap' }), 0, 'trap damage was not absorbed');
  assert.equal(actor.hp, hp);
  assert.equal(actor.shieldHp, 9.5);

  damage(game, actor, 5, { type: 'zone' });
  assert.equal(actor.hp, hp - 5, 'storm damage was absorbed');
  assert.equal(actor.shieldHp, 9.5, 'storm damage consumed shield');

  const deadline = createGame('blade-ward-deadline');
  deadline.phase = 'finale';
  deadline.time = CONFIG.matchLimit - 1 / 60;
  deadline.zone = { x: 0, y: 0, radius: 0, initialRadius: 0, startedAt: deadline.time - 11 };
  for (const target of deadline.actors) { target.hp = target.maxHp; target.shieldHp = 100; target.shieldT = 10; }
  stepGame(deadline, 1 / 60);
  assert.ok(deadline.actors.every(target => !target.alive), 'deadline storm failed to kill fully shielded actors');
  assert.ok(deadline.actors.every(target => target.damageTakenByKind.zone > 0), 'deadline damage was not attributed to storm');
  assert.ok(deadline.actors.every(target => target.shieldHp === 0 && target.shieldT === 0), 'death left blade ward active');
});

test('precision has a five-rank 25 percent cap, deals 1.5x damage, and skips RNG without rank or during grace', () => {
  const target = monster('precision-target', 150, 100);
  const { game, actor, actors } = arena('classic', { actors: 2, monsters: [target] });
  let draws = 0;
  game.rng = () => { draws++; return 0.24; };
  assert.equal(damage(game, target, 20, actor), 20);
  assert.equal(draws, 0, 'unranked precision consumed RNG');

  actor.skills.precision = 99;
  assert.equal(damage(game, target, 20, actor), 30, 'capped precision did not deal 1.5x');
  assert.equal(draws, 1);
  game.rng = () => { draws++; return 0.25; };
  assert.equal(damage(game, target, 20, actor), 20, 'precision above rank five exceeded its 25% cap');
  const drawsBeforeGrace = draws;
  game.phase = 'grace';
  const hp = actors[1].hp;
  assert.equal(damage(game, actors[1], 50, actor), 0);
  assert.equal(actors[1].hp, hp);
  assert.equal(draws, drawsBeforeGrace, 'grace-protected traveler hit consumed RNG before protection');
});

test('sustain heals once per kill up to max HP and never revives a dead actor', () => {
  const victim = monster('victim', 150, 100, 1);
  const { game, actor } = arena('classic', { monsters: [victim] });
  actor.skills.sustain = 3;
  actor.hp = actor.maxHp - 4;
  assert.ok(damage(game, victim, 1, actor) > 0);
  assert.equal(victim.alive, false);
  assert.equal(actor.hp, actor.maxHp, 'sustain exceeded max HP instead of capping');
  const healedHp = actor.hp;
  assert.equal(damage(game, victim, 1, actor), 0);
  assert.equal(actor.hp, healedHp, 'repeated damage to a dead monster healed again');

  actor.hp = 100;
  damage(game, monster('heal-exact', 150, 100, 1), 1, actor);
  assert.equal(actor.hp, 109, 'rank three sustain should heal exactly nine HP');

  actor.hp = 0;
  actor.alive = false;
  const secondVictim = monster('second-victim', 150, 100, 1);
  game.monsters = [secondVictim];
  assert.ok(damage(game, secondVictim, 1, actor) > 0);
  assert.equal(actor.hp, 0, 'dead sustain owner was revived');
});

test('focus reduces every active cooldown by at most twenty percent and leaves unranked cooldowns unchanged', () => {
  for (const [mode, catalog] of [['classic', SKILLS], ['melee', MELEE_SKILLS]]) {
    const activeIds = Object.entries(catalog).filter(([, skill]) => skill.type === 'active').map(([id]) => id);
    assert.equal(activeIds.length, 5);
    for (const id of activeIds) {
      const baseline = oneActive(mode, id);
      assert.equal(castSkill(baseline.game, baseline.actor, 0, baseline.actor.x + 100, baseline.actor.y), true, `${mode}/${id} baseline cast failed`);
      const baseCooldown = mode === 'melee' ? ACTIVES[id].cooldown : skillCooldown(id, 1);
      assert.equal(baseline.actor.cooldowns[id], baseCooldown, `${mode}/${id} unranked focus changed cooldown`);

      const focused = oneActive(mode, id);
      focused.actor.skills.focus = 99;
      assert.equal(castSkill(focused.game, focused.actor, 0, focused.actor.x + 100, focused.actor.y), true, `${mode}/${id} focused cast failed`);
      assert.equal(focused.actor.cooldowns[id], focusCooldown(baseCooldown, 5), `${mode}/${id} focus failed to scale cooldown`);
    }
  }
  assert.equal(focusCooldown(10, 99), 8, 'focus exceeded its 20 percent cap');
});

