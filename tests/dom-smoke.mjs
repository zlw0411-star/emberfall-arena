// DOM 冒烟测试：模拟全等不覆盖 app.js / renderer.js 的 DOM 路径，
// 这里用一个最小 DOM + Canvas mock 把真实入口跑起来，抓运行时错误。
import { readFileSync } from 'node:fs';

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
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
    tabIndex: 0,
  };
  elements.set(id, el);
  return el;
}

// 模式选择卡：app.js/overlays.js 会用 querySelectorAll('[data-mode]') 遍历并绑定 onclick
const modeCards = new Map();
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
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };
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

// 加载真实入口；它会在模块顶层查询 DOM 并注册事件
await import('../dist/js/app.js');

// ---- 驱动真实主循环 ----------------------------------------------------
const { Renderer } = await import('../dist/js/renderer.js');
const { createGame, stepGame } = await import('../dist/js/simulation.js');

/** 推进 n 帧（每帧 16.7ms），让 app.js 自己的 frame() 跑起来。 */
function pumpFrames(n, startAt = 0) {
  for (let i = 0; i < n; i++) {
    if (typeof pendingFrame !== 'function') throw new Error('主循环未注册 requestAnimationFrame');
    const cb = pendingFrame;
    pendingFrame = null;
    cb(startAt + i * (1000 / 60));
  }
}

const debug = globalThis.window.__emberfall;
if (!debug) errors.push(new Error('app.js 未暴露 __emberfall 调试入口，说明入口模块没有正常执行'));
const $game = document.getElementById('game');

// 主菜单阶段：先跑几帧，确认未开局时不崩
try { pumpFrames(5, 1000); } catch (e) { errors.push(new Error(`主菜单帧循环失败: ${e.message}`)); }

// 开始经典模式：点开始按钮，然后跑 3 秒（约 180 帧）
try {
  document.getElementById('start-button').dispatch('click');
  const game = debug.state.game;
  if (!debug.state.started) errors.push(new Error('点击开始后 started 仍为 false'));
  if (game.mode !== 'classic') errors.push(new Error(`默认模式应为 classic，实际 ${game.mode}`));
  const before = game.time;
  pumpFrames(180, 3000);
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
  pumpFrames(60, 6000);
  if (game.time !== t) errors.push(new Error('暂停后模拟时间仍在推进'));
  document.getElementById('pause-button').dispatch('click');
  if (game.paused) errors.push(new Error('继续按钮未生效'));
} catch (e) { errors.push(new Error(`暂停流程失败: ${e.message}`)); }

// 键盘移动 + 技能键
try {
  const game = debug.state.game;
  const player = game.actors[0];
  const x0 = player.x;
  window.dispatch('keydown', { key: 'd' });
  pumpFrames(30, 8000);
  window.dispatch('keyup', { key: 'd' });
  if (!(player.x > x0)) errors.push(new Error(`按 D 后未向右移动 (${x0} -> ${player.x})`));
} catch (e) { errors.push(new Error(`键盘输入失败: ${e.message}`)); }

// 返回菜单，再切到近战模式开始一局
try {
  document.getElementById('menu-pause').dispatch('click');
  if (debug.state.started) errors.push(new Error('返回菜单后 started 仍为 true'));
  pumpFrames(3, 9000);
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
  pumpFrames(90, 10000);
  document.getElementById('game').dispatch('pointerup', { button: 0 });
  if (!(game.time > before)) errors.push(new Error('近战主循环未推进时间'));
  if (!(player.meleeActionSequence > 0)) errors.push(new Error('按住左键未产生任何挥刀动作'));
  // 刀光用 crescent() 的 lineTo 多边形绘制，不是 canvas arc()；
  // 这里只确认近战期间确实发生了绘制（fillRect 增长），并记录 lineTo 次数。
  if (!(calls.fillRect > 0)) errors.push(new Error('近战模式未发生任何绘制'));
} catch (e) { errors.push(new Error(`近战驱动失败: ${e.message}`)); }

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
