import assert from 'node:assert/strict';
import { createGame, stepGame } from '../dist/js/simulation.js';
import { BOSS_CONFIG } from '../dist/js/boss-config.js';

const DT = 1 / 60;
const ALL_MAPS = ['courtyard', 'desert', 'frost', 'swamp'];
const ALL_MODES = ['classic', 'melee'];
const DEFAULT_SEEDS = ['boss-sim-101', 'boss-sim-202', 'boss-sim-303'];

function option(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find(arg => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).split(',').filter(Boolean) : fallback;
}

const mapIds = option('maps', ALL_MAPS);
const modes = option('modes', ALL_MODES);
const seeds = option('seeds', DEFAULT_SEEDS);
for (const id of mapIds) assert.ok(ALL_MAPS.includes(id), `unknown map: ${id}`);
for (const mode of modes) assert.ok(ALL_MODES.includes(mode), `unknown mode: ${mode}`);
if (process.argv.includes('--help')) {
  console.log('Usage: node tests/boss-simulate.mjs [--maps=courtyard,desert] [--modes=classic,melee] [--seeds=a,b]');
  process.exit(0);
}

const results = [];
for (const mapId of mapIds) for (const mode of modes) for (const seed of seeds) {
  const game = createGame(seed, { mode, mapId, ruleset: 'boss' });
  assert.equal(game.ruleset, 'boss');
  assert.equal(game.actors.length, 12);
  assert.equal(game.actors.filter(actor => actor.combatMode === 'classic').length, 6);
  assert.equal(game.actors.filter(actor => actor.combatMode === 'melee').length, 6);
  for (const actor of game.actors) actor.isPlayer = false;

  const started = process.hrtime.bigint();
  let steps = 0;
  while (!game.result && steps < 600 * 60 + 10) {
    stepGame(game, DT, { autoPlayer: true });
    steps++;
    if (game.boss) assert.ok(game.boss.hp >= 0 && game.boss.hp <= game.boss.maxHp, `${mapId}/${mode}/${seed}: boss HP out of range`);
    assert.ok(game.actors.every(actor => Number.isFinite(actor.bossDamage) && actor.bossDamage >= 0), `${mapId}/${mode}/${seed}: invalid boss damage credit`);
    assert.ok(game.actors.every(actor => actor.hp <= actor.maxHp && (!actor.alive || actor.hp > 0)), `${mapId}/${mode}/${seed}: illegal actor health`);
    assert.equal(game.zone, null, `${mapId}/${mode}/${seed}: boss mode started a shrinking zone`);
  }
  const wallMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(game.result, `${mapId}/${mode}/${seed}: no result by the 600-second deadline`);
  assert.ok(['bossDefeated', 'timeLimit'].includes(game.result.reason), 'unexpected result reason');
  assert.ok(game.time <= 600, 'boss round exceeded deadline');
  const totalCredited = game.actors.reduce((sum, actor) => sum + actor.bossDamage, 0);
  const actualLost = game.boss.maxHp - game.boss.hp;
  assert.ok(Math.abs(totalCredited - actualLost) < 1e-6,
    `${mapId}/${mode}/${seed}: damage credit ${totalCredited} != boss HP loss ${actualLost}`);
  const row = {
    mapId, mode, seed, result: game.result.reason, time: Number(game.time.toFixed(2)), steps,
    bossHp: game.boss.hp, totalDamage: Number(totalCredited.toFixed(2)),
    deaths: game.actors.reduce((sum, actor) => sum + (actor.deaths || 0), 0),
    winnerIds: [...game.result.winnerIds],
    winnerModes: Object.fromEntries(['classic', 'melee'].map(weapon => [weapon,
      game.result.winnerIds.filter(id => game.actors.find(actor => actor.id === id)?.combatMode === weapon).length])),
    wallMs: Number(wallMs.toFixed(1)),
    damageByWeapon: Object.fromEntries(['classic', 'melee'].map(weapon => [weapon,
      Number(game.actors.filter(actor => actor.combatMode === weapon).reduce((sum, actor) => sum + actor.bossDamage, 0).toFixed(2))])),
    deathsByWeapon: Object.fromEntries(['classic', 'melee'].map(weapon => [weapon,
      game.actors.filter(actor => actor.combatMode === weapon).reduce((sum, actor) => sum + (actor.deaths || 0), 0)])),
  };
  results.push(row);
  console.log(JSON.stringify(row));
}

const summaries = Object.fromEntries(ALL_MODES.map(mode => {
  const totalDamage = results.reduce((sum, row) => sum + row.damageByWeapon[mode], 0);
  return [mode, {
    runs: results.length,
    totalDamage: Number(totalDamage.toFixed(2)),
    averageDamagePerRun: Number((totalDamage / Math.max(1, results.length)).toFixed(2)),
    winnerCount: results.reduce((sum, row) => sum + row.winnerModes[mode], 0),
    deaths: results.reduce((sum, row) => sum + row.deathsByWeapon[mode], 0),
  }];
}));
const byMatchMode = Object.fromEntries(modes.map(mode => {
  const rows = results.filter(row => row.mode === mode);
  return [mode, {
    runs: rows.length,
    averageTime: Number((rows.reduce((sum, row) => sum + row.time, 0) / Math.max(1, rows.length)).toFixed(2)),
    damageByWeapon: Object.fromEntries(ALL_MODES.map(weapon => [weapon,
      Number(rows.reduce((sum, row) => sum + row.damageByWeapon[weapon], 0).toFixed(2))])),
    winnerCountByWeapon: Object.fromEntries(ALL_MODES.map(weapon => [weapon,
      rows.reduce((sum, row) => sum + row.winnerModes[weapon], 0)])),
    deathsByWeapon: Object.fromEntries(ALL_MODES.map(weapon => [weapon,
      rows.reduce((sum, row) => sum + row.deathsByWeapon[weapon], 0)])),
  }];
}));
const byMap = Object.fromEntries(mapIds.map(mapId => {
  const rows = results.filter(row => row.mapId === mapId);
  return [mapId, {
    runs: rows.length,
    averageTime: Number((rows.reduce((sum, row) => sum + row.time, 0) / Math.max(1, rows.length)).toFixed(2)),
    damageByWeapon: Object.fromEntries(ALL_MODES.map(weapon => [weapon,
      Number(rows.reduce((sum, row) => sum + row.damageByWeapon[weapon], 0).toFixed(2))])),
    winnerCountByWeapon: Object.fromEntries(ALL_MODES.map(weapon => [weapon,
      rows.reduce((sum, row) => sum + row.winnerModes[weapon], 0)])),
  }];
}));
const summary = {
  runs: results.length, modes, maps: mapIds, seeds,
  configuration: { hz: 60, bossHp: BOSS_CONFIG.maxHp,
    basicDamageMultipliers: BOSS_CONFIG.basicDamageMultipliers,
    skillDamageMultipliers: BOSS_CONFIG.skillDamageMultipliers,
    nearGuardRadius: BOSS_CONFIG.nearGuardRadius,
    nearGuardReduction: BOSS_CONFIG.nearGuardReduction },
  resultCounts: Object.fromEntries(['bossDefeated', 'timeLimit'].map(reason => [reason, results.filter(row => row.result === reason).length])),
  averageTime: Number((results.reduce((sum, row) => sum + row.time, 0) / Math.max(1, results.length)).toFixed(2)),
  totalDeaths: results.reduce((sum, row) => sum + row.deaths, 0),
  byMatchMode,
  byMap,
  summary: summaries,
};
console.log(JSON.stringify(summary, null, 2));
