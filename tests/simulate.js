import { CONFIG, createGame, stepGame } from '../dist/js/simulation.js';

const SIM_HZ = Math.max(1, Number(process.env.SIM_HZ) || 30);
const DT = 1 / SIM_HZ;
const GAME_MODE = process.env.GAME_MODE === 'melee' ? 'melee' : 'classic';
// Give the final capped step one frame of observation in case settlement needs it.
const MAX_SECONDS = CONFIG.matchLimit + DT;
const SEEDS = process.argv.slice(2).length ? process.argv.slice(2) : ['sim-101', 'sim-202', 'sim-303'];
const VALID_PHASES = new Set(['grace', 'hunt', 'finale']);

function actorsOf(game) {
  return game.actors ?? [];
}

function rowFor(seed) {
  const game = createGame(seed, { mode: GAME_MODE });
  const initialActors = actorsOf(game);
  if (initialActors.length !== 12 || initialActors.filter(actor => actor.isPlayer).length !== 1) {
    throw new Error(`${seed}: expected a 12-actor roster with exactly one player`);
  }
  // Run a fully automated match while preserving the real roster contract at game creation.
  for (const actor of initialActors) actor.isPlayer = false;
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
    for (const monster of game.monsters ?? []) monsterTypes.set(monster.id, monster.type || 'monster');
    stepGame(game, DT, { autoPlayer: true, mx: 0, my: 0, castSlot: -1 });
    if (!Number.isFinite(game.time) || game.time < previousTime) bugs.add(`invalid or backward time at tick ${tick}`);
    previousTime = game.time;

    const actors = actorsOf(game);
    if (actors.length !== 12) bugs.add(`expected 12 actors, found ${actors.length} at ${game.time.toFixed(1)}s`);
    for (const field of ['id', 'name', 'color']) {
      const values = actors.map(actor => actor[field]);
      if (values.some(value => typeof value !== 'string' || !value.length) || new Set(values).size !== values.length) {
        bugs.add(`missing or duplicate actor ${field} at ${game.time.toFixed(1)}s`);
      }
    }
    if (!VALID_PHASES.has(game.phase)) bugs.add(`invalid phase ${String(game.phase)} at ${game.time.toFixed(1)}s`);
    for (const actor of actors) {
      if (!Number.isFinite(actor.x) || !Number.isFinite(actor.y) || !Number.isFinite(actor.hp) || !Number.isFinite(actor.level)) {
        bugs.add(`invalid actor state for ${actor.id} at ${game.time.toFixed(1)}s`);
      }
      if (actor.alive !== true && actor.alive !== false) bugs.add(`invalid alive state for ${actor.id} at ${game.time.toFixed(1)}s`);
      if (actor.alive && actor.hp <= 0) bugs.add(`living actor ${actor.id} has no health at ${game.time.toFixed(1)}s`);
      if (!actor.alive && !deathReasons.has(actor.id)) {
        deathReasons.set(actor.id, {
          kind: actor.lastDamageKind || 'unknown',
          source: actor.lastDamageSource || null,
        });
      }
    }
    if (firstMaxLevelAt === null && actors.some(actor => actor.level >= CONFIG.maxLevel)) firstMaxLevelAt = game.time;
    if (game.phase === 'finale') {
      if (!game.zone || ![game.zone.x, game.zone.y, game.zone.radius].every(Number.isFinite) || game.zone.radius < 0) {
        bugs.add(`invalid finale zone at ${game.time.toFixed(1)}s`);
      }
      if (finaleAt === null) {
        finaleAt = game.time;
        finaleMonsterSpawns = game.spawnCount;
        finaleGemSpawns = game.gemSpawnCount;
      } else {
        if (game.spawnCount > finaleMonsterSpawns) bugs.add(`monster spawn counter advanced after finale at ${game.time.toFixed(1)}s`);
        if (game.gemSpawnCount > finaleGemSpawns) bugs.add(`map crystal spawn counter advanced after finale at ${game.time.toFixed(1)}s`);
      }
    }
    if (game.result) {
      const living = actors.filter(actor => actor.alive);
      if (!Number.isFinite(game.result.time) || game.result.time > game.time + 1e-9) bugs.add('result has an invalid settlement time');
      if (living.length > 1) bugs.add(`match settled with ${living.length} survivors`);
      const expectedWinner = living[0]?.id ?? null;
      if (game.result.winnerId !== expectedWinner) bugs.add(`result winner ${String(game.result.winnerId)} does not match survivors`);
    }
  }

  const deathCounts = { actor: 0, monster: 0, trap: 0, zone: 0, unknown: 0 };
  for (const death of deathReasons.values()) deathCounts[death.kind] = (deathCounts[death.kind] || 0) + 1;
  const deaths = [...deathReasons.entries()].map(([id, death]) => {
    const source = death.kind === 'monster' ? (monsterTypes.get(death.source) || death.source) : death.source;
    return `${id}:${death.kind}${source ? `(${source})` : ''}`;
  }).join(', ');
  const livingAtEnd = actorsOf(game).filter(actor => actor.alive).length;
  if (!game.result) bugs.add(`match remained unsettled after ${MAX_SECONDS}s`);
  if (game.time > CONFIG.matchLimit + 1e-9 || (game.result && game.result.time > CONFIG.matchLimit + 1e-9)) {
    bugs.add(`match exceeded the ${CONFIG.matchLimit}s hard limit`);
  }
  if (game.result && livingAtEnd > 1) bugs.add(`match ended with ${livingAtEnd} survivors`);

  return {
    seed,
    mode: game.mode,
    hz: SIM_HZ,
    endSeconds: game.result?.time ?? game.time,
    winner: game.result ? (game.result.winnerId ?? 'draw') : 'unfinished',
    livingAtEnd,
    deathCounts,
    deaths,
    firstMaxLevelSeconds: firstMaxLevelAt,
    finaleSeconds: finaleAt,
    reachedTarget: Boolean(game.result && game.result.time >= 5 * 60 && game.result.time <= 10 * 60),
    bugs: [...bugs],
  };
}

const rows = SEEDS.map(rowFor);
console.table(rows.map(({ seed, mode, hz, endSeconds, winner, livingAtEnd, firstMaxLevelSeconds, finaleSeconds, reachedTarget, deathCounts, bugs }) => ({
  seed,
  mode,
  hz,
  end: `${Number(endSeconds).toFixed(1)}s`,
  winner,
  living: livingAtEnd,
  deaths: `A${deathCounts.actor}/M${deathCounts.monster}/T${deathCounts.trap}/Z${deathCounts.zone}/?${deathCounts.unknown}`,
  firstMax: firstMaxLevelSeconds === null ? '—' : `${firstMaxLevelSeconds.toFixed(1)}s`,
  finale: finaleSeconds === null ? '—' : `${finaleSeconds.toFixed(1)}s`,
  "5to10min": reachedTarget,
  bugs: bugs.length ? bugs.join('; ') : 'none',
})));
for (const row of rows) console.log(`${row.seed} eliminations: ${row.deaths || 'none'}`);

const settled = rows.filter(row => row.winner !== 'unfinished');
const average = settled.length ? settled.reduce((sum, row) => sum + row.endSeconds, 0) / settled.length : 0;
console.log(`\nAverage end time: ${average.toFixed(1)}s across ${settled.length}/${rows.length} settled seeds.`);
console.log(`Matches ending in 5–10 minutes: ${rows.filter(row => row.reachedTarget).length}/${rows.length}.`);
if (rows.some(row => row.bugs.length)) process.exitCode = 1;
