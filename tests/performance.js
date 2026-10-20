import { CONFIG, createGame, spawnMonster, stepGame } from '../dist/js/simulation.js';
import { evaluatePerformanceBudget, parseP95Budget, percentile } from './performance-budget.mjs';

const DT = 1 / 60;
const WARMUP_SECONDS = 2;
const MEASURE_SECONDS = 30;
const GAME_MODE = process.env.GAME_MODE === 'melee' ? 'melee' : 'classic';
const P95_BUDGET_MS = parseP95Budget(process.env.PERFORMANCE_P95_BUDGET_MS);
const game = createGame(`performance-${CONFIG.actorCount}actors-${CONFIG.monsterCap}monsters`, { mode: GAME_MODE });

game.phase = 'hunt';
game.time = 90;
for (const actor of game.actors) {
  actor.isPlayer = false;
  actor.hp = actor.maxHp = 1_000_000;
}
while (game.monsters.filter(monster => monster.alive).length < CONFIG.monsterCap) {
  const monster = spawnMonster(game);
  if (!monster) throw new Error(`Could not populate ${CONFIG.monsterCap} live monsters for benchmark`);
}
for (const monster of game.monsters) {
  monster.hp = monster.maxHp = 1_000_000;
  monster.damage = 0;
}

function tick() {
  stepGame(game, DT, { autoPlayer: true, mx: 0, my: 0, castSlot: -1 });
}

for (let i = 0; i < WARMUP_SECONDS / DT; i++) tick();

const samplesMs = [];
for (let i = 0; i < MEASURE_SECONDS / DT; i++) {
  const start = process.hrtime.bigint();
  tick();
  samplesMs.push(Number(process.hrtime.bigint() - start) / 1e6);
}

const averageMs = samplesMs.reduce((sum, ms) => sum + ms, 0) / samplesMs.length;
const p95Ms = percentile(samplesMs);
const maxMs = Math.max(...samplesMs);
const liveActors = game.actors.filter(actor => actor.alive).length;
const liveMonsters = game.monsters.filter(monster => monster.alive).length;

if (liveActors !== 12 || liveMonsters !== 62) {
  throw new Error(`Expected 12 actors + 62 live monsters, measured ${liveActors} + ${liveMonsters}`);
}

const budget = evaluatePerformanceBudget(p95Ms, P95_BUDGET_MS);

console.log(JSON.stringify({
  node: process.version,
  mode: game.mode,
  seed: game.seed,
  actors: liveActors,
  liveMonsters,
  simulatedSeconds: MEASURE_SECONDS,
  measuredSteps: samplesMs.length,
  stepAverageMs: Number(averageMs.toFixed(3)),
  stepP95Ms: Number(p95Ms.toFixed(3)),
  stepP95Of60HzBudgetPercent: Number((p95Ms / (1000 / 60) * 100).toFixed(1)),
  p95BudgetMs: budget.budgetMs,
  p95WithinBudget: budget.p95WithinBudget,
  stepMaxMs: Number(maxMs.toFixed(3)),
  measuredWallSeconds: Number((samplesMs.reduce((sum, ms) => sum + ms, 0) / 1000).toFixed(3)),
  realtimeFactor: Number((MEASURE_SECONDS / (samplesMs.reduce((sum, ms) => sum + ms, 0) / 1000)).toFixed(2)),
}, null, 2));

if (!budget.p95WithinBudget) {
  console.error(`Performance budget exceeded: P95 ${p95Ms.toFixed(3)}ms > ${budget.budgetMs}ms`);
  process.exitCode = 1;
}
