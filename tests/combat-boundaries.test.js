import test from 'node:test';
import assert from 'node:assert/strict';
import { createActor, castSkill, updateCombat } from '../dist/js/combat.js';
import { ACTIVES } from '../dist/js/balance.js';
import { blocked, generateMap, lineClear, rngFromSeed } from '../dist/js/world.js';

const DT = 1 / 60;
function arena() {
  const actor = createActor('a0', 'player', 100, 100, true);
  actor.attackTimer = Infinity;
  const game = { mode: 'classic', phase: 'hunt', time: 2.8, rng: rngFromSeed('boundaries'),
    map: { width: 600, height: 400, obstacles: [], traps: [{ type: 'spike', x: 100, y: 100, r: 25, offset: 0 }] },
    actors: [actor], monsters: [], bullets: [], gems: [], effects: [], events: [] };
  return { actor, game };
}
function advance(game, steps) {
  for (let i = 0; i < steps; i++) { game.time += DT; updateCombat(game, DT); }
}

test('leaving a spike for four seconds expires the old hit cooldown before reentry', () => {
  const { actor, game } = arena();
  updateCombat(game, DT);
  assert.equal(actor.hp, actor.maxHp - 8);
  actor.x = 300;
  advance(game, 240);
  actor.x = 100;
  advance(game, 1);
  assert.equal(actor.hp, actor.maxHp - 16);
});

test('a retracted spike still lets the shared damage cooldown expire', () => {
  const { actor, game } = arena();
  game.time = 3.99;
  updateCombat(game, DT);
  advance(game, 1);
  assert.equal(game.map.traps[0].active, false);
  advance(game, 166);
  assert.equal(actor.hp, actor.maxHp - 8);
  advance(game, 2);
  assert.equal(actor.hp, actor.maxHp - 16, 'new active period should hit immediately');
});

test('overlapping spikes cannot speed up a victim cooldown or stack same-step damage', () => {
  const one = arena(), two = arena();
  two.game.map.traps.push({ ...two.game.map.traps[0] });
  updateCombat(one.game, DT); updateCombat(two.game, DT);
  advance(one.game, 30); advance(two.game, 30);
  assert.equal(two.actor.hp, one.actor.hp);
  assert.equal(two.actor.trapDamageTimer, one.actor.trapDamageTimer);
});

test('monster spike cooldown expires even while away from every spike', () => {
  const { actor, game } = arena();
  actor.x = 300;
  const monster = { id: 'm0', type: 'slime', x: 100, y: 100, radius: 11,
    hp: 1000, maxHp: 1000, alive: true, attackTimer: Infinity, speed: 1e-9, damage: 1e-9 };
  game.monsters = [monster];
  updateCombat(game, DT);
  monster.x = 400;
  advance(game, 240);
  monster.x = 100;
  advance(game, 1);
  assert.equal(monster.hp, 984);
});

function equip(actor, rank) {
  actor.activeSkills = ['fireball']; actor.skills.fireball = rank;
  actor.cooldowns.fireball = 0;
}
for (const rank of [1, ACTIVES.fireball.maxRank]) {
  test(`rank ${rank} fireball has a legal spawn when cast toward a nearby wall`, () => {
    const { actor, game } = arena();
    game.map.traps = [];
    game.map.obstacles = [{ x: 112.1, y: 0, w: 48, h: 300 }];
    equip(actor, rank);
    assert.equal(blocked(game.map, actor.x, actor.y, actor.radius), false);
    const cast = castSkill(game, actor, 0, 300, actor.y);
    if (cast) {
      assert.equal(game.bullets.length, 1);
      const bullet = game.bullets[0];
      assert.equal(blocked(game.map, bullet.x, bullet.y, bullet.radius), false);
      assert.ok(lineClear(game.map, actor, bullet, bullet.radius));
    } else {
      assert.equal(game.bullets.length, 0);
      assert.equal(actor.cooldowns.fireball, 0, 'no room must not consume cooldown');
    }
  });

  test(`rank ${rank} fireball can leave a close wall when aiming away`, () => {
    const { actor, game } = arena();
    game.map.traps = [];
    game.map.obstacles = [{ x: 112.1, y: 0, w: 48, h: 300 }];
    equip(actor, rank);
    assert.equal(castSkill(game, actor, 0, 0, actor.y), true);
    assert.equal(blocked(game.map, game.bullets[0].x, game.bullets[0].y, game.bullets[0].radius), false);
    assert.equal(game.bullets[0].x, actor.x - ACTIVES.fireball.muzzle);
  });

  test(`rank ${rank} unobstructed fireball retains its nominal muzzle and damage`, () => {
    const { actor, game } = arena();
    game.map.traps = [];
    equip(actor, rank);
    assert.equal(castSkill(game, actor, 0, 200, 200), true);
    const bullet = game.bullets[0];
    assert.ok(Math.abs(Math.hypot(bullet.x - actor.x, bullet.y - actor.y) - ACTIVES.fireball.muzzle) < 1e-9);
    assert.equal(bullet.radius, ACTIVES.fireball.radiusBase + rank * ACTIVES.fireball.radiusPerRank);
  });
}

test('fireball cannot spawn embedded in the real generated courtyard wall', () => {
  const { actor, game } = arena();
  game.map = generateMap('audit-courtyard-0');
  actor.x = 446.5788566338364; actor.y = 196.41346830292605;
  equip(actor, 1);
  assert.equal(castSkill(game, actor, 0, 520, actor.y), true);
  const bullet = game.bullets[0];
  assert.equal(blocked(game.map, bullet.x, bullet.y, bullet.radius), false);
  assert.ok(lineClear(game.map, actor, bullet, bullet.radius));
});
