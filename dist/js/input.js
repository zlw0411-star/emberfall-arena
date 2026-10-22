/**
 * 输入：键盘、指针、攻击输入。
 *
 * 原来这些散在 app.js 的中段（一堆 window.addEventListener 后面紧跟着
 * 只在这一段可见的 keys/pointer/castSlot 变量）。现在收敛成一个工厂，
 * 由 app.js 注入它需要的动作回调，避免输入层直接操作对局状态。
 */
import { MODES } from './modes.js';
import { $ } from './dom.js';
import { createAttackInput } from './controls.js';
import { canAct } from './targeting.js';

/** 需要阻止浏览器默认行为的键（方向键滚动、空格滚动、Esc、数字/技能键）。 */
const PREVENT_DEFAULT = new Set([
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'escape', '1', '2', '3', 'q', 'e', 'r',
]);
const SKILL_SLOTS = ['q', 'e', 'r'];
const NATIVE_CONTROL_SELECTOR = 'button, input, select, textarea, [contenteditable="true"]';

/** 只有画布/战场容器获得焦点时才拦截游戏热键；原生表单控件保留默认语义。 */
function isGameKeyboardContext(event) {
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return true;
  if (target.closest(NATIVE_CONTROL_SELECTOR)) return false;
  return target === $('game') || target === $('game-shell') || target === document.body || target?.id === 'body'
    || target?.getAttribute?.('role') === 'application';
}

export function createInput(state, actions) {
  const keys = state.keys;
  const pointer = state.pointer;

  function pointAt(event) {
    const rect = $('game').getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
  }

  function clearAttack() {
    attackInput.clear();
    const player = state.game?.actors?.[0];
    if (player) {
      player.attackHeld = false;
      player.attackPressed = false;
    }
  }

  function clearInput() {
    keys.clear();
    state.castSlot = -1;
    clearAttack();
  }

  // 移动轴：取两个方向键的差，保证斜向不会超速。
  function movementAxes() {
    const right = keys.has('d') || keys.has('arrowright');
    const left = keys.has('a') || keys.has('arrowleft');
    const down = keys.has('s') || keys.has('arrowdown');
    const up = keys.has('w') || keys.has('arrowup');
    return { mx: Number(right) - Number(left), my: Number(down) - Number(up) };
  }

  // ---- 键盘 -------------------------------------------------------------

  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.target?.isConnected === false) return;
    const key = event.key.toLowerCase();
    const helpOpen = !$('help-overlay').classList.contains('hidden');
    if (helpOpen) {
      if (!isGameKeyboardContext(event)) return;
      if (PREVENT_DEFAULT.has(key)) event.preventDefault();
      return;
    }
    const choiceMovement = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)
      && state.started && !state.game.paused && !state.game.result && state.game.actors[0].alive
      && !$('choices').classList.contains('hidden') && $('choices').contains(event.target);
    // Arrow keys still move during selection; Space/Enter retain native activation.
    if (PREVENT_DEFAULT.has(key) && (isGameKeyboardContext(event) || choiceMovement)) event.preventDefault();
    if (event.repeat) return;
    if (key === 'escape') {
      actions.togglePause();
      return;
    }
    keys.add(key);
    if ('123'.includes(key)) actions.pickVisible(Number(key) - 1);
    if (SKILL_SLOTS.includes(key) && state.started && !state.game.paused) {
      state.castSlot = SKILL_SLOTS.indexOf(key);
    }
  });

  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));

  // ---- 指针与攻击 -------------------------------------------------------

  $('game').addEventListener('pointermove', pointAt);

  const attackInput = createAttackInput(
    $('game'),
    window,
    () => MODES[state.game.mode].usesPointerAttack
      && state.started && !state.game.paused && !state.game.result && canAct(state.game, state.game.actors[0]),
    (event) => {
      pointAt(event);
      $('game-shell').focus({ preventScroll: true });
    },
  );

  // ---- 失焦自动暂停 -----------------------------------------------------

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    clearInput();
    actions.pause(true);
  });
  window.addEventListener('blur', () => {
    clearInput();
    if (state.started) actions.pause(true);
  });

  window.addEventListener('resize', () => state.renderer?.resize());

  return {
    clearInput,
    clearAttack,
    movementAxes,
    /** 读取并清空一次攻击边沿（供固定步长循环调用）。 */
    readAttack: () => attackInput.read(),
    /** 画布坐标 -> 世界坐标。 */
    aimWorld: () => state.renderer.toWorld(pointer.x, pointer.y),
    pointAt,
  };
}
