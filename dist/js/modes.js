/**
 * 玩法模式注册表。
 *
 * 重构前的问题：`mode === 'melee'` 这类判断散落在 5 个模块共 18 处，
 * 而且 combat.js 靠「getSkills(game) === MELEE_SKILLS」这种对象身份比较来分流，
 * 每秒要比较上千次。新增第三种玩法（弓弩/召唤）时必须改全 18 处，漏一处就静默走错分支。
 *
 * 现在每个模式在表里声明自己是什么，各模块按声明的键去查自己的行为表：
 *   combat.js   SKILL_CATALOGS[skillsKey] / TICKERS[combatKey] / CASTERS[combatKey]
 *   ai.js       THINKERS[aiKey]
 *   renderer.js POSE_DRAWERS[weaponType]
 *   simulation  POINTER_INPUT_MODES（由 usesPointerAttack 派生）
 * 加新模式 = registerMode({...}) + 在各行为表里加对应键，判断点不需要再增加。
 *
 * 本模块保持零依赖（不 import combat.js），避免形成循环依赖。
 */

/** 近战刀战的公共动作参数（普攻窗口与伤害倍率）。 */
export const MELEE_BALANCE = Object.freeze({
  range: 68,
  arc: 2 * Math.PI / 3,
  interval: 0.65,
  windup: 0.20,
  active: 0.08,
  damageMultiplier: 2.2,
});

export const DEFAULT_MODE = 'classic';

/** 模式声明必须提供的全部字段；缺一个就视为半个模式，直接拒绝注册。 */
const REQUIRED_FIELDS = Object.freeze([
  'id', 'name', 'description', 'controls', 'weaponType',
  'skillsKey', 'combatKey', 'aiKey',
  'usesPointerAttack', 'bodyClass', 'attackControlHtml', 'portraitPose',
  'damageLabel', 'damageDisplayMultiplier',
]);

/**
 * 模式表。表本身可变，但注册进去的模式对象是冻结的 ——
 * 扩展点是 registerMode()，而不是去改这个文件里的字面量。
 * 所有模块共享同一个表对象，因此注册后立刻对所有模块生效。
 */
const registry = Object.create(null);

/** 注册（或覆盖）一个模式。字段不全直接抛错，不会留下半个模式。 */
export function registerMode(definition) {
  if (!definition || typeof definition !== 'object') throw new TypeError('registerMode 需要一个模式定义对象');
  for (const field of REQUIRED_FIELDS) {
    if (!(field in definition)) throw new TypeError(`模式定义缺少字段 ${field}`);
  }
  registry[definition.id] = Object.freeze({ ...definition });
  return registry[definition.id];
}

/** 取消注册。主要用于测试，避免污染后续用例。默认模式不允许注销。 */
export function unregisterMode(id) {
  if (id === DEFAULT_MODE) throw new Error(`不能注销默认模式 ${DEFAULT_MODE}`);
  delete registry[id];
}

registerMode({
  id: 'classic',
  name: '经典远程',
  description: '自动索敌射击，收集经验强化技能。',
  controls: 'WASD移动，Q/E/R施放技能，1/2/3选择强化',
  /** 武器种类：决定角色初始状态、渲染姿态、以及是否走近战动作系统。 */
  weaponType: 'ranged',
  /** 技能目录键（combat.js 的 SKILL_CATALOGS）。 */
  skillsKey: 'classic',
  /** 每帧 Actor 更新与技能释放的行为键。 */
  combatKey: 'classic',
  /** AI 决策键（ai.js 的 THINKERS）。 */
  aiKey: 'classic',
  /** 是否需要鼠标左键攻击输入。 */
  usesPointerAttack: false,
  /** 给 <body> 加的样式类，用于模式专属 CSS。 */
  bodyClass: '',
  /** 操作提示文案。 */
  attackControlHtml: '<span class="control-icon">⌖</span><span>自动普攻</span>',
  /** 头像/选人卡姿态。null 表示使用远程默认姿态。 */
  portraitPose: null,
  /** HUD 攻击力标签与展示倍率。 */
  damageLabel: '攻击',
  damageDisplayMultiplier: 1,
});

registerMode({
  id: 'melee',
  name: '近战刀战',
  description: '鼠标瞄准，挥刀与突进斩击。',
  controls: 'WASD移动，鼠标瞄准，按住左键连续挥刀，Q/E/R施放技能，1/2/3选择强化',
  weaponType: 'sword',
  skillsKey: 'melee',
  combatKey: 'melee',
  aiKey: 'melee',
  usesPointerAttack: true,
  bodyClass: 'mode-melee',
  attackControlHtml: '<kbd>左键</kbd><span>瞄准 · 按住连斩</span>',
  // 头像里让角色朝左上举刀，与近战模式的第一印象一致。
  portraitPose: Object.freeze({ weaponType: 'sword', aimAngle: -Math.PI / 3, attackRange: 36 }),
  damageLabel: '刀伤',
  // 近战 HUD 展示的是“刀伤”，需乘上近战动作的基础伤害倍率。
  damageDisplayMultiplier: MELEE_BALANCE.damageMultiplier,
});

export const MODES = registry;

export function normalizeMode(mode) {
  return Object.hasOwn(registry, mode) ? mode : DEFAULT_MODE;
}

/** 取模式声明；未知模式一律落回默认，不会返回 undefined。 */
export function modeOf(mode) {
  return registry[normalizeMode(mode)];
}

/** 武器的行为键：'ranged' | 'sword'。渲染器和角色配置都靠它分流。 */
export function weaponTypeOf(mode) {
  return modeOf(mode).weaponType;
}

/** 该模式的角色是否走近战动作系统（有 meleeAction / meleeVisuals）。 */
export function usesMeleeActions(mode) {
  return weaponTypeOf(mode) === 'sword';
}
