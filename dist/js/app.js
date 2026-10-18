/**
 * 入口：创建各层、接好依赖、驱动固定步长主循环。
 *
 * 重构前这个文件约 150 行，其中 updateHud 单函数就有 835 字符，
 * 输入、流程、HUD、渲染全混在一起。现在职责拆成：
 *   state.js     会话状态（唯一可变宿主，避免模块间循环 import）
 *   dom.js       $ / show / timeText / beep / toast
 *   hud.js       HUD 分区刷新
 *   input.js     键盘/指针/攻击输入与失焦暂停
 *   overlays.js  开始/暂停/菜单/选技/帮助/观战/声音
 * 本文件只剩装配与主循环。
 */
import { createGame, stepGame, CONFIG } from './simulation.js';
import { Renderer, drawHero } from './renderer.js';
import { MODES } from './modes.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createFlow } from './overlays.js';

// ---- 装配 ---------------------------------------------------------------

state.game = createGame(Date.now());
state.lastAlive = state.game.actors.length;
state.lastHp = state.game.actors[0].hp;
state.previous = performance.now();
state.fpsAt = performance.now();

state.renderer = new Renderer($('game'), $('minimap'));

const portraitCtx = $('portrait').getContext('2d');
portraitCtx.imageSmoothingEnabled = false;
drawHero(portraitCtx, 24, 25, '#f2be65', 0, false, 1.45);

// flow 与 hud 都需要 input 的 clearInput，而 input 又需要 flow 的回调。
// 用一个可变的 actions 表打破这个环：先建空表，再逐个填入。
const actions = {};
const input = createInput(state, actions);
const flow = createFlow(state, input, state.renderer, portraitCtx);
Object.assign(actions, flow, { clearInput: input.clearInput });
const hud = createHud(state, actions);

// ---- 主循环 -------------------------------------------------------------

const STEP = 1 / CONFIG.simulationHz;
/** 单帧最多补算的步数，防止切回标签页后一次性算爆。 */
const MAX_CATCHUP_STEPS = 6;
/** HUD 刷新间隔（毫秒）；HUD 比渲染便宜但比渲染更耗 DOM，没必要每帧刷。 */
const HUD_INTERVAL_MS = 100;

function tickSimulation(deltaSeconds) {
  state.accumulator += deltaSeconds;
  let ticks = 0;
  while (state.accumulator >= STEP && ticks++ < MAX_CATCHUP_STEPS) {
    const aim = input.aimWorld();
    const attack = input.readAttack();
    const { mx, my } = input.movementAxes();
    stepGame(state.game, STEP, {
      mx, my,
      aimX: aim.x, aimY: aim.y,
      castSlot: state.castSlot,
      ...attack,
    });
    state.castSlot = -1;
    if (!state.game.actors[0].alive) input.clearInput();
    state.accumulator -= STEP;
  }
  // 丢掉超出预算的余量，避免「死亡螺旋」式的追帧。
  state.accumulator = Math.min(state.accumulator, STEP);
}

function frame(now) {
  const delta = Math.min(0.1, (now - state.previous) / 1000);
  state.previous = now;

  state.fpsFrames++;
  if (now - state.fpsAt >= 750) {
    const running = state.started && !state.game.paused;
    $('fps-meter').textContent = running
      ? `FPS ${Math.round(state.fpsFrames * 1000 / (now - state.fpsAt))}`
      : 'FPS —';
    state.fpsFrames = 0;
    state.fpsAt = now;
  }

  const live = state.started && !state.game.paused && !state.game.result;
  if (live) tickSimulation(delta);
  else state.accumulator = 0;

  state.renderer.draw(state.game, {
    started: state.started,
    spectateId: state.spectateId,
    alpha: live ? state.accumulator / STEP : 1,
  });

  if (now - state.lastHud > HUD_INTERVAL_MS) {
    hud.update();
    state.lastHud = now;
  }
  requestAnimationFrame(frame);
}

// ---- 启动 ---------------------------------------------------------------

flow.bind();
flow.syncMode();
hud.update();
requestAnimationFrame(frame);

// 供浏览器控制台调试：查看当前对局与模式表，不参与游戏逻辑。
Object.assign(window, { __emberfall: { state, MODES } });
