import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame } from '../dist/js/simulation.js';
import { damage, updateCombat, castSkill, addXp, xpNeeded, getChoices, chooseSkill } from '../dist/js/combat.js';
import { isBossGame, combatModeOf, combatTargets, canTarget, canAct } from '../dist/js/targeting.js';
import { BOSS_CONFIG } from '../dist/js/boss-config.js';
import { createBoss, tickBoss, bossAttackContains } from '../dist/js/boss.js';
import { generateBossMap } from '../dist/js/boss-map.js';

const DT = 1 / 60;
const modes = ['classic', 'melee'];
const maps = ['courtyard', 'desert', 'frost', 'swamp'];

function bossGame(seed = 'boss-test', mode = 'classic', mapId = 'courtyard') {
  return createGame(seed, { mode, mapId, ruleset: 'boss' });
}

function player(game, index = 0) {
  return game.actors[index];
}

function quiet(game) {
  for (const actor of game.actors) {
    actor.isPlayer = true;
    actor.attackTimer = Number.POSITIVE_INFINITY;
    actor.attackHeld = false;
  }
  game.monsters = [];
  game.gems = [];
}

test('boss game initializes six ranged and six melee actors with isolated combat modes', () => {
  for (const mode of modes) for (const mapId of maps) {
    const game = bossGame(`boss-init-${mode}-${mapId}`, mode, mapId);
    assert.equal(game.ruleset, 'boss');
    assert.equal(game.mode, mode);
    assert.equal(game.actors.length, 12);
    assert.equal(game.actors.filter(actor => combatModeOf(game, actor) === 'classic').length, 6);
    assert.equal(game.actors.filter(actor => combatModeOf(game, actor) === 'melee').length, 6);
    assert.ok(game.actors.every(actor => actor.combatMode === combatModeOf(game, actor)));
    assert.equal(game.boss, null, 'boss should stay hidden until its 90-second reveal');
  }
});

test('boss timing, health, phase transition, announcement, and 600 second result use boss rules', () => {
  const game = bossGame('boss-time-contract');
  quiet(game);
  assert.equal(game.phase, 'grace');
  assert.equal(game.boss, null);
  assert.equal(BOSS_CONFIG.spawnAt, 90);
  assert.equal(BOSS_CONFIG.noticeAt, 85);
  assert.equal(BOSS_CONFIG.timeLimit, 600);

  game.time = 84.99;
  stepGame(game, 0.001, { autoPlayer: false });
  assert.equal(game.events.length, 1, 'announcement appeared before 85 seconds');
  const noticesBefore = game.events.length;
  stepGame(game, 0.02, { autoPlayer: false });
  assert.ok(game.events.length > noticesBefore, '85s announcement was not emitted');
  game.time = 89.99;
  stepGame(game, DT, { autoPlayer: false });
  assert.equal(game.phase, 'boss');
  assert.equal(game.boss.maxHp, 180000);
  assert.equal(game.boss.radius, 64);

  game.time = 599.99;
  stepGame(game, 0.02, { autoPlayer: false });
  assert.equal(game.time, 600);
  assert.equal(game.result?.reason, 'timeLimit');
  assert.equal(game.result?.time, 600);
});

test('boss map keeps a clear central arena and connected legal spawn points', () => {
  for (const biome of maps) {
    const map = generateBossMap(`boss-map-${biome}`, { biome });
    assert.equal(map.biome, biome);
    assert.equal(map.spawnPoints.length, 12);
    assert.equal(map.width / 2, 1024);
    assert.equal(map.height / 2, 1024);
    assert.ok(!map.obstacles.some(rect => {
      const x = Math.max(rect.x, Math.min(1024, rect.x + rect.w));
      const y = Math.max(rect.y, Math.min(1024, rect.y + rect.h));
      return Math.hypot(x - 1024, y - 1024) < 440;
    }), 'boss central 440px arena contains an obstacle');
    assert.ok(map.spawnPoints.every(point => point.x >= 16 && point.x <= map.width - 16 && point.y >= 16 && point.y <= map.height - 16));
  }
});

test('targeting isolates actors from monsters, prevents friendly fire, and lets monsters target actors', () => {
  const game = bossGame('boss-target-contract');
  game.boss = createBoss(game);
  const [a, b] = game.actors;
  const monster = { id: 'mob', x: a.x, y: a.y, hp: 10, alive: true };
  game.monsters = [monster];
  assert.equal(isBossGame(game), true);
  assert.equal(canTarget(game, a, b), false);
  assert.equal(canTarget(game, a, monster), true);
  assert.equal(canTarget(game, a, game.boss), true);
  assert.equal(canTarget(game, monster, a), true);
  assert.equal(canTarget(game, monster, game.boss), false);
  assert.deepEqual(new Set(combatTargets(game, a)), new Set([monster, game.boss]));
  assert.deepEqual(new Set(combatTargets(game, monster)), new Set(game.actors), 'monsters should target players');
});

test('boss mode blocks actor friendly fire and tracks boss and boss-attack damage separately', () => {
  const game = bossGame('boss-isolation-contract');
  game.boss = createBoss(game);
  game.phase = 'boss';
  const [attacker, ally] = game.actors;
  const allyHp = ally.hp;
  damage(game, ally, ally.maxHp, attacker);
  assert.equal(ally.hp, allyHp, 'actor-to-actor damage landed');
  const bossHp = game.boss.hp;
  damage(game, game.boss, 250, attacker);
  const scaledBasic = 250 * BOSS_CONFIG.basicDamageMultipliers[attacker.combatMode];
  assert.equal(game.boss.hp, bossHp - scaledBasic, 'boss basic damage multiplier was not applied');
  assert.equal(attacker.bossDamage, scaledBasic);
  const afterBasic = game.boss.hp;
  damage(game, game.boss, 40, attacker, { attackKind: 'active' });
  assert.equal(game.boss.hp, afterBasic - 40 * BOSS_CONFIG.skillDamageMultipliers[attacker.combatMode], 'boss active damage multiplier was not applied');
  const hp = attacker.hp;
  damage(game, attacker, 30, game.boss);
  assert.equal(attacker.hp, hp - 30, 'boss damage did not reach a player');
  assert.equal(ally.hp, allyHp, 'damage to the boss damaged a second player');
});

test('friendly actors neither take a ranged projectile nor block it from reaching the boss', () => {
  const game = bossGame('boss-friendly-projectile');
  const [owner, ally] = game.actors;
  game.boss = createBoss(game);
  game.phase = 'boss';
  game.monsters = [];
  owner.x = game.boss.x - 220; owner.y = game.boss.y;
  ally.x = game.boss.x - 110; ally.y = game.boss.y;
  const allyHp = ally.hp, bossHp = game.boss.hp;
  game.bullets = [{ x: game.boss.x - 170, y: game.boss.y, vx: 4200, vy: 0, radius: 4, damage: 40, ownerId: owner.id, ttl: 1, kind: 'basic' }];
  for (let i = 0; i < 5 && game.bullets.length; i++) updateCombat(game, DT);
  assert.equal(ally.hp, allyHp, 'projectile damaged a friendly actor in front of the boss');
  assert.ok(game.boss.hp < bossHp, 'friendly actor body blocked a projectile from the boss');
  assert.equal(owner.bossDamage > 0, true);
});

test('ranged area skills and melee swings hit the boss without damaging or slowing allies', () => {
  const ranged = bossGame('boss-ranged-aoe');
  const [caster, ally] = ranged.actors;
  ranged.boss = createBoss(ranged);
  ranged.phase = 'boss';
  ranged.monsters = [];
  caster.x = ranged.boss.x - 70; caster.y = ranged.boss.y;
  ally.x = ranged.boss.x - 20; ally.y = ranged.boss.y;
  const allyHp = ally.hp, bossHp = ranged.boss.hp;
  caster.skills = { quake: 1 };
  caster.activeSkills = ['quake'];
  caster.cooldowns = { quake: 0 };
  assert.equal(castSkill(ranged, caster, 0, ranged.boss.x, ranged.boss.y), true);
  assert.ok(ranged.boss.hp < bossHp, 'ranged area skill missed the boss');
  assert.equal(ally.hp, allyHp, 'area skill damaged a teammate');
  assert.equal(ally.slowUntil || 0, 0, 'area skill slowed a teammate');
  caster.skills = { frostNova: 1 };
  caster.activeSkills = ['frostNova'];
  caster.cooldowns = { frostNova: 0 };
  const afterQuake = ranged.boss.hp;
  assert.equal(castSkill(ranged, caster, 0, ranged.boss.x, ranged.boss.y), true);
  assert.ok(ranged.boss.hp < afterQuake, 'frost area skill missed the boss');
  assert.equal(ally.hp, allyHp, 'frost area skill damaged a teammate');
  assert.equal(ally.slowUntil || 0, 0, 'frost area skill slowed a teammate');
  caster.skills = { fireball: 1 };
  caster.activeSkills = ['fireball'];
  caster.cooldowns = { fireball: 0 };
  const afterNova = ranged.boss.hp;
  assert.equal(castSkill(ranged, caster, 0, ranged.boss.x, ranged.boss.y), true);
  for (let i = 0; i < 90 && ranged.boss.hp === afterNova; i++) updateCombat(ranged, DT);
  assert.ok(ranged.boss.hp < afterNova, 'fireball projectile or explosion missed the boss');
  assert.equal(ally.hp, allyHp, 'fireball explosion damaged a teammate');

  const melee = bossGame('boss-melee-hit', 'melee');
  const [swordsman, friend] = melee.actors;
  melee.boss = createBoss(melee);
  melee.phase = 'boss';
  melee.monsters = [];
  swordsman.x = melee.boss.x - 50; swordsman.y = melee.boss.y;
  friend.x = melee.boss.x - 15; friend.y = melee.boss.y;
  const friendHp = friend.hp, meleeBossHp = melee.boss.hp;
  swordsman.skills = { whirlwind: 1 };
  swordsman.activeSkills = ['whirlwind'];
  swordsman.cooldowns = { whirlwind: 0 };
  assert.equal(castSkill(melee, swordsman, 0, melee.boss.x, melee.boss.y), true);
  assert.ok(melee.boss.hp < meleeBossHp, 'melee active missed the boss');
  assert.equal(friend.hp, friendHp, 'melee active damaged a teammate');
  for (const actor of melee.actors) actor.attackTimer = Number.POSITIVE_INFINITY;
  swordsman.attackTimer = 0;
  swordsman.attackHeld = true;
  swordsman.aimAngle = 0;
  swordsman.meleeAction = null;
  const afterActive = melee.boss.hp;
  for (let i = 0; i < 30; i++) updateCombat(melee, DT);
  assert.ok(melee.boss.hp < afterActive, 'melee basic attack missed the boss');
  assert.equal(friend.hp, friendHp, 'melee basic attack damaged a teammate');
});

test('boss encounter object exposes the specified attack shapes and boundary hit testing', () => {
  const game = bossGame('boss-attack-shapes');
  const boss = createBoss(game);
  game.boss = boss;
  assert.equal(boss.maxHp, 180000);
  const attacks = [
    { kind: 'sweep', angle: 0, radius: 100, arc: Math.PI / 2 },
    { kind: 'rocks', targets: [{ x: boss.x, y: boss.y, radius: 20 }] },
    { kind: 'cross', width: 20, angle: 0, radius: 100 },
  ];
  for (const attack of attacks) {
    assert.equal(bossAttackContains(attack, boss, { x: boss.x, y: boss.y }), true, `${attack.kind} omitted its center`);
    assert.equal(bossAttackContains(attack, boss, { x: 500, y: 500 }), false, `${attack.kind} hit a distant point`);
  }
  assert.ok(['sweep', 'rocks', 'cross'].includes(boss.attack?.kind) || boss.attack == null);
  tickBoss(game, DT);
});

test('boss attack hit IDs target each selected actor at most once', () => {
  const game = bossGame('boss-attack-isolation');
  game.boss = createBoss(game);
  game.phase = 'boss';
  const [a, b] = game.actors;
  const aHp = a.hp, bHp = b.hp;
  const attack = { kind: 'rocks', startedAt: 19, windup: 0.65, active: 0.15, recovery: 0.6,
    targets: [{ x: a.x, y: a.y, radius: 64 }], damage: 30, hitIds: new Set() };
  const localGame = { ...game, boss: { ...game.boss, attack } };
  localGame.time = 19.66;
  tickBoss(localGame, DT);
  const afterFirstHit = a.hp;
  assert.ok(afterFirstHit < aHp, 'targeted player was not hit');
  assert.equal(b.hp, bHp, 'untargeted player was hit');
  localGame.time += DT;
  tickBoss(localGame, DT);
  assert.equal(a.hp, afterFirstHit, 'same attack hit the same player twice');
  const other = { ...attack, targets: [{ x: a.x, y: a.y, radius: 500 }], hitIds: new Set() };
  assert.equal(bossAttackContains(other, game.boss, { x: a.x, y: a.y }), true);
});

test('boss damage credit clamps an overkill projectile from a dead owner to remaining HP', () => {
  const game = bossGame('boss-credit-contract');
  quiet(game);
  game.boss = createBoss(game);
  game.phase = 'boss';
  const actor = player(game);
  game.boss.hp = 10;
  actor.alive = false;
  game.bullets = [{ x: game.boss.x - 8, y: game.boss.y, vx: 1200, vy: 0, radius: 3, damage: 100,
    ownerId: actor.id, ttl: 1, kind: 'basic' }];
  updateCombat(game, DT);
  assert.equal(game.boss.hp, 0);
  assert.equal(actor.bossDamage, 10);
  stepGame(game, DT, { autoPlayer: false });
  assert.equal(game.result?.winnerId, actor.id, 'credited dead owner should still win on unique top damage');
});

test('boss deaths respawn after eight seconds with retained progression and two seconds of attack protection', () => {
  const game = bossGame('boss-respawn-contract');
  quiet(game);
  const actor = player(game);
  actor.level = 5;
  actor.xp = 3;
  actor.skills = { fireball: 2, power: 1 };
  actor.activeSkills = ['fireball'];
  actor.cooldowns = { fireball: 20 };
  actor.pendingChoices = 1;
  actor.choices = ['fireball', 'power', 'vitality'];
  const choices = [...actor.choices];
  const oldMax = actor.maxHp;
  damage(game, actor, actor.maxHp + 1, null);
  assert.equal(actor.alive, false);
  assert.equal(actor.respawnAt, game.time + 8);
  assert.deepEqual(actor.choices, [], 'dead actor should not keep an active choice prompt');
  assert.deepEqual(actor.respawnChoices.choices, choices, 'death discarded the pending choice options');
  for (let i = 0; i < 8 * 60 - 1; i++) stepGame(game, DT, { autoPlayer: false });
  assert.equal(actor.alive, false);
  stepGame(game, DT, { autoPlayer: false });
  assert.equal(actor.alive, true);
  assert.equal(actor.hp, oldMax);
  assert.equal(actor.level, 5);
  assert.equal(actor.xp, 3);
  assert.deepEqual(actor.skills, { fireball: 2, power: 1 });
  assert.ok(actor.cooldowns.fireball <= 12.01 && actor.cooldowns.fireball >= 11.9, 'cooldown did not continue while dead');
  assert.equal(actor.pendingChoices, 1);
  assert.deepEqual(actor.choices, choices);
  assert.equal(canAct(game, actor), false);
  game.time = actor.invulnerableUntil + DT;
  assert.equal(canAct(game, actor), true);
});

test('boss death settles with all tied top scorers, while zero damage yields no winners', () => {
  const tied = bossGame('boss-tie-result');
  quiet(tied);
  tied.boss = createBoss(tied);
  tied.phase = 'boss';
  for (const actor of tied.actors.slice(0, 2)) actor.bossDamage = 25;
  tied.boss.hp = 0;
  tied.boss.alive = false;
  stepGame(tied, DT, { autoPlayer: false });
  assert.equal(tied.result.reason, 'bossDefeated');
  assert.deepEqual(new Set(tied.result.winnerIds), new Set(tied.actors.slice(0, 2).map(actor => actor.id)));
  assert.equal(tied.result.winnerId, null);
  assert.deepEqual(tied.result.ranking.filter(row => row.rank === 1).map(row => row.damage), [25, 25]);

  const nobody = bossGame('boss-no-score-result');
  quiet(nobody);
  nobody.boss = createBoss(nobody);
  nobody.phase = 'boss';
  nobody.boss.hp = 0;
  nobody.boss.alive = false;
  stepGame(nobody, DT, { autoPlayer: false });
  assert.equal(nobody.result.winnerId, null);
  assert.deepEqual(nobody.result.winnerIds, []);
  assert.ok(nobody.result.ranking.every(row => row.damage === 0));
});

test('boss mode continues after all actors die and max level never stops supply spawns', () => {
  const game = bossGame('boss-lifecycle-contract');
  quiet(game);
  game.boss = createBoss(game);
  game.phase = 'boss';
  for (const actor of game.actors) { actor.alive = false; actor.hp = 0; actor.respawnAt = 200; }
  game.time = 120;
  stepGame(game, DT, { autoPlayer: false });
  assert.equal(game.result, null);
  assert.equal(game.phase, 'boss');
  assert.equal(game.zone, null);
  const actor = player(game);
  actor.alive = true;
  actor.hp = actor.maxHp;
  addXp(game, actor, 10000);
  assert.equal(actor.level, 15);
  const spawned = game.spawnCount;
  game.spawnTimer = 999;
  stepGame(game, DT, { autoPlayer: false });
  assert.ok(game.spawnCount > spawned, 'max level incorrectly stopped spawning');
  assert.equal(game.phase, 'boss');
  assert.equal(game.zone, null);
});

test('participation grants exactly four XP only for living contributors once per ten-second window', () => {
  const game = bossGame('boss-xp-window');
  quiet(game);
  game.phase = 'boss'; game.time = 99.99; game.boss = createBoss(game);
  game.nextParticipationAt = 100;
  const [actor, inactive, dead] = game.actors;
  damage(game, game.boss, 1, actor, { attackKind: 'active' });
  dead.alive = false; dead.hp = 0; dead.respawnAt = 200; dead.bossParticipated = true;
  stepGame(game, DT);
  assert.equal(actor.xp, 4);
  assert.equal(inactive.xp, 0);
  assert.equal(dead.xp, 0);
  assert.equal(actor.bossParticipated, false);
  assert.equal(game.nextParticipationAt, 110);
  game.time = 109.99;
  stepGame(game, DT);
  assert.equal(actor.xp, 4, 'old damage cannot earn repeated participation XP');
  game.time = 119.99;
  damage(game, game.boss, 1, actor, { attackKind: 'active' });
  stepGame(game, DT);
  assert.equal(actor.xp, 8, 'a new damage window should earn four more XP');
});

test('a contributor revived before the same participation boundary still earns XP', () => {
  const game = bossGame('boss-revived-xp');
  quiet(game);
  game.time = 91;
  game.boss = createBoss(game);
  game.boss.nextAttackAt = Infinity;
  game.nextParticipationAt = 100;
  const actor = game.actors[0];
  damage(game, game.boss, 1, actor, { attackKind: 'active' });
  damage(game, actor, actor.maxHp * 2, game.boss);
  assert.equal(actor.alive, false);
  while (game.time < 99.1) stepGame(game, DT);
  assert.equal(actor.alive, true);
  assert.equal(actor.xp, 0);
  assert.equal(actor.bossParticipated, true);
  while (game.time < 100) stepGame(game, DT);
  assert.equal(actor.xp, 4);
  assert.equal(actor.bossParticipated, false);
});

test('weapon progression can be legally prepared for both modes at all milestone levels', () => {
  for (const mode of modes) for (const level of [1, 8, 15]) {
    const game = bossGame(`boss-build-${mode}-${level}`, mode);
    const actor = player(game);
    if (level > 1) {
      let xp = 0;
      for (let current = 1; current < level; current++) xp += xpNeeded(current);
      addXp(game, actor, xp);
    }
    assert.equal(actor.level, level);
    assert.equal(actor.combatMode, mode);
    const expectedChoices = level === 1 ? 0 : level === 8 ? 4 : 8;
    assert.equal(actor.pendingChoices, expectedChoices);
    while (actor.pendingChoices) {
      const choices = getChoices(game, actor);
      assert.equal(choices.length, 3);
      assert.equal(chooseSkill(game, actor, choices[0]), true);
    }
    assert.equal(actor.pendingChoices, 0);
  }
});
