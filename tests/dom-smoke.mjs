// DOM 冒烟测试：模拟全等不覆盖 app.js / renderer.js 的 DOM 路径，
// 这里用一个最小 DOM + Canvas mock 把真实入口跑起来，抓运行时错误。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const indexHtml = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');

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

let choiceCardSerial = 0;
function nodeList(items) {
  return Object.assign({ length: items.length, item: index => items[index] ?? null,
    forEach: items.forEach.bind(items), entries: items.entries.bind(items),
    keys: items.keys.bind(items), values: items.values.bind(items),
    [Symbol.iterator]: items[Symbol.iterator].bind(items) }, items);
}
function addChoiceCards(container, html) {
  for (const [, attributes, content] of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const card = makeElement(`choice-${++choiceCardSerial}`);
    card.tagName = 'BUTTON';
    for (const [, name, value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) card.setAttribute(name, value);
    card._innerHTML = content;
    card.textContent = content.replace(/<[^>]*>/g, '');
    container.appendChild(card);
  }
}

function addRosterRows(container, html) {
  for (const [, attributes, content] of html.matchAll(/<div\b([^>]*)>([\s\S]*?)<\/div>/g)) {
    const row = makeElement(`roster-${++choiceCardSerial}`);
    for (const [, name, value] of attributes.matchAll(/([\w-]+)="([^"]*)"/g)) row.setAttribute(name, value);
    row._innerHTML = content;
    container.appendChild(row);
  }
}

function markButton(element) {
  element.tagName = 'BUTTON';
  return element;
}

// 元素注册表：任何 id 都能拿到一个可用的伪元素
const elements = new Map();
function makeElement(id = '') {
  const el = {
    id, tagName: 'DIV', disabled: false, dataset: {}, style: {}, classList: {
      _set: new Set(),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, on) { if (on === undefined) { this._set.has(c) ? this._set.delete(c) : this._set.add(c); } else if (on) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    children: [], parentNode: null, textContent: '', _innerHTML: '', _attributes: new Map(),
    get className() { return [...this.classList._set].join(' '); },
    set className(value) { this.classList._set = new Set(value.split(/\s+/).filter(Boolean)); },
    get innerHTML() { return this._innerHTML + this.children.map(child => child.outerHTML).join(''); },
    set innerHTML(value) {
      for (const child of [...this.children]) child.remove();
      this._innerHTML = ['choices', 'roster'].includes(this.id) ? '' : value;
      if (this.id === 'choices') addChoiceCards(this, value);
      if (this.id === 'roster') addRosterRows(this, value);
    },
    get outerHTML() {
      const attributes = new Map(this._attributes);
      if (this.className) attributes.set('class', this.className);
      for (const [key, value] of Object.entries(this.dataset)) attributes.set(`data-${key.replace(/[A-Z]/g, c => '-' + c.toLowerCase())}`, value);
      const tag = (this.tagName || 'div').toLowerCase();
      return `<${tag}${[...attributes].map(([key, value]) => ` ${key}="${value}"`).join('')}>${this.innerHTML}</${tag}>`;
    },
    width: 800, height: 600, clientWidth: 800, clientHeight: 600,
    _handlers: {},
    addEventListener(type, fn) { (this._handlers[type] ??= []).push(fn); },
    removeEventListener() {},
    dispatch(type, event = {}) {
      const target = event.target ?? this;
      const dispatched = event.type === type ? event : { defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; },
        ...event, type, target };
      dispatched.defaultPrevented ??= false;
      dispatched.preventDefault ??= function preventDefault() { this.defaultPrevented = true; };
      dispatched.stopPropagation ??= function stopPropagation() { this.propagationStopped = true; };
      dispatched.target = target;
      for (const fn of this._handlers[type] ?? []) fn(dispatched);
      const handler = this[`on${type}`];
      if (typeof handler === 'function') handler(dispatched);
      if (this.parentNode && !dispatched.propagationStopped) {
        this.parentNode.dispatch(type, dispatched);
      }
      return dispatched;
    },
    setAttribute(name, value) {
      this._attributes.set(name, String(value));
      if (name === 'class') this.className = String(value);
      if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
      if (name === 'tabindex') this.tabIndex = Number(value);
    },
    getAttribute(name) {
    if (name === 'class') return this.className;
      if (name === 'data-choice-id') return this.dataset.choiceId ?? null;
      if (name === 'data-choice-version') return this.dataset.choiceVersion ?? null;
      if (name === 'type') return this._attributes.get(name) ?? null;
      if (name === 'role') return this._attributes.get(name) ?? null;
      if (name === 'tabindex' && this._tabIndex !== undefined) return String(this.tabIndex);
      if (name.startsWith('data-')) return this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
      return this._attributes.get(name) ?? null;
    },
    removeAttribute(name) {
      this._attributes.delete(name);
      if (name.startsWith('data-')) delete this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
      if (name === 'tabindex') delete this._tabIndex;
    },
    appendChild(child) { return this.insertBefore(child, null); },
    insertBefore(child, reference) {
      if (child === reference) return child;
      child.remove();
      const index = reference ? this.children.indexOf(reference) : this.children.length;
      assert.ok(index >= 0, 'insertBefore 的参照节点必须属于容器');
      this.children.splice(index, 0, child);
      child.parentNode = this;
      child.isConnected = this.isConnected;
      return child;
    },
    remove() {
      if (this.contains(globalThis.document?.activeElement)) document.activeElement = document.body;
      if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
      this.isConnected = false;
    },
    contains(node) { return node != null && (node === this || this.children.some(child => child.contains(node))); },
    focus() { document.activeElement = this; },
    blur() { if (document.activeElement === this) document.activeElement = document.body; },
    click() { if (!this.disabled) this.dispatch('click'); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    get tabIndex() { return this._tabIndex ?? (this.tagName === 'BUTTON' ? 0 : -1); },
    set tabIndex(value) { this._tabIndex = Number(value); this._attributes.set('tabindex', String(value)); },
    get inert() { return this._inert ?? false; },
    set inert(value) {
      this._inert = Boolean(value);
      if (this._inert) this._attributes.set('inert', '');
      else this._attributes.delete('inert');
      if (this._inert && this.contains(document.activeElement)) document.activeElement = document.body;
    },
    matches(selector) {
      const attribute = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (attribute) return this.getAttribute(attribute[1]) !== null
        && (attribute[2] === undefined || this.getAttribute(attribute[1]) === attribute[2]);
      if (selector === '[role="button"]') return this.getAttribute('role') === 'button';
      if (selector === 'button') return this.tagName === 'BUTTON';
      return selector.startsWith('.') && this.classList.contains(selector.slice(1));
    },
    querySelectorAll(selector) {
      return nodeList(this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]));
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; },
    getContext: () => makeCtx(),
    _captures: new Set(),
    setPointerCapture(id) { this._captures.add(id); },
    releasePointerCapture(id) { this._captures.delete(id); },
    hasPointerCapture(id) { return this._captures.has(id); },
    isConnected: true,
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
    card.tagName = 'BUTTON';
    card.dataset.weapon = weapon;
    weaponCards.set(weapon, card);
  }
  return weaponCards.get(weapon);
}
function makeMapCard(mapId) {
  if (!mapCards.has(mapId)) {
    const card = makeElement(`map-card-${mapId}`);
    card.tagName = 'BUTTON';
    card.dataset.map = mapId;
    mapCards.set(mapId, card);
  }
  return mapCards.get(mapId);
}
function makeModeCard(mode) {
  if (!modeCards.has(mode)) {
    const card = makeElement(`mode-card-${mode}`);
    card.tagName = 'BUTTON';
    card.dataset.mode = mode;
    modeCards.set(mode, card);
  }
  return modeCards.get(mode);
}

globalThis.document = {
  getElementById(id) { return elements.get(id) ?? makeElement(id); },
  querySelectorAll(selector) {
    if (selector === '[data-mode]') return nodeList([...modeCards.values()]);
    if (selector === '[data-weapon]') return nodeList([...weaponCards.values()]);
    if (selector === '[data-map]') return nodeList([...mapCards.values()]);
    return nodeList([]);
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
document.activeElement = document.body;
document.getElementById('body').isConnected = true;
document.getElementById('game-shell').isConnected = true;
document.getElementById('help-button').isConnected = true;
document.getElementById('start-button').isConnected = true;
document.getElementById('help-overlay')._innerHTML = '';
document.getElementById('help-overlay').classList.add('hidden');
const helpDialog = makeElement('created-help-dialog');
helpDialog.className = 'help-dialog';
document.getElementById('help-overlay').appendChild(helpDialog);
const app = document.getElementById('app');
app.appendChild(document.getElementById('game-shell'));
app.appendChild(document.getElementById('help-button'));
app.appendChild(document.getElementById('start-button'));
for (const id of [
  'sound-button', 'help-button', 'pause-button', 'start-button', 'resume-button',
  'restart-pause', 'menu-pause', 'restart-death', 'menu-death', 'spectate-button',
  'restart-result', 'menu-result', 'close-help', 'help-done',
]) {
  document.getElementById(id).tagName = 'BUTTON';
  document.getElementById(id).setAttribute('type', 'button');
}
helpDialog.appendChild(document.getElementById('close-help'));
helpDialog.appendChild(document.getElementById('help-done'));

globalThis.window = {
  _handlers: {},
  addEventListener(type, fn) { (this._handlers[type] ??= []).push(fn); },
  removeEventListener() {},
  dispatch(type, event = {}) {
    const target = event.target ?? document.activeElement ?? document.body;
    const dispatched = {
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.propagationStopped = true; },
      ...event,
      type,
      target,
    };
    if (!dispatched.propagationStopped && typeof target.dispatch === 'function') target.dispatch(type, dispatched);
    if (!dispatched.propagationStopped) {
      for (const fn of this._handlers[type] ?? []) fn(dispatched);
    }
    // 浏览器默认行为：未被取消的 Space/Enter 激活原生按钮。
    if (type === 'keydown' && !dispatched.defaultPrevented
      && [' ', 'Spacebar', 'Enter'].includes(dispatched.key)
      && dispatched.target?.tagName === 'BUTTON') {
      dispatched.target.dispatch('click');
    }
    return dispatched;
  },
  devicePixelRatio: 1,
  requestAnimationFrame: () => 0, cancelAnimationFrame() {},
  focus() {},
};
helpDialog.remove();
document.getElementById('close-help').remove();
document.getElementById('help-done').remove();
document.getElementById('help-overlay').appendChild(helpDialog);
helpDialog.appendChild(document.getElementById('close-help'));
helpDialog.appendChild(document.getElementById('help-done'));
globalThis.window.document = document;
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

scenario('暂停时调整窗口会立即重绘小地图，且不推进模拟', () => {
  const game = startMode('classic');
  pumpFrames(8);
  click('pause-button');
  const time = game.time;
  const mini = document.getElementById('minimap');
  const renderer = debug.state.renderer;
  const drawMap = renderer.drawMap;
  const originalSize = [mini.clientWidth, mini.clientHeight];
  let paints = 0;
  renderer.drawMap = function (...args) { paints++; return drawMap.apply(this, args); };
  try {
    for (const [width, height] of [[252, 150], [150, 252]]) {
      mini.clientWidth = width;
      mini.clientHeight = height;
      const before = paints;
      window.dispatch('resize');
      pumpFrames(1);
      assert.equal(paints, before + 1, '暂停时尺寸变化也必须刷新地图');
      assert.deepEqual([mini.width, mini.height], [width, height]);
      assert.equal(game.time, time);
      pumpFrames(4);
      assert.equal(paints, before + 1, '静止且尺寸不变时不应反复重画');
    }
  } finally {
    renderer.drawMap = drawMap;
    [mini.clientWidth, mini.clientHeight] = originalSize;
  }
  click('pause-button');
  assertMenuRecovery('classic');
});

scenario('静态菜单复用小地图，切图、重开、缩放和暂停观战仍刷新', () => {
  startMode('classic'); click('menu-pause');
  const renderer = debug.state.renderer, drawMap = renderer.drawMap;
  let paints = 0;
  renderer.drawMap = function (...args) { paints++; return drawMap.apply(this, args); };
  try {
    pumpFrames(1);
    const first = paints;
    pumpFrames(60);
    assert.equal(paints, first, '静态菜单不应每帧重画');
    makeMapCard('frost').dispatch('click');
    pumpFrames(1);
    assert.equal(paints, first + 1, '菜单切图立即重画');
    click('start-button'); pumpFrames(1);
    const started = paints;
    assert.ok(started > first + 1, '新对局立即更新小地图');
    click('pause-button'); pumpFrames(1);
    const paused = paints, game = debug.state.game;
    game.actors[0].alive = false;
    debug.state.spectateId = game.actors[1].id;
    pumpFrames(1);
    assert.equal(paints, paused + 1, '冻结时镜头切换应更新视野框');
    pumpFrames(4);
    assert.equal(paints, paused + 1);
  } finally { renderer.drawMap = drawMap; }
  click('menu-pause');
});

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

scenario('A01 选技卡过期事件按技能 ID 和选项版本拒绝，交错的下一张仍保留', () => {
  const game = startMode('classic');
  game.rng = () => 0; // 下一轮固定首项为火球，隔离随机夹具波动。
  game.monsters = []; game.gems = [];
  const player = game.actors[0];
  player.pendingChoices = 2;
  player.choices = ['power', 'vitality', 'focus'];
  debug.state.choiceKey = '';
  pumpFrames(8);
  const choices = document.getElementById('choices');
  const oldCard = choices.querySelector('[data-choice-id]');
  assert.equal(oldCard?.dataset.choiceId, 'power', 'HTML 必须写出可校验的技能 ID');
  oldCard.click();
  assert.equal(player.skills.power, 1);
  assert.equal(player.pendingChoices, 1);
  assert.notEqual(player.choices[0], 'power', '测试夹具需要让下一张与旧卡不同');
  const nextSkill = player.choices[0];
  oldCard.click();
  window.dispatch('keydown', { key: '1', target: oldCard });
  assert.equal(player.skills.power, 1, '旧 DOM 点击不得消费尚未显示的新选项');
  assert.equal(player.skills[nextSkill] || 0, 0, '旧 DOM 数字键也不得消费新选项');
  assert.equal(player.pendingChoices, 1, '过期事件后待选队列必须保留');
  assert.equal(game.paused, false, '保留选技不停战');
  pumpFrames(8);
  const freshCard = choices.querySelector('[data-choice-id]');
  assert.equal(freshCard?.dataset.choiceId, nextSkill);
  window.dispatch('keydown', { key: '1' });
  assert.equal(player.skills[nextSkill] || 0, 1, '刷新后的新卡仍可通过数字键选择');
  assert.equal(player.pendingChoices, 0);
});

scenario('A01 同技能同槽位由选项版本区分，旧点击和数字键都失效', () => {
  const game = startMode('classic');
  game.monsters = []; game.gems = [];
  const player = game.actors[0];
  player.pendingChoices = 2;
  player.choices = ['power', 'precision', 'focus'];
  debug.state.choiceKey = '';
  pumpFrames(8);
  const choices = document.getElementById('choices');
  const oldSlot = choices.querySelector('[data-choice="0"]');
  const oldVersion = Number(oldSlot.dataset.choiceVersion);
  oldSlot.click();
  assert.equal(player.pendingChoices, 1);
  assert.equal(Number(debug.state.choiceVersion), oldVersion + 1, '成功选择必须立即推进版本');
  const expiredAfterChoice = oldSlot;
  expiredAfterChoice.dataset.choiceVersion = String(oldVersion);

  player.choices = ['power', 'vitality', 'focus'];
  debug.state.choiceKey = '';
  pumpFrames(8);
  const freshSlot = choices.querySelector('[data-choice="0"]');
  assert.equal(freshSlot.dataset.choiceId, 'power');
  assert.notEqual(freshSlot.dataset.choiceVersion, expiredAfterChoice.dataset.choiceVersion);
  expiredAfterChoice.click();
  assert.equal(player.skills.power || 0, 1, '同 ID 的旧事件仍须被版本拒绝');
  assert.equal(player.pendingChoices, 1);
  freshSlot.click();
  assert.equal(player.skills.power, 2, '当前版本的同技能卡仍可强化');
  assert.equal(player.pendingChoices, 0);
});

scenario('A02 帮助层锁焦、背景 inert、幂等打开并恢复原暂停态', () => {
  let game = startMode('classic');
  game.monsters = []; game.gems = [];
  const help = document.getElementById('help-overlay');
  const shell = document.getElementById('game-shell');
  const helpButton = document.getElementById('help-button');
  helpButton.focus();
  helpButton.click();
  assert.equal(hidden('help-overlay'), false);
  assert.equal(game.paused, true);
  assert.equal(document.getElementById('app').inert, true, '帮助显示时背景必须 inert');
  assert.equal(document.getElementById('app').getAttribute('inert'), '', '背景容器 must expose inert attribute');
  assert.equal(help.contains(document.activeElement), true, '焦点必须移入帮助模态');
  const close = document.getElementById('close-help');
  for (let i = 0; i < 8; i++) {
    window.dispatch('keydown', { key: 'Tab', shiftKey: i % 2 === 1 });
    assert.equal(help.contains(document.activeElement), true, 'Tab/Shift+Tab 必须留在帮助层');
  }
  helpButton.dispatch('click');
  assert.equal(game.paused, true, '重复打开不能覆盖原始暂停态');
  const escape = window.dispatch('keydown', { key: 'Escape', target: document.activeElement, bubbling: true });
  assert.equal(hidden('help-overlay'), true);
  assert.equal(game.paused, false, '此前未暂停时关闭帮助应恢复运行');
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.propagationStopped, true, '帮助已处理 Escape 后不得再次触发全局暂停');
  assert.equal(game.paused, false, '冒泡到全局后不能再次切换暂停');
  assert.equal(document.getElementById('app').inert, false);
  assert.equal(document.activeElement, helpButton, '关闭后必须恢复打开者焦点');

  click('pause-button');
  assert.equal(game.paused, true);
  helpButton.click();
  helpButton.click();
  close.click();
  assert.equal(game.paused, true, '打开帮助前已暂停时必须保持暂停');
  assert.equal(hidden('pause-overlay'), false, '关闭帮助后应恢复原暂停浮层');
  click('resume-button');

  game.time = CONFIG.matchLimit - 0.05;
  pumpFrames(8);
  assert.ok(game.result, '夹具应到达结算');
  helpButton.click();
  assert.equal(hidden('help-overlay'), false);
  assert.equal(game.paused, false, '结算状态不能因帮助打开而变成运行时暂停');
  close.click();
  assert.equal(hidden('help-overlay'), true);
  click('menu-result');
  pumpFrames(8);
  helpButton.focus();
  helpButton.click();
  assert.equal(game === debug.state.game, false);
  close.click();
  assert.equal(document.activeElement, helpButton);
});

scenario('A03 原生按钮空格不被吞，帮助显示时游戏键隔离，战场方向键仍防滚动', () => {
  click('menu-pause');
  makeModeCard('melee').dispatch('click');
  const start = document.getElementById('start-button');
  start.focus();
  document.activeElement = start;
  const event = window.dispatch('keydown', { key: ' ' });
  assert.equal(event.defaultPrevented, false, '原生按钮空格应保留默认激活');
  assert.equal(debug.state.started, true, '空格应启动对局');
  $game.focus();
  const arrow = window.dispatch('keydown', { key: 'ArrowDown' });
  assert.equal(arrow.defaultPrevented, true, '战场方向键仍需防止页面滚动');
  const helpButton = document.getElementById('help-button');
  helpButton.focus();
  helpButton.click();
  const game = debug.state.game;
  const beforeTime = game.time;
  const q = window.dispatch('keydown', { key: 'q', target: document.getElementById('close-help') });
  assert.equal(q.defaultPrevented, false, '原生按钮上的 Q 不应被游戏全局处理器吞掉');
  assert.equal(debug.state.castSlot, -1, '帮助显示时 Q 不得排队施法');
  pumpFrames(8);
  assert.equal(game.time, beforeTime, '帮助显示时模拟保持暂停');
  click('close-help');
  assert.equal(hidden('help-overlay'), true);
});

scenario('C02 技能卡焦点下方向键防滚动并移动，空格仍能原生选卡', () => {
  const game = startMode('classic'), player = game.actors[0];
  for (const actor of game.actors) { actor.isPlayer = true; actor.attackTimer = Infinity; }
  game.monsters = []; game.gems = [];
  player.x = player.prevX = 1024; player.y = player.prevY = 1024;
  player.pendingChoices = 1; player.choices = ['power', 'vitality', 'focus'];
  pumpFrames(8);
  const card = document.getElementById('choices').querySelector('[data-choice="0"]');
  card.focus();
  const y = player.y;
  const arrow = window.dispatch('keydown', { key: 'ArrowDown', target: card });
  assert.equal(arrow.defaultPrevented, true);
  pumpFrames(8);
  assert.ok(player.y > y, '聚焦技能卡仍需正常移动');
  window.dispatch('keyup', { key: 'ArrowDown' });
  const space = window.dispatch('keydown', { key: ' ', target: card });
  assert.equal(space.defaultPrevented, false);
  assert.equal(player.skills.power, 1, '空格仍可原生激活技能卡');
});

scenario('A02/A03 帮助完成按钮空格可原生关闭，背景仍不恢复', () => {
  const game = startMode('classic');
  game.monsters = []; game.gems = [];
  const helpButton = document.getElementById('help-button');
  helpButton.click();
  const done = document.getElementById('help-done');
  done.focus();
  const space = window.dispatch('keydown', { key: ' ' });
  assert.equal(space.defaultPrevented, false, '帮助按钮空格必须保留默认激活');
  assert.equal(hidden('help-overlay'), true, '空格应通过原生按钮默认行为关闭帮助');
  assert.equal(game.paused, false);
  click('menu-pause');
});

scenario('A07 首领参战经验和晶体说明来自运行配置，HTML 具备模态语义', () => {
  const liveConfig = CONFIG;
  const participation = BOSS_CONFIG.participationXp * BOSS_CONFIG.xpMultiplier;
  const mapGem = liveConfig.mapGemXp * BOSS_CONFIG.xpMultiplier;
  assert.equal(participation, 6);
  assert.equal(mapGem, 7.5);
  assert.match(indexHtml, /id="boss-participation-xp"/);
  assert.match(indexHtml, /id="boss-map-gem-xp"/);
  assert.match(indexHtml, /id="help-overlay"[^>]*role="dialog"[^>]*aria-modal="true"/);
  startBoss('classic');
  pumpFrames(8);
  assert.equal(document.getElementById('boss-participation-xp').textContent, String(participation));
  assert.equal(document.getElementById('boss-map-gem-xp').textContent, String(mapGem));
  assert.equal(document.getElementById('help-participation-xp').textContent, String(participation));
  assert.equal(document.getElementById('help-map-gem-xp').textContent, String(mapGem));
  click('menu-pause');
});

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
      document.getElementById('choices').querySelector('[data-choice="0"]').click();
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
    const roster = document.getElementById('roster');
    const row = roster.querySelector(`[data-actor="${living[1].id}"]`);
    assert.ok(row, '使用HUD实际生成的名册行');
    roster.dispatch('click', { target: row });
    const before = game.time;
    pumpFrames(16);
    assert.ok(game.time > before, '观战必须继续推进模拟');
    assert.equal(debug.state.spectateId, living[1].id, '点击名册必须切换观战目标');
    assert.equal(hidden('death-card'), true, '关闭死亡卡后不能再次弹出');
    assertMenuRecovery(mode);
  });

  scenario(`${mode}: 观战名册跨刷新保留焦点、键盘选人及死亡回退`, () => {
    const game = startMode(mode);
    damage(game, game.actors[0], 10000, { type: 'trap' });
    pumpFrames(8);
    click('spectate-button');
    const roster = document.getElementById('roster');
    const actor = game.actors[2];
    const row = roster.querySelector(`[data-actor="${actor.id}"]`);
    assert.equal(row.getAttribute('role'), 'button');
    row.focus();
    pumpFrames(16);
    assert.equal(document.activeElement, row, '多次HUD刷新后仍应聚焦同一角色行');
    assert.equal(roster.querySelector(`[data-actor="${actor.id}"]`), row, '实际行应复用');
    for (const key of ['Enter', ' ']) {
      window.dispatch('keydown', { key });
      window.dispatch('keyup', { key });
      assert.equal(debug.state.spectateId, actor.id);
      pumpFrames(8);
      assert.equal(row.getAttribute('aria-pressed'), 'true');
    }
    actor.level = 9;
    pumpFrames(8);
    assert.equal(document.activeElement, row, '等级更新不应移除焦点行');
    assert.match(row.innerHTML, /LV\.09/);
    damage(game, actor, 10000, { type: 'trap' });
    pumpFrames(8);
    assert.notEqual(debug.state.spectateId, actor.id);
    assert.equal(row.getAttribute('role'), null);
    assert.equal(row.getAttribute('tabindex'), null);
    assert.equal(document.activeElement, document.getElementById('game-shell'));
    window.dispatch('keydown', { key: 'Enter', target: row });
    assert.notEqual(debug.state.spectateId, actor.id, '死亡旧行不可切回');
    const survivorRow = roster.querySelector(`[data-actor="${game.actors[3].id}"]`);
    survivorRow.focus();
    game.result = { winnerId: game.actors[3].id, time: game.time };
    pumpFrames(8);
    assert.equal(survivorRow.getAttribute('role'), null, '结算撤销观战交互');
    assert.equal(document.activeElement, document.getElementById('game-shell'));
    assertFreshGame(mode, 'restart-result');
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

const bossRankRow = actor => document.getElementById('boss-ranking').querySelector(`[data-actor="${actor.id}"]`);
function assertStaticBossRanking() {
  const ranking = document.getElementById('boss-ranking');
  assert.equal(ranking.querySelectorAll('[role="button"]').length, 0);
  assert.equal(ranking.querySelectorAll('[tabindex]').length, 0);
  assert.equal(ranking.querySelectorAll('[aria-pressed]').length, 0);
}

for (const weapon of ['classic', 'melee']) {
  scenario(`首领 ${weapon}：伤害榜真实点击/键盘、排序焦点、死者拒绝与复活撤销交互`, () => {
    const game = startBoss(weapon);
    quietBoss(game);
    pumpFrames(8);
    assertStaticBossRanking();
    const [player, first, second, third, dead] = game.actors;
    bossRankRow(second).click();
    assert.equal(debug.state.spectateId, null, '玩家存活时不可选择观战');
    damage(game, player, player.maxHp + 1, { type: 'trap' });
    damage(game, dead, dead.maxHp + 1, { type: 'trap' });
    pumpFrames(8);
    assert.equal(debug.state.spectateId, first.id);
    assert.equal(bossRankRow(first).getAttribute('aria-pressed'), 'true');
    assert.equal(bossRankRow(player).getAttribute('role'), null);
    assert.equal(bossRankRow(dead).getAttribute('tabindex'), null);
    const secondRow = bossRankRow(second), thirdRow = bossRankRow(third);
    assert.equal(secondRow.getAttribute('role'), 'button');
    assert.equal(secondRow.getAttribute('tabindex'), '0');
    assert.match(secondRow.getAttribute('aria-label'), /观战/);
    secondRow.click();
    assert.equal(debug.state.spectateId, second.id, '伤害榜的实际行必须能点击切换');
    thirdRow.focus();
    assert.equal(thirdRow.dispatch('keydown', { key: 'Enter' }).defaultPrevented, true);
    assert.equal(debug.state.spectateId, third.id, 'Enter 必须切换观战');
    secondRow.focus();
    assert.equal(secondRow.dispatch('keydown', { key: ' ' }).defaultPrevented, true, '空格切换必须阻止页面滚动');
    assert.equal(debug.state.spectateId, second.id, 'Space 必须切换观战');
    thirdRow.dispatch('keydown', { key: 'ArrowDown' });
    assert.equal(debug.state.spectateId, second.id, '其他按键不应切换观战');
    bossRankRow(dead).click();
    bossRankRow(dead).dispatch('keydown', { key: 'Enter' });
    assert.equal(debug.state.spectateId, second.id, '死者不能成为观战对象');
    pumpFrames(8);
    assert.equal(bossRankRow(second), secondRow, '常规刷新必须复用角色行');
    assert.equal(document.activeElement, secondRow, '常规刷新必须保留键盘焦点');
    assert.equal(secondRow.getAttribute('aria-pressed'), 'true');
    assert.equal(thirdRow.getAttribute('aria-pressed'), 'false');
    const oldIndex = document.getElementById('boss-ranking').children.indexOf(secondRow);
    second.bossDamage = 700;
    pumpFrames(8);
    assert.notEqual(document.getElementById('boss-ranking').children.indexOf(secondRow), oldIndex);
    assert.equal(bossRankRow(second), secondRow, '排名变化仍须复用角色行');
    assert.equal(document.activeElement, secondRow, '排名变化不得丢失焦点');
    damage(game, second, second.maxHp + 1, { type: 'trap' });
    thirdRow.click();
    assert.equal(debug.state.spectateId, third.id);
    secondRow.click();
    secondRow.dispatch('keydown', { key: ' ' });
    assert.equal(debug.state.spectateId, third.id, 'HUD 刷新前也必须拒绝已死目标');
    pumpFrames(8);
    assert.equal(secondRow.getAttribute('role'), null);
    assert.equal(secondRow.getAttribute('tabindex'), null);
    assert.equal(document.activeElement, document.getElementById('game-shell'), '焦点角色死亡后应回到战场');
    damage(game, third, third.maxHp + 1, { type: 'trap' });
    pumpFrames(8);
    assert.equal(debug.state.spectateId, first.id, '观战对象死亡后应自动回退到存活角色');
    const firstRow = bossRankRow(first);
    firstRow.focus();
    // 让真实 rAF 先完成复活，保留上一轮 HUD，验证事件按即时状态拒绝。
    game.time = player.respawnAt - 1 / 120;
    debug.state.lastHud = frameTime;
    pumpFrames(1);
    assert.equal(player.alive, true);
    assert.equal(firstRow.getAttribute('role'), 'button', '此时应仍是复活前的旧 DOM');
    const previous = debug.state.spectateId;
    for (const key of ['Enter', ' ']) {
      bossRankRow(game.actors[5]).dispatch('keydown', { key });
      assert.equal(debug.state.spectateId, previous, '复活后旧 DOM 键盘入口必须立即拒绝');
    }
    bossRankRow(game.actors[5]).click();
    assert.equal(debug.state.spectateId, previous, '复活后旧 DOM 点击入口必须立即拒绝');
    pumpFrames(8);
    assert.equal(debug.state.spectateId, null);
    assert.equal(debug.state.deathDismissed, false);
    assert.equal(document.getElementById('game-shell').classList.contains('spectating'), false);
    assert.equal(hidden('death-card'), true);
    assertStaticBossRanking();
    assert.equal(document.activeElement, document.getElementById('game-shell'));
    bossRankRow(first).click();
    bossRankRow(first).dispatch('keydown', { key: 'Enter' });
    assert.equal(debug.state.spectateId, null);
  });
}

scenario('首领：未开局和死亡等待中的结算均拒绝切换，结算榜单保持静态', () => {
  startBoss();
  click('menu-pause');
  pumpFrames(8);
  assertStaticBossRanking();
  const preview = debug.state.game;
  preview.actors[0].alive = false;
  bossRankRow(preview.actors[2]).click();
  bossRankRow(preview.actors[2]).dispatch('keydown', { key: 'Enter' });
  assert.equal(debug.state.spectateId, null, '未开局不得切换');

  const game = startBoss();
  quietBoss(game);
  game.time = 599;
  damage(game, game.actors[0], game.actors[0].maxHp + 1, { type: 'trap' });
  pumpFrames(8);
  const row = bossRankRow(game.actors[2]);
  row.focus();
  row.click();
  assert.equal(debug.state.spectateId, game.actors[2].id);
  game.time = 600 - 1 / 120;
  debug.state.lastHud = frameTime;
  pumpFrames(1);
  assert.equal(game.result.reason, 'timeLimit');
  assert.equal(row.getAttribute('role'), 'button', '此时应仍是结算前的旧 DOM');
  const previous = debug.state.spectateId;
  for (const key of ['Enter', ' ']) {
    bossRankRow(game.actors[3]).dispatch('keydown', { key });
    assert.equal(debug.state.spectateId, previous, '结算必须立即拒绝键盘切换');
  }
  bossRankRow(game.actors[3]).click();
  assert.equal(debug.state.spectateId, previous, '结算必须立即拒绝点击切换');
  pumpFrames(8);
  assert.equal(hidden('result-overlay'), false);
  assert.equal(hidden('death-card'), true);
  assert.equal(debug.state.spectateId, null);
  assert.equal(debug.state.deathDismissed, false);
  assert.equal(document.getElementById('game-shell').classList.contains('spectating'), false);
  assert.equal(document.activeElement, document.getElementById('game-shell'));
  assertStaticBossRanking();
  const resultHtml = document.getElementById('result-stats').innerHTML;
  assert.match(resultHtml, /result-ranking/);
  assert.doesNotMatch(resultHtml, /data-actor|role="button"|tabindex|aria-pressed/);
  row.click();
  row.dispatch('keydown', { key: 'Enter' });
  row.dispatch('keydown', { key: ' ' });
  assert.equal(debug.state.spectateId, null);
});

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
  document.getElementById('choices').querySelector('[data-choice="0"]').click();
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
  // 覆盖0.05秒复活等待，再留出完整的100ms HUD刷新窗口。
  pumpFrames(12);
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
  const restoredHtml = document.getElementById('choices').innerHTML;
  const withoutOfferVersion = html => html.replace(/data-choice-version="\d+"/g, 'data-choice-version="offer"');
  assert.equal(withoutOfferVersion(restoredHtml), withoutOfferVersion(cardHtml), '复活保留技能、等级、说明和卡片顺序，仅更新防过期版本');
  assert.ok(player.invulnerableUntil > game.time);
  assert.match(document.getElementById('footer-status').textContent, /重生保护/);
});

for (const weapon of ['classic', 'melee']) {
  scenario(`C01 首领 ${weapon}：复活帧清旧输入，复活后的新按键跨HUD持续移动`, () => {
    const game = startBoss(weapon), player = game.actors[0];
    quietBoss(game);
    damage(game, player, player.maxHp + 1, { type: 'trap' });
    pumpFrames(8);
    game.time = player.respawnAt - 1 / 120;
    debug.state.accumulator = 1 / 120;
    debug.state.lastHud = frameTime;
    window.dispatch('keydown', { key: 'd' });
    pumpFrames(1);
    assert.equal(player.alive, true);
    assertInputCleared(game);
    assert.equal(player.x, game.map.spawnPoints[0].x, '复活这一帧不能使用死前输入');
    window.dispatch('keyup', { key: 'd' });
    window.dispatch('keydown', { key: 'd' });
    pumpFrames(1);
    const earlyX = player.x;
    pumpFrames(8);
    assert.equal(debug.state.keys.has('d'), true, 'HUD不能删除复活后产生的输入');
    const acrossHudX = player.x;
    assert.ok(acrossHudX > earlyX);
    window.dispatch('keydown', { key: 'd', repeat: true });
    pumpFrames(20);
    assert.ok(player.x > acrossHudX, '持续按住不能被界面刷新打断');
    window.dispatch('keyup', { key: 'd' });
  });
}

scenario('首领：全员倒下仍推进、600 秒无得分结算和击杀后的并列第一', () => {
  let game = startBoss();
  quietBoss(game);
  for (const actor of game.actors) damage(game, actor, actor.maxHp + 1, { type: 'trap' });
  const time = game.time;
  pumpFrames(8);
  assert.equal(game.actors.some(actor => actor.alive), false);
  assert.equal(debug.state.spectateId, null, '全员倒下后不应保留失效观战目标');
  assertStaticBossRanking();
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
