import assert from 'node:assert/strict';
import { createGame, stepGame } from '../dist/js/simulation.js';
import { addXp, castSkill, chooseSkill, getChoices, getSkills, updateCombat, xpNeeded } from '../dist/js/combat.js';
import { createBoss } from '../dist/js/boss.js';
import { BOSS_CONFIG } from '../dist/js/boss-config.js';

const DT = 1 / 60;

function prepareBuild(mode, level) {
  const game = createGame(`boss-duel-${mode}-${level}`, { mode, ruleset: 'boss' });
  const actor = game.actors[0];
  game.actors = [actor];
  game.monsters = [];
  game.gems = [];
  game.bullets = [];
  game.time = 100;
  game.phase = 'boss';
  game.boss = createBoss(game);
  game.map.movementCircles = [game.boss];
  actor.x = game.boss.x + 120;
  actor.y = game.boss.y;
  actor.aimAngle = Math.PI;
  actor.attackTimer = 0;
  if (level > 1) {
    let xp = 0;
    for (let current = 1; current < level; current++) xp += xpNeeded(current);
    addXp(game, actor, xp / BOSS_CONFIG.xpMultiplier);
  }
  const activeBuild = mode === 'classic' ? ['fireball', 'quake', 'chainLightning'] : ['lunge', 'whirlwind', 'heavySlash'];
  const desired = level === 1 ? [] : level === 8 ? [...activeBuild, 'power'] : [...activeBuild, ...Array(5).fill('power')];
  const choices = [];
  for (const desiredSkill of desired) {
    const catalog = getSkills(game, actor);
    if (!Object.hasOwn(catalog, desiredSkill)) throw new Error(`${desiredSkill} is not in the ${mode} catalog`);
    let offer = [];
    for (let attempt = 0; attempt < 5000; attempt++) {
      offer = getChoices(game, actor);
      if (offer.includes(desiredSkill)) break;
      if (attempt === 4999) throw new Error(`Could not obtain a legal offer of ${desiredSkill} for ${mode} Lv${level}`);
    }
    if (!chooseSkill(game, actor, desiredSkill)) throw new Error(`Rejected legal skill choice ${desiredSkill}`);
    choices.push(desiredSkill);
  }
  assert.equal(actor.pendingChoices, 0, `${mode} Lv${level} left unspent milestone choices`);
  assert.deepEqual(actor.activeSkills, activeBuild.slice(0, level === 1 ? 0 : 3));
  actor.cooldowns = Object.fromEntries(actor.activeSkills.map(id => [id, 0]));
  actor.hp = actor.maxHp = 1e9;
  return { game, actor, choices };
}

function runDuel(mode, level, seconds = 30) {
  const { game, actor, choices } = prepareBuild(mode, level);
  const casts = Object.fromEntries(actor.activeSkills.map(id => [id, 0]));
  let elapsed = 0;
  while (elapsed < seconds && game.boss.hp > 0) {
    for (let slot = 0; slot < actor.activeSkills.length; slot++) {
      const id = actor.activeSkills[slot];
      if ((actor.cooldowns[id] || 0) <= 0 && castSkill(game, actor, slot, game.boss.x, game.boss.y)) {
        casts[id]++;
        break;
      }
    }
    actor.attackHeld = true;
    updateCombat(game, DT);
    game.time += DT;
    elapsed += DT;
  }
  const credited = actor.bossDamage || 0;
  const actual = game.boss.maxHp - game.boss.hp;
  assert.ok(Math.abs(credited - actual) < 1e-6, `${mode} Lv${level}: credited damage differs from boss HP loss`);
  return {
    mode, level, choices, choiceCount: choices.length, skillRanks: { ...actor.skills },
    activeSkills: [...actor.activeSkills], seconds: Number(elapsed.toFixed(2)), casts,
    damage: Number(actual.toFixed(2)), bossHp: Number(game.boss.hp.toFixed(2)),
  };
}

const duels = [];
for (const mode of ['classic', 'melee']) {
  for (const level of [1, 8, 15]) duels.push(runDuel(mode, level));
}
assert.deepEqual(duels.filter(row => row.level === 1).map(row => row.choiceCount), [0, 0]);
assert.deepEqual(duels.filter(row => row.level === 8).map(row => row.choiceCount), [4, 4]);
assert.deepEqual(duels.filter(row => row.level === 15).map(row => row.choiceCount), [8, 8]);

// Profile the actual new rules path with the expected full 12-actor and 62-monster load.
const benchmark = createGame('boss-duels-performance', { mode: 'classic', ruleset: 'boss' });
benchmark.phase = 'boss';
benchmark.time = 100;
for (const actor of benchmark.actors) {
  actor.hp = actor.maxHp = 1e9;
  actor.isPlayer = false;
  actor.bossDamage = 0;
}
benchmark.monsters = Array.from({ length: 62 }, (_, index) => ({
  id: `bench-${index}`, x: 80 + (index % 12) * 120, y: 80 + Math.floor(index / 12) * 150,
  radius: 11, hp: 1e9, maxHp: 1e9, speed: 0, damage: 0, attackTimer: 1e9,
  alive: true, type: 'slime', xp: 15,
}));
const samples = [];
for (let i = 0; i < 1800; i++) {
  const started = process.hrtime.bigint();
  stepGame(benchmark, DT, { autoPlayer: true });
  samples.push(Number(process.hrtime.bigint() - started) / 1e6);
}
samples.sort((a, b) => a - b);
const p95Ms = samples[Math.ceil(samples.length * .95) - 1];
const averageMs = samples.reduce((sum, ms) => sum + ms, 0) / samples.length;
assert.ok(p95Ms < 8, `12 actors + 62 monsters boss-mode P95 is ${p95Ms.toFixed(3)}ms (limit 8ms)`);

console.log(JSON.stringify({ duels, performance: {
  damageMultipliers: { basic: BOSS_CONFIG.basicDamageMultipliers, skill: BOSS_CONFIG.skillDamageMultipliers },
  actors: benchmark.actors.length, monsters: benchmark.monsters.length, mode: benchmark.ruleset,
  measuredFrames: samples.length, averageMs: Number(averageMs.toFixed(3)), p95Ms: Number(p95Ms.toFixed(3)),
  p95LimitMs: 8,
} }, null, 2));
