// Combat simulation. This module deliberately has no DOM or external dependencies.
import { lineClear, moveEntity } from './world.js';
export const SKILLS = {
  fireball: { name: '火球', description: '每级伤害36→63，爆炸半径56→80，冷却3.86→2.86秒（共4级）', icon: '●', color: '#ff8a42', type: 'active', maxRank: 4, cooldown: 4.2 },
  dash: { name: '震荡冲刺', description: '冲刺112→148像素；冲击伤害31→55、半径47→62（共4级）', icon: '➤', color: '#67e8f9', type: 'active', maxRank: 4, cooldown: 6.5 },
  quake: { name: '震荡波', description: '范围伤害29→56、半径103→154（共4级）', icon: '◎', color: '#c084fc', type: 'active', maxRank: 4, cooldown: 8 },
  power: { name: '强力弹丸', description: '每级所有攻击伤害+10%，最多+50%', icon: '✦', color: '#fb7185', type: 'passive', maxRank: 5, cooldown: 0 },
  haste: { name: '迅捷', description: '每级移速+8%、攻击间隔缩短6.5%，最多移速+40%', icon: '»', color: '#facc15', type: 'passive', maxRank: 5, cooldown: 0 },
  vitality: { name: '坚韧', description: '每级最大生命+30并立即恢复30；每2.5秒恢复0.57→1.45生命', icon: '♥', color: '#4ade80', type: 'passive', maxRank: 5, cooldown: 0 },
  magnet: { name: '拾荒者', description: '每级拾取半径+18像素，从30扩大到120', icon: '✧', color: '#60a5fa', type: 'passive', maxRank: 5, cooldown: 0 },
  multishot: { name: '连射', description: '每级攻击间隔缩短5.5%、弹速+18；4级起每次攻击额外发射1枚弹丸', icon: '⁝', color: '#f0abfc', type: 'passive', maxRank: 5, cooldown: 0 },
};

export const PROGRESSION = Object.freeze({
  maxLevel: 15,
  milestones: Object.freeze([2, 4, 6, 8, 10, 12, 14, 15]),
  maxActiveSkills: 3,
});

export const COMBAT_BALANCE = Object.freeze({
  actorDamageMultiplier: 0.32,
  huntDamageMultiplier: 0.12,
  finaleDamageMultiplier: 0.32,
  xpThresholdMultiplier: 1.1,
  baseMaxHp: 280,
  levelMaxHp: 8,
  levelHeal: 8,
  baseAttackDamage: 13,
  levelAttackDamage: 0.4,
  powerDamagePerRank: 0.1,
  actorKillXpBase: 40,
  actorKillXpPerLevel: 5,
  vitalityMaxHp: 30,
  vitalityHeal: 30,
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

export function createActor(id, name, x, y, isPlayer = false, color = '#74d680') {
  return {
    id, name, x, y, radius: 12, isPlayer, color, alive: true,
    hp: COMBAT_BALANCE.baseMaxHp, maxHp: COMBAT_BALANCE.baseMaxHp, level: 1, xp: 0, kills: 0, monsterKills: 0, damageDealt: 0,
    speed: 100, attackDamage: COMBAT_BALANCE.baseAttackDamage, attackInterval: 0.88, attackRange: 220,
    attackTimer: 0.18, pickupRadius: 30,
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
  const available = Object.keys(SKILLS).filter(id => (actor.skills?.[id] || 0) < SKILLS[id].maxRank && canLearnSkill(actor, id));
  if (!available.length) {
    actor.pendingChoices = 0;
    actor.choices = [];
    return [];
  }
  const rng = game?.rng || Math.random;
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
  if (!alive(actor) || !(actor.pendingChoices > 0) || !Object.hasOwn(SKILLS, skillId)) return false;
  let choices = actor.choices;
  if (!Array.isArray(choices) || !choices.length) choices = getChoices(game, actor);
  if (!choices.includes(skillId) || (actor.skills?.[skillId] || 0) >= SKILLS[skillId].maxRank || !canLearnSkill(actor, skillId)) return false;
  applySkillRank(actor, skillId);
  actor.pendingChoices--;
  actor.choices = actor.pendingChoices > 0 ? getChoices(game, actor) : [];
  pushEvent(game, `${actor.name || '战士'} 强化了「${SKILLS[skillId].name}」`, SKILLS[skillId].color);
  pushEffect(game, { x: actor.x, y: actor.y - 28, kind: 'text', text: SKILLS[skillId].name, color: SKILLS[skillId].color, ttl: 1 });
  if (actor.isPlayer !== true && actor.pendingChoices > 0) autoChoose(game, actor);
  return true;
}

function applySkillRank(actor, skillId) {
  actor.skills ||= {};
  actor.skills[skillId] = (actor.skills[skillId] || 0) + 1;
  if (SKILLS[skillId].type === 'active' && !actor.activeSkills.includes(skillId)) actor.activeSkills.push(skillId);
  if (skillId === 'vitality') {
    actor.maxHp = levelMaxHp(actor.level) + (actor.skills.vitality || 0) * COMBAT_BALANCE.vitalityMaxHp;
    actor.hp = Math.min(actor.maxHp, actor.hp + COMBAT_BALANCE.vitalityHeal);
  }
  if (skillId === 'haste') actor.speed = 100 * (1 + actor.skills.haste * 0.08);
  if (skillId === 'magnet') actor.pickupRadius = 30 + actor.skills.magnet * 18;
}

function autoChoose(game, actor) {
  let guard = 0;
  while (actor.pendingChoices > 0 && guard++ < 10) {
    const options = getChoices(game, actor);
    if (!options.length) break;
    // Prefer an active option early, then strengthen the best available attack/passive.
    const rankOf = id => actor.skills?.[id] || 0;
    const priority = id => (rankOf(id) === 0 && SKILLS[id].type === 'active' ? 4 : 0)
      + ({ power: 3, haste: 2, vitality: 1, multishot: 1, fireball: 2, quake: 1, dash: 1 }[id] || 0)
      - rankOf(id) * 0.2;
    options.sort((a, b) => priority(b) - priority(a));
    if (!chooseSkill(game, actor, options[0])) break;
  }
}

export function castSkill(game, actor, slot, aimX, aimY) {
  if (!alive(actor) || !Number.isInteger(slot) || slot < 0 || slot >= PROGRESSION.maxActiveSkills) return false;
  const skillId = actor.activeSkills?.[slot];
  if (!skillId || SKILLS[skillId]?.type !== 'active' || (actor.cooldowns?.[skillId] || 0) > 0) return false;
  const rank = actor.skills?.[skillId] || 0;
  if (!Number.isInteger(rank) || rank < 1 || rank > SKILLS[skillId].maxRank) return false;
  actor.cooldowns ||= {};
  actor.cooldowns[skillId] = SKILLS[skillId].cooldown * (skillId === 'fireball' ? Math.max(0.58, 1 - rank * 0.08) : Math.max(0.64, 1 - rank * 0.06));
  const dx = (aimX ?? actor.x + 1) - actor.x;
  const dy = (aimY ?? actor.y) - actor.y;
  const len = hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  if (skillId === 'fireball') {
    game.bullets ||= [];
    game.bullets.push({ x: actor.x + ux * 15, y: actor.y + uy * 15, vx: ux * 310, vy: uy * 310,
      radius: 9 + rank, damage: scaledDamage(actor, 27 + rank * 9), ownerId: actor.id, ttl: 2.2,
      kind: 'fireball', color: SKILLS.fireball.color, splash: 48 + rank * 8 });
    pushEffect(game, { x: actor.x + ux * 18, y: actor.y + uy * 18, kind: 'burst', color: SKILLS.fireball.color, radius: 20, ttl: 0.35 });
  } else if (skillId === 'dash') {
    // Skills may move actors; normal movement and mud slow remain core-owned.
    const dashDistance = 100 + rank * 12;
    moveEntity(game.map, actor, ux * dashDistance, uy * dashDistance);
    const cx = actor.x, cy = actor.y;
    areaDamage(game, actor, cx, cy, 42 + rank * 5, scaledDamage(actor, 23 + rank * 8), SKILLS.dash.color, 'slash');
    pushEffect(game, { x: cx, y: cy, kind: 'slash', color: SKILLS.dash.color, radius: 54 + rank * 6, ttl: 0.35 });
  } else if (skillId === 'quake') {
    const radius = 86 + rank * 17;
    areaDamage(game, actor, actor.x, actor.y, radius, scaledDamage(actor, 20 + rank * 9), SKILLS.quake.color, 'burst');
    pushEffect(game, { x: actor.x, y: actor.y, kind: 'ring', color: SKILLS.quake.color, radius, ttl: 0.6 });
  }
  return true;
}

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
    if (!alive(actor)) continue;
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
  if (vitality && actor.hp < actor.maxHp && actor.regenTimer >= 2.5) {
    const ticks = Math.floor(actor.regenTimer / 2.5);
    actor.regenTimer -= ticks * 2.5;
    actor.hp = Math.min(actor.maxHp, actor.hp + ticks * (0.35 + vitality * 0.22));
  }
  if (actor.pendingChoices > 0 && actor.isPlayer !== true) autoChoose(game, actor);
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
  const speed = monster.speed || ({ slime: 38, bat: 70, brute: 25 }[monster.type] || 38);
  const mx = dx / d * speed * dt, my = dy / d * speed * dt;
  moveEntity(game.map, monster, mx, my);
}

function fireBasic(game, actor, target) {
  const dx = target.x - actor.x, dy = target.y - actor.y, d = hypot(dx, dy);
  const haste = actor.skills?.haste || 0;
  const multi = actor.skills?.multishot || 0;
  const rate = Math.max(0.34, (actor.attackInterval || 0.88) * Math.max(0.56, 1 - haste * 0.065 - multi * 0.055));
  actor.attackTimer = rate;
  const count = multi >= 4 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const angle = Math.atan2(dy, dx) + (i ? 0.10 : 0);
    const speed = 350 + multi * 18;
    game.bullets.push({ x: actor.x, y: actor.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      radius: 4, damage: scaledDamage(actor, actor.attackDamage || 13), ownerId: actor.id,
      ttl: Math.max(0.45, (actor.attackRange || 220) / speed + 0.16), kind: 'basic', color: actor.color || '#fff1a8' });
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

function dropGem(game, monster, value) {
  game.gems ||= [];
  game.nextId ??= 1;
  if (monster.type === 'brute' || value >= 12) {
    game.gems.push({ id: game.nextId++, x: monster.x, y: monster.y, value, kind: 'xp', radius: 6, ttl: 70 });
  } else {
    game.gems.push({ id: game.nextId++, x: monster.x, y: monster.y, value, kind: 'xp', radius: 5, ttl: 60 });
  }
  if (monster.type === 'brute' && (game.rng || Math.random)() < 0.28) game.gems.push({ id: game.nextId++, x: monster.x + 8, y: monster.y, value: COMBAT_BALANCE.healingGemValue, kind: 'heal', radius: 6, ttl: 45 });
}

function canLearnSkill(actor, skillId) {
  return SKILLS[skillId].type !== 'active' || actor.activeSkills?.includes(skillId)
    || (actor.activeSkills?.length || 0) < PROGRESSION.maxActiveSkills;
}
function scaledDamage(actor, amount) { return amount * (1 + Math.min(SKILLS.power.maxRank, actor?.skills?.power || 0) * COMBAT_BALANCE.powerDamagePerRank); }
function levelMaxHp(level) { return COMBAT_BALANCE.baseMaxHp + (level - 1) * COMBAT_BALANCE.levelMaxHp; }
function classifyDamage(game, target, sourceActor, source) {
  if (sourceActor) return 'actor';
  if (source && (monsterList(game).includes(source) || ['slime', 'bat', 'brute'].includes(source.type))) return 'monster';
  if (!source && game?.phase === 'finale' && game.zone
    && Math.hypot(target.x - game.zone.x, target.y - game.zone.y) > game.zone.radius) return 'zone';
  return source == null ? 'trap' : 'monster';
}
function damageCauseLabel(kind, sourceActor, source) {
  if (kind === 'actor') return sourceActor?.name || '其他战士';
  if (kind === 'monster') return source?.name || ({ slime: '史莱姆', bat: '蝙蝠', brute: '巨兽' }[source?.type] || '怪物');
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
