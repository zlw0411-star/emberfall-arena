import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_P95_BUDGET_MS,
  evaluatePerformanceBudget,
  parseP95Budget,
  percentile,
} from './performance-budget.mjs';

test('default P95 budget matches the boss threshold and accepts a configured budget', () => {
  assert.equal(DEFAULT_P95_BUDGET_MS, 8);
  assert.equal(parseP95Budget(undefined), 8);
  assert.equal(parseP95Budget('12.5'), 12.5);
});

test('invalid P95 budgets are rejected instead of disabling the gate', () => {
  for (const value of ['', ' ', '0', '-1', 'Infinity', '-Infinity', 'NaN', 'not-a-number']) {
    assert.throws(() => parseP95Budget(value), /finite positive number/, String(value));
  }
});

test('synthetic 100ms samples fail the default budget and normal samples pass', () => {
  const synthetic100Ms = Array.from({ length: 1800 }, () => 100);
  const failed = evaluatePerformanceBudget(percentile(synthetic100Ms), DEFAULT_P95_BUDGET_MS);
  assert.equal(failed.budgetMs, 8);
  assert.equal(failed.p95WithinBudget, false);

  const normal = percentile(Array.from({ length: 100 }, (_, index) => index % 8));
  const passed = evaluatePerformanceBudget(normal, DEFAULT_P95_BUDGET_MS);
  assert.equal(normal, 7);
  assert.equal(passed.p95WithinBudget, true);
});

test('P95 uses nearest-rank selection and rejects an empty or invalid sample set', () => {
  assert.equal(percentile([4, 1, 3, 2, 5]), 5);
  assert.equal(percentile([100, 1, 2], 0.5), 2);
  assert.throws(() => percentile([]), /non-empty array/);
  assert.throws(() => percentile([1, NaN]), /finite numbers/);
  assert.throws(() => percentile([1, 2], 0), /fraction/);
});

test('the real performance CLI exits nonzero when a synthetic clock reports 100ms steps', () => {
  const script = `let clock = 0n; process.hrtime.bigint = () => (clock += 100000000n); await import(${JSON.stringify(new URL('./performance.js', import.meta.url).href)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', timeout: 15000,
    env: { ...process.env, GAME_MODE: 'classic', PERFORMANCE_P95_BUDGET_MS: '8' },
  });
  assert.equal(result.status, 1, result.error?.message || result.stderr);
  const metrics = JSON.parse(result.stdout);
  assert.equal(metrics.stepP95Ms, 100);
  assert.equal(metrics.p95WithinBudget, false);
  assert.match(result.stderr, /Performance budget exceeded/);
});
