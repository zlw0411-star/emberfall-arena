import test from 'node:test';
import assert from 'node:assert/strict';
import { createActor, configureActorForMode, castSkill, updateCombat } from '../dist/js/combat.js';
import { createBoss, tickBoss } from '../dist/js/boss.js';
import { thinkBoss } from '../dist/js/boss-ai.js';
import { moveEntity } from '../dist/js/world.js';

const fallback = () => ({ mx: 0, my: 0, castSlot: -1 });
function encounter(skill, distance) {
  const game = { time: 100, mode: 'melee', ruleset: 'boss', phase: 'boss', rng: () => .5,
    map: { width: 2048, height: 2048, obstacles: [], traps: [] },
    actors: [], monsters: [], gems: [], bullets: [], effects: [], events: [], nextId: 10 };
  const actor = createActor('a0', '近战', 1024 + distance, 1024, true, '#fff');
  configureActorForMode(actor, 'melee');
  Object.assign(actor, { combatMode: 'melee', level: 15, activeSkills: [skill],
    skills: { [skill]: 1 }, cooldowns: {}, attackTimer: Infinity, aimAngle: Math.PI });
  game.actors = [actor]; game.boss = createBoss(game);
  game.map.movementCircles = [game.boss];
  game.boss.attack = { id: 'sweep', kind: 'sweep', startedAt: 100, windup: 1.35,
    active: .15, recovery: .6, angle: 0, radius: 200, arc: 160 * Math.PI / 180,
    damage: 45, hitIds: new Set() };
  return { game, actor };
}
function execute(game, actor, command, dt) {
  moveEntity(game.map, actor, command.mx * actor.speed * dt, command.my * actor.speed * dt);
  if (command.castSlot >= 0) castSkill(game, actor, command.castSlot, command.aimX, command.aimY);
  updateCombat(game, dt);
  tickBoss(game, dt);
}

for (const hz of [30, 60]) {
  test(`Boss AI waits through the last overlapping damage step before lunging at ${hz}Hz`, () => {
    const dt = 1 / hz, { game, actor } = encounter('lunge', 217);
    const attack = game.boss.attack, end = attack.startedAt + attack.windup + attack.active;
    game.time = end + dt * .4; // end falls inside this step, not on a frame boundary
    const hp = actor.hp;
    const command = thinkBoss(game, actor, dt, fallback);
    assert.equal(command.castSlot, -1, 'do not lunge while this step can still deal damage');
    execute(game, actor, command, dt);
    assert.equal(actor.hp, hp);
    game.time += dt;
    const recovered = thinkBoss(game, actor, dt, fallback);
    assert.equal(recovered.castSlot, 0, 'one step later the safe lunge must be allowed');
    execute(game, actor, recovered, dt);
    assert.equal(actor.hp, hp);
    assert.ok(actor.bossDamage > 0, 'waiting must still allow real damage on the next step');

    const control = encounter('lunge', 217);
    control.game.time = end + dt * .4;
    castSkill(control.game, control.actor, 0, 1024, 1024);
    tickBoss(control.game, dt);
    assert.ok(control.actor.hp < hp, 'an early forced lunge really enters the active hit window');
  });

  for (const [skill, far] of [['piercingThrust', 182], ['heavySlash', 142]]) {
    test(`${skill} keeps its cooldown when retreat will outrange the windup at ${hz}Hz`, () => {
      const dt = 1 / hz, { game, actor } = encounter(skill, far);
      const command = thinkBoss(game, actor, dt, fallback);
      assert.ok(command.mx > .9, 'must keep retreating from the aimed sweep');
      assert.equal(command.castSlot, -1);
      execute(game, actor, command, dt);
      assert.equal(actor.cooldowns[skill] || 0, 0);

      // Actual movement/combat control: an immediate forced cast at this
      // location spends its cooldown but misses throughout its active window.
      const control = encounter(skill, far);
      execute(control.game, control.actor, { ...command, castSlot: 0, aimX: 1024, aimY: 1024 }, dt);
      const action = control.actor.meleeAction;
      for (let i = 0; i < Math.ceil(.55 / dt); i++) {
        control.game.time += dt;
        execute(control.game, control.actor, { ...command, castSlot: -1 }, dt);
      }
      assert.equal(action.hitIds.has('boss'), false);
      assert.ok(control.actor.cooldowns[skill] > 0);
    });

    test(`${skill} remains available while retreating when its windup stays in range at ${hz}Hz`, () => {
      const dt = 1 / hz, { game, actor } = encounter(skill, 113);
      const hp = actor.hp;
      const command = thinkBoss(game, actor, dt, fallback);
      assert.equal(command.castSlot, 0, 'do not disable all windup casts during warnings');
      execute(game, actor, command, dt);
      const action = actor.meleeAction;
      for (let i = 0; i < Math.ceil(.4 / dt); i++) {
        game.time += dt;
        execute(game, actor, { ...command, castSlot: -1 }, dt);
      }
      assert.ok(action.hitIds.has('boss'));
      assert.ok(actor.bossDamage > 0);
      assert.equal(actor.hp, hp);
    });
  }
}
