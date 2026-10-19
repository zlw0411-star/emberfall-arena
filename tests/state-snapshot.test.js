import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readSnapshot, SNAPSHOT_CASES, snapshotDifferences, validateSnapshot } from './state-snapshot.mjs';

const validSnapshot = () => Object.fromEntries(SNAPSHOT_CASES.map(({ mode, seed }) => [
  `${mode}:${seed}`, { steps: 60, endTime: 1, winner: 'a0', marks: ['0123456789abcdef'] },
]));

test('tracked baseline has all eight valid cases', () => {
  const data = readSnapshot(fileURLToPath(new URL('./baselines/state-baseline.json', import.meta.url)));
  assert.equal(Object.keys(data).length, 8);
});

test('snapshot validation rejects empty, missing, and unexpected cases', () => {
  for (const data of [null, [], {}, { unexpected: {} }]) assert.throws(() => validateSnapshot(data));
  const missing = validSnapshot();
  delete missing['classic:sim-101'];
  assert.throws(() => validateSnapshot(missing), /missing \[classic:sim-101\]/);
  const extra = { ...validSnapshot(), 'classic:sim-999': validSnapshot()['classic:sim-101'] };
  assert.throws(() => validateSnapshot(extra), /unexpected \[classic:sim-999\]/);
});

test('snapshot validation rejects malformed metadata and hash coverage', () => {
  for (const patch of [
    { steps: 0 }, { steps: 1.5 }, { steps: 50000 }, { endTime: NaN }, { endTime: 721 },
    { winner: 'a12' }, { winner: undefined }, { marks: [] }, { marks: ['bad-hash'] },
    { marks: ['0123456789abcdef', '0123456789abcdef'] }, { marks: [null] },
  ]) {
    const data = validSnapshot();
    Object.assign(data['classic:sim-101'], patch);
    assert.throws(() => validateSnapshot(data), /invalid.*classic:sim-101/);
  }
});

test('comparison checks results and each state mark, and rejects truncated inputs', () => {
  const base = validSnapshot(), now = validSnapshot();
  assert.deepEqual(snapshotDifferences(base, now), []);
  now['melee:sim-404'].marks[0] = '1111111111111111';
  assert.match(snapshotDifferences(base, now)[0], /melee:sim-404.*first divergence at mark 1/);
  now['classic:sim-101'].winner = 'a1';
  assert.equal(snapshotDifferences(base, now).length, 2);
  delete now['classic:sim-202'];
  assert.throws(() => snapshotDifferences(base, now), /missing/);
});

for (const fixture of ['missing', 'empty', 'invalid JSON']) {
  test(`verify and snapshot check fail before simulation when the baseline is ${fixture}`, () => {
    const folder = mkdtempSync(join(tmpdir(), 'emberfall-snapshot-'));
    try {
      const baseline = join(folder, 'tests', 'baselines', 'state-baseline.json');
      mkdirSync(dirname(baseline), { recursive: true });
      if (fixture !== 'missing') writeFileSync(baseline, fixture === 'empty' ? '{}' : '{');
      const verify = spawnSync(process.execPath, [fileURLToPath(new URL('./verify.mjs', import.meta.url))],
        { cwd: folder, encoding: 'utf8', timeout: 10000 });
      assert.equal(verify.status, 1, verify.stderr || verify.error?.message);
      assert.match(verify.stderr, /FAIL baseline:/);
      assert.doesNotMatch(verify.stdout, /1\/6 unit tests|PASSED|SKIP/);
      const check = spawnSync(process.execPath, [fileURLToPath(new URL('./state-snapshot.mjs', import.meta.url)), 'check', baseline],
        { cwd: folder, encoding: 'utf8', timeout: 10000 });
      assert.equal(check.status, 1, check.stderr || check.error?.message);
      assert.match(check.stderr, /FAIL:/);
      assert.doesNotMatch(check.stdout, /byte-identical/);
    } finally {
      // Only remove the exact temporary directory returned for this test.
      assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
      assert.ok(basename(folder).startsWith('emberfall-snapshot-'));
      rmSync(folder, { recursive: true, force: true });
    }
  });
}
