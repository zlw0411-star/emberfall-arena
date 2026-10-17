// 逐帧状态快照：把整局模拟的可序列化状态每秒哈希一次。
// 用途：架构重构的验收基准。任何阶段改了代码，重跑此脚本并 diff 输出，
// 必须与 baseline JSON 完全一致，才允许通过。
//
// 用法（从仓库根目录执行）：
//   node tests/state-snapshot.mjs write tests/baselines/state-baseline.json
//   node tests/state-snapshot.mjs check tests/baselines/state-baseline.json
// 或直接 npm run snapshot:write / npm run snapshot:check
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createGame, stepGame } from '../dist/js/simulation.js';

const DT = 1 / 60;
const SEEDS = ['sim-101', 'sim-202', 'sim-303', 'sim-404'];
const MODES = ['classic', 'melee'];

// 视觉字段不参与比对：它们不影响模拟结果，而是由模拟派生。
// Set 转数组以稳定序列化。
const VISUAL_KEYS = new Set(['meleeVisuals', 'hitFlash', 'effects']);
function canonical(game) {
  return JSON.parse(
    JSON.stringify(game, (key, value) => {
      if (VISUAL_KEYS.has(key)) return undefined;
      if (value instanceof Set) return [...value];
      return value;
    }),
  );
}
const hashOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

export function snapshot() {
  const out = {};
  for (const mode of MODES) {
    for (const seed of SEEDS) {
      const game = createGame(seed, { mode });
      for (const actor of game.actors) actor.isPlayer = false;
      const marks = [];
      let steps = 0;
      while (!game.result && steps < 43201) {
        stepGame(game, DT, { autoPlayer: true });
        steps++;
        // 每秒一次 + 终局一次，控制快照体积同时保持灵敏度
        if (steps % 60 === 0 || game.result) marks.push(hashOf(canonical(game)));
      }
      out[`${mode}:${seed}`] = {
        steps,
        endTime: Number(game.time.toFixed(3)),
        winner: game.result?.winnerId ?? null,
        marks,
      };
    }
  }
  return out;
}

// 仅当作为脚本直接运行时执行 CLI 逻辑（被测试 import 时不触发）。
if (process.argv[1] && process.argv[1].replaceAll('\\', '/').endsWith('/state-snapshot.mjs')) {
  const [command, file] = process.argv.slice(2);
  const data = snapshot();
  if (command === 'write') {
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    const total = Object.values(data).reduce((sum, row) => sum + row.marks.length, 0);
    console.log(`wrote ${file}: ${Object.keys(data).length} runs, ${total} hashes`);
  } else if (command === 'check') {
    const base = JSON.parse(readFileSync(file, 'utf8'));
    let failed = 0;
    for (const key of Object.keys(base)) {
      const a = base[key];
      const b = data[key];
      if (!b) { console.error(`MISSING ${key}`); failed++; continue; }
      if (a.steps !== b.steps || a.endTime !== b.endTime || a.winner !== b.winner) {
        console.error(`MISMATCH ${key}: steps ${a.steps}->${b.steps}, end ${a.endTime}->${b.endTime}, winner ${a.winner}->${b.winner}`);
        failed++;
        continue;
      }
      if (a.marks.length !== b.marks.length) {
        console.error(`MISMATCH ${key}: ${a.marks.length} vs ${b.marks.length} marks`);
        failed++;
        continue;
      }
      const at = a.marks.findIndex((hash, i) => hash !== b.marks[i]);
      if (at >= 0) {
        console.error(`MISMATCH ${key}: first divergence at mark ${at} (${(at + 1)}s)`);
        failed++;
      }
    }
    if (failed) {
      console.error(`\nFAILED: ${failed}/${Object.keys(base).length} runs diverged`);
      process.exitCode = 1;
    } else {
      console.log(`OK: ${Object.keys(base).length} runs byte-identical (${Object.values(data).reduce((s, r) => s + r.marks.length, 0)} hashes)`);
    }
  } else {
    console.error('usage: node tests/state-snapshot.mjs <write|check> <file>');
    process.exitCode = 2;
  }
}
