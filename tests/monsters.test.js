// 怪物类型注册表的契约测试。
//
// 背景：以前新增一种怪物要改四处（spawnMonster / tickMonster 速度表 /
// classifyDamage 类型白名单 / damageCauseLabel 中文名）。漏改白名单不会让
// 任何现有测试变红，只会让死亡归因静默变成兜底值，simulate.js 的统计从此失真。
// 这些断言把「改一处即可」变成可验证事实。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MONSTERS, MONSTER_FALLBACK, isKnownMonster, BRUTE_HEAL_DROP_CHANCE } from '../dist/js/balance.js';
import { CONFIG, createGame, spawnMonster, stepGame } from '../dist/js/simulation.js';
import { createActor, damage, updateCombat, dropGem } from '../dist/js/combat.js';

test('every monster type declares the full stat set used by spawner and ticker', () => {
  const required = ['name', 'hp', 'radius', 'spawnSpeed', 'fallbackSpeed', 'damage', 'xp'];
  for (const [type, def] of Object.entries(MONSTERS)) {
    for (const field of required) {
      assert.ok(def[field] !== undefined, `${type} missing ${field}`);
    }
    assert.equal(typeof def.name, 'string');
    assert.ok(def.name.length > 0, `${type} has empty display name`);
    assert.ok(Number.isFinite(def.hp) && def.hp > 0, `${type} has invalid hp`);
    assert.ok(Number.isFinite(def.spawnSpeed) && def.spawnSpeed > 0, `${type} has invalid spawnSpeed`);
    assert.ok(Number.isFinite(def.fallbackSpeed) && def.fallbackSpeed > 0, `${type} has invalid fallbackSpeed`);
  }
  // 历史上 spawnSpeed 与 fallbackSpeed 并不相等，合并会改变行为
  assert.notEqual(MONSTERS.slime.spawnSpeed, MONSTERS.slime.fallbackSpeed);
  assert.notEqual(MONSTERS.brute.spawnSpeed, MONSTERS.brute.fallbackSpeed);
});

test('spawner reads stats from the registry, so editing the table changes spawned monsters', () => {
  const game = createGame('monster-registry', { mode: 'classic' });
  game.phase = 'hunt';
  game.time = 200; // 越过 bruteAfterSeconds
  const spawned = [];
  for (let i = 0; i < 60; i++) {
    const monster = spawnMonster(game);
    if (monster) spawned.push(monster);
  }
  assert.ok(spawned.length > 0, 'no monsters spawned');
  for (const monster of spawned) {
    const def = MONSTERS[monster.type];
    assert.ok(def, `spawned unknown type ${monster.type}`);
    assert.equal(monster.hp, def.hp, `${monster.type} hp not from registry`);
    assert.equal(monster.maxHp, def.hp);
    assert.equal(monster.speed, def.spawnSpeed, `${monster.type} speed not from registry`);
    assert.equal(monster.radius, def.radius);
    assert.equal(monster.damage, def.damage);
    assert.equal(monster.xp, def.xp);
  }
});

test('CONFIG monster XP stays in sync with the registry', () => {
  assert.equal(CONFIG.monsterXp, MONSTERS.slime.xp);
  assert.equal(CONFIG.bruteXp, MONSTERS.brute.xp);
});

test('death attribution works for every registered monster type without a type whitelist edit', () => {
  for (const type of Object.keys(MONSTERS)) {
    const game = createGame(`attribution-${type}`, { mode: 'classic' });
    const victim = game.actors[0];
    victim.hp = victim.maxHp = 10;
    const monster = { id: 999, type, x: victim.x + 4, y: victim.y, hp: 1, maxHp: 1, speed: 1, damage: 999, attackTimer: 0, alive: true, xp: 15 };
    // 真实怪物一定在 game.monsters 里；死亡来源记录的是它的 id。
    game.monsters = [monster];
    damage(game, victim, 999, monster);
    assert.equal(victim.alive, false, `${type} failed to kill`);
    assert.equal(victim.lastDamageKind, 'monster', `${type} attributed as ${victim.lastDamageKind}`);
    assert.equal(victim.lastDamageSource, monster.id, `${type} did not record the killer id`);
    // 中文名也必须能从同一张表查出来
    const label = MONSTERS[type].name;
    const event = game.events.at(-1);
    assert.ok(event.text.includes(label), `${type} death event missing label ${label}: ${event.text}`);
  }
});

test('an unregistered monster type still attributes as monster with the fallback name', () => {
  const game = createGame('attribution-unknown', { mode: 'classic' });
  const victim = game.actors[0];
  victim.hp = victim.maxHp = 10;
  assert.equal(isKnownMonster('wyvern'), false);
  const monster = { id: 1000, type: 'wyvern', x: victim.x, y: victim.y, hp: 1, maxHp: 1, damage: 999 };
  game.monsters = [monster];
  damage(game, victim, 999, monster);
  assert.equal(victim.lastDamageKind, 'monster');
  assert.ok(game.events.at(-1).text.includes(MONSTER_FALLBACK.name));
});

test('tickMonster falls back to the registry speed, not a hardcoded table', () => {
  for (const [type, def] of Object.entries(MONSTERS)) {
    const game = createGame(`speed-${type}`, { mode: 'classic' });
    const target = game.actors[0];
    target.hp = target.maxHp = 1_000_000;
    const monster = { id: 500, type, x: target.x + 400, y: target.y, hp: 1_000_000, maxHp: 1_000_000, damage: 0, attackTimer: 0, alive: true, radius: def.radius };
    game.monsters = [monster];
    game.actors = [target];
    game.gems = [];
    game.bullets = [];
    game.effects = [];
    game.phase = 'hunt';
    const before = monster.x;
    updateCombat(game, 1 / 60);
    const moved = before - monster.x;
    assert.ok(moved > 0, `${type} did not move toward the target`);
    // 移动距离应当接近 fallbackSpeed * dt（允许一帧内的碰撞修正误差）
    const expected = def.fallbackSpeed / 60;
    assert.ok(
      Math.abs(moved - expected) < 0.5,
      `${type} moved ${moved.toFixed(3)} but registry predicts ${expected.toFixed(3)}`,
    );
  }
});

test('brute heal drop chance comes from the registry constant', async () => {
  assert.ok(BRUTE_HEAL_DROP_CHANCE > 0 && BRUTE_HEAL_DROP_CHANCE < 1);
  const { dropGem } = await import('../dist/js/combat.js');
  // rng 恒为 0 时必掉，恒为 0.99 时必不掉
  for (const [rngValue, expectDrop] of [[0, 1], [0.99, 0]]) {
    const game = { actors: [], monsters: [], gems: [], time: 0, events: [], effects: [], nextId: 1, rng: () => rngValue };
    const brute = { id: 1, type: 'brute', x: 10, y: 10, xp: 25 };
    dropGem(game, brute, 10);
    assert.equal(game.gems.filter((gem) => gem.kind === 'heal').length, expectDrop, `rng=${rngValue}`);
  }
});

test('spawn RNG order is preserved so seeded matches stay reproducible', () => {
  // 只抽一次 brute 判定、再抽一次 bat 判定的顺序不能变，否则同种子刷怪序列会漂移。
  const a = createGame('spawn-order', { mode: 'classic' });
  const b = createGame('spawn-order', { mode: 'classic' });
  a.phase = b.phase = 'hunt';
  a.time = b.time = 200;
  // 清空初始怪物，否则会撞上 monsterCap 使得 spawnMonster 返回 null
  a.monsters = [];
  b.monsters = [];
  for (let i = 0; i < 40; i++) {
    const ma = spawnMonster(a);
    const mb = spawnMonster(b);
    assert.ok(ma && mb, `spawn ${i} returned null`);
    assert.equal(ma.type, mb.type, `type diverged at spawn ${i}`);
    assert.equal(ma.x, mb.x);
    assert.equal(ma.y, mb.y);
  }
});
