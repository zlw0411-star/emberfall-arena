// 架构重构的回归闸门。
//
// 一次跑完全部验收：单元测试 + 双模式整局模拟 + 对砍基准 + 性能 + 逐帧状态全等。
// 任何一步失败立即退出并给出可定位的信息。
//
// 与 npm test 的区别：npm test 只管单元测试；本脚本是「改完代码能不能提交」的判定。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { snapshot } from '../.local/state-snapshot.mjs';

const BASELINE = '.local/baseline-output/state-baseline.json';
const results = [];
let failed = 0;

function step(name, command, args, env = {}) {
  const started = Date.now();
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    const ms = Date.now() - started;
    results.push({ name, ok: true, ms });
    console.log(`  ok    ${name}  (${ms}ms)`);
    return output;
  } catch (error) {
    const ms = Date.now() - started;
    results.push({ name, ok: false, ms });
    failed++;
    console.log(`  FAIL  ${name}  (${ms}ms)`);
    console.log(String(error.stdout || '').split('\n').slice(-40).join('\n'));
    console.log(String(error.stderr || '').split('\n').slice(-40).join('\n'));
    return null;
  }
}

console.log('1/5 unit tests');
// Windows 下 npm 的 glob 由 shell 展开，node 自身不展开通配符，
// 所以这里显式传 shell，并保持参数固定（无用户输入）。
step('unit tests', process.execPath, ['--test', 'tests/contracts.test.js', 'tests/controls.test.js', 'tests/determinism.test.js', 'tests/melee.test.js', 'tests/melee-vfx.test.js', 'tests/monsters.test.js', 'tests/skills.test.js']);

console.log('2/5 full-match simulation (classic + melee, 60Hz)');
step('simulate classic 60Hz', process.execPath, ['tests/simulate.js', 'sim-101', 'sim-202', 'sim-303'], { SIM_HZ: '60' });
step('simulate melee 60Hz', process.execPath, ['tests/simulate.js', 'sim-101', 'sim-202', 'sim-303'], { SIM_HZ: '60', GAME_MODE: 'melee' });

console.log('3/5 duel benchmarks');
step('duels (ranged)', process.execPath, ['tests/duels.js']);
step('duels (melee)', process.execPath, ['tests/melee-duels.js']);

console.log('4/5 performance');
step('performance classic', process.execPath, ['tests/performance.js']);
step('performance melee', process.execPath, ['tests/performance.js'], { GAME_MODE: 'melee' });

console.log('5/5 frame-by-frame state identity vs baseline');
if (!existsSync(BASELINE)) {
  console.log(`  SKIP  no baseline at ${BASELINE}; run: node .local/state-snapshot.mjs write ${BASELINE}`);
} else {
  const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
  const now = snapshot();
  let diverged = 0;
  for (const key of Object.keys(base)) {
    const a = base[key];
    const b = now[key];
    if (!b) { console.log(`  MISS  ${key}`); diverged++; continue; }
    const same = a.steps === b.steps && a.endTime === b.endTime && a.winner === b.winner
      && a.marks.length === b.marks.length && !a.marks.some((hash, i) => hash !== b.marks[i]);
    if (!same) {
      const at = a.marks.findIndex((hash, i) => hash !== b.marks[i]);
      console.log(`  DIFF  ${key}: steps ${a.steps}->${b.steps}, end ${a.endTime}->${b.endTime}, winner ${a.winner}->${b.winner}`
        + (at >= 0 ? `, first divergence at ${at + 1}s` : ''));
      diverged++;
    }
  }
  const total = Object.values(now).reduce((sum, row) => sum + row.marks.length, 0);
  if (diverged) {
    failed++;
    console.log(`  FAIL  ${diverged}/${Object.keys(base).length} runs diverged`);
  } else {
    console.log(`  ok    ${Object.keys(base).length} runs byte-identical (${total} hashes)`);
  }
}

// 每次跑完留一份性能快照，方便和历史对比。
writeFileSync(
  '.local/baseline-output/verify-last.json',
  `${JSON.stringify({ at: new Date().toISOString(), results, failed }, null, 2)}\n`,
);

const slowest = [...results].sort((a, b) => b.ms - a.ms)[0];
console.log(`\n${failed ? 'FAILED' : 'PASSED'}: ${results.filter((r) => r.ok).length}/${results.length} checks`
  + (slowest ? `, slowest = ${slowest.name} (${slowest.ms}ms)` : ''));
if (failed) process.exitCode = 1;
