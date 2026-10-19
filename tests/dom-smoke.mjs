// DOM 冒烟测试：模拟全等不覆盖 app.js / renderer.js 的 DOM 路径，
// 这里用一个最小 DOM + Canvas mock 把真实入口跑起来，抓运行时错误。
import assert from 'node:assert/strict';

const errors = [];
const calls = { fillRect: 0, arc: 0, fillText: 0, stroke: 0, drawImage: 0 };

function makeCtx() {
  const noop = () => {};
  return new Proxy({
    canvas: null,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    measureText: (text) => ({ width: String(text).length * 6 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    fillRect: () => { calls.fillRect++; },
    arc: () => { calls.arc++; },
    fillText: () => { calls.fillText++; },
    stroke: () => { calls.stroke++; },
    fill: noop, save: noop, restore: noop, beginPath: noop, closePath: noop,
    moveTo: noop, lineTo: noop, rect: noop, ellipse: noop, translate: noop,
    scale: noop, rotate: noop, setLineDash: noop, clearRect: noop,
    strokeRect: () => { calls.strokeRect = (calls.strokeRect ?? 0) + 1; },
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    textAlign: 'left', globalAlpha: 1, imageSmoothingEnabled: false,
    drawImage: () => { calls.drawImage++; },
    setTransform: noop, clip: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
  }, {
    get(target, key) {
      if (key in target) return target[key];
      // 未知的 canvas API 一律当 noop，但属性赋值要能存住
      return undefined;
    },
    set(target, key, value) { target[key] = value; return true; },
  });
}

// 元素注册表：任何 id 都能拿到一个可用的伪元素
const elements = new Map();
function makeElement(id = '') {
  const el = {
    id, dataset: {}, style: {}, classList: {
      _set: new Set(),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, on) { if (on === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (on) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    children: [], textContent: '', innerHTML: '',
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    _handlers: {},
    addEventListener(type, fn) { (this._handlers[type] ??= []).push(fn); },
    removeEventListener() {},
    dispatch(type, event = {}) {
      for (const fn of this._handlers[type] ?? []) fn({ preventDefault() {}, ...event });
      const handler = this[`on${type}`];
      if (typeof handler === 'function') handler({ preventDefault() {}, ...event });
      return event;
    },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    appendChild() {}, focus() {}, blur() {}, click() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    querySelectorAll: () => [], querySelector: () => null, closest: () => null,
    getContext: () => makeCtx(),
    _captures: new Set(),
    setPointerCapture(id) { this._captures.add(id); },
    releasePointerCapture(id) { this._captures.delete(id); },
    hasPointerCapture(id) { return this._captures.has(id); },
    tabIndex: 0,
  };
  elements.set(id, el);
  return el;
}

// 模式选择卡：app.js/overlays.js 会用 querySelectorAll('[data-mode]') 遍历并绑定 onclick
const modeCards = new Map();
const weaponCards = new Map();
const mapCards = new Map();
function makeWeaponCard(weapon) {
  if (!weaponCards.has(weapon)) {
    const card = makeElement(`weapon-card-${weapon}`);
    card.dataset.weapon = weapon;
    weaponCards.set(weapon, card);
  }
  return weaponCards.get(weapon);
}
function makeMapCard(mapId) {
  if (!mapCards.has(mapId)) {
    const card = makeElement(`map-card-${mapId}`);
    card.dataset.map = mapId;
    mapCards.set(mapId, card);
  }
  return mapCards.get(mapId);
}
function makeModeCard(mode) {
  if (!modeCards.has(mode)) {
    const card = makeElement(`mode-card-${mode}`);
    card.dataset.mode = mode;
    modeCards.set(mode, card);
  }
  return modeCards.get(mode);
}

globalThis.document = {
  getElementById(id) { return elements.get(id) ?? makeElement(id); },
  querySelectorAll(selector) {
    if (selector === '[data-mode]') return [...modeCards.values()];
    if (selector === '[data-weapon]') return [...weaponCards.values()];
    if (selector === '[data-map]') return [...mapCards.values()];
    return [];
  },
  querySelector: () => null,
  createElement(tag) {
    const el = makeElement(`created-${tag}`);
    el.tagName = tag.toUpperCase();
    return el;
  },
  _handlers: {},
  addEventListener(type, fn) { (this._handlers[type] ??= []).push(fn); },
  dispatch(type, event = {}) { for (const fn of this._handlers[type] ?? []) fn({ preventDefault() {}, ...event }); },
  body: makeElement('body'),
  hidden: false,
};
globalThis.window = {
  _handlers: {},
  addEventListener(type, fn) { (this._handlers[type] ??= []).push(fn); },
  removeEventListener() {},
  dispatch(type, event = {}) { for (const fn of this._handlers[type] ?? []) fn({ preventDefault() {}, ...event }); },
  devicePixelRatio: 1,
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  focus() {},
};
// 捕获 rAF 回调，改由本脚本手动推进，从而真实跑主循环。
let pendingFrame = null;
globalThis.requestAnimationFrame = (cb) => { pendingFrame = cb; return 1; };
globalThis.cancelAnimationFrame = () => { pendingFrame = null; };
// performance.now() 和 rAF 共用单调时钟，重开不会跳回真实时间。
let frameTime = 0;
globalThis.performance = { now: () => frameTime };
globalThis.setTimeout = globalThis.setTimeout ?? (() => 0);
globalThis.clearTimeout = globalThis.clearTimeout ?? (() => {});
globalThis.AudioContext = class { constructor() { throw new Error('audio disabled in smoke test'); } };

// 未捕获异常必须让脚本以非零退出，否则 CI/verify 会误判通过。
process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT:', e.message);
  errors.push(e);
  process.exitCode = 1;
});
process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED REJECTION:', e?.message ?? e);
  errors.push(e);
  process.exitCode = 1;
});

// 模拟 HTML 里预先存在的模式选择卡（必须在 import 之前，
// 因为 app.js 顶层就会 bind() 并遍历 querySelectorAll('[data-mode]')）
makeModeCard('classic');
makeModeCard('melee');
makeModeCard('boss');
makeWeaponCard('classic');
makeWeaponCard('melee');
for (const mapId of ['courtyard', 'desert', 'frost', 'swamp', 'random']) makeMapCard(mapId);

// 加载真实入口；它会在模块顶层查询 DOM 并注册事件
await import('../dist/js/app.js');

// ---- 驱动真实主循环 ----------------------------------------------------
const { Renderer } = await import('../dist/js/renderer.js');
const { createGame, stepGame, CONFIG } = await import('../dist/js/simulation.js');
const { damage } = await import('../dist/js/combat.js');
const { BOSS_CONFIG } = await import('../dist/js/boss-config.js');

/** 推进 n 帧（每帧 16.7ms），让 app.js 自己的 frame() 跑起来。 */
function pumpFrames(n) {
  for (let i = 0; i < n; i++) {
    if (typeof pendingFrame !== 'function') throw new Error('主循环未注册 requestAnimationFrame');
    const cb = pendingFrame;
    pendingFrame = null;
    frameTime += 1000 / 60;
    cb(frameTime);
    assert.equal(typeof pendingFrame, 'function', '本帧结束后必须继续注册 requestAnimationFrame');
  }
}

const debug = globalThis.window.__emberfall;
if (!debug) errors.push(new Error('app.js 未暴露 __emberfall 调试入口，说明入口模块没有正常执行'));
const $game = document.getElementById('game');

// 主菜单阶段：先跑几帧，确认未开局时不崩
try { pumpFrames(5); } catch (e) { errors.push(new Error(`主菜单帧循环失败: ${e.message}`)); }

// 开始经典模式：点开始按钮，然后跑 3 秒（约 180 帧）
try {
  document.getElementById('start-button').dispatch('click');
  const game = debug.state.game;
  if (!debug.state.started) errors.push(new Error('点击开始后 started 仍为 false'));
  if (game.mode !== 'classic') errors.push(new Error(`默认模式应为 classic，实际 ${game.mode}`));
  const before = game.time;
  pumpFrames(180);
  if (!(game.time > before)) errors.push(new Error(`经典模式主循环未推进模拟时间 (${before} -> ${game.time})`));
  // HUD 必须真的写到 DOM 上
  const clock = document.getElementById('clock').textContent;
  if (!/^\d{2}:\d{2}$/.test(clock)) errors.push(new Error(`时钟格式异常: ${clock}`));
  const roster = document.getElementById('roster').innerHTML;
  if (!roster.includes('roster-row')) errors.push(new Error('名册未渲染'));
} catch (e) { errors.push(new Error(`经典模式驱动失败: ${e.message}`)); }

// 暂停 / 继续
try {
  const game = debug.state.game;
  document.getElementById('pause-button').dispatch('click');
  if (!game.paused) errors.push(new Error('暂停按钮未生效'));
  const t = game.time;
  pumpFrames(60);
  if (game.time !== t) errors.push(new Error('暂停后模拟时间仍在推进'));
  document.getElementById('pause-button').dispatch('click');
  if (game.paused) errors.push(new Error('继续按钮未生效'));
} catch (e) { errors.push(new Error(`暂停流程失败: ${e.message}`)); }

// 键盘移动
try {
  const game = debug.state.game;
  const player = game.actors[0];
  const x0 = player.x;
  window.dispatch('keydown', { key: 'd' });
  pumpFrames(30);
  window.dispatch('keyup', { key: 'd' });
  if (!(player.x > x0)) errors.push(new Error(`按 D 后未向右移动 (${x0} -> ${player.x})`));
} catch (e) { errors.push(new Error(`键盘输入失败: ${e.message}`)); }

// 返回菜单，再切到近战模式开始一局
try {
  document.getElementById('menu-pause').dispatch('click');
  if (debug.state.started) errors.push(new Error('返回菜单后 started 仍为 true'));
  pumpFrames(3);
} catch (e) { errors.push(new Error(`返回菜单失败: ${e.message}`)); }

// 通过模式卡切到近战（模拟真实点击路径）
try {
  const card = makeModeCard('melee');
  card.dispatch('click');
  if (debug.state.selectedMode !== 'melee') errors.push(new Error(`切模式失败: ${debug.state.selectedMode}`));
  document.getElementById('start-button').dispatch('click');
  const game = debug.state.game;
  if (game.mode !== 'melee') errors.push(new Error(`近战开局模式错误: ${game.mode}`));
  const player = game.actors[0];
  if (player.weaponType !== 'sword') errors.push(new Error(`近战角色武器应为 sword，实际 ${player.weaponType}`));
  // 按住左键挥刀：模拟 pointerdown + 多帧
  const before = game.time;
  document.getElementById('game').dispatch('pointerdown', { button: 0, pointerId: 1, clientX: 400, clientY: 300 });
  pumpFrames(90);
  window.dispatch('pointerup', { button: 0 });
  if (!(game.time > before)) errors.push(new Error('近战主循环未推进时间'));
  if (!(player.meleeActionSequence > 0)) errors.push(new Error('按住左键未产生任何挥刀动作'));
  // 刀光用 crescent() 的 lineTo 多边形绘制，不是 canvas arc()；
  // 这里只确认近战期间确实发生了绘制（fillRect 增长），并记录 lineTo 次数。
  if (!(calls.fillRect > 0)) errors.push(new Error('近战模式未发生任何绘制'));
} catch (e) { errors.push(new Error(`近战驱动失败: ${e.message}`)); }

// 回归：死亡和结算必须经过真实 HUD/帧循环，而非仅调用 Renderer。
const frameDriver = pendingFrame;
function scenario(name, test) {
  // 前一场景若使 rAF 崩溃，仅在场景边界复位测试夹具，让其他分支也能独立报告。
  if (pendingFrame === null) pendingFrame = frameDriver;
  try {
    test();
    console.log(`  ok ${name}`);
  } catch (error) {
    errors.push(new Error(`${name}: ${error.message}`, { cause: error }));
  }
}

const click = (id) => document.getElementById(id).dispatch('click');
const hidden = (id) => document.getElementById(id).classList.contains('hidden');

function startMode(mode) {
  click('menu-pause');
  makeModeCard(mode).dispatch('click');
  click('start-button');
  assert.equal(debug.state.game.mode, mode);
  assert.equal(debug.state.started, true);
  return debug.state.game;
}

function holdInput(game) {
  window.dispatch('keydown', { key: 'd' });
  window.dispatch('keydown', { key: 'q' });
  $game.dispatch('pointerdown', { button: 0, pointerId: 7, clientX: 500, clientY: 300 });
  assert.equal(debug.state.keys.has('d'), true);
  assert.equal(debug.state.castSlot, 0);
  if (game.mode === 'melee') assert.equal($game.hasPointerCapture(7), true);
}

function assertInputCleared(game) {
  assert.equal(debug.state.keys.size, 0, '方向键状态必须清空');
  assert.equal(debug.state.castSlot, -1, '待释放技能必须清空');
  assert.equal(game.actors[0].attackHeld, false, '角色持续攻击状态必须清空');
  assert.equal(game.actors[0].attackPressed, false, '角色攻击边沿必须清空');
  assert.equal($game._captures.size, 0, '持续攻击必须释放指针捕获');
}

function assertFreshGame(mode, button) {
  const oldGame = debug.state.game;
  click(button);
  const game = debug.state.game;
  assert.notEqual(game, oldGame, '重开必须创建新对局');
  assert.equal(game.mode, mode, '重开必须保留当前模式');
  assert.equal(debug.state.started, true);
  assert.equal(game.paused, false);
  assert.equal(game.result, null);
  assert.equal(game.time, 0);
  assert.equal(debug.state.spectateId, null);
  assert.equal(debug.state.deathDismissed, false);
  assert.equal(document.getElementById('game-shell').classList.contains('spectating'), false);
  for (const id of ['start-overlay', 'death-card', 'result-overlay', 'pause-overlay']) {
    assert.equal(hidden(id), true, `重开后必须隐藏 ${id}`);
  }
  const x = game.actors[0].x;
  const y = game.actors[0].y;
  pumpFrames(8);
  assert.ok(game.time > 0 && game.time < 0.2, '新局必须从零正常推进');
  assert.equal(game.actors[0].x, x, '重开不能继承移动键');
  assert.equal(game.actors[0].y, y, '重开不能继承移动键');
  if (mode === 'melee') assert.equal(game.actors[0].meleeActionSequence || 0, 0, '重开不能继承按住挥刀');
  return game;
}

function assertMenuRecovery(mode) {
  click('pause-button');
  assert.equal(debug.state.game.paused, true);
  click('menu-pause');
  assert.equal(debug.state.started, false);
  assert.equal(hidden('start-overlay'), false);
  const menuGame = debug.state.game;
  pumpFrames(8);
  assert.equal(menuGame.time, 0, '主菜单不能推进对局');
  assertFreshGame(mode, 'start-button');
}

const { BIOMES, biomeOf } = await import('../dist/js/biomes.js');
for (const mode of ['classic', 'melee']) for (const mapId of Object.keys(BIOMES)) {
  scenario(`${mode}/${mapId}: 地图选择、模式切换、地图锁定与重开`, () => {
    click('menu-pause');
    makeMapCard(mapId).dispatch('click');
    makeModeCard(mode).dispatch('click');
    assert.equal(debug.state.selectedMap, mapId);
    assert.equal(biomeOf(debug.state.game.map).id, mapId, '切换玩法不能丢失地图选择');
    assert.equal(mapCards.get(mapId).classList.contains('selected'), true);
    click('start-button');
    pumpFrames(8);
    const game = debug.state.game;
    assert.equal(biomeOf(game.map).id, mapId);
    assert.equal(document.getElementById('world-map-name').textContent, BIOMES[mapId].name);
    assert.equal(document.getElementById('result-map').textContent, BIOMES[mapId].name);
    makeMapCard(mapId === 'desert' ? 'frost' : 'desert').dispatch('click');
    assert.equal(debug.state.game, game, '开局后地图不可切换');
    click('pause-button');
    assertFreshGame(mode, 'restart-pause');
    assert.equal(biomeOf(debug.state.game.map).id, mapId, '重开应保留指定地图');
    assertMenuRecovery(mode);
    assert.equal(biomeOf(debug.state.game.map).id, mapId);
  });
}
scenario('随机地图：显示实际地图且菜单保留随机选项', () => {
  click('menu-pause');
  makeMapCard('random').dispatch('click');
  click('start-button');
  pumpFrames(8);
  assert.equal(debug.state.selectedMap, 'random');
  const actual = biomeOf(debug.state.game.map);
  assert.ok(Object.hasOwn(BIOMES, actual.id));
  assert.equal(document.getElementById('world-map-name').textContent, actual.name);
  assertMenuRecovery(debug.state.game.mode);
  assert.equal(debug.state.selectedMap, 'random');
});
// 后面的死亡/结算回归继续使用原庭院，不与地图选择场景互相污染。
click('menu-pause');
makeMapCard('courtyard').dispatch('click');

for (const mode of ['classic', 'melee']) {
  scenario(`${mode}: 新技能卡选择不停战、键盘施放与护盾HUD`, () => {
    const game = startMode(mode);
    const player = game.actors[0];
    const ids = mode === 'classic' ? ['chainLightning', 'frostNova'] : ['piercingThrust', 'bladeWard'];
    for (const id of ids) {
      player.pendingChoices = 1;
      player.choices = [id, 'precision', 'focus'];
      pumpFrames(8);
      assert.equal(hidden('choices'), false);
      assert.match(document.getElementById('choices').innerHTML, new RegExp(`data-choice="0"`));
      assert.equal(game.paused, false);
      const before = { time: game.time, x: player.x, y: player.y };
      window.dispatch('keydown', { key: 'd' });
      document.getElementById('choices').dispatch('click', { target: { closest: () => ({ dataset: { choice: '0' } }) } });
      pumpFrames(8);
      window.dispatch('keyup', { key: 'd' });
      assert.ok(game.time > before.time, '选择技能不能暂停模拟');
      assert.ok(player.x !== before.x || player.y !== before.y, '选择技能期间仍可移动');
      assert.equal(player.skills[id], 1);
      assert.equal(Boolean(player.attackHeld), false, '选择卡片不能触发普通挥刀');
      assert.match(document.getElementById('skills-bar').innerHTML, new RegExp(ids.indexOf(id) ? '冰霜新星|护体刀阵' : '闪电链|穿云刺'));
    }
    // 在安全出生点附近放置一个耐打目标，用真实键盘入口触发两个新主动。
    game.monsters = [{ id: 'smoke-skill-target', type: 'slime', x: player.x + 65, y: player.y,
      radius: 11, hp: 1000, maxHp: 1000, alive: true, speed: 1, damage: 0, xp: 0, attackTimer: 99 }];
    const enemy = game.monsters[0];
    window.dispatch('keydown', { key: 'q' });
    pumpFrames(40);
    window.dispatch('keyup', { key: 'q' });
    assert.ok(player.cooldowns[ids[0]] > 0, 'Q必须施放新技能');
    if (mode === 'classic') assert.ok(enemy.hp < 1000, '闪电链必须命中目标');
    window.dispatch('keydown', { key: 'e' });
    pumpFrames(8);
    window.dispatch('keyup', { key: 'e' });
    assert.ok(player.cooldowns[ids[1]] > 0, 'E必须施放新技能');
    if (mode === 'melee') {
      assert.ok(player.shieldHp > 0);
      assert.match(document.getElementById('hp-text').textContent, /盾/);
    } else assert.ok(enemy.slowUntil > game.time, '冰环减速应生效');
    assert.equal(game.paused, false);
    assertMenuRecovery(mode);
  });
}

for (const mode of ['classic', 'melee']) {
  scenario(`${mode}: 死亡清空输入、观战继续、重开与返回菜单恢复`, () => {
    let game = startMode(mode);
    holdInput(game);
    game.actors[0].alive = false;
    game.actors[0].hp = 0;
    pumpFrames(8);
    assert.equal(game.result, null);
    assertInputCleared(game);
    assert.equal(hidden('death-card'), false);
    assert.equal(hidden('result-overlay'), true);
    assert.equal(document.getElementById('game-shell').classList.contains('spectating'), true);
    // 在死亡卡仍可见时重开，再经历一次死亡测试观战分支。
    game = assertFreshGame(mode, 'restart-death');
    holdInput(game);
    game.actors[0].alive = false;
    game.actors[0].hp = 0;
    pumpFrames(8);
    assertInputCleared(game);
    assert.equal(hidden('death-card'), false);
    const living = game.actors.filter((actor) => actor.alive);
    assert.equal(debug.state.spectateId, living[0].id, '死亡后自动跟随存活旅者');
    click('spectate-button');
    assert.equal(debug.state.deathDismissed, true);
    const row = { dataset: { actor: living[1].id } };
    document.getElementById('roster').dispatch('click', { target: { closest: () => row } });
    const before = game.time;
    pumpFrames(16);
    assert.ok(game.time > before, '观战必须继续推进模拟');
    assert.equal(debug.state.spectateId, living[1].id, '点击名册必须切换观战目标');
    assert.equal(hidden('death-card'), true, '关闭死亡卡后不能再次弹出');
    assertMenuRecovery(mode);
  });

  for (const outcome of ['win', 'loss', 'draw']) {
    scenario(`${mode}: ${outcome} 结算清空输入、显示浮层且能够重开`, () => {
      const game = startMode(mode);
      holdInput(game);
      // 保留一人由真实 stepGame 判胜；平局用时限风暴在同一步杀死最后两人。
      for (let i = 0; i < game.actors.length; i++) {
        const alive = outcome === 'win' ? i === 0 : outcome === 'loss' ? i === 1 : i < 2;
        game.actors[i].alive = alive;
        game.actors[i].hp = alive ? game.actors[i].maxHp : 0;
      }
      if (outcome === 'draw') game.time = CONFIG.matchLimit - 1 / 120;
      assert.equal(game.result, null);
      pumpFrames(8);
      assert.equal(game.result?.winnerId, outcome === 'win' ? game.actors[0].id : outcome === 'loss' ? game.actors[1].id : null);
      assert.equal(game.actors[0].alive, outcome === 'win');
      assertInputCleared(game);
      assert.equal(hidden('result-overlay'), false);
      assert.equal(hidden('death-card'), true);
      assert.equal(hidden('choices'), true);
      const title = document.getElementById('result-title').textContent;
      assert.equal(title, outcome === 'win' ? '你是最后的微光' : outcome === 'loss' ? `${game.actors[1].name} 赢得试炼` : '余烬之下，无人生还');
      const time = game.time;
      pumpFrames(16);
      assert.equal(game.time, time, '结算后模拟停止但帧循环继续');
      assertFreshGame(mode, 'restart-result');
      assertMenuRecovery(mode);
    });
  }
}

// 首领路径同样通过真实选择卡、HUD 与 rAF 主循环驱动。
function startBoss(weapon = 'classic', mapId = 'courtyard') {
  click('menu-pause');
  makeModeCard('boss').dispatch('click');
  makeWeaponCard(weapon).dispatch('click');
  makeMapCard(mapId).dispatch('click');
  click('start-button');
  const game = debug.state.game;
  assert.equal(game.ruleset, 'boss');
  assert.equal(game.mode, weapon);
  assert.equal(game.actors[0].combatMode, weapon);
  return game;
}

function quietBoss(game) {
  // 缩短测试只改变夹具：保留真实时钟、战斗、生命周期和渲染路径。
  for (const actor of game.actors) {
    actor.isPlayer = true;
    actor.attackTimer = Infinity;
    actor.attackHeld = false;
    actor.attackPressed = false;
  }
  game.monsters = [];
  game.gems = [];
  game.spawnTimer = 0;
  game.gemTimer = 0;
}

scenario('首领：双武器与四地图选择、锁定、重开和返回菜单保留', () => {
  for (const weapon of ['classic', 'melee']) for (const mapId of Object.keys(BIOMES)) {
    const game = startBoss(weapon, mapId);
    pumpFrames(8);
    assert.equal(document.body.classList.contains('rules-boss'), true);
    assert.equal(hidden('boss-weapon-picker'), false);
    assert.equal(modeCards.get('boss').classList.contains('selected'), true);
    assert.equal(weaponCards.get(weapon).classList.contains('selected'), true);
    assert.equal(biomeOf(game.map).id, mapId);
    assert.match(document.getElementById('world-mode').textContent, /首领竞伤/);
    assert.equal(document.getElementById('world-map-name').textContent, BIOMES[mapId].name);
    assert.equal(game.actors.filter(actor => actor.combatMode === 'classic').length, 6);
    assert.equal(game.actors.filter(actor => actor.combatMode === 'melee').length, 6);
    makeWeaponCard(weapon === 'classic' ? 'melee' : 'classic').dispatch('click');
    makeMapCard(mapId === 'frost' ? 'desert' : 'frost').dispatch('click');
    assert.equal(debug.state.game, game, '首领开局后武器与地图均应锁定');
    click('pause-button');
    assertFreshGame(weapon, 'restart-pause');
    assert.equal(debug.state.game.ruleset, 'boss');
    assert.equal(biomeOf(debug.state.game.map).id, mapId);
    assertMenuRecovery(weapon);
    assert.equal(debug.state.selectedRuleset, 'boss');
    assert.equal(debug.state.selectedMode, weapon);
    assert.equal(debug.state.selectedMap, mapId);
    assert.equal(debug.state.game.ruleset, 'boss');
    assert.equal(biomeOf(debug.state.game.map).id, mapId);
  }
});

scenario('首领：85 秒公告、90 秒降临和真实首领面板绘制', () => {
  const game = startBoss();
  quietBoss(game);
  game.time = 84.98;
  pumpFrames(8);
  assert.equal(game.bossNoticeSent, true);
  assert.equal(game.boss, null);
  assert.equal(hidden('zone-banner'), false);
  assert.match(document.getElementById('zone-banner').textContent, /首领降临/);
  assert.equal(game.events.filter(event => /即将降临/.test(event.text)).length, 1);
  game.time = 89.98;
  const drawn = calls.fillRect;
  pumpFrames(8);
  assert.equal(game.phase, 'boss');
  assert.equal(game.boss.isBoss, true);
  assert.equal(hidden('zone-banner'), true);
  assert.equal(hidden('boss-panel'), false);
  assert.equal(hidden('boss-ranking-panel'), false);
  assert.match(document.getElementById('boss-hp-text').textContent, /180,000/);
  assert.match(document.getElementById('boss-ranking').innerHTML, /boss-rank-row/);
  assert.match(document.getElementById('boss-stage').textContent, /阶段 1/);
  assert.ok(calls.fillRect > drawn, '首领出现后真实画布应继续绘制');
  const player = game.actors[0];
  game.boss.nextAttackAt = Infinity;
  player.x = player.prevX = game.boss.x + 120;
  player.y = player.prevY = game.boss.y;
  pumpFrames(8);
  assert.equal(document.getElementById('boss-guard-status').classList.contains('active'), true);
  assert.match(document.getElementById('boss-guard-status').textContent, /生效.*20%/);
  player.x = player.prevX = game.boss.x + 200;
  pumpFrames(8);
  assert.equal(document.getElementById('boss-guard-status').classList.contains('active'), false);
  assert.match(document.getElementById('boss-guard-status').textContent, /160/);
});

scenario('首领：选技不停战、真实死亡保留原卡、自动复活清输入和退出观战', () => {
  const game = startBoss('melee');
  quietBoss(game);
  const player = game.actors[0];
  player.pendingChoices = 1;
  player.choices = ['bladeWard', 'precision', 'focus'];
  pumpFrames(8);
  assert.equal(hidden('choices'), false);
  const time = game.time;
  document.getElementById('choices').dispatch('click', { target: { closest: () => ({ dataset: { choice: '0' } }) } });
  pumpFrames(8);
  assert.equal(player.skills.bladeWard, 1);
  assert.ok(game.time > time);
  assert.equal(game.paused, false);
  assert.equal(player.meleeActionSequence || 0, 0, '选卡不能触发挥刀');
  player.pendingChoices = 1;
  player.choices = ['power', 'vitality', 'focus'];
  pumpFrames(8);
  const cards = [...player.choices];
  const cardHtml = document.getElementById('choices').innerHTML;
  holdInput(game);
  damage(game, player, player.maxHp + 1, { type: 'trap' });
  assert.equal(player.alive, false, '死亡必须由 damage 真实触发');
  assert.deepEqual(player.respawnChoices, { pendingChoices: 1, choices: cards });
  pumpFrames(8);
  assertInputCleared(game);
  assert.equal(hidden('choices'), true);
  assert.equal(hidden('death-card'), false);
  assert.equal(document.getElementById('game-shell').classList.contains('spectating'), true);
  assert.ok(debug.state.spectateId, '等待复活时应自动跟随存活角色');
  click('spectate-button');
  assert.equal(debug.state.deathDismissed, true);
  game.time = player.respawnAt - 0.05;
  // 等待复活时的新输入不能泄漏到复活后的角色。
  window.dispatch('keydown', { key: 'd' });
  pumpFrames(8);
  assert.equal(player.alive, true);
  assert.equal(game.paused, false);
  assertInputCleared(game);
  assert.equal(debug.state.spectateId, null);
  assert.equal(debug.state.deathDismissed, false);
  assert.equal(document.getElementById('game-shell').classList.contains('spectating'), false);
  assert.equal(hidden('death-card'), true);
  assert.equal(hidden('choices'), false);
  assert.equal(player.pendingChoices, 1);
  assert.deepEqual(player.choices, cards);
  assert.equal(document.getElementById('choices').innerHTML, cardHtml);
  assert.ok(player.invulnerableUntil > game.time);
  assert.match(document.getElementById('footer-status').textContent, /重生保护/);
});

scenario('首领：全员倒下仍推进、600 秒无得分结算和击杀后的并列第一', () => {
  let game = startBoss();
  quietBoss(game);
  for (const actor of game.actors) damage(game, actor, actor.maxHp + 1, { type: 'trap' });
  const time = game.time;
  pumpFrames(8);
  assert.equal(game.actors.some(actor => actor.alive), false);
  assert.equal(game.result, null);
  assert.ok(game.time > time, '全员倒下时帧循环必须继续推进');
  assert.equal(hidden('result-overlay'), true);
  game.time = 599.95;
  pumpFrames(8);
  assert.equal(game.result.reason, 'timeLimit');
  assert.equal(game.time, 600);
  assert.deepEqual(game.result.winnerIds, []);
  assert.equal(document.getElementById('result-title').textContent, '本局无人得分');
  assert.equal(hidden('result-overlay'), false);
  assert.equal(hidden('choices'), true);
  assertInputCleared(game);
  const endedAt = game.time;
  pumpFrames(8);
  assert.equal(game.time, endedAt);

  game = startBoss();
  quietBoss(game);
  game.time = 89.98;
  pumpFrames(8);
  game.boss.hp = 20;
  damage(game, game.boss, 10 / BOSS_CONFIG.basicDamageMultipliers[game.actors[0].combatMode], game.actors[0]);
  damage(game, game.boss, 1000, game.actors[1]);
  assert.equal(game.result, null, '结果应由真实 step 结算');
  pumpFrames(8);
  assert.equal(game.result.reason, 'bossDefeated');
  assert.deepEqual(new Set(game.result.winnerIds), new Set(game.actors.slice(0, 2).map(actor => actor.id)));
  assert.equal(game.result.winnerId, null);
  assert.equal(document.getElementById('result-title').textContent, '你并列竞伤第一');
  assert.match(document.getElementById('result-stats').innerHTML, /你的首领伤害/);
  assert.equal(hidden('result-overlay'), false);
});

scenario('首领返回 classic/melee：旧玩法界面无首领残留', () => {
  for (const mode of ['classic', 'melee']) {
    startBoss(mode);
    pumpFrames(8);
    const game = startMode(mode);
    pumpFrames(8);
    assert.notEqual(game.ruleset, 'boss');
    assert.equal(debug.state.selectedRuleset, 'arena');
    assert.equal(document.body.classList.contains('rules-boss'), false);
    assert.equal(hidden('boss-weapon-picker'), true);
    assert.equal(hidden('boss-panel'), true);
    assert.equal(hidden('boss-ranking-panel'), true);
    assert.equal(hidden('result-overlay'), true);
    assert.equal(hidden('death-card'), true);
    assert.equal(hidden('zone-banner'), true);
    assert.doesNotMatch(document.getElementById('world-mode').textContent, /首领/);
    assert.doesNotMatch(document.getElementById('attack-stat').textContent, /首领/);
    assert.equal(document.getElementById('timeline-hunt').textContent, '02 争夺');
    assert.equal(document.getElementById('timeline-finale').textContent, '03 决战');
    assert.match(document.getElementById('roster').innerHTML, /roster-row/);
    assert.equal(debug.state.spectateId, null);
    assert.equal(document.getElementById('game-shell').classList.contains('spectating'), false);
  }
});

// 渲染器单独跑两种模式 + 第三个注册模式
for (const mode of ['classic', 'melee']) {
  const game = createGame(`dom-${mode}`, { mode });
  const renderer = new Renderer(makeElement(`canvas-${mode}`), makeElement(`minimap-${mode}`));
  game.phase = 'hunt';
  const before = calls.fillRect;
  for (let i = 0; i < 120; i++) {
    stepGame(game, 1 / 60, { autoPlayer: true });
    renderer.draw(game, { started: true, spectateId: null, alpha: 0.5 });
  }
  if (!(calls.fillRect > before)) errors.push(new Error(`${mode}: renderer produced no draw calls`));
}

// 用模式注册表驱动一次渲染，确认第三个模式不会让渲染器崩
// 同一个种子切换地图必须重烘焙，反复渲染同图仍复用缓存。
const mapRenderer = new Renderer(makeElement('map-cache-canvas'), makeElement('map-cache-minimap'));
let previousTerrain;
for (const mapId of Object.keys(BIOMES)) {
  const game = createGame('same-seed-different-maps', { mapId });
  mapRenderer.draw(game);
  assert.notEqual(mapRenderer.terrain, previousTerrain, `${mapId}复用了上一张地图地形`);
  previousTerrain = mapRenderer.terrain;
  mapRenderer.draw(game);
  assert.equal(mapRenderer.terrain, previousTerrain, '相同地图不应每帧重新烘焙');
}

const modes = await import('../dist/js/modes.js');
modes.registerMode({ ...modes.MODES.classic, id: 'smoke-third', name: '烟雾模式' });
try {
  const game = createGame('dom-third', { mode: 'smoke-third' });
  const renderer = new Renderer(makeElement('c3'), makeElement('m3'));
  renderer.draw(game, { started: true, spectateId: null, alpha: 1 });
} finally {
  modes.unregisterMode('smoke-third');
}

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log(`OK: app.js booted, renderer ran for classic/melee/third mode; draw calls fillRect=${calls.fillRect} arc=${calls.arc} text=${calls.fillText} image=${calls.drawImage}`);
}
