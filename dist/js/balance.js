/**
 * 平衡数值的单一来源。
 *
 * 为什么需要这个文件：
 *  1. 以前技能数值（伤害/半径/冷却/位移）散落在 castSkill、castMeleeSkill、tickMelee、
 *     fireBasic 的各处表达式里，而中文描述字符串里又手写了一串数字。
 *     调一次平衡要同时改代码和描述，改漏了就是给玩家看错数字。
 *  2. AI 策略（ai.js）需要知道刀技的实际触及范围来判断是否开技能，
 *     于是 78 / 96 / 112 这些数字在 combat.js 和 ai.js 里各写了一份。
 *     ai.js 不能 import combat.js（会形成循环依赖），但可以 import 本文件。
 *
 * 约定：本模块零依赖、纯数据 + 纯函数，不 import 任何其他模块。
 */

/** 把浮点误差抹平后再转字符串，避免 3.6999999999999997 这种输出。 */
export const num = (value) => String(Math.round(value * 100) / 100);

/** 百分比显示：0.065 -> 6.5 */
const pct = (ratio) => num(ratio * 100);

// ---------------------------------------------------------------------------
// 通用攻击参数
// ---------------------------------------------------------------------------

export const ATTACK = Object.freeze({
  /** createActor 的初始攻击间隔与射程（远程）。 */
  baseInterval: 0.88,
  baseRange: 220,
  baseDamage: 13,
  /** 攻击间隔的下限，防止攻速叠满后出现零间隔。 */
  minInterval: 0.34,
  /** haste / multishot 各自对攻击间隔的缩短系数。 */
  hasteIntervalReduction: 0.065,
  multishotIntervalReduction: 0.055,
  /** 攻速乘数下限。 */
  minIntervalMultiplier: 0.56,
  /** 弹丸基础速度，以及每级 multishot 的加成。 */
  bulletSpeed: 350,
  multishotSpeedBonus: 18,
  /** multishot 达到该等级后每次攻击额外发射一枚。 */
  multishotExtraAtRank: 4,
  bulletTtlFloor: 0.45,
  bulletTtlPadding: 0.16,
  bulletRadius: 4,
});

// ---------------------------------------------------------------------------
// 被动技能数值
// ---------------------------------------------------------------------------

export const PASSIVE = Object.freeze({
  /** 强力弹丸 / 刀锋强化：每级 +10% 伤害，5 级共 +50%。 */
  powerDamagePerRank: 0.1,
  /** 迅捷：每级移速 +8%，5 级共 +40%。 */
  hasteSpeedPerRank: 0.08,
  hasteMaxRank: 5,
  /** 坚韧：每级最大生命 +30 并立刻恢复 30；每 2.5 秒回复 0.35 + 0.22/级。 */
  vitalityHpPerRank: 30,
  vitalityHealOnRank: 30,
  vitalityRegenInterval: 2.5,
  vitalityRegenBase: 0.35,
  vitalityRegenPerRank: 0.22,
  /** 拾荒者：每级 +18 像素，基础 30，5 级共 120。 */
  magnetRadiusBase: 30,
  magnetRadiusPerRank: 18,
  /** 刀势延伸：每级普攻范围 +4 像素、扇形角度 +6°。 */
  bladeReachRangePerRank: 4,
  bladeReachArcDegPerRank: 6,
  bladeReachMaxRank: 5,
  precisionMaxRank: 5,
  precisionChancePerRank: 0.05,
  precisionMultiplier: 1.5,
  sustainMaxRank: 5,
  sustainHealPerRank: 3,
  focusMaxRank: 5,
  focusReductionPerRank: 0.04,
  /** 迅捷同时缩短普攻间隔，复用 ATTACK 的系数。 */
});

// ---------------------------------------------------------------------------
// 主动技能数值
// ---------------------------------------------------------------------------

/**
 * 每个技能一条记录，同时被「计算」和「描述」使用。
 * rank 一律从 1 开始。
 */
export const ACTIVES = Object.freeze({
  fireball: Object.freeze({
    name: '火球',
    icon: '●',
    color: '#ff8a42',
    maxRank: 4,
    cooldown: 4.2,
    /** 冷却按等级缩短：cooldown * max(floor, 1 - rank * perRank)。 */
    cooldownFloor: 0.58,
    cooldownPerRank: 0.08,
    damageBase: 27,
    damagePerRank: 9,
    splashBase: 48,
    splashPerRank: 8,
    radiusBase: 9,
    radiusPerRank: 1,
    speed: 310,
    ttl: 2.2,
    muzzle: 15,
    effectRadius: 20,
    effectTtl: 0.35,
  }),
  dash: Object.freeze({
    name: '震荡冲刺',
    icon: '➤',
    color: '#67e8f9',
    maxRank: 4,
    cooldown: 6.5,
    cooldownFloor: 0.64,
    cooldownPerRank: 0.06,
    distanceBase: 100,
    distancePerRank: 12,
    damageBase: 23,
    damagePerRank: 8,
    radiusBase: 42,
    radiusPerRank: 5,
    effectRadiusBase: 54,
    effectRadiusPerRank: 6,
    effectTtl: 0.35,
  }),
  quake: Object.freeze({
    name: '震荡波',
    icon: '◎',
    color: '#c084fc',
    maxRank: 4,
    cooldown: 8,
    cooldownFloor: 0.64,
    cooldownPerRank: 0.06,
    damageBase: 20,
    damagePerRank: 9,
    radiusBase: 86,
    radiusPerRank: 17,
    effectTtl: 0.6,
  }),
  lunge: Object.freeze({
    name: '突进斩',
    icon: '➤',
    color: '#67e8f9',
    maxRank: 4,
    cooldown: 7,
    cooldownFloor: 0.64,
    cooldownPerRank: 0.06,
    distanceBase: 112,
    distancePerRank: 12,
    coefficientBase: 2.8,
    coefficientPerRank: 0.3,
  }),
  whirlwind: Object.freeze({
    name: '旋风斩',
    icon: '◎',
    color: '#c084fc',
    maxRank: 4,
    cooldown: 8,
    cooldownFloor: 0.64,
    cooldownPerRank: 0.06,
    radiusBase: 78,
    radiusPerRank: 6,
    coefficientBase: 3,
    coefficientPerRank: 0.3,
  }),
  heavySlash: Object.freeze({
    name: '重斩',
    icon: '✦',
    color: '#ff8a42',
    maxRank: 4,
    cooldown: 8,
    cooldownFloor: 0.64,
    cooldownPerRank: 0.06,
    windup: 0.35,
    rangeBase: 96,
    rangePerRank: 6,
    arcDeg: 80,
    coefficientBase: 3.5,
    coefficientPerRank: 0.4,
    knockback: 24,
  }),
  chainLightning: Object.freeze({
    name: '闪电链', icon: 'ϟ', color: '#a6e4ff', maxRank: 4, cooldown: 7.5,
    damageBase: 30, damagePerRank: 6, firstRange: 260,
    targetsBase: 3, extraTargetAtRank: 3, jumpRange: 145, jumpDamageMultiplier: 0.75,
    effectTtl: 0.65,
  }),
  frostNova: Object.freeze({
    name: '冰霜新星', icon: '❄', color: '#8de4f2', maxRank: 4, cooldown: 9,
    radiusBase: 125, radiusPerRank: 10, damageBase: 22, damagePerRank: 5,
    slowMultiplier: 0.65, slowDurationBase: 2, slowDurationPerRank: 0.25, effectTtl: 0.9,
  }),
  piercingThrust: Object.freeze({
    name: '穿云刺', icon: '⇢', color: '#b6e4ff', maxRank: 4, cooldown: 6.5,
    windup: 0.22, rangeBase: 140, rangePerRank: 10, arcDeg: 30,
    coefficientBase: 2.6, coefficientPerRank: 0.2,
  }),
  bladeWard: Object.freeze({
    name: '护体刀阵', icon: '◇', color: '#9de9ca', maxRank: 4, cooldown: 10,
    shieldBase: 36, shieldPerRank: 12, durationBase: 3.5, durationPerRank: 0.25,
    effectTtl: 0.8, effectRadiusPadding: 18,
  }),
});

/** 近战技能的公共动作窗口（与 MELEE_BALANCE 的普攻窗口无关）。 */
export const MELEE_ACTIVE_WINDOW = Object.freeze({ active: 0.08, recovery: 0.25 });

// ---------------------------------------------------------------------------
// 怪物类型
// ---------------------------------------------------------------------------

/**
 * 以前一种怪物要改四个地方：
 *   simulation.js 的 spawnMonster（数值）、combat.js 的 tickMonster（速度兜底表）、
 *   classifyDamage（死亡归因的类型白名单）、damageCauseLabel（中文名）。
 * 漏改白名单不会让任何测试变红，只会让伤害归因静默变成兜底值，
 * 而 simulate.js 的死亡统计从此失真。现在四个地方都查这张表。
 *
 * spawnSpeed 与 fallbackSpeed 是两套值，必须保留差异：
 * spawn 时写入 monster.speed，而 tickMonster 只在缺 speed 时才用兜底表，
 * 两者历史上就不一致（例如史莱姆 44 / 38），合并会改变行为。
 */
export const MONSTERS = Object.freeze({
  slime: Object.freeze({
    name: '史莱姆', hp: 40, radius: 10, spawnSpeed: 44, fallbackSpeed: 38, damage: 6, xp: 15,
  }),
  bat: Object.freeze({
    name: '蝙蝠', hp: 26, radius: 10, spawnSpeed: 69, fallbackSpeed: 70, damage: 6, xp: 15,
  }),
  brute: Object.freeze({
    name: '巨兽', hp: 80, radius: 15, spawnSpeed: 35, fallbackSpeed: 25, damage: 12, xp: 25,
  }),
});

/** 未知类型的落回值（与历史行为一致）。 */
export const MONSTER_FALLBACK = Object.freeze({ speed: 38, name: '怪物' });

/** 刷怪选择策略。注意 rng 消耗顺序必须与历史一致：先判 brute，再判 bat。 */
export const MONSTER_SPAWN_POLICY = Object.freeze({
  bruteAfterSeconds: 170,
  bruteChance: 0.24,
  batChance: 0.28,
});

/** 巨兽额外掉治疗晶体的概率。 */
export const BRUTE_HEAL_DROP_CHANCE = 0.28;

/** 怪物类型是否是已知类型（用于死亡归因，避免兜底静默生效）。 */
export const isKnownMonster = (type) => Object.hasOwn(MONSTERS, type);

// ---------------------------------------------------------------------------
// 派生函数：技能几何与数值（combat.js 与 ai.js 共用，保证两边永远一致）
// ---------------------------------------------------------------------------

/** 火球爆炸半径 */
export const fireballSplash = (rank) => ACTIVES.fireball.splashBase + ACTIVES.fireball.splashPerRank * rank;
/** 火球伤害 */
export const fireballDamage = (rank) => ACTIVES.fireball.damageBase + ACTIVES.fireball.damagePerRank * rank;
/** keepRange: 震荡冲刺位移 */
export const dashDistance = (rank) => ACTIVES.dash.distanceBase + ACTIVES.dash.distancePerRank * rank;
/** 震荡冲刺伤害 */
export const dashDamage = (rank) => ACTIVES.dash.damageBase + ACTIVES.dash.damagePerRank * rank;
/** 震荡冲刺冲击半径 */
export const dashRadius = (rank) => ACTIVES.dash.radiusBase + ACTIVES.dash.radiusPerRank * rank;
/** 震荡波伤害 */
export const quakeDamage = (rank) => ACTIVES.quake.damageBase + ACTIVES.quake.damagePerRank * rank;
/** 震荡波半径 */
export const quakeRadius = (rank) => ACTIVES.quake.radiusBase + ACTIVES.quake.radiusPerRank * rank;

/** 突进斩位移（rank 从 1 起） */
export const lungeDistance = (rank) => ACTIVES.lunge.distanceBase + ACTIVES.lunge.distancePerRank * (rank - 1);
/** 突进斩伤害倍率 */
export const lungeCoefficient = (rank) => ACTIVES.lunge.coefficientBase + ACTIVES.lunge.coefficientPerRank * (rank - 1);

/** 旋风斩触及半径 */
export const whirlwindRadius = (rank) => ACTIVES.whirlwind.radiusBase + ACTIVES.whirlwind.radiusPerRank * (rank - 1);
/** 旋风斩伤害倍率 */
export const whirlwindCoefficient = (rank) =>
  ACTIVES.whirlwind.coefficientBase + ACTIVES.whirlwind.coefficientPerRank * (rank - 1);

/** 重斩触及范围 */
export const heavySlashRange = (rank) => ACTIVES.heavySlash.rangeBase + ACTIVES.heavySlash.rangePerRank * (rank - 1);
/** 重斩伤害倍率 */
export const heavySlashCoefficient = (rank) =>
  ACTIVES.heavySlash.coefficientBase + ACTIVES.heavySlash.coefficientPerRank * (rank - 1);

export const chainLightningDamage = (rank) => ACTIVES.chainLightning.damageBase + ACTIVES.chainLightning.damagePerRank * (rank - 1);
export const chainLightningTargets = (rank) => ACTIVES.chainLightning.targetsBase + (rank >= ACTIVES.chainLightning.extraTargetAtRank ? 1 : 0);
export const frostNovaRadius = (rank) => ACTIVES.frostNova.radiusBase + ACTIVES.frostNova.radiusPerRank * (rank - 1);
export const frostNovaDamage = (rank) => ACTIVES.frostNova.damageBase + ACTIVES.frostNova.damagePerRank * (rank - 1);
export const piercingThrustRange = (rank) => ACTIVES.piercingThrust.rangeBase + ACTIVES.piercingThrust.rangePerRank * (rank - 1);
export const piercingThrustCoefficient = (rank) => ACTIVES.piercingThrust.coefficientBase + ACTIVES.piercingThrust.coefficientPerRank * (rank - 1);
export const bladeWardShield = (rank) => ACTIVES.bladeWard.shieldBase + ACTIVES.bladeWard.shieldPerRank * (rank - 1);
export const bladeWardDuration = (rank) => ACTIVES.bladeWard.durationBase + ACTIVES.bladeWard.durationPerRank * (rank - 1);

/** 灵能专注只缩短主动技能冷却；无该被动时保持原值。 */
export const focusCooldown = (base, rank = 0) => base * (1 - Math.max(0, Math.min(PASSIVE.focusMaxRank, rank)) * PASSIVE.focusReductionPerRank);

/** 主动技能实际冷却（按等级缩短）。 */
export function skillCooldown(id, rank) {
  const def = ACTIVES[id];
  if (!def) return 0;
  return def.cooldown * Math.max(def.cooldownFloor ?? 1, 1 - rank * (def.cooldownPerRank ?? 0));
}

/** 刀势延伸带来的射程加成。 */
export const bladeReachBonus = (rank) => Math.min(PASSIVE.bladeReachMaxRank, rank) * PASSIVE.bladeReachRangePerRank;

// ---------------------------------------------------------------------------
// 描述文本：由上面的常量生成，不再手写数字
// ---------------------------------------------------------------------------

const range = (base, per, first = 1, last = 4) => `${num(base + per * first)}→${num(base + per * last)}`;

export const DESCRIPTIONS = Object.freeze({
  fireball: `每级伤害${num(fireballDamage(1))}→${num(fireballDamage(ACTIVES.fireball.maxRank))}，`
    + `爆炸半径${num(fireballSplash(1))}→${num(fireballSplash(ACTIVES.fireball.maxRank))}，`
    + `冷却${num(skillCooldown('fireball', 1))}→${num(skillCooldown('fireball', ACTIVES.fireball.maxRank))}秒`
    + `（共${ACTIVES.fireball.maxRank}级）`,
  dash: `冲刺${range(ACTIVES.dash.distanceBase, ACTIVES.dash.distancePerRank)}像素；`
    + `冲击伤害${range(ACTIVES.dash.damageBase, ACTIVES.dash.damagePerRank)}、`
    + `半径${range(ACTIVES.dash.radiusBase, ACTIVES.dash.radiusPerRank)}（共${ACTIVES.dash.maxRank}级）`,
  quake: `范围伤害${range(ACTIVES.quake.damageBase, ACTIVES.quake.damagePerRank)}、`
    + `半径${range(ACTIVES.quake.radiusBase, ACTIVES.quake.radiusPerRank)}（共${ACTIVES.quake.maxRank}级）`,
  power: `每级所有攻击伤害+${pct(PASSIVE.powerDamagePerRank)}%，最多+${pct(PASSIVE.powerDamagePerRank * PASSIVE.hasteMaxRank)}%`,
  haste: `每级移速+${pct(PASSIVE.hasteSpeedPerRank)}%、攻击间隔缩短${pct(ATTACK.hasteIntervalReduction)}%，`
    + `最多移速+${pct(PASSIVE.hasteSpeedPerRank * PASSIVE.hasteMaxRank)}%`,
  vitality: `每级最大生命+${PASSIVE.vitalityHpPerRank}并立即恢复${PASSIVE.vitalityHealOnRank}；`
    + `每${PASSIVE.vitalityRegenInterval}秒恢复`
    + `${num(PASSIVE.vitalityRegenBase + PASSIVE.vitalityRegenPerRank * 1)}→`
    + `${num(PASSIVE.vitalityRegenBase + PASSIVE.vitalityRegenPerRank * PASSIVE.hasteMaxRank)}生命`,
  magnet: `每级拾取半径+${PASSIVE.magnetRadiusPerRank}像素，`
    + `从${PASSIVE.magnetRadiusBase}扩大到${PASSIVE.magnetRadiusBase + PASSIVE.magnetRadiusPerRank * PASSIVE.hasteMaxRank}`,
  multishot: `每级攻击间隔缩短${pct(ATTACK.multishotIntervalReduction)}%、弹速+${ATTACK.multishotSpeedBonus}；`
    + `${ATTACK.multishotExtraAtRank}级起每次攻击额外发射1枚弹丸`,
  bladeReach: `每级普攻范围+${PASSIVE.bladeReachRangePerRank}像素、`
    + `扇形角度+${PASSIVE.bladeReachArcDegPerRank}°`,
  lunge: `向瞄准方向突进${range(ACTIVES.lunge.distanceBase, ACTIVES.lunge.distancePerRank, 0, 3)}像素，`
    + `挥刀造成${num(lungeCoefficient(1))}→${num(lungeCoefficient(ACTIVES.lunge.maxRank))}倍伤害`,
  whirlwind: `周身${range(ACTIVES.whirlwind.radiusBase, ACTIVES.whirlwind.radiusPerRank, 0, 3)}像素斩击，`
    + `造成${num(whirlwindCoefficient(1))}→${num(whirlwindCoefficient(ACTIVES.whirlwind.maxRank))}倍伤害`,
  heavySlash: `蓄力${ACTIVES.heavySlash.windup}秒，`
    + `斩击${range(ACTIVES.heavySlash.rangeBase, ACTIVES.heavySlash.rangePerRank, 0, 3)}像素，`
    + `造成${num(heavySlashCoefficient(1))}→${num(heavySlashCoefficient(ACTIVES.heavySlash.maxRank))}倍伤害并击退`,
  chainLightning: `向前优先锁定${ACTIVES.chainLightning.firstRange}像素内可见敌人，首击伤害${num(chainLightningDamage(1))}→${num(chainLightningDamage(ACTIVES.chainLightning.maxRank))}；`
    + `共命中${chainLightningTargets(1)}→${chainLightningTargets(ACTIVES.chainLightning.maxRank)}个目标，跳距${ACTIVES.chainLightning.jumpRange}像素、每跳保留${pct(ACTIVES.chainLightning.jumpDamageMultiplier)}%伤害；冷却${ACTIVES.chainLightning.cooldown}秒`,
  frostNova: `周身${num(frostNovaRadius(1))}→${num(frostNovaRadius(ACTIVES.frostNova.maxRank))}像素冰爆，伤害${num(frostNovaDamage(1))}→${num(frostNovaDamage(ACTIVES.frostNova.maxRank))}；`
    + `减速${pct(1 - ACTIVES.frostNova.slowMultiplier)}%，持续${num(ACTIVES.frostNova.slowDurationBase)}→${num(ACTIVES.frostNova.slowDurationBase + (ACTIVES.frostNova.maxRank - 1) * ACTIVES.frostNova.slowDurationPerRank)}秒；冷却${ACTIVES.frostNova.cooldown}秒`,
  piercingThrust: `蓄力${ACTIVES.piercingThrust.windup}秒，刺穿前方${ACTIVES.piercingThrust.arcDeg}°、${num(piercingThrustRange(1))}→${num(piercingThrustRange(ACTIVES.piercingThrust.maxRank))}像素内敌人，`
    + `造成${num(piercingThrustCoefficient(1))}→${num(piercingThrustCoefficient(ACTIVES.piercingThrust.maxRank))}倍伤害；冷却${ACTIVES.piercingThrust.cooldown}秒`,
  bladeWard: `获得${num(bladeWardShield(1))}→${num(bladeWardShield(ACTIVES.bladeWard.maxRank))}点护盾，持续${num(bladeWardDuration(1))}→${num(bladeWardDuration(ACTIVES.bladeWard.maxRank))}秒；`
    + `重复施放刷新护盾，风暴伤害穿透；冷却${ACTIVES.bladeWard.cooldown}秒`,
  precision: `每级暴击率+${pct(PASSIVE.precisionChancePerRank)}%，最多${pct(PASSIVE.precisionChancePerRank * PASSIVE.precisionMaxRank)}%；攻击暴击造成${num(PASSIVE.precisionMultiplier)}倍伤害`,
  sustain: `每级击杀敌人恢复${PASSIVE.sustainHealPerRank}生命，最多恢复${PASSIVE.sustainHealPerRank * PASSIVE.sustainMaxRank}；不超过最大生命`,
  focus: `每级主动技能实际冷却缩短${pct(PASSIVE.focusReductionPerRank)}%，最多缩短${pct(PASSIVE.focusReductionPerRank * PASSIVE.focusMaxRank)}%`,
});
