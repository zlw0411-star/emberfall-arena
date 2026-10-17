// Combat simulation. This module deliberately has no DOM or external dependencies.
import { lineClear, moveEntity } from './world.js';
import { normalizeMode, MELEE_BALANCE } from './modes.js';
import {
  ACTIVES, ATTACK, BRUTE_HEAL_DROP_CHANCE, DESCRIPTIONS, MELEE_ACTIVE_WINDOW, MONSTER_FALLBACK, MONSTERS, PASSIVE,
  bladeReachBonus, dashDamage, dashDistance, dashRadius,
  fireballDamage, fireballSplash, heavySlashCoefficient, heavySlashRange, isKnownMonster,
  lungeCoefficient, lungeDistance, quakeDamage, quakeRadius,
  skillCooldown, whirlwindCoefficient, whirlwindRadius,
} from './balance.js';

// 技能目录只声明「是什么」（类型/图标/上限），数值一律来自 balance.js，
// 描述文本由数值生成 —— 调平衡时不会再出现代码与文案不同步。
export const SKILLS = {
  fireball: { name: ACTIVES.fireball.name, description: DESCRIPTIONS.fireball, icon: ACTIVES.fireball.icon, color: ACTIVES.fireball.color, type: 'active', maxRank: ACTIVES.fireball.maxRank, cooldown: ACTIVES.fireball.cooldown },
  dash: { name: ACTIVES.dash.name, description: DESCRIPTIONS.dash, icon: ACTIVES.dash.icon, color: ACTIVES.dash.color, type: 'active', maxRank: ACTIVES.dash.maxRank, cooldown: ACTIVES.dash.cooldown },
  quake: { name: ACTIVES.quake.name, description: DESCRIPTIONS.quake, icon: ACTIVES.quake.icon, color: ACTIVES.quake.color, type: 'active', maxRank: ACTIVES.quake.maxRank, cooldown: ACTIVES.quake.cooldown },
  power: { name: '强力弹丸', description: DESCRIPTIONS.power, icon: '✦', color: '#fb7185', type: 'passive', maxRank: PASSIVE.hasteMaxRank, cooldown: 0 },
  haste: { name: '迅捷', description: DESCRIPTIONS.haste, icon: '»', color: '#facc15', type: 'passive', maxRank: PASSIVE.hasteMaxRank, cooldown: 0 },
  vitality: { name: '坚韧', description: DESCRIPTIONS.vitality, icon: '♥', color: '#4ade80', type: 'passive', maxRank: PASSIVE.hasteMaxRank, cooldown: 0 },
  magnet: { name: '拾荒者', description: DESCRIPTIONS.magnet, icon: '✧', color: '#60a5fa', type: 'passive', maxRank: PASSIVE.hasteMaxRank, cooldown: 0 },
  multishot: { name: '连射', description: DESCRIPTIONS.multishot, icon: '⁝', color: '#f0abfc', type: 'passive', maxRank: PASSIVE.hasteMaxRank, cooldown: 0 },
};

export const MELEE_SKILLS = {
  lunge: { name: ACTIVES.lunge.name, description: DESCRIPTIONS.lunge, icon: ACTIVES.lunge.icon, color: ACTIVES.lunge.color, type: 'active', maxRank: ACTIVES.lunge.maxRank, cooldown: ACTIVES.lunge.cooldown },
  whirlwind: { name: ACTIVES.whirlwind.name, description: DESCRIPTIONS.whirlwind, icon: ACTIVES.whirlwind.icon, color: ACTIVES.whirlwind.color, type: 'active', maxRank: ACTIVES.whirlwind.maxRank, cooldown: ACTIVES.whirlwind.cooldown },
  heavySlash: { name: ACTIVES.heavySlash.name, description: DESCRIPTIONS.heavySlash, icon: ACTIVES.heavySlash.icon, color: ACTIVES.heavySlash.color, type: 'active', maxRank: ACTIVES.heavySlash.maxRank, cooldown: ACTIVES.heavySlash.cooldown },
  power: { ...SKILLS.power, name: '刀锋强化' },
  haste: { ...SKILLS.haste }, vitality: { ...SKILLS.vitality }, magnet: { ...SKILLS.magnet },
  bladeReach: { name: '刀势延伸', description: DESCRIPTIONS.bladeReach, icon: '⌁', color: '#f0abfc', type: 'passive', maxRank: PASSIVE.bladeReachMaxRank, cooldown: 0 },
};
export function getSkills(gameOrMode) {
  const mode = typeof gameOrMode === 'string' ? gameOrMode : gameOrMode?.mode ?? (gameOrMode?.weaponType === 'sword' ? 'melee' : 'classic');
  return normalizeMode(mode) === 'melee' ? MELEE_SKILLS : SKILLS;
}
export function configureActorForMode(actor, mode) {
  actor.weaponType = normalizeMode(mode) === 'melee' ? 'sword' : 'ranged';
  if (actor.weaponType === 'sword') Object.assign(actor, { attackRange: MELEE_BALANCE.range, attackInterval: MELEE_BALANCE.interval, attackTimer: 0, aimAngle: 0, attackHeld: false, attackPressed: false, meleeAction: null, meleeVisuals: [] });
  return actor;
}

export const PROGRESSION = Object.freeze({
  maxLevel: 15,
  milestones: Object.freeze([2, 4, 6, 8, 10, 12, 14, 15]),
  maxActiveSkills: 3,
});

export const COMBAT_BALANCE = Object.freeze({
  actorDamageMultiplier: 0.95,
  huntDamageMultiplier: 0.65,
  finaleDamageMultiplier: 0.95,
  xpThresholdMultiplier: 1.1,
  baseMaxHp: 280,
  levelMaxHp: 8,
  levelHeal: 8,
  baseAttackDamage: ATTACK.baseDamage,
  levelAttackDamage: 0.4,
  // 以下三项与被动技能共用同一常量，避免两处各写一份。
  powerDamagePerRank: PASSIVE.powerDamagePerRank,
  actorKillXpBase: 40,
  actorKillXpPerLevel: 5,
  vitalityMaxHp: PASSIVE.vitalityHpPerRank,
  vitalityHeal: PASSIVE.vitalityHealOnRank,
  healingGemValue: 40,
});

const MILESTONES = new Set(PROGRESSION.milestones);
const MAX_LEVEL = PROGRESSION.maxLevel;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const hypot = (x, y) => Math.hypot(x, y) || 1;
const actorList = game => Array.isArray(game?.actors) ? game.actors : [];
const monsterList = game => Array.isArray(game?.monsters) ? game.monsters : [];
const alive = entity => entity && entity.alive !== false && (entity.hp == null || entity.hp > 0);
const isActor = (game, entity) => !!entity && (entity.isPlayer === true || actorList(game).includes(entity));

/**
 * 确定性红线：任何需要随机数的地方都必须用 game.rng。
 * 以前写的是 `game?.rng || Math.random`，漏传就静默降级成不可复现，
 * 而这类 bug 不会让任何测试变红 —— 只会让“同种子逐帧全等”的验收失效。
 */
function requireRng(game) {
  if (game && typeof game.rng === 'function') return game.rng;
  throw new TypeError('缺少 game.rng：模拟必须可复现，禁止回退到 Math.random');
}

export function createActor(id, name, x, y, isPlayer = false, color = '#74d680') {
  return {
    id, name, x, y, radius: 12, isPlayer, color, alive: true,
    hp: COMBAT_BALANCE.baseMaxHp, maxHp: COMBAT_BALANCE.baseMaxHp, level: 1, xp: 0, kills: 0, monsterKills: 0, damageDealt: 0,
    speed: 100, attackDamage: COMBAT_BALANCE.baseAttackDamage, attackInterval: ATTACK.baseInterval, attackRange: ATTACK.baseRange,
    attackTimer: 0.18, pickupRadius: PASSIVE.magnetRadiusBase,
    skills: {}, activeSkills: [], cooldowns: {}, pendingChoices: 0, choices: [],
    regenTimer: 0, hitFlash: 0, combatSpeedMult: 1, speedBoostT: 0,
    damageTakenByKind: { actor: 0, monster: 0, trap: 0, zone: 0 },
    lastDamageKind: null, lastDamageSource: null,
  };
}

// XP required to advance from the supplied current level to the next one.
export function xpNeeded(level) {
  const lv = clamp(Math.floor(Number(level) || 1), 1, MAX_LEVEL);
  return Math.round((65 + (lv - 1) * 12) * COMBAT_BALANCE.xpThresholdMultiplier);
}

export function addXp(game, actor, amount) {
  if (!alive(actor) || actor.level >= MAX_LEVEL || !(amount > 0)) return 0;
  actor.xp = (actor.xp || 0) + amount;
  let gained = 0;
  while (actor.level < MAX_LEVEL && actor.xp >= xpNeeded(actor.level)) {
    actor.xp -= xpNeeded(actor.level);
    actor.level++;
    gained++;
    actor.maxHp = levelMaxHp(actor.level) + (actor.skills?.vitality || 0) * COMBAT_BALANCE.vitalityMaxHp;
    actor.hp = Math.min(actor.maxHp, actor.hp + COMBAT_BALANCE.levelHeal);
    // Recompute from the base so repeated XP grants cannot compound the level bonus.
    actor.attackDamage = COMBAT_BALANCE.baseAttackDamage + (actor.level - 1) * COMBAT_BALANCE.levelAttackDamage;
    if (MILESTONES.has(actor.level)) actor.pendingChoices = (actor.pendingChoices || 0) + 1;
    pushEffect(game, { x: actor.x, y: actor.y - 20, kind: 'text', text: `Lv.${actor.level} 生命+${COMBAT_BALANCE.levelMaxHp} 攻击+${COMBAT_BALANCE.levelAttackDamage}`, color: '#ffe67a', ttl: 1.3 });
  }
  if (actor.level >= MAX_LEVEL) actor.xp = 0;
  if (actor.pendingChoices > 0 && actor.isPlayer !== true) autoChoose(game, actor);
  return gained;
}

export function getChoices(game, actor) {
  if (!alive(actor) || !(actor.pendingChoices > 0)) return [];
  const skills = getSkills(game);
  const available = Object.keys(skills).filter(id => (actor.skills?.[id] || 0) < skills[id].maxRank && canLearnSkill(actor, id, skills));
  if (!available.length) {
    actor.pendingChoices = 0;
    actor.choices = [];
    return [];
  }
  // 选技必须消耗 game.rng 以保持同种子可复现；缺失时直接报错。
  const rng = requireRng(game);
  const pool = [...available];
  const choices = [];
  while (pool.length && choices.length < 3) {
    const index = Math.floor(Math.max(0, Math.min(0.999999999, rng())) * pool.length);
    choices.push(pool.splice(index, 1)[0]);
  }
  actor.choices = choices;
  return choices;
}

export function chooseSkill(game, actor, skillId) {
  const skills = getSkills(game);
  if (!alive(actor) || !(actor.pendingChoices > 0) || !Object.hasOwn(skills, skillId)) return false;
  let choices = actor.choices;
  if (!Array.isArray(choices) || !choices.length) choices = getChoices(game, actor);
  if (!choices.includes(skillId) || (actor.skills?.[skillId] || 0) >= skills[skillId].maxRank || !canLearnSkill(actor, skillId, skills)) return false;
  applySkillRank(actor, skillId, skills);
  actor.pendingChoices--;
  actor.choices = actor.pendingChoices > 0 ? getChoices(game, actor) : [];
  pushEvent(game, `${actor.name || '战士'} 强化了「${skills[skillId].name}」`, skills[skillId].color);
  pushEffect(game, { x: actor.x, y: actor.y - 28, kind: 'text', text: skills[skillId].name, color: skills[skillId].color, ttl: 1 });
  if (actor.isPlayer !== true && actor.pendingChoices > 0) autoChoose(game, actor);
  return true;
}

function applySkillRank(actor, skillId, skills = SKILLS) {
  actor.skills ||= {};
  actor.skills[skillId] = (actor.skills[skillId] || 0) + 1;
  if (skills[skillId].type === 'active' && !actor.activeSkills.includes(skillId)) actor.activeSkills.push(skillId);
  // 被动升级后的属性重算：以前是一串 `if (skillId === 'vitality') ...`，
  // 新增被动要在这里加分支，漏了就是“选了技能但没效果”。现在集中成一张表。
  const apply = RANK_EFFECTS[skillId];
  if (apply) apply(actor);
}

/** 被动技能升级后的属性重算。键必须与技能目录中的 id 对应。 */
const RANK_EFFECTS = {
  vitality(actor) {
    actor.maxHp = levelMaxHp(actor.level) + (actor.skills.vitality || 0) * COMBAT_BALANCE.vitalityMaxHp;
    actor.hp = Math.min(actor.maxHp, actor.hp + COMBAT_BALANCE.vitalityHeal);
  },
  haste(actor) { actor.speed = 100 * (1 + actor.skills.haste * PASSIVE.hasteSpeedPerRank); },
  magnet(actor) { actor.pickupRadius = PASSIVE.magnetRadiusBase + actor.skills.magnet * PASSIVE.magnetRadiusPerRank; },
  bladeReach(actor) { actor.attackRange = MELEE_BALANCE.range + bladeReachBonus(actor.skills.bladeReach); },
};

function autoChoose(game, actor) {
  const skills = getSkills(game);
  let guard = 0;
  while (actor.pendingChoices > 0 && guard++ < 10) {
    const options = getChoices(game, actor);
    if (!options.length) break;
    // Prefer an active option early, then strengthen the best available attack/passive.
    const rankOf = id => actor.skills?.[id] || 0;
    const priority = id => (rankOf(id) === 0 && skills[id].type === 'active' ? 4 : 0)
      + ({ power: 3, haste: 2, vitality: 1, multishot: 1, fireball: 2, quake: 1, dash: 1 }[id] || 0)
      - rankOf(id) * 0.2;
    options.sort((a, b) => priority(b) - priority(a));
    if (!chooseSkill(game, actor, options[0])) break;
  }
}

export function castSkill(game, actor, slot, aimX, aimY) {
  if (!alive(actor) || !Number.isInteger(slot) || slot < 0 || slot >= PROGRESSION.maxActiveSkills) return false;
  if (getSkills(game) === MELEE_SKILLS || actor.weaponType === 'sword') return castMeleeSkill(game, actor, slot, aimX, aimY);
  const skillId = actor.activeSkills?.[slot];
  if (!skillId || SKILLS[skillId]?.type !== 'active' || (actor.cooldowns?.[skillId] || 0) > 0) return false;
  const rank = actor.skills?.[skillId] || 0;
  if (!Number.isInteger(rank) || rank < 1 || rank > SKILLS[skillId].maxRank) return false;
  // 只有登记了释放效果才算可施放；新增主动技能只需在表里加一条。
  const effect = CAST_EFFECTS[skillId];
  if (!effect) return false;
  actor.cooldowns ||= {};
  actor.cooldowns[skillId] = skillCooldown(skillId, rank);
  const dx = (aimX ?? actor.x + 1) - actor.x;
  const dy = (aimY ?? actor.y) - actor.y;
  const len = hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  effect(game, actor, rank, ux, uy);
  return true;
}

/**
 * 远程主动技能的释放效果声明表。
 * 以前是 `if (skillId === 'fireball') ... else if (skillId === 'dash') ... else if (skillId === 'quake')`，
 * 新增技能要同时改目录、冷却、释放三处。现在释放行为只写在这里。
 */
const CAST_EFFECTS = {
  fireball(game, actor, rank, ux, uy) {
    game.bullets ||= [];
    game.bullets.push({ x: actor.x + ux * ACTIVES.fireball.muzzle, y: actor.y + uy * ACTIVES.fireball.muzzle, vx: ux * ACTIVES.fireball.speed, vy: uy * ACTIVES.fireball.speed,
      radius: ACTIVES.fireball.radiusBase + rank * ACTIVES.fireball.radiusPerRank, damage: scaledDamage(actor, fireballDamage(rank)), ownerId: actor.id, ttl: ACTIVES.fireball.ttl,
      kind: 'fireball', color: SKILLS.fireball.color, splash: fireballSplash(rank) });
    pushEffect(game, { x: actor.x + ux * 18, y: actor.y + uy * 18, kind: 'burst', color: SKILLS.fireball.color, radius: ACTIVES.fireball.effectRadius, ttl: ACTIVES.fireball.effectTtl });
  },
  dash(game, actor, rank, ux, uy) {
    // Skills may move actors; normal movement and mud slow remain core-owned.
    moveEntity(game.map, actor, ux * dashDistance(rank), uy * dashDistance(rank));
    const cx = actor.x, cy = actor.y;
    areaDamage(game, actor, cx, cy, dashRadius(rank), scaledDamage(actor, dashDamage(rank)), SKILLS.dash.color, 'slash');
    pushEffect(game, { x: cx, y: cy, kind: 'slash', color: SKILLS.dash.color, radius: ACTIVES.dash.effectRadiusBase + rank * ACTIVES.dash.effectRadiusPerRank, ttl: ACTIVES.dash.effectTtl });
  },
  quake(game, actor, rank) {
    const radius = quakeRadius(rank);
    areaDamage(game, actor, actor.x, actor.y, radius, scaledDamage(actor, quakeDamage(rank)), SKILLS.quake.color, 'burst');
    pushEffect(game, { x: actor.x, y: actor.y, kind: 'ring', color: SKILLS.quake.color, radius, ttl: ACTIVES.quake.effectTtl });
  },
};

export function damage(game, target, amount, source = null) {
  if (!alive(target) || !(amount > 0)) return 0;
  const sourceActor = resolveActor(game, source);
  if (isActor(game, target) && sourceActor && sourceActor !== target && game?.phase === 'grace') return 0;
  const damageKind = classifyDamage(game, target, sourceActor, source);
  const isActorHit = damageKind === 'actor' && isActor(game, target) && sourceActor !== target;
  const actorMultiplier = game?.phase === 'finale'
    ? COMBAT_BALANCE.finaleDamageMultiplier
    : game?.phase === 'hunt' ? COMBAT_BALANCE.huntDamageMultiplier : COMBAT_BALANCE.actorDamageMultiplier;
  const dealt = Math.max(0, amount * (isActorHit ? actorMultiplier : 1));
  target.damageTakenByKind ||= { actor: 0, monster: 0, trap: 0, zone: 0 };
  target.damageTakenByKind[damageKind] = (target.damageTakenByKind[damageKind] || 0) + dealt;
  target.lastDamageKind = damageKind;
  target.lastDamageSource = sourceActor && sourceActor !== target
    ? sourceActor.id
    : source?.id ?? (damageKind === 'zone' ? 'zone' : damageKind === 'trap' ? 'trap' : source?.type ? `monster:${source.type}` : null);
  target.hp = Math.max(0, (target.hp ?? target.maxHp ?? 0) - dealt);
  target.hitFlash = 0.12;
  if (sourceActor && sourceActor !== target) sourceActor.damageDealt = (sourceActor.damageDealt || 0) + dealt;
  pushEffect(game, { x: target.x, y: target.y - (target.radius || 10), kind: 'text', text: `-${Math.round(dealt)}`, color: '#ff756b', ttl: 0.55 });
  if (target.hp <= 0) {
    target.alive = false;
    if (isActor(game, target)) {
      if (target.weaponType === 'sword') { target.meleeAction = null; target.meleeVisuals = []; target.attackHeld = false; target.attackPressed = false; }
      target.pendingChoices = 0;
      target.choices = [];
      if (sourceActor && sourceActor !== target && actorList(game).includes(sourceActor)) {
        sourceActor.kills = (sourceActor.kills || 0) + 1;
        // Award only on this live -> dead transition, to the actor that dealt the lethal hit.
        const defeatedLevel = clamp(Math.floor(Number(target.level) || 1), 1, MAX_LEVEL);
        addXp(game, sourceActor, COMBAT_BALANCE.actorKillXpBase + defeatedLevel * COMBAT_BALANCE.actorKillXpPerLevel);
      }
      const cause = damageCauseLabel(damageKind, sourceActor, source);
      pushEvent(game, `${target.name || '战士'} 倒下了（${cause}）`, '#ff716d');
    } else {
      target.deathT = 0;
      if (sourceActor) {
        sourceActor.monsterKills = (sourceActor.monsterKills || 0) + 1;
        // A small immediate award keeps kill feedback crisp; the rest is a collectible gem.
        addXp(game, sourceActor, Math.max(1, (target.xp || 10) * 0.35));
      }
      dropGem(game, target, sourceActor ? (target.xp || 10) * 0.65 : (target.xp || 10));
      pushEffect(game, { x: target.x, y: target.y, kind: 'burst', color: target.color || '#86efac', radius: 28, ttl: 0.45 });
    }
  }
  return dealt;
}

export function updateCombat(game, dt) {
  if (!game || !(dt > 0)) return;
  const actors = actorList(game), monsters = monsterList(game);
  game.bullets ||= [];
  game.gems ||= [];
  game.effects ||= [];
  for (const actor of actors) {
    if (!alive(actor)) { if (actor.weaponType === 'sword') { actor.meleeAction = null; actor.meleeVisuals = []; actor.attackHeld = false; actor.attackPressed = false; } continue; }
    tickActor(game, actor, dt);
  }
  for (const monster of monsters) {
    if (alive(monster)) tickMonster(game, monster, dt);
  }
  tickBullets(game, dt);
  tickGems(game, dt);
  tickTraps(game, dt);
  tickEffects(game, dt);
}

function tickActor(game, actor, dt) {
  actor.attackTimer = Math.max(0, (actor.attackTimer || 0) - dt);
  actor.hitFlash = Math.max(0, (actor.hitFlash || 0) - dt);
  for (const id of Object.keys(actor.cooldowns || {})) actor.cooldowns[id] = Math.max(0, actor.cooldowns[id] - dt);
  if (actor.speedBoostT > 0) {
    actor.speedBoostT = Math.max(0, actor.speedBoostT - dt);
    if (!actor.speedBoostT) actor.combatSpeedMult = 1;
  }
  actor.regenTimer = (actor.regenTimer || 0) + dt;
  const vitality = actor.skills?.vitality || 0;
  if (vitality && actor.hp < actor.maxHp && actor.regenTimer >= PASSIVE.vitalityRegenInterval) {
    const ticks = Math.floor(actor.regenTimer / PASSIVE.vitalityRegenInterval);
    actor.regenTimer -= ticks * PASSIVE.vitalityRegenInterval;
    actor.hp = Math.min(actor.maxHp, actor.hp + ticks * (PASSIVE.vitalityRegenBase + vitality * PASSIVE.vitalityRegenPerRank));
  }
  if (actor.pendingChoices > 0 && actor.isPlayer !== true) autoChoose(game, actor);
  if (getSkills(game) === MELEE_SKILLS || actor.weaponType === 'sword') { tickMelee(game, actor, dt); return; }
  if (actor.attackTimer <= 0) {
    const targets = [...monsterList(game)];
    if (game.phase !== 'grace') targets.push(...actorList(game).filter(other => other !== actor && alive(other)));
    const target = nearest(targets, actor.x, actor.y, actor.attackRange || 220, entity => alive(entity) && hasLine(game.map, actor, entity));
    if (target) fireBasic(game, actor, target);
  }
}

function tickMonster(game, monster, dt) {
  monster.hitFlash = Math.max(0, (monster.hitFlash || 0) - dt);
  const candidates = actorList(game).filter(a => alive(a) && !(game.phase === 'grace' && monster.isActor));
  if (!candidates.length) return;
  const target = nearest(candidates, monster.x, monster.y, Infinity);
  if (!target) return;
  monster.attackTimer = Math.max(0, (monster.attackTimer || 0) - dt);
  const dx = target.x - monster.x, dy = target.y - monster.y, d = hypot(dx, dy);
  const reach = (monster.radius || 11) + (target.radius || 12) + 4;
  if (d <= reach) {
    if (monster.attackTimer <= 0) {
      const dealt = damage(game, target, monster.damage || 8, monster);
      if (dealt) monster.attackTimer = monster.attackInterval || (monster.type === 'brute' ? 1.45 : 1.0);
    }
    return;
  }
  // 速度兜底表已移到 balance.js 的 MONSTERS 表，与 spawnMonster 共用同一声明。
  // 注意用的是 fallbackSpeed 而非 spawnSpeed：历史行为两者本就不同。
  const speed = monster.speed || (MONSTERS[monster.type]?.fallbackSpeed ?? MONSTER_FALLBACK.speed);
  const mx = dx / d * speed * dt, my = dy / d * speed * dt;
  moveEntity(game.map, monster, mx, my);
}

function fireBasic(game, actor, target) {
  const dx = target.x - actor.x, dy = target.y - actor.y, d = hypot(dx, dy);
  const haste = actor.skills?.haste || 0;
  const multi = actor.skills?.multishot || 0;
  const rate = Math.max(ATTACK.minInterval, (actor.attackInterval || ATTACK.baseInterval)
    * Math.max(ATTACK.minIntervalMultiplier, 1 - haste * ATTACK.hasteIntervalReduction - multi * ATTACK.multishotIntervalReduction));
  actor.attackTimer = rate;
  const count = multi >= ATTACK.multishotExtraAtRank ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const angle = Math.atan2(dy, dx) + (i ? 0.10 : 0);
    const speed = ATTACK.bulletSpeed + multi * ATTACK.multishotSpeedBonus;
    game.bullets.push({ x: actor.x, y: actor.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      radius: ATTACK.bulletRadius, damage: scaledDamage(actor, actor.attackDamage || COMBAT_BALANCE.baseAttackDamage), ownerId: actor.id,
      ttl: Math.max(ATTACK.bulletTtlFloor, (actor.attackRange || ATTACK.baseRange) / speed + ATTACK.bulletTtlPadding), kind: 'basic', color: actor.color || '#fff1a8' });
  }
}

function tickBullets(game, dt) {
  const survivors = [];
  for (const b of game.bullets || []) {
    b.ttl -= dt;
    if (b.ttl <= 0) continue;
    const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
    if (!lineClear(game.map, { x: b.x, y: b.y }, { x: nx, y: ny }, b.radius || 3)) {
      if (b.kind === 'fireball') explode(game, b);
      continue;
    }
    b.x = nx; b.y = ny;
    const owner = actorList(game).find(a => a.id === b.ownerId) || null;
    const targets = monsterList(game).filter(m => alive(m));
    if (owner && game.phase !== 'grace') targets.push(...actorList(game).filter(a => alive(a) && a !== owner));
    // Monster projectiles may hit actors. Actor-v-actor hits are added only after grace.
    if (!owner) targets.push(...actorList(game).filter(a => alive(a)));
    const hit = nearest(targets, b.x, b.y, (b.radius || 4) + 18, target =>
      alive(target) && Math.hypot(target.x - b.x, target.y - b.y) <= (target.radius || 10) + (b.radius || 4));
    if (hit) {
      damage(game, hit, b.damage, owner || b);
      if (b.kind === 'fireball') explode(game, b);
      else pushEffect(game, { x: b.x, y: b.y, kind: 'burst', color: b.color, radius: 10, ttl: 0.2 });
      continue;
    }
    survivors.push(b);
  }
  game.bullets = survivors;
}

function explode(game, bullet) {
  areaDamage(game, resolveActor(game, bullet), bullet.x, bullet.y, bullet.splash || 48, bullet.damage * 0.7, bullet.color, 'burst');
  pushEffect(game, { x: bullet.x, y: bullet.y, kind: 'burst', color: bullet.color, radius: bullet.splash || 48, ttl: 0.38 });
}

function areaDamage(game, owner, x, y, radius, amount, color, kind = 'ring') {
  for (const target of [...monsterList(game), ...actorList(game)]) {
    if (!alive(target) || target === owner || Math.hypot(target.x - x, target.y - y) > radius + (target.radius || 0)) continue;
    if (isActor(game, target) && owner && game.phase === 'grace') continue;
    damage(game, target, amount, owner);
  }
  pushEffect(game, { x, y, kind, color, radius, ttl: 0.42 });
}

function tickGems(game, dt) {
  for (const gem of game.gems || []) {
    if (gem.ttl != null) gem.ttl -= dt;
    for (const actor of actorList(game)) {
      if (!alive(actor) || Math.hypot(actor.x - gem.x, actor.y - gem.y) > (actor.pickupRadius || 30) + (gem.radius || 5)) continue;
      if (gem.kind === 'heal') {
        const healed = Math.min(actor.maxHp - actor.hp, gem.value || 24);
        if (healed > 0) {
          actor.hp += healed;
          pushEffect(game, { x: actor.x, y: actor.y - 18, kind: 'text', text: `+${Math.round(healed)}`, color: '#69f0a1', ttl: 0.65 });
        }
      } else {
        addXp(game, actor, gem.value || 5);
        pushEffect(game, { x: actor.x, y: actor.y - 16, kind: 'text', text: `+${Math.round(gem.value || 5)} XP`, color: '#8be9ff', ttl: 0.55 });
      }
      gem.collected = true;
      break;
    }
  }
  game.gems = (game.gems || []).filter(g => !g.collected && (g.ttl == null || g.ttl > 0));
}

function tickTraps(game, dt) {
  if (!Array.isArray(game.map?.traps)) return;
  const t = game.time || 0;
  for (const trap of game.map.traps) {
    if (trap.type !== 'spike') continue;
    const phase = ((t + (trap.offset || 0)) % 4 + 4) % 4;
    trap.active = phase >= 2.8;
    trap.warning = phase >= 2.1 && phase < 2.8;
    if (!trap.active) continue;
    for (const entity of [...actorList(game), ...monsterList(game)]) {
      if (!alive(entity) || Math.hypot(entity.x - trap.x, entity.y - trap.y) > trap.r + (entity.radius || 0)) continue;
      entity.trapDamageTimer = (entity.trapDamageTimer || 0) - dt;
      if (entity.trapDamageTimer <= 0) {
        damage(game, entity, 8, null);
        entity.trapDamageTimer = 0.65;
        pushEffect(game, { x: trap.x, y: trap.y, kind: 'burst', color: '#fb7185', radius: trap.r, ttl: 0.28 });
      }
    }
  }
}

function tickEffects(game, dt) {
  game.effects = (game.effects || []).filter(effect => {
    effect.ttl = (effect.ttl ?? 0.5) - dt;
    return effect.ttl > 0;
  });
  if (Array.isArray(game.events)) game.events = game.events.slice(-30);
}

export function dropGem(game, monster, value) {
  game.gems ||= [];
  game.nextId ??= 1;
  if (monster.type === 'brute' || value >= 12) {
    game.gems.push({ id: game.nextId++, x: monster.x, y: monster.y, value, kind: 'xp', radius: 6, ttl: 70 });
  } else {
    game.gems.push({ id: game.nextId++, x: monster.x, y: monster.y, value, kind: 'xp', radius: 5, ttl: 60 });
  }
  if (monster.type === 'brute' && requireRng(game)() < BRUTE_HEAL_DROP_CHANCE) game.gems.push({ id: game.nextId++, x: monster.x + 8, y: monster.y, value: COMBAT_BALANCE.healingGemValue, kind: 'heal', radius: 6, ttl: 45 });
}

function canLearnSkill(actor, skillId, skills = SKILLS) {
  return skills[skillId].type !== 'active' || actor.activeSkills?.includes(skillId)
    || (actor.activeSkills?.length || 0) < PROGRESSION.maxActiveSkills;
}
function scaledDamage(actor, amount) { return amount * (1 + Math.min(SKILLS.power.maxRank, actor?.skills?.power || 0) * COMBAT_BALANCE.powerDamagePerRank); }
function levelMaxHp(level) { return COMBAT_BALANCE.baseMaxHp + (level - 1) * COMBAT_BALANCE.levelMaxHp; }
function classifyDamage(game, target, sourceActor, source) {
  if (sourceActor) return 'actor';
  if (source?.type === 'zone') return 'zone';
  // 类型白名单改为查 MONSTERS 表，新增怪物类型时不会因漏改这里而静默归因失败。
  if (source && (monsterList(game).includes(source) || isKnownMonster(source.type))) return 'monster';
  if (!source && game?.phase === 'finale' && game.zone
    && Math.hypot(target.x - game.zone.x, target.y - game.zone.y) > game.zone.radius) return 'zone';
  return source == null ? 'trap' : 'monster';
}
function damageCauseLabel(kind, sourceActor, source) {
  if (kind === 'actor') return sourceActor?.name || '其他战士';
  if (kind === 'monster') return source?.name || MONSTERS[source?.type]?.name || MONSTER_FALLBACK.name;
  return kind === 'zone' ? '余烬风暴' : '尖刺陷阱';
}
function resolveActor(game, source) {
  if (!source) return null;
  if (isActor(game, source)) return source;
  const id = source.ownerId ?? source.id;
  return actorList(game).find(a => a.id === id) || null;
}
function nearest(entities, x, y, maxDist, predicate = () => true) {
  let best = null, bestD2 = maxDist * maxDist;
  for (const entity of entities || []) {
    const dx = entity.x - x, dy = entity.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2 && predicate(entity)) { best = entity; bestD2 = d2; }
  }
  return best;
}
function pushEffect(game, effect) { if (game) { game.effects ||= []; game.effects.push({ maxTtl: effect.ttl, ...effect }); } }
function pushEvent(game, text, color) {
  if (!game) return;
  game.events ||= [];
  game.events.push({ text, time: game.time || 0, color });
  if (game.events.length > 30) game.events.splice(0, game.events.length - 30);
}

function hasLine(map, a, b) { return lineClear(map, a, b, 1); }

function meleeAction(actor, kind, angle, range, arc, windup, active, recovery, amount) {
  actor.meleeActionSequence = (actor.meleeActionSequence || 0) + 1;
  return { id: `${actor.id}:${actor.meleeActionSequence}`, kind, phase: windup > 0 ? 'windup' : 'active', angle, range, arc, elapsed: 0,
    windup, active, recovery, hitIds: new Set(), damage: amount };
}
function castMeleeSkill(game, actor, slot, aimX, aimY) {
  const id = actor.activeSkills?.[slot], def = MELEE_SKILLS[id], rank = actor.skills?.[id] || 0;
  if (!def || def.type !== 'active' || !Number.isInteger(rank) || rank < 1 || rank > def.maxRank || (actor.cooldowns?.[id] || 0) > 0) return false;
  if (actor.meleeAction && actor.meleeAction.kind !== 'basic') return false;
  // 几何参数也由声明表提供，新增刀技只需加一条；缺条目则不可施放。
  const shape = MELEE_SHAPES[id];
  if (!shape) return false;
  const dx = (aimX ?? actor.x + Math.cos(actor.aimAngle || 0)) - actor.x;
  const dy = (aimY ?? actor.y + Math.sin(actor.aimAngle || 0)) - actor.y;
  const angle = dx || dy ? Math.atan2(dy, dx) : actor.aimAngle || 0;
  const originX = actor.x, originY = actor.y;
  const geometry = shape(game, actor, rank, angle);
  actor.meleeAction = meleeAction(actor, id, angle, geometry.range, geometry.arc, geometry.windup,
    MELEE_ACTIVE_WINDOW.active, MELEE_ACTIVE_WINDOW.recovery,
    scaledDamage(actor, (actor.attackDamage || COMBAT_BALANCE.baseAttackDamage) * geometry.coefficient));
  // Presentation can finish its follow-through after the damage/action window.
  // These snapshots never participate in collision, damage, cooldowns or AI.
  actor.meleeVisuals = [...(actor.meleeVisuals || []).filter(v => (game.time || 0) - v.startedAt < 1.25), {
    id: actor.meleeAction.id, kind: id, angle, range: geometry.range, arc: geometry.arc, windup: geometry.windup,
    startedAt: game.time || 0, originX, originY, x: actor.x, y: actor.y,
  }].slice(-3);
  actor.cooldowns ||= {};
  actor.cooldowns[id] = def.cooldown;
  if (!geometry.windup) hitMelee(game, actor, actor.meleeAction);
  return true;
}

/**
 * 近战主动技能的几何声明表。
 * 每个函数返回 {range, arc, windup, coefficient}，并可在其中执行位移等副作用。
 * 以前是 `if (id === 'lunge') ... else if (id === 'whirlwind') ... else { 重斩 }`
 * —— 注意原来的 else 分支实际上是“默认当成重斩”，新增刀技会被静默当成重斩。
 */
const MELEE_SHAPES = {
  lunge(game, actor, rank, angle) {
    const distance = lungeDistance(rank);
    moveEntity(game.map, actor, Math.cos(angle) * distance, Math.sin(angle) * distance);
    return { range: MELEE_BALANCE.range, arc: MELEE_BALANCE.arc, windup: 0, coefficient: lungeCoefficient(rank) };
  },
  whirlwind(game, actor, rank) {
    return { range: whirlwindRadius(rank), arc: Math.PI * 2, windup: 0, coefficient: whirlwindCoefficient(rank) };
  },
  heavySlash(game, actor, rank) {
    return {
      range: heavySlashRange(rank), arc: ACTIVES.heavySlash.arcDeg * Math.PI / 180,
      windup: ACTIVES.heavySlash.windup, coefficient: heavySlashCoefficient(rank),
    };
  },
};
function tickMelee(game, actor, dt) {
  actor.attackRange = MELEE_BALANCE.range + bladeReachBonus(actor.skills?.bladeReach || 0);
  const pressed = actor.attackPressed;
  actor.attackPressed = false;
  const action = actor.meleeAction;
  if (action) {
    const before = action.elapsed;
    action.elapsed += dt;
    if (before < action.windup + action.active && action.elapsed >= action.windup) hitMelee(game, actor, action);
    action.phase = action.elapsed < action.windup ? 'windup' : action.elapsed < action.windup + action.active ? 'active' : 'recovery';
    if (action.elapsed >= action.windup + action.active + action.recovery) actor.meleeAction = null;
  }
  if (!actor.meleeAction && actor.attackTimer <= 0 && (pressed || actor.attackHeld)) {
    const reach = Math.min(PASSIVE.bladeReachMaxRank, actor.skills?.bladeReach || 0);
    const interval = (actor.attackInterval || MELEE_BALANCE.interval)
      * Math.max(.56, 1 - (actor.skills?.haste || 0) * ATTACK.hasteIntervalReduction);
    actor.attackTimer = interval;
    actor.meleeAction = meleeAction(actor, 'basic', actor.aimAngle || 0, MELEE_BALANCE.range + bladeReachBonus(reach),
      MELEE_BALANCE.arc + reach * PASSIVE.bladeReachArcDegPerRank * Math.PI / 180, MELEE_BALANCE.windup, MELEE_BALANCE.active,
      Math.max(0, interval - MELEE_BALANCE.windup - MELEE_BALANCE.active), scaledDamage(actor, (actor.attackDamage || COMBAT_BALANCE.baseAttackDamage) * MELEE_BALANCE.damageMultiplier));
  }
}
function circleIntersectsSector(actor, target, action) {
  const dx = target.x - actor.x, dy = target.y - actor.y, distance = Math.hypot(dx, dy), radius = target.radius || 0;
  if (distance > action.range + radius) return false;
  if (distance <= radius || action.arc >= 2 * Math.PI) return true;
  const difference = Math.atan2(Math.sin(Math.atan2(dy, dx) - action.angle), Math.cos(Math.atan2(dy, dx) - action.angle));
  if (Math.abs(difference) <= action.arc / 2) return true;
  // Outside the angular span, the nearest sector point lies on one of its radial edges.
  for (const edge of [action.angle - action.arc / 2, action.angle + action.arc / 2]) {
    const ux = Math.cos(edge), uy = Math.sin(edge), projection = clamp(dx * ux + dy * uy, 0, action.range);
    if (Math.hypot(dx - ux * projection, dy - uy * projection) <= radius) return true;
  }
  return false;
}
function hitMelee(game, actor, action) {
  const visual = actor.meleeVisuals?.find(v => v.id === action.id);
  if (visual && visual.impactAt == null) {
    visual.impactX = actor.x; visual.impactY = actor.y; visual.impactAt = game.time || 0;
  }
  for (const target of [...monsterList(game), ...actorList(game)]) {
    const key = target.id ?? target;
    if (!alive(target) || target === actor || action.hitIds.has(key) || (game.phase === 'grace' && isActor(game, target))) continue;
    if (!circleIntersectsSector(actor, target, action) || !hasLine(game.map, actor, target)) continue;
    action.hitIds.add(key);
    const dealt = damage(game, target, action.damage, actor);
    if (dealt) {
      target.hitFlash = Math.max(target.hitFlash || 0, .18);
      if (action.hitIds.size <= 4) pushEffect(game, {
        kind: 'meleeImpact', x: target.x, y: target.y, angle: action.angle,
        color: action.kind === 'lunge' ? '#91ecdf' : action.kind === 'whirlwind' ? '#c8b7ef' : '#efbb79',
        radius: action.kind === 'heavySlash' ? 23 : 15, ttl: .28, maxTtl: .28,
      });
    }
    if (dealt && action.kind === 'heavySlash' && alive(target)) {
      const dx = target.x - actor.x, dy = target.y - actor.y, distance = Math.hypot(dx, dy);
      const ux = distance ? dx / distance : Math.cos(action.angle), uy = distance ? dy / distance : Math.sin(action.angle);
      moveEntity(game.map, target, ux * 24, uy * 24);
    }
  }
}
