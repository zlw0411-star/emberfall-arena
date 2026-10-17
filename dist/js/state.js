/**
 * 前端运行期状态。
 *
 * 拆分成多个模块后，这些可变量需要一个共同宿主。
 * 放在单独模块里可以避免 hud/input/overlays 之间互相 import 形成循环。
 *
 * 注意：这里只放「界面层的会话状态」。
 * 对局本身（角色、怪物、收缩圈）全部在 game 对象里，由 simulation.js 拥有。
 */
export const state = {
  /** 主菜单当前选中、但尚未开始的模式。 */
  selectedMode: 'classic',
  /** 当前对局；未开始时也是一局「演示」对局。 */
  game: null,
  /** 是否已经进入对局（主菜单 vs 战场）。 */
  started: false,
  /** 观战目标 id；null 表示自动选择。 */
  spectateId: null,
  /** 玩家是否已关闭死亡卡片。 */
  deathDismissed: false,
  /** 打开帮助前是否处于暂停，用于关闭时恢复。 */
  helpWasPaused: false,
  /** 上次渲染的选技卡缓存键，避免每帧重建 DOM。 */
  choiceKey: '',
  /** 上一帧的 HUD 对比基线，用于触发播报。 */
  lastLevel: 1,
  lastPhase: 'grace',
  lastAlive: 0,
  lastHp: 0,
  lastKills: 0,
  /** 上次刷新 HUD 的时间戳。 */
  lastHud: 0,
  /** 声音开关与 AudioContext 实例。 */
  soundOn: false,
  audio: null,
  /** 待释放的技能槽（-1 表示无）。 */
  castSlot: -1,
  /** 当前按下的按键集合。 */
  keys: new Set(),
  /** 画布内指针坐标（CSS 像素）。 */
  pointer: { x: 0, y: 0 },
  /** 固定步长累加器与上一帧时间戳。 */
  accumulator: 0,
  previous: 0,
  /** FPS 统计。 */
  fpsFrames: 0,
  fpsAt: 0,
  /** Renderer 实例，由 app.js 在 DOM 就绪后创建。 */
  renderer: null,
};
