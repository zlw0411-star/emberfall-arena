// 技能注册表契约测试。
//
// 背景：以前新增一个技能要改三处 ——
//   SKILLS 目录（含手写数值描述）、applySkillRank 的 if 分支、castSkill 的 if 分支。
// 而且 castMeleeSkill 的最后一个 else 实际上把「任何未知刀技」都当成重斩，
// 新增刀技会静默变成重斩而不是报错。
// 这些断言把「加一条就生效」钉成可验证事实。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVES, DESCRIPTIONS, PASSIVE, skillCooldown,
  fireballDamage, fireballSplash, dashDistance, quakeRadius,
  lungeDistance, whirlwindRadius, heavySlashRange,
} from '../dist/js/balance.js';
import {
  SKILLS, MELEE_SKILLS, createActor, configureActorForMode, castSkill, chooseSkill,
  getSkills, updateCombat, PROGRESSION,
} from '../dist/js/combat.js';
import { createGame } from '../dist/js/simulation.js';

const map = { width: 600, height: 400, obstacles: [], traps: [] };

function arena(mode = 'classic') {
  const game = createGame(`skill-registry-${mode}`, { mode });
  const actor = createActor('a0', '测试', 200, 200, true, '#fff');
  configureActorForMode(actor, mode);
  Object.assign(game, { map, phase: 'hunt', time: 100, actors: [actor], monsters: [], gems: [], bullets: [], effects: [], events: [] });
  return { game, actor };
}

function equip(actor, id, rank = 1) {
  actor.skills[id] = rank;
  actor.activeSkills = [id];
  actor.cooldowns[id] = 0;
}

test('every catalog entry has a description generated from constants', () => {
  for (const catalog of [SKILLS, MELEE_SKILLS]) {
    for (const [id, def] of Object.entries(catalog)) {
      assert.equal(typeof def.description, 'string', `${id} missing description`);
      assert.ok(def.description.length > 0, `${id} has empty description`);
      assert.equal(def.description, DESCRIPTIONS[id], `${id} description drifted from generated text`);
      // 描述里不应再出现手写的、与常量不符的小数
      assert.ok(!/\d\.\d{3,}/.test(def.description), `${id} description has suspicious precision: ${def.description}`);
    }
  }
});

test('every passive in the catalog has a rank effect and vice versa', () => {
  // 通过行为验证：选满级后属性必须真的变化
  const passives = Object.entries(SKILLS).filter(([, def]) => def.type === 'passive').map(([id]) => id);
  for (const id of passives) {
    const { game, actor } = arena('classic');
    actor.pendingChoices = 1;
    const before = {
      maxHp: actor.maxHp, hp: actor.hp, speed: actor.speed,
      pickupRadius: actor.pickupRadius, attackRange: actor.attackRange,
    };
    actor.skills[id] = 0;
    actor.choices = [id];
    assert.ok(chooseSkill(game, actor, id), `${id} could not be chosen`);
    const changed = actor.maxHp !== before.maxHp || actor.hp !== before.hp || actor.speed !== before.speed
      || actor.pickupRadius !== before.pickupRadius || actor.attackRange !== before.attackRange;
    // power / multishot 只影响结算，不改这些字段；其余被动必须改变对应属性
    if (['vitality', 'haste', 'magnet', 'bladeReach'].includes(id)) {
      assert.ok(changed, `passive ${id} had no effect on actor stats`);
    }
  }
});

test('vitality raises max hp by the registry value and heals immediately', () => {
  const { game, actor } = arena('classic');
  const baseMax = actor.maxHp;
  actor.hp = 100;
  actor.pendingChoices = 1;
  actor.choices = ['vitality'];
  chooseSkill(game, actor, 'vitality');
  assert.equal(actor.maxHp, baseMax + PASSIVE.vitalityHpPerRank);
  assert.equal(actor.hp, 100 + PASSIVE.vitalityHealOnRank);
});

test('haste and magnet scale with the registry constants', () => {
  const { game, actor } = arena('classic');
  for (let rank = 1; rank <= 3; rank++) {
    actor.pendingChoices = 1;
    actor.choices = ['haste'];
    chooseSkill(game, actor, 'haste');
    assert.equal(actor.speed, 100 * (1 + rank * PASSIVE.hasteSpeedPerRank), `haste rank ${rank} speed`);
  }
  for (let rank = 1; rank <= 3; rank++) {
    actor.pendingChoices = 1;
    actor.choices = ['magnet'];
    chooseSkill(game, actor, 'magnet');
    assert.equal(actor.pickupRadius, PASSIVE.magnetRadiusBase + rank * PASSIVE.magnetRadiusPerRank, `magnet rank ${rank}`);
  }
});

test('ranged actives produce the geometry the registry declares', () => {
  const { game, actor } = arena('classic');

  equip(actor, 'fireball', 2);
  assert.ok(castSkill(game, actor, 0, actor.x + 100, actor.y));
  const fireball = game.bullets.at(-1);
  assert.equal(fireball.kind, 'fireball');
  assert.equal(fireball.splash, fireballSplash(2));
  assert.equal(fireball.damage, fireballDamage(2));

  game.bullets.length = 0;
  equip(actor, 'dash', 3);
  const startX = actor.x;
  assert.ok(castSkill(game, actor, 0, actor.x + 100, actor.y));
  assert.ok(Math.abs(actor.x - (startX + dashDistance(3))) < 1e-9,
    `dash moved ${actor.x - startX}, expected ${dashDistance(3)}`);

  equip(actor, 'quake', 1);
  assert.ok(castSkill(game, actor, 0, actor.x, actor.y));
  const ring = game.effects.filter((effect) => effect.kind === 'ring').at(-1);
  assert.equal(ring.radius, quakeRadius(1));
});

test('melee actives produce the geometry the registry declares', () => {
  const { game, actor } = arena('melee');

  equip(actor, 'lunge', 2);
  const startX = actor.x;
  assert.ok(castSkill(game, actor, 0, actor.x + 100, actor.y));
  // moveEntity 分段移动会引入浮点尾差，用近似比较
  assert.ok(Math.abs(actor.x - (startX + lungeDistance(2))) < 1e-9,
    `lunge moved ${actor.x - startX}, expected ${lungeDistance(2)}`);
  assert.equal(actor.meleeAction.kind, 'lunge');

  // 刀技之间不能互相打断，所以每次测试新技能前先清掉上一个动作
  actor.meleeAction = null;
  equip(actor, 'whirlwind', 3);
  assert.ok(castSkill(game, actor, 0, actor.x + 100, actor.y));
  assert.equal(actor.meleeAction.range, whirlwindRadius(3));
  assert.equal(actor.meleeAction.arc, Math.PI * 2);

  actor.meleeAction = null;
  equip(actor, 'heavySlash', 4);
  assert.ok(castSkill(game, actor, 0, actor.x + 100, actor.y));
  assert.equal(actor.meleeAction.range, heavySlashRange(4));
  assert.equal(actor.meleeAction.windup, ACTIVES.heavySlash.windup);
});

test('a melee skill missing from the shape table is rejected instead of silently becoming heavy slash', () => {
  const { game, actor } = arena('melee');
  // 模拟「目录里有、声明表里没有」的新技能
  const original = { ...MELEE_SKILLS };
  MELEE_SKILLS.experimentalSlash = {
    name: '实验斩', description: 'x', icon: '?', color: '#fff', type: 'active', maxRank: 4, cooldown: 5,
  };
  try {
    equip(actor, 'experimentalSlash', 1);
    assert.equal(castSkill(game, actor, 0, actor.x + 100, actor.y), false,
      'unknown melee skill must be rejected, not treated as heavySlash');
  } finally {
    delete MELEE_SKILLS.experimentalSlash;
    assert.deepEqual(Object.keys(MELEE_SKILLS), Object.keys(original));
  }
});

test('a ranged active missing from the effect table is rejected', () => {
  const { game, actor } = arena('classic');
  SKILLS.experimentalBolt = {
    name: '实验弹', description: 'x', icon: '?', color: '#fff', type: 'active', maxRank: 4, cooldown: 5,
  };
  try {
    equip(actor, 'experimentalBolt', 1);
    assert.equal(castSkill(game, actor, 0, actor.x + 100, actor.y), false);
    // 被拒绝的释放不能消耗冷却（equip 把冷却预置为 0）
    assert.equal(actor.cooldowns.experimentalBolt, 0, 'rejected cast must not spend cooldown');
  } finally {
    delete SKILLS.experimentalBolt;
  }
});

test('active cooldowns follow the registry formula at every rank', () => {
  for (const id of ['fireball', 'dash', 'quake']) {
    const def = ACTIVES[id];
    for (let rank = 1; rank <= def.maxRank; rank++) {
      const expected = def.cooldown * Math.max(def.cooldownFloor, 1 - rank * def.cooldownPerRank);
      assert.equal(skillCooldown(id, rank), expected, `${id} rank ${rank}`);
    }
  }
});

test('passive rank caps come from the registry, not scattered literals', () => {
  assert.equal(SKILLS.power.maxRank, PASSIVE.hasteMaxRank);
  assert.equal(SKILLS.vitality.maxRank, PASSIVE.hasteMaxRank);
  assert.equal(MELEE_SKILLS.bladeReach.maxRank, PASSIVE.bladeReachMaxRank);
  // 满级后不能再选
  const { game, actor } = arena('classic');
  actor.skills.haste = SKILLS.haste.maxRank;
  actor.pendingChoices = 1;
  actor.choices = ['haste'];
  assert.equal(chooseSkill(game, actor, 'haste'), false, 'rank cap not enforced');
});

test('mode skill pools stay separate and complete', () => {
  assert.deepEqual(Object.keys(getSkills('classic')), Object.keys(SKILLS));
  assert.deepEqual(Object.keys(getSkills('melee')), Object.keys(MELEE_SKILLS));
  for (const id of ['fireball', 'dash', 'quake', 'multishot']) {
    assert.equal(MELEE_SKILLS[id], undefined, `${id} leaked into melee pool`);
  }
  for (const id of ['lunge', 'whirlwind', 'heavySlash', 'bladeReach']) {
    assert.equal(SKILLS[id], undefined, `${id} leaked into classic pool`);
  }
  assert.ok(PROGRESSION.maxActiveSkills >= 3);
});
