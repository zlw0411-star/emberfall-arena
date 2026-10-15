import { CONFIG, createGame, stepGame } from '../dist/js/simulation.js';

const SIM_HZ = Math.max(1, Number(process.env.SIM_HZ) || 30);
const DT = 1 / SIM_HZ;
const MAX_SECONDS = 15 * 60;
const SEEDS = process.argv.slice(2).length ? process.argv.slice(2) : ['sim-101', 'sim-202', 'sim-303'];

function actorsOf(game) {
  return game.actors ?? [];
}

function rowFor(seed) {
  const game = createGame(seed);
  for (const actor of actorsOf(game)) actor.isPlayer = false;
  let firstMaxLevelAt = null;
  let finaleAt = null;
  let finaleMonsterSpawns = null;
  let finaleGemSpawns = null;
  const bugs = new Set();
  const deathReasons = new Map();
  const monsterTypes = new Map();
  let previousTime = game.time;
  const maxSteps = Math.ceil(MAX_SECONDS / DT);

  for (let tick = 0; tick < maxSteps && !game.result; tick++) {
    for (const monster of game.monsters) monsterTypes.set(monster.id, monster.type || 'monster');
    stepGame(game, DT, { autoPlayer: true, mx: 0, my: 0, castSlot: -1 });
    if (!Number.isFinite(game.time) || game.time < previousTime) bugs.add(`invalid or backward time at tick ${tick}`);
    previousTime = game.time;

    const actors = actorsOf(game);
    for (const actor of actors) {
      if (!actor.alive && !deathReasons.has(actor.id)) {
        deathReasons.set(actor.id, {
          kind: actor.lastDamageKind || 'unknown',
          source: actor.lastDamageSource || null,
        });
      }
    }
    if (firstMaxLevelAt === null && actors.some(actor => actor.level >= CONFIG.maxLevel)) firstMaxLevelAt = game.time;
    if (finaleAt === null && game.phase === 'finale') {
      finaleAt = game.time;
      finaleMonsterSpawns = game.spawnCount;
      finaleGemSpawns = game.gemSpawnCount;
    } else if (finaleAt !== null) {
      if (game.spawnCount > finaleMonsterSpawns) bugs.add(`monster spawn counter advanced after finale at ${game.time.toFixed(1)}s`);
      if (game.gemSpawnCount > finaleGemSpawns) bugs.add(`map crystal spawn counter advanced after finale at ${game.time.toFixed(1)}s`);
    }
  }

  const deathCounts = { actor: 0, monster: 0, trap: 0, zone: 0, unknown: 0 };
  for (const death of deathReasons.values()) deathCounts[death.kind] = (deathCounts[death.kind] || 0) + 1;
  const deaths = [...deathReasons.entries()].map(([id, death]) => {
    const source = death.kind === 'monster' ? (monsterTypes.get(death.source) || death.source) : death.source;
    return `${id}:${death.kind}${source ? `(${source})` : ''}`;
  }).join(', ');

  return {
    seed,
    hz: SIM_HZ,
    endSeconds: game.result?.time ?? game.time,
    winner: game.result ? (game.result.winnerId ?? 'draw') : 'unfinished',
    livingAtEnd: actorsOf(game).filter(actor => actor.alive).length,
    deathCounts,
    deaths,
    firstMaxLevelSeconds: firstMaxLevelAt,
    finaleSeconds: finaleAt,
    reachedTarget: Boolean(game.result && game.result.time >= 8 * 60 && game.result.time <= 12 * 60),
    bugs: [...bugs],
  };
}

const rows = SEEDS.map(rowFor);
console.table(rows.map(({ seed, hz, endSeconds, winner, livingAtEnd, firstMaxLevelSeconds, finaleSeconds, reachedTarget, deathCounts, bugs }) => ({
  seed,
  hz,
  end: `${Number(endSeconds).toFixed(1)}s`,
  winner,
  living: livingAtEnd,
  deaths: `A${deathCounts.actor}/M${deathCounts.monster}/T${deathCounts.trap}/Z${deathCounts.zone}/?${deathCounts.unknown}`,
  firstMax: firstMaxLevelSeconds === null ? '—' : `${firstMaxLevelSeconds.toFixed(1)}s`,
  finale: finaleSeconds === null ? '—' : `${finaleSeconds.toFixed(1)}s`,
  "8to12min": reachedTarget,
  bugs: bugs.length ? bugs.join('; ') : 'none',
})));
for (const row of rows) console.log(`${row.seed} eliminations: ${row.deaths || 'none'}`);

const completed = rows.filter(row => Number.isFinite(row.endSeconds));
const average = completed.length ? completed.reduce((sum, row) => sum + row.endSeconds, 0) / completed.length : 0;
console.log(`\nAverage end time: ${average.toFixed(1)}s across ${completed.length}/${rows.length} seeds.`);
console.log(`Matches ending in 8–12 minutes: ${rows.filter(row => row.reachedTarget).length}/${rows.length}.`);
if (rows.some(row => row.bugs.length)) process.exitCode = 1;
