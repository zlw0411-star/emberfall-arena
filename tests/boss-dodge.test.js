import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../dist/js/simulation.js';
import { thinkBoss } from '../dist/js/boss-ai.js';
import { createBoss, tickBoss, bossAttackContains } from '../dist/js/boss.js';
import { bossIncomingMultiplier } from '../dist/js/boss-config.js';
import { castSkill, updateCombat } from '../dist/js/combat.js';
import { dashDistance, lungeDistance } from '../dist/js/balance.js';
import { moveEntity } from '../dist/js/world.js';

const noFallback = () => assert.fail('a clear central warning must use Boss dodge policy');

function sweepFixture({ mode = 'melee', stage = 1, radius = 113, hz = 60 } = {}) {
  const game = createGame(`boss-dodge-${mode}-${stage}-${radius}-${hz}`, { ruleset: 'boss', mode });
  const actor = game.actors[0];
  game.actors = [actor];
  game.monsters = [];
  game.gems = [];
  game.time = 100;
  game.phase = 'boss';
  game.boss = createBoss(game);
  const boss = game.boss;
  boss.hp = boss.maxHp * ({ 1: 0.9, 2: 0.5, 3: 0.2 })[stage];
  boss.nextAttackAt = game.time;
  game.map.movementCircles = [boss];
  actor.x = boss.x + radius;
  actor.y = boss.y;
  actor.ai = {};
  actor.attackTimer = 0;
  tickBoss(game, 1 / hz);
  assert.equal(boss.stage, stage);
  assert.equal(boss.attack.kind, 'sweep');
  assert.equal(bossAttackContains(boss.attack, boss, actor, actor.radius), true,
    'the actor must start inside the real aimed sweep');
  return { game, actor, boss, attack: boss.attack, dt: 1 / hz };
}

function hasMovement(command) {
  return Math.hypot(command.mx, command.my) > 0.9;
}

for (const hz of [30, 60]) for (const stage of [1, 2, 3]) {
  test(`stage ${stage} sweep leaves base-speed melee enough warning to dodge from 113px at ${hz}Hz`, () => {
    const { game, actor, boss, attack, dt } = sweepFixture({ stage, hz });
    const stationary = sweepFixture({ stage, hz });
    assert.equal(actor.speed, 100);
    assert.deepEqual(actor.skills, {});
    assert.equal(actor.invulnerableUntil, 0);
    assert.equal(actor.shieldHp, 0);
    const startHp = actor.hp;
    const activeAt = attack.startedAt + attack.windup;
    let exitAt = null;
    let movements = 0;
    // Same order as the real step: advance time, think, move, then Boss damage.
    while (game.time < activeAt + attack.active + dt) {
      game.time += dt;
      const command = thinkBoss(game, actor, dt, noFallback);
      assert.equal(command.castSlot, -1, 'escape must require no learned movement skill');
      if (hasMovement(command)) movements++;
      moveEntity(game.map, actor, command.mx * actor.speed * dt, command.my * actor.speed * dt);
      if (exitAt == null && !bossAttackContains(attack, boss, actor, actor.radius)) exitAt = game.time;
      tickBoss(game, dt);
      stationary.game.time = game.time;
      tickBoss(stationary.game, dt);
    }
    assert.ok(movements > 0, 'AI must actually walk to safety');
    assert.ok(exitAt != null && exitAt < activeAt, `escape ${exitAt} missed damage start ${activeAt}`);
    assert.equal(actor.hp, startHp, 'dodging actor must avoid the full real active window');
    assert.equal(attack.hitIds.has(actor.id), false);
    assert.equal(stationary.actor.hp, startHp - stationary.attack.damage * bossIncomingMultiplier(stationary.game, stationary.actor, stationary.boss),
      'a stationary control at the same standoff must take the real sweep exactly once');
    assert.equal(stationary.attack.hitIds.has(stationary.actor.id), true);
  });
}

for (const hz of [30, 60]) {
  test(`protected melee still dodges but requests no attack or ready cast at ${hz}Hz`, () => {
    const { game, actor, dt } = sweepFixture({ hz });
    actor.activeSkills = ['bladeWard'];
    actor.skills.bladeWard = 1;
    const unprotected = thinkBoss(game, actor, dt, noFallback);
    assert.equal(unprotected.castSlot, 0, 'ready ward establishes a meaningful cast opportunity');
    actor.invulnerableUntil = game.time + 2;
    const command = thinkBoss(game, actor, dt, noFallback);
    assert.ok(hasMovement(command), 'protection must not disable dodging movement');
    assert.equal(command.attackHeld, false);
    assert.equal(Boolean(command.attackPressed), false);
    assert.equal(command.castSlot, -1);
    assert.equal(castSkill(game, actor, 0, game.boss.x, game.boss.y), false);
    actor.activeSkills = [];
    actor.attackHeld = true;
    actor.attackPressed = true;
    updateCombat(game, dt);
    assert.equal(actor.meleeAction, null, 'protection must reject basic attacks at execution too');
  });

  test(`melee can request and start a basic attack while walking out of a warning at ${hz}Hz`, () => {
    const { game, actor, boss, dt } = sweepFixture({ hz });
    const command = thinkBoss(game, actor, dt, noFallback);
    assert.ok(hasMovement(command));
    assert.equal(command.attackHeld, true, 'an in-range dodge must retain its basic attack request');
    assert.equal(command.castSlot, -1);
    const before = { x: actor.x, y: actor.y };
    actor.attackHeld = command.attackHeld;
    actor.aimAngle = Math.atan2(boss.y - actor.y, boss.x - actor.x);
    moveEntity(game.map, actor, command.mx * actor.speed * dt, command.my * actor.speed * dt);
    updateCombat(game, dt);
    assert.ok(Math.hypot(actor.x - before.x, actor.y - before.y) > 0);
    assert.equal(actor.meleeAction?.kind, 'basic');
  });

  for (const [mode, skill] of [['classic', 'quake'], ['melee', 'whirlwind']]) {
    test(`${mode} can deal nonmovement skill damage while dodging at ${hz}Hz`, () => {
      const { game, actor, boss, dt } = sweepFixture({ mode, hz });
      actor.activeSkills = [skill];
      actor.skills[skill] = 1;
      const command = thinkBoss(game, actor, dt, noFallback);
      assert.ok(hasMovement(command));
      assert.equal(command.castSlot, 0);
      const x = actor.x, y = actor.y, hp = boss.hp;
      assert.equal(castSkill(game, actor, command.castSlot, command.aimX, command.aimY), true);
      assert.equal(actor.x, x, 'nonmovement cast must leave the dodge position intact');
      assert.equal(actor.y, y);
      assert.ok(boss.hp < hp, 'the retained cast must actually hit the Boss');
      moveEntity(game.map, actor, command.mx * actor.speed * dt, command.my * actor.speed * dt);
      assert.ok(Math.hypot(actor.x - x, actor.y - y) > 0, 'casting and dodging must both execute');
    });
  }

  for (const [mode, skill, reach] of [['classic', 'dash', dashDistance], ['melee', 'lunge', lungeDistance]]) {
    test(`${skill} is rejected during a dodge even when its ordinary cast would enter danger at ${hz}Hz`, () => {
      const { game, actor, boss, attack, dt } = sweepFixture({ mode, radius: 210, hz });
      actor.activeSkills = [skill];
      actor.skills[skill] = 1;
      const endpoint = { x: actor.x - reach(1), y: actor.y };
      assert.equal(bossAttackContains(attack, boss, endpoint, actor.radius), true);
      boss.attack = null;
      const ordinary = thinkBoss(game, actor, dt, noFallback);
      assert.equal(ordinary.castSlot, 0, 'the same distance and build must permit this cast without warning');
      boss.attack = attack;
      actor.ai = {};
      const dodging = thinkBoss(game, actor, dt, noFallback);
      assert.ok(hasMovement(dodging));
      assert.equal(dodging.castSlot, -1, 'dodge movement must not cast a charge into the warning');
      assert.equal(castSkill(game, actor, ordinary.castSlot, ordinary.aimX, ordinary.aimY), true);
      assert.equal(bossAttackContains(attack, boss, actor, actor.radius), true,
        'executing the rejected ordinary request really would end inside the damaging shape');
    });
  }
}
