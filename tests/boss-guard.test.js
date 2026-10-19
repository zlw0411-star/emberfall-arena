import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../dist/js/simulation.js';
import { damage } from '../dist/js/combat.js';
import { createBoss, tickBoss } from '../dist/js/boss.js';
import { BOSS_CONFIG, bossGuardActive, bossIncomingMultiplier } from '../dist/js/boss-config.js';

const guarded = 1 - BOSS_CONFIG.nearGuardReduction;

function fixture(mode = 'classic', radius = 100) {
  const game = createGame(`boss-guard-${mode}-${radius}`, { ruleset: 'boss', mode });
  const actor = game.actors[0];
  game.actors = [actor];
  game.monsters = [];
  game.time = 100;
  game.phase = 'boss';
  game.boss = createBoss(game);
  actor.x = game.boss.x + radius;
  actor.y = game.boss.y;
  return { game, actor, boss: game.boss };
}

test('near guard uses a 160px center radius and a 20% reduction', () => {
  assert.equal(BOSS_CONFIG.nearGuardRadius, 160);
  assert.equal(BOSS_CONFIG.nearGuardReduction, 0.2);
  const { game, actor, boss } = fixture();
  actor.x = boss.x + 96;
  actor.y = boss.y + 128;
  const before = JSON.stringify(game);
  assert.equal(bossGuardActive(game, actor), true, 'the exact diagonal boundary counts');
  assert.equal(bossIncomingMultiplier(game, actor, boss), guarded);
  assert.equal(JSON.stringify(game), before, 'presentation helpers must not mutate the game');
  actor.x += 0.001;
  assert.equal(bossGuardActive(game, actor), false, 'actor radius does not enlarge the guard');
  assert.equal(bossGuardActive(undefined, actor), false);
  assert.equal(bossGuardActive(game, undefined), false);
});

for (const mode of ['classic', 'melee']) for (const isPlayer of [true, false]) {
  test(`${mode} ${isPlayer ? 'player' : 'AI'} gets actual HP mitigation only inside the boundary`, () => {
    for (const radius of [0, 159.999, 160, 160.001, 175]) {
      const { game, actor, boss } = fixture(mode, radius);
      actor.isPlayer = isPlayer;
      const before = actor.hp;
      const expected = 50 * (radius <= BOSS_CONFIG.nearGuardRadius ? guarded : 1);
      assert.equal(damage(game, actor, 50, boss), expected);
      assert.equal(actor.hp, before - expected, `center distance ${radius}`);
      assert.equal(actor.damageTakenByKind.monster, expected);
    }
  });
}

for (const mode of ['classic', 'melee']) for (const kind of ['sweep', 'rocks', 'cross']) {
  test(`${mode} ${kind} boss attack applies guard before actual HP damage`, () => {
    for (const radius of [160, 160.001]) {
      const { game, actor, boss } = fixture(mode, radius);
      const attack = {
        kind, startedAt: 99, windup: 1, active: 0.15, recovery: 0.6,
        angle: 0, radius: 480, arc: Math.PI, width: 80,
        targets: [{ x: actor.x, y: actor.y, radius: 64 }],
        damage: 40, hitIds: new Set(),
      };
      boss.attack = attack;
      const before = actor.hp;
      tickBoss(game, 1 / 60);
      assert.equal(actor.hp, before - 40 * (radius <= BOSS_CONFIG.nearGuardRadius ? guarded : 1));
      assert.equal(attack.hitIds.has(actor.id), true);
      tickBoss(game, 1 / 60);
      assert.equal(actor.hp, before - 40 * (radius <= BOSS_CONFIG.nearGuardRadius ? guarded : 1),
        'a guard must not change per-attack hit deduplication');
    }
  });
}

test('guard reduces damage before shield absorption', () => {
  const { game, actor, boss } = fixture('melee');
  const before = actor.hp;
  actor.shieldT = 5;
  actor.shieldHp = 30;
  assert.equal(damage(game, actor, 100, boss), 100 * guarded - 30);
  assert.equal(actor.hp, before - (100 * guarded - 30));
  assert.equal(actor.shieldHp, 0);
  actor.shieldT = 5;
  actor.shieldHp = 100;
  assert.equal(damage(game, actor, 50, boss), 0);
  assert.equal(actor.shieldHp, 100 - 50 * guarded);
});

test('respawn protection and friendly-fire rejection still precede guard and shields', () => {
  const { game, actor, boss } = fixture();
  actor.shieldT = 5;
  actor.shieldHp = 100;
  actor.invulnerableUntil = game.time + 2;
  const before = JSON.stringify(actor);
  assert.equal(damage(game, actor, 100, boss), 0);
  assert.equal(JSON.stringify(actor), before);
  actor.invulnerableUntil = 0;
  const friend = { ...actor, id: 'friend', isPlayer: false };
  game.actors.push(friend);
  assert.equal(damage(game, actor, 100, friend), 0);
  assert.equal(actor.shieldHp, 100);
  assert.equal(actor.hp, actor.maxHp);
});

test('near guard excludes ordinary monsters, traps, zones, and boss lookalikes', () => {
  for (const source of [{ id: 'mob', type: 'crawler' }, { type: 'trap' }, { type: 'zone' }, { id: 'boss-copy', type: 'boss', isBoss: true }]) {
    const { game, actor } = fixture();
    const before = actor.hp;
    assert.equal(bossGuardActive(game, actor), true);
    assert.equal(bossIncomingMultiplier(game, actor, source), 1);
    assert.equal(damage(game, actor, 50, source), 50);
    assert.equal(actor.hp, before - 50);
  }
  const { game, boss } = fixture();
  const monster = { id: 'mob', type: 'crawler', x: boss.x + 100, y: boss.y, hp: 100, alive: true };
  game.monsters.push(monster);
  assert.equal(bossGuardActive(game, monster), false, 'only actors receive the guard');
  assert.equal(damage(game, monster, 50, boss), 50);
});

test('original arena rules and dead bosses never activate the guard', () => {
  const { game, actor, boss } = fixture();
  game.ruleset = 'arena';
  assert.equal(bossGuardActive(game, actor), false);
  assert.equal(damage(game, actor, 50, boss), 50);
  game.ruleset = 'boss';
  for (const deadState of [{ hp: 0, alive: true }, { hp: boss.maxHp, alive: false }]) {
    Object.assign(boss, deadState);
    assert.equal(bossGuardActive(game, actor), false);
    assert.equal(damage(game, actor, 50, boss), 50);
  }
  Object.assign(boss, { hp: boss.maxHp, alive: true });
  actor.alive = false;
  assert.equal(bossGuardActive(game, actor), false);
  actor.alive = true;
  actor.hp = 0;
  assert.equal(bossGuardActive(game, actor), false);
});

test('boss outgoing-damage scoring uses the declared weapon multipliers without a guard bonus', () => {
  assert.deepEqual(BOSS_CONFIG.basicDamageMultipliers, { classic: 2, melee: 1 });
  assert.deepEqual(BOSS_CONFIG.skillDamageMultipliers, { classic: 0.95, melee: 1 });
  for (const mode of ['classic', 'melee']) for (const attackKind of ['basic', 'active']) {
    const { game, actor, boss } = fixture(mode);
    const multipliers = attackKind === 'basic' ? BOSS_CONFIG.basicDamageMultipliers : BOSS_CONFIG.skillDamageMultipliers;
    const expected = 50 * multipliers[mode];
    const before = boss.hp;
    assert.equal(bossGuardActive(game, actor), true);
    assert.equal(damage(game, boss, 50, actor, { attackKind }), expected);
    assert.equal(boss.hp, before - expected);
    assert.equal(actor.bossDamage, expected);
    assert.equal(actor.damageDealt, expected);
  }
});
