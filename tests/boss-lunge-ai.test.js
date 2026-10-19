import test from 'node:test';
import assert from 'node:assert/strict';
import { createActor, configureActorForMode, castSkill, updateCombat } from '../dist/js/combat.js';
import { createBoss, tickBoss } from '../dist/js/boss.js';
import { thinkBoss } from '../dist/js/boss-ai.js';
import { moveEntity } from '../dist/js/world.js';

const DT = 1 / 60;
const fallback = () => ({ mx: 0, my: 0, castSlot: -1, attackHeld: false });

function encounter(distance = 113) {
  const game = { time: 100, mode: 'melee', ruleset: 'boss', phase: 'boss', rng: () => 0.5,
    map: { width: 2048, height: 2048, obstacles: [], traps: [] },
    actors: [], monsters: [], gems: [], bullets: [], effects: [], events: [], nextId: 10 };
  const actor = createActor('a0', '近战', 1024 + distance, 1024, true, '#fff');
  configureActorForMode(actor, 'melee');
  Object.assign(actor, { combatMode: 'melee', level: 15, speed: 100,
    activeSkills: ['lunge'], skills: { lunge: 1 }, cooldowns: {}, aimAngle: Math.PI });
  game.actors = [actor]; game.boss = createBoss(game);
  game.map.movementCircles = [game.boss];
  return { game, actor };
}

test('Boss AI uses a close lunge when real movement clamps safely and the strike hits', () => {
  const { game, actor } = encounter();
  const initialHp = game.boss.hp;
  const command = thinkBoss(game, actor, DT, fallback);
  assert.equal(command.castSlot, 0);
  assert.equal(castSkill(game, actor, command.castSlot, command.aimX, command.aimY), true);
  const d = Math.hypot(actor.x - game.boss.x, actor.y - game.boss.y);
  assert.ok(d >= game.boss.radius + actor.radius + 4, 'lunge must retain a safe stand-off');
  assert.ok(d < 90, 'test must exercise the collision-clamped close endpoint');
  assert.ok(game.boss.hp < initialHp, 'the actual lunge must strike the Boss');
  assert.equal(thinkBoss(game, actor, DT, fallback).castSlot, -1, 'active/cooling lunge must not recast');
});

test('Boss AI rejects lunges during a warning, including from its safe side', () => {
  for (const angle of [0, Math.PI]) {
    const { game, actor } = encounter(220);
    game.boss.attack = { id: `warning-${angle}`, kind: 'sweep', startedAt: game.time,
      windup: 1.35, active: 0.15, recovery: 0.6, angle, radius: 200,
      arc: 160 * Math.PI / 180, damage: 45, hitIds: new Set() };
    assert.equal(thinkBoss(game, actor, DT, fallback).castSlot, -1);
  }
});

test('Boss AI rejects unsafe predicted endpoints, excessive range and spawn protection', () => {
  const unsafe = encounter();
  unsafe.game.map.traps.push({ x: 1100, y: 1024, r: 4, type: 'spike', offset: 3 });
  assert.equal(thinkBoss(unsafe.game, unsafe.actor, DT, fallback).castSlot, -1);
  const tooClose = encounter(110);
  assert.equal(thinkBoss(tooClose.game, tooClose.actor, DT, fallback).castSlot, -1,
    'a clipped endpoint with less than four pixels stand-off must not be chosen');
  const far = encounter(430);
  assert.equal(thinkBoss(far.game, far.actor, DT, fallback).castSlot, -1);
  const protectedActor = encounter();
  protectedActor.actor.invulnerableUntil = protectedActor.game.time + 2;
  assert.equal(thinkBoss(protectedActor.game, protectedActor.actor, DT, fallback).castSlot, -1);
});

test('a base-speed actor escapes a real sweep from its lunge endpoint in every Boss stage', () => {
  for (const hpFraction of [1, 0.6, 0.3]) {
    const { game, actor } = encounter();
    const lunge = thinkBoss(game, actor, DT, fallback);
    assert.equal(castSkill(game, actor, lunge.castSlot, lunge.aimX, lunge.aimY), true);
    const closeDistance = Math.hypot(actor.x - game.boss.x, actor.y - game.boss.y);
    assert.ok(closeDistance >= 80 && closeDistance < 90);
    game.boss.hp = game.boss.maxHp * hpFraction;
    game.boss.nextAttackAt = game.time;
    tickBoss(game, DT);
    assert.equal(game.boss.attack.kind, 'sweep');
    const initialHp = actor.hp;
    for (let frame = 0; frame < 100; frame++) {
      game.time += DT;
      const command = thinkBoss(game, actor, DT, fallback);
      moveEntity(game.map, actor, command.mx * actor.speed * DT, command.my * actor.speed * DT);
      actor.attackHeld = command.attackHeld;
      updateCombat(game, DT);
      tickBoss(game, DT);
    }
    assert.equal(actor.hp, initialHp, `stage ${game.boss.stage} sweep hit the escaping swordsman`);
  }
});
