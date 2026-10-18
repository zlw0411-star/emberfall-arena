// 模式注册表契约测试。
//
// 背景：重构前 `mode === 'melee'` 这类判断散落在 5 个模块共 18 处，
// 且 combat.js 靠 `getSkills(game) === MELEE_SKILLS` 这种对象身份比较分流。
// 新增第三种玩法时必须改全 18 处，漏一处就静默走错分支。
//
// 这些断言验证：模式的所有差异都能从 MODES 声明里读出来，
// 并且注册一个新的、声明完整的模式后，各模块确实按新声明工作。
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODES, DEFAULT_MODE, MELEE_BALANCE,
  normalizeMode, modeOf, weaponTypeOf, usesMeleeActions,
  registerMode, unregisterMode,
} from '../dist/js/modes.js';
import {
  SKILLS, MELEE_SKILLS, getSkills, configureActorForMode, createActor, castSkill,
} from '../dist/js/combat.js';
import { createGame, stepGame } from '../dist/js/simulation.js';
import { think } from '../dist/js/ai.js';

const map = { width: 600, height: 400, obstacles: [], traps: [] };

function pointerArena(mode) {
  const game = createGame(`pointer-registry-${mode}`, { mode });
  const actor = configureActorForMode(createActor('attacker', '刀手', 200, 200, true), mode);
  const target = createActor('target', '目标', 200, 150, true);
  target.attackTimer = Infinity;
  Object.assign(game, { map, phase: 'hunt', time: 100, actors: [actor, target], monsters: [], gems: [], bullets: [], effects: [], events: [] });
  return { game, actor, target };
}

test('every mode declares the complete key set the modules consume', () => {
  const required = [
    'id', 'name', 'description', 'controls', 'weaponType',
    'skillsKey', 'combatKey', 'aiKey',
    'usesPointerAttack', 'bodyClass', 'attackControlHtml', 'portraitPose',
    'damageLabel', 'damageDisplayMultiplier',
  ];
  for (const [key, mode] of Object.entries(MODES)) {
    for (const field of required) {
      assert.ok(field in mode, `mode ${key} missing declaration: ${field}`);
    }
    assert.equal(mode.id, key, `mode ${key} has mismatched id ${mode.id}`);
    assert.equal(typeof mode.usesPointerAttack, 'boolean');
    assert.equal(typeof mode.damageDisplayMultiplier, 'number');
  }
});

test('mode declarations point at existing behaviour tables', () => {
  for (const mode of Object.values(MODES)) {
    const catalog = getSkills(mode.id);
    assert.ok(catalog, `mode ${mode.id} skillsKey ${mode.skillsKey} has no catalog`);
    assert.ok(Object.keys(catalog).length > 0);
    // 每个声明都必须能真的配置出一个合法角色
    const actor = configureActorForMode(createActor('a', 'n', 10, 10), mode.id);
    assert.equal(actor.weaponType, mode.weaponType);
    if (mode.weaponType === 'sword') {
      assert.equal(actor.meleeAction, null);
      assert.equal(actor.attackRange, MELEE_BALANCE.range);
      assert.equal(actor.attackInterval, MELEE_BALANCE.interval);
    }
  }
});

test('normalizeMode falls back to the declared default for unknown input', () => {
  assert.equal(normalizeMode('classic'), 'classic');
  assert.equal(normalizeMode('melee'), 'melee');
  for (const bad of ['', 'nope', null, undefined, 0, {}]) {
    assert.equal(normalizeMode(bad), DEFAULT_MODE);
  }
  assert.equal(modeOf('nope').id, DEFAULT_MODE);
});

test('getSkills routes by skillsKey rather than object identity', () => {
  assert.equal(getSkills('classic'), SKILLS);
  assert.equal(getSkills('melee'), MELEE_SKILLS);
  // game 形状
  assert.equal(getSkills({ mode: 'classic' }), SKILLS);
  assert.equal(getSkills({ mode: 'melee' }), MELEE_SKILLS);
  // actor 形状（兼容旧的 weaponType 推断）
  assert.equal(getSkills({ weaponType: 'ranged' }), SKILLS);
  assert.equal(getSkills({ weaponType: 'sword' }), MELEE_SKILLS);
  // 未知模式必须落回默认目录，而不是 undefined
  assert.equal(getSkills({ mode: 'unknown-mode' }), SKILLS);
});

test('castSkill dispatches by combatKey, not by comparing skill catalogs', () => {
  for (const mode of ['classic', 'melee']) {
    const game = createGame(`dispatch-${mode}`, { mode });
    const actor = configureActorForMode(createActor('a0', 't', 200, 200, true, '#fff'), mode);
    Object.assign(game, { map, phase: 'hunt', time: 50, actors: [actor], monsters: [], gems: [], bullets: [], effects: [], events: [] });
    const activeId = Object.entries(getSkills(mode)).find(([, def]) => def.type === 'active')[0];
    actor.skills[activeId] = 1;
    actor.activeSkills = [activeId];
    actor.cooldowns[activeId] = 0;
    assert.equal(castSkill(game, actor, 0, actor.x + 60, actor.y), true, `${mode} failed to cast ${activeId}`);
    // 冷却必须被消耗
    assert.ok(actor.cooldowns[activeId] > 0, `${mode} did not spend cooldown`);
  }
});

test('AI dispatch reads aiKey and both modes produce a usable command', () => {
  for (const mode of ['classic', 'melee']) {
    const game = createGame(`ai-${mode}`, { mode });
    game.phase = 'hunt';
    game.time = 100;
    const actor = game.actors[1];
    const command = think(game, actor, 1 / 60);
    assert.ok(Number.isFinite(command.mx) && Number.isFinite(command.my), `${mode} produced non-finite movement`);
    assert.ok(Number.isFinite(command.aimX) && Number.isFinite(command.aimY), `${mode} produced non-finite aim`);
    assert.ok(['number', 'undefined'].includes(typeof command.castSlot));
  }
});

test('pointer attack flag is declared, not inferred from the mode name', async () => {
  assert.equal(MODES.classic.usesPointerAttack, false);
  assert.equal(MODES.melee.usesPointerAttack, true);
  // 模拟层只按这个标志决定是否把 attackHeld / aim 写入 actor
  const { stepGame } = await import('../dist/js/simulation.js');
  for (const mode of ['classic', 'melee']) {
    const game = createGame(`pointer-${mode}`, { mode });
    game.phase = 'hunt';
    const actor = game.actors[0];
    actor.isPlayer = true;
    // 只对近战预设 aimAngle，避免远程分支被自己的预置值混淆
    if (MODES[mode].usesPointerAttack) actor.aimAngle = 0;
    stepGame(game, 1 / 60, { aimX: actor.x, aimY: actor.y - 100, attackHeld: true, attackPressed: true, mx: 0, my: 0, castSlot: -1 });
    if (MODES[mode].usesPointerAttack) {
      // 向上瞄准 -> aimAngle 应约为 -PI/2
      assert.ok(Math.abs(actor.aimAngle - -Math.PI / 2) < 1e-6, `${mode} did not adopt pointer aim`);
    } else {
      assert.equal(actor.aimAngle, undefined, `${mode} should not store aimAngle`);
      assert.equal(actor.attackHeld, undefined, `${mode} should not store attackHeld`);
    }
  }
});

test('registering a third mode requires no new branch in the modules', async () => {
  // 第三种玩法的声明：技能目录与行为表都复用现有的，只换声明。
  // 若各模块仍散落 mode 字面量判断，这个模式会走错分支或直接崩。
  const { stepGame } = await import('../dist/js/simulation.js');
  registerMode({
    ...MODES.classic,
    id: 'trial',
    name: '试炼模式',
    description: '测试用第三模式',
    weaponType: 'ranged',
    skillsKey: 'classic',
    combatKey: 'classic',
    aiKey: 'classic',
    usesPointerAttack: false,
    bodyClass: '',
  });
  try {
    const game = createGame('third-mode', { mode: 'trial' });
    assert.equal(game.mode, 'trial', 'unknown mode should not be silently downgraded');
    assert.equal(getSkills(game), SKILLS);
    for (const actor of game.actors) {
      assert.equal(actor.weaponType, 'ranged');
      assert.equal(actor.meleeAction, undefined, 'ranged mode must not get melee state');
    }
    game.phase = 'hunt';
    for (const actor of game.actors) actor.isPlayer = false;
    // 跑 600 步，确认没有分支因未知模式而崩
    for (let i = 0; i < 600; i++) stepGame(game, 1 / 60, { autoPlayer: true });
    assert.ok(Number.isFinite(game.time) && game.time > 0);
  } finally {
    unregisterMode('trial');
  }
  assert.equal(Object.hasOwn(MODES, 'trial'), false, 'cleanup failed');
});

test('a melee mode registered after simulation import accepts clicks and held attacks', () => {
  const id = 'pointer-melee';
  registerMode({ ...MODES.melee, id });
  try {
    const { game, actor, target } = pointerArena(id);
    const aim = { aimX: actor.x, aimY: actor.y - 100 };
    stepGame(game, 1 / 60, { ...aim, attackPressed: true, attackHeld: false });
    assert.ok(Math.abs(actor.aimAngle + Math.PI / 2) < 1e-6, 'registered mode ignored upward aim');
    assert.equal(actor.meleeAction?.kind, 'basic', 'a click did not start a swing');
    const firstAction = actor.meleeAction.id;
    for (let i = 0; i < 45; i++) stepGame(game, 1 / 60, { ...aim, attackHeld: true });
    assert.equal(actor.attackHeld, true);
    assert.equal(actor.meleeAction?.kind, 'basic', 'holding attack did not start another swing');
    assert.notEqual(actor.meleeAction.id, firstAction);
    assert.ok(target.hp < target.maxHp, 'registered melee attacks never damaged the target');
  } finally {
    unregisterMode(id);
  }
});

test('a registered melee mode passes AI attack input into combat', () => {
  const id = 'pointer-melee-ai';
  registerMode({ ...MODES.melee, id });
  try {
    const { game, actor, target } = pointerArena(id);
    actor.isPlayer = false;
    stepGame(game, 1 / 60);
    assert.equal(actor.attackHeld, true, 'AI attack input was dropped');
    assert.ok(Math.abs(actor.aimAngle + Math.PI / 2) < 1e-6);
    assert.equal(actor.meleeAction?.kind, 'basic');
    for (let i = 0; i < 15; i++) stepGame(game, 1 / 60);
    assert.ok(target.hp < target.maxHp, 'AI swing never damaged its nearby target');
  } finally {
    unregisterMode(id);
  }
});

test('pointer input follows the latest registered flag, including disabling it', () => {
  const id = 'pointer-toggle';
  registerMode({ ...MODES.melee, id, usesPointerAttack: false });
  try {
    const { game, actor } = pointerArena(id);
    const input = { aimX: actor.x, aimY: actor.y - 100, attackPressed: true, attackHeld: true };
    stepGame(game, 1 / 60, input);
    assert.equal(actor.aimAngle, 0);
    assert.equal(actor.attackHeld, false);
    assert.equal(actor.meleeAction, null);

    registerMode({ ...MODES[id], usesPointerAttack: true });
    stepGame(game, 1 / 60, input);
    assert.ok(Math.abs(actor.aimAngle + Math.PI / 2) < 1e-6, 'overwriting the flag did not enable pointer input');
    assert.equal(actor.attackHeld, true);
    assert.equal(actor.meleeAction?.kind, 'basic');

    registerMode({ ...MODES[id], usesPointerAttack: false });
    const disabled = pointerArena(id);
    stepGame(disabled.game, 1 / 60, input);
    assert.equal(disabled.actor.aimAngle, 0, 'overwriting the flag did not disable pointer aim');
    assert.equal(disabled.actor.attackHeld, false);
    assert.equal(disabled.actor.meleeAction, null);

    registerMode({ ...MODES.classic, id });
    const ranged = pointerArena(id);
    stepGame(ranged.game, 1 / 60, input);
    assert.equal(ranged.actor.aimAngle, undefined);
    assert.equal(ranged.actor.attackHeld, undefined);
    assert.equal(ranged.actor.attackPressed, undefined);
  } finally {
    unregisterMode(id);
  }
});

test('registerMode rejects incomplete definitions instead of leaving a half mode', () => {
  const base = {
    id: 'broken', name: 'x', description: 'x', controls: 'x', weaponType: 'ranged',
    skillsKey: 'classic', combatKey: 'classic', aiKey: 'classic',
    usesPointerAttack: false, bodyClass: '', attackControlHtml: 'x', portraitPose: null,
    damageLabel: 'x', damageDisplayMultiplier: 1,
  };
  // 完整定义可以注册
  registerMode(base);
  assert.equal(normalizeMode('broken'), 'broken');
  unregisterMode('broken');
  // 缺任意一个字段都必须在注册阶段就失败
  for (const field of Object.keys(base)) {
    const partial = { ...base, id: `broken-${field}` };
    delete partial[field];
    assert.throws(() => registerMode(partial), TypeError, `missing ${field} was accepted`);
    assert.equal(Object.hasOwn(MODES, `broken-${field}`), false, `${field} left a partial mode behind`);
  }
  // 默认模式不允许注销
  assert.throws(() => unregisterMode(DEFAULT_MODE), Error);
});
