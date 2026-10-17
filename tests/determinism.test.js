// 确定性红线测试。
//
// 背景：以前三处随机数都写成 `game?.rng || Math.random`，
// 漏传 game.rng 时会静默降级成不可复现的随机源 —— 没有任何现有测试会因此变红，
// 但「同种子逐帧全等」的验收会失效。本文件把这些缺口钉死成可执行的断言。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as world from '../dist/js/world.js';
import { createActor, getChoices, dropGem, PROGRESSION } from '../dist/js/combat.js';
import { createGame, stepGame } from '../dist/js/simulation.js';

const { randomFree, rngFromSeed, generateMap } = world;

test('randomFree refuses to fall back to Math.random', () => {
  const map = { width: 300, height: 300, obstacles: [], traps: [] };
  assert.throws(() => randomFree(map), TypeError, 'missing rng should throw');
  assert.throws(() => randomFree(map, undefined, 24), TypeError);
  assert.throws(() => randomFree(map, null, 24), TypeError);
  // 传入确定性 rng 时正常工作
  const point = randomFree(map, rngFromSeed('rng-contract'), 24);
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
});

test('randomFree is reproducible for the same seed and diverges across seeds', () => {
  const map = generateMap('rng-reproduce');
  const a = randomFree(map, rngFromSeed('pick'), 24);
  const b = randomFree(map, rngFromSeed('pick'), 24);
  assert.deepEqual(a, b);
  const c = randomFree(map, rngFromSeed('other'), 24);
  assert.notDeepEqual(a, c);
});

test('skill choices require game.rng and do not silently use Math.random', () => {
  const actor = createActor('a0', '测试', 100, 100, true, '#fff');
  actor.pendingChoices = 1;
  // 没有 rng 的游戏对象必须报错，而不是偷偷用 Math.random
  const noRng = { actors: [actor], time: 0, events: [], effects: [] };
  assert.throws(() => getChoices(noRng, actor), TypeError);
  // 有 rng 时正常返回三选一
  const withRng = { actors: [actor], time: 0, events: [], effects: [], rng: () => 0 };
  assert.equal(getChoices(withRng, actor).length, 3);
});

test('brute healing gem drop requires game.rng', () => {
  const game = { actors: [], monsters: [], gems: [], time: 0, events: [], effects: [], nextId: 1 };
  const brute = { id: 7, type: 'brute', x: 100, y: 100, xp: 25 };
  assert.throws(() => dropGem(game, brute, 10), TypeError, 'missing rng should throw');
  const withRng = { ...game, rng: () => 0 };
  dropGem(withRng, brute, 10);
  // rng 返回 0 < 0.28，所以巨兽额外掉一颗治疗晶体
  assert.equal(withRng.gems.filter((gem) => gem.kind === 'heal').length, 1);
});

test('a full match remains reproducible because every random draw is seeded', () => {
  // 把「确定性」从口头约定变成可执行事实：同种子两次跑完整局，序列化状态必须一致。
  const clean = (game) => JSON.stringify(game, (key, value) => {
    if (['meleeVisuals', 'hitFlash', 'effects'].includes(key)) return undefined;
    return value instanceof Set ? [...value] : value;
  });
  for (const mode of ['classic', 'melee']) {
    const runOnce = () => {
      const game = createGame('determinism-contract', { mode });
      for (const actor of game.actors) actor.isPlayer = false;
      let steps = 0;
      // 跑 150 秒：已经越过 90 秒保护期、经历多次升级选技和怪物掉落，
      // 足够暴露任何 Math.random 泄漏，又不会把常规测试拖慢到十秒级。
      while (!game.result && steps < 60 * 150) {
        stepGame(game, 1 / 60, { autoPlayer: true });
        steps++;
      }
      return { steps, state: clean(game) };
    };
    const first = runOnce();
    const second = runOnce();
    assert.equal(first.steps, second.steps, `${mode}: step count diverged`);
    assert.equal(first.state, second.state, `${mode}: serialized state diverged`);
  }
});
