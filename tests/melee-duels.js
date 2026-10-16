import assert from 'node:assert/strict';
import { createGame } from '../dist/js/simulation.js';
import { createActor, addXp, castSkill, configureActorForMode, updateCombat, xpNeeded, chooseSkill, PROGRESSION } from '../dist/js/combat.js';

const DT = 1 / 60;
const map = { width: 600, height: 400, obstacles: [], traps: [] };

function makeDuel(level = 1, build = []) {
  const game = createGame(`melee-duel-${level}-${build.join('-') || 'basic'}`, { mode: 'melee' });
  const attacker = createActor('attacker', '刀手', build.includes('lunge') ? 80 : 180, 200, true, '#fff');
  const victim = createActor('victim', '靶子', 260, 200, true, '#f00');
  configureActorForMode(attacker, 'melee');
  configureActorForMode(victim, 'melee');
  game.map = map;
  game.phase = 'hunt';
  game.time = 100;
  game.actors = [attacker, victim];
  game.monsters = [];
  game.gems = [];
  game.bullets = [];
  game.effects = [];
  attacker.attackTimer = 0;
  victim.attackTimer = Number.POSITIVE_INFINITY;
  victim.skills = {};
  victim.activeSkills = [];
  victim.hp = victim.maxHp;
  if (level > 1) {
    let xp = 0;
    for (let lv = 1; lv < level; lv++) xp += xpNeeded(lv);
    addXp(game, attacker, xp);
    addXp(game, victim, xp);
  }
  victim.skills = {};
  victim.activeSkills = [];
  victim.pendingChoices = 0;
  victim.choices = [];
  for (const skillId of build) {
    attacker.choices = [skillId];
    if (!chooseSkill(game, attacker, skillId)) throw new Error(`illegal Lv${level} build choice: ${skillId}`);
  }
  attacker.cooldowns = Object.fromEntries(attacker.activeSkills.map(id => [id, 0]));
  attacker.hp = attacker.maxHp;
  victim.hp = victim.maxHp;
  return { game, attacker, victim };
}

function runDuel(level, build = []) {
  const { game, attacker, victim } = makeDuel(level, build);
  const casts = Object.fromEntries(attacker.activeSkills.map(id => [id, 0]));
  let elapsed = 0;
  const deadline = 30;
  while (victim.alive && elapsed < deadline) {
    for (let slot = 0; slot < attacker.activeSkills.length; slot++) {
      const id = attacker.activeSkills[slot];
      if ((attacker.cooldowns[id] || 0) <= 0 && castSkill(game, attacker, slot, victim.x, victim.y)) {
        casts[id]++;
        break;
      }
    }
    const dx = victim.x - attacker.x, dy = victim.y - attacker.y, distance = Math.hypot(dx, dy);
    if (distance > 60) {
      attacker.x += dx / distance * 100 * DT;
      attacker.y += dy / distance * 100 * DT;
    }
    attacker.attackHeld = true;
    attacker.aimAngle = Math.atan2(victim.y - attacker.y, victim.x - attacker.x);
    updateCombat(game, DT);
    elapsed += DT;
  }
  return {
    level,
    build: build.length ? build.join('+') : 'no skills',
    skillRanks: { ...attacker.skills },
    seconds: elapsed,
    casts,
    hp: victim.hp,
    initialHp: victim.maxHp,
  };
}

function runMaxRankSlash(skillId) {
  const plan = [...Array(4).fill(skillId), ...Array(4).fill('power')];
  const { game, attacker, victim } = makeDuel(15, plan);
  const slot = attacker.activeSkills.indexOf(skillId);
  assert.ok(slot >= 0, `${skillId} was not in the legal Lv15 active skill slots`);
  const cast = castSkill(game, attacker, slot, victim.x, victim.y);
  assert.equal(cast, true, `${skillId} rank 4 did not cast`);
  for (let i = 0; i < 90 && victim.hp === victim.maxHp; i++) updateCombat(game, DT);
  return { skill: skillId, level: attacker.level, ranks: { ...attacker.skills }, damage: victim.maxHp - victim.hp, targetHp: victim.hp, targetMaxHp: victim.maxHp };
}

const lv8Build = ['lunge', 'whirlwind', 'heavySlash', 'power'];
const lv15Build = ['lunge', 'whirlwind', 'heavySlash', 'power', 'lunge', 'whirlwind', 'heavySlash', 'power'];
assert.equal(PROGRESSION.maxLevel, 15, `unexpected progression cap ${PROGRESSION.maxLevel}`);
const capProbe = createActor('cap-probe', '上限检查', 0, 0, true);
const capGame = { actors: [capProbe], time: 0, events: [], effects: [], rng: () => 0 };
addXp(capGame, capProbe, 1e9);
assert.equal(capProbe.level, 15, 'melee progression exceeded the actual level-15 cap');
const results = [
  runDuel(1),
  runDuel(8), runDuel(8, lv8Build),
  runDuel(15), runDuel(15, lv15Build),
];
const singleSlashResults = ['lunge', 'whirlwind', 'heavySlash'].map(runMaxRankSlash);
const byLevel = level => results.filter(result => result.level === level);
assert.ok(results[0].seconds >= 6 && results[0].seconds <= 12,
  `Lv1 melee basic TTK should be about 6–12s; got ${results[0].seconds.toFixed(2)}s`);
assert.equal(lv8Build.length, 4, 'Lv8 build should spend all four milestone choices');
assert.equal(lv15Build.length, 8, 'Lv15 build should spend all eight milestone choices');
for (const level of [8, 15]) {
  const [withoutSkills, withSkills] = byLevel(level);
  assert.ok(withSkills.seconds < withoutSkills.seconds,
    `Lv${level} skill build did not shorten its no-skill TTK (${withSkills.seconds.toFixed(2)}s vs ${withoutSkills.seconds.toFixed(2)}s)`);
  assert.ok(withSkills.seconds > 1, `Lv${level} skill build nearly one-shot a full-health target`);
  assert.ok(withSkills.hp === 0, `Lv${level} skill build did not finish the full-health target`);
  for (const skillId of ['lunge', 'whirlwind', 'heavySlash']) {
    assert.ok(withSkills.casts[skillId] > 0, `Lv${level} build never cast ${skillId}`);
  }
}
for (const result of singleSlashResults) {
  assert.ok(result.damage > 0, `${result.skill} rank 4 failed to damage a full-health target`);
  assert.ok(result.targetHp > 0, `${result.skill} rank 4 one-shot a full-health Lv15 target`);
}

console.log(JSON.stringify({ mode: 'melee', maxLevel: PROGRESSION.maxLevel, levels: [1, 8, 15], results, singleSlashResults }, null, 2));
