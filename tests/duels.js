import assert from 'node:assert/strict';
import { COMBAT_BALANCE, PROGRESSION, addXp, castSkill, createActor, damage, updateCombat, xpNeeded } from '../dist/js/combat.js';

const DT = 1 / 60;
const map = { width: 2048, height: 2048, obstacles: [], traps: [] };

function createDuel(phase, level, build = {}) {
  const attacker = createActor('attacker', '攻击方', 900, 1024, true);
  const victim = createActor('victim', '靶子', 1040, 1024, true);
  const game = {
    map, phase, time: 100, actors: [attacker, victim], monsters: [], gems: [], bullets: [], effects: [], events: [], nextId: 1,
    rng: () => 0,
  };

  if (level > 1) {
    let xp = 0;
    for (let lv = 1; lv < level; lv++) xp += xpNeeded(lv);
    addXp(game, attacker, xp);
    addXp(game, victim, xp);
  }
  attacker.pendingChoices = 0;
  victim.pendingChoices = 0;
  Object.assign(attacker.skills, build?.skills || {});
  attacker.activeSkills = [...(build?.activeSkills || [])];
  attacker.cooldowns = Object.fromEntries(attacker.activeSkills.map(id => [id, 0]));
  victim.attackTimer = Number.POSITIVE_INFINITY;
  victim.skills = {};
  victim.activeSkills = [];
  victim.hp = victim.maxHp;
  return { game, attacker, victim };
}

function duel({ phase, level, build, abilities }) {
  const { game, attacker, victim } = createDuel(phase, level, build);
  let elapsed = 0;
  let casts = 0;
  const deadline = 90;
  while (victim.alive && elapsed < deadline) {
    if (abilities) {
      for (let slot = 0; slot < attacker.activeSkills.length; slot++) {
        if (castSkill(game, attacker, slot, victim.x, victim.y)) casts++;
      }
    }
    updateCombat(game, DT);
    elapsed += DT;
  }
  return { phase, level, mode: abilities ? 'skills + basic' : 'basic only', seconds: elapsed, casts, hp: victim.hp, initialHp: victim.maxHp };
}

function graceProtection() {
  const build = { skills: { fireball: 2, quake: 1, power: 1 }, activeSkills: ['fireball', 'quake'] };
  const { game, attacker, victim } = createDuel('grace', 8, build);
  for (let i = 0; i < 5 * 60; i++) {
    for (let slot = 0; slot < attacker.activeSkills.length; slot++) castSkill(game, attacker, slot, victim.x, victim.y);
    updateCombat(game, DT);
  }
  const directDamage = damage(game, victim, 1000, attacker);
  return { hp: victim.hp, maxHp: victim.maxHp, directDamage };
}

const builds = [
  { level: 1, build: null },
  { level: 8, build: { skills: { fireball: 2, quake: 1, power: 1 }, activeSkills: ['fireball', 'quake'] } },
  { level: 15, build: { skills: { fireball: 2, quake: 2, power: 2, haste: 2 }, activeSkills: ['fireball', 'quake'] } },
];

const results = [];
for (const phase of ['hunt', 'finale']) {
  for (const { level, build } of builds) {
    results.push(duel({ phase, level, build, abilities: false }));
    if (build) results.push(duel({ phase, level, build, abilities: true }));
  }
}

for (const result of results) {
  assert.ok(result.seconds < 90, `${result.phase} Lv${result.level} ${result.mode} did not finish`);
  assert.ok(result.seconds > 3, `${result.phase} Lv${result.level} ${result.mode} was an instant kill (${result.seconds.toFixed(2)}s)`);
}

for (const phase of ['hunt', 'finale']) {
  for (const level of [8, 15]) {
    const result = results.find(r => r.phase === phase && r.level === level && r.mode === 'skills + basic');
    assert.ok(result.seconds >= 6 && result.seconds <= 28,
      `${phase} Lv${level} skill build expected roughly 10–20s TTK, got ${result.seconds.toFixed(2)}s`);
    assert.ok(result.casts > 0, `${phase} Lv${level} build did not cast its active skills`);
  }
}

const protectedResult = graceProtection();
assert.equal(protectedResult.directDamage, 0, 'direct PvP damage should be blocked during grace');
assert.equal(protectedResult.hp, protectedResult.maxHp, 'skill and basic projectiles should not damage during grace');
assert.ok(PROGRESSION.maxLevel >= 15 && COMBAT_BALANCE.huntDamageMultiplier > 0,
  'duel benchmark requires current exported progression and balance');

const multipliers = {
  hunt: { previous: 0.12, current: COMBAT_BALANCE.huntDamageMultiplier },
  finale: { previous: 0.32, current: COMBAT_BALANCE.finaleDamageMultiplier },
};
for (const value of Object.values(multipliers)) value.damageRatio = value.current / value.previous;

console.log(JSON.stringify({ hz: 1 / DT, multipliers, grace: protectedResult, results }, null, 2));
