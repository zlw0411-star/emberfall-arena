import { blocked, lineClear, moveEntity } from './world.js';
import { modeOf } from './modes.js';
import {
  ACTIVES, dashDistance, dashRadius, frostNovaRadius, heavySlashRange,
  lungeDistance, piercingThrustRange, quakeRadius, whirlwindRadius,
} from './balance.js';
import { bossAttackContains, bossAttackThreatensStep } from './boss.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const live = entity => entity?.alive !== false && entity?.hp > 0;
const idle = actor => ({ mx: 0, my: 0, aimX: actor?.x || 0, aimY: actor?.y || 0, castSlot: -1, attackHeld: false });

function shadowGame(game, actor) {
  // Explicitly enter Arena grace when reusing its navigation/farming policy.
  // The separate Boss can never be mistaken for a moving ordinary monster.
  return { ...game, ruleset: 'arena', phase: 'grace', zone: null, mode: actor.combatMode || game.mode, boss: null };
}

function spikeDanger(game, point, padding = 0) {
  return (game.map.traps || []).some(trap => trap.type === 'spike'
    && ((game.time + (trap.offset || 0)) % 4 + 4) % 4 >= 2.1
    && distance(point, trap) < trap.r + padding + 8);
}

function validPoint(game, boss, actor, point) {
  const radius = actor.radius || 12;
  return !blocked(game.map, point.x, point.y, radius + 3)
    && (!live(boss) || distance(point, boss) >= boss.radius + radius + 4)
    && !spikeDanger(game, point, radius);
}

function clearsBoss(actor, point, boss) {
  if (!live(boss)) return true;
  const dx = point.x - actor.x, dy = point.y - actor.y;
  const length2 = dx * dx + dy * dy;
  const t = length2 > 0 ? Math.max(0, Math.min(1, ((boss.x - actor.x) * dx + (boss.y - actor.y) * dy) / length2)) : 0;
  const clearance = Math.min(boss.radius + (actor.radius || 12) + 2, distance(actor, boss) - 0.01);
  return Math.hypot(actor.x + dx * t - boss.x, actor.y + dy * t - boss.y) >= clearance;
}

function dodgeTarget(game, actor, boss, attack) {
  const state = actor.ai;
  const padding = (actor.radius || 12) + 6;
  if (state.bossDodgeId === attack?.id && state.bossDodge && validPoint(game, boss, actor, state.bossDodge)
    && !bossAttackContains(attack, boss, state.bossDodge, padding)) return state.bossDodge;
  let best = null, bestScore = Infinity;
  const away = Math.atan2(actor.y - boss.y, actor.x - boss.x);
  const consider = point => {
    if (!validPoint(game, boss, actor, point) || !clearsBoss(actor, point, boss)
      || !lineClear(game.map, actor, point, actor.radius || 12)
      || (attack && bossAttackContains(attack, boss, point, padding))) return;
    const score = distance(actor, point) + Math.max(0, distance(point, boss) - 350) * 0.08;
    if (score < bestScore) { best = point; bestScore = score; }
  };
  // Evaluate the actual boundary exits first. Coarse 80/120px samples made a
  // contestant travel much farther than necessary, especially beside a cross.
  const margin = padding + 2;
  if (attack?.kind === 'sweep') {
    const r = attack.radius + margin;
    consider({ x: boss.x + Math.cos(away) * r, y: boss.y + Math.sin(away) * r });
    for (const sign of [-1, 1]) {
      const angle = attack.angle + sign * attack.arc / 2;
      const ux = Math.cos(angle), uy = Math.sin(angle);
      const along = Math.max(0, Math.min(attack.radius, (actor.x - boss.x) * ux + (actor.y - boss.y) * uy));
      consider({ x: boss.x + ux * along - uy * margin * sign, y: boss.y + uy * along + ux * margin * sign });
    }
  } else if (attack?.kind === 'rocks') {
    for (const target of attack.targets || []) {
      const angle = Math.atan2(actor.y - target.y, actor.x - target.x);
      for (let i = 0; i < 24; i++) {
        const a = angle + i * Math.PI / 12, r = target.radius + margin;
        consider({ x: target.x + Math.cos(a) * r, y: target.y + Math.sin(a) * r });
      }
    }
  } else if (attack?.kind === 'cross') {
    for (let i = 0; i < 4; i++) {
      const angle = attack.angle + i * Math.PI / 2, ux = Math.cos(angle), uy = Math.sin(angle);
      const along = Math.max(0, Math.min(attack.radius, (actor.x - boss.x) * ux + (actor.y - boss.y) * uy));
      for (const sign of [-1, 1]) {
        const across = sign * (attack.width / 2 + margin);
        consider({ x: boss.x + ux * along - uy * across, y: boss.y + uy * along + ux * across });
      }
    }
  }
  for (const length of [48, 80, 120, 170, 230, 300]) {
    if (best && length >= bestScore) break;
    for (let i = 0; i < 24; i++) {
      const angle = away + i * Math.PI / 12;
      const point = { x: actor.x + Math.cos(angle) * length, y: actor.y + Math.sin(angle) * length };
      consider(point);
    }
  }
  state.bossDodgeId = attack?.id;
  state.bossDodge = best;
  return best;
}

function moveToward(game, actor, boss, target, dt, fallbackThink) {
  const radius = actor.radius || 12;
  if (!clearsBoss(actor, target, boss)) {
    const from = Math.atan2(actor.y - boss.y, actor.x - boss.x);
    const to = Math.atan2(target.y - boss.y, target.x - boss.x);
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    const angle = from + Math.sign(delta || 1) * Math.PI / 3;
    const ring = Math.max(boss.radius + radius + 55, Math.min(220, distance(actor, boss)));
    target = { x: boss.x + Math.cos(angle) * ring, y: boss.y + Math.sin(angle) * ring };
  }
  let dx = target.x - actor.x, dy = target.y - actor.y;
  const length = Math.hypot(dx, dy);
  if (length <= 4) return { mx: 0, my: 0 };
  if (lineClear(game.map, actor, target, radius)) return { mx: dx / length, my: dy / length };
  // A synthetic resource reuses Arena's cached A* without exposing the Boss as
  // a monster or allowing the fallback to change weapon/targeting policy.
  const shadow = shadowGame(game, actor);
  const factor = Math.min(1, 650 / length);
  shadow.monsters = [];
  shadow.gems = [{ x: actor.x + dx * factor, y: actor.y + dy * factor, value: 100, kind: 'xp' }];
  const decision = fallbackThink(shadow, actor, dt);
  return { mx: decision.mx || 0, my: decision.my || 0 };
}

function windupInRange(game, actor, boss, id, range, movement, dt) {
  // Predict the current movement through the first damage frame. Do not stop
  // dodging to rescue a cast: keep the cooldown when retreat would outrange it.
  const duration = Math.ceil(ACTIVES[id].windup / dt) * dt;
  const length = Math.max(1, Math.hypot(movement.mx || 0, movement.my || 0));
  let slow = (game.map.traps || []).some(trap => trap.type === 'mud'
    && distance(actor, trap) < trap.r + actor.radius) ? .55 : 1;
  if (actor.slowUntil > game.time) slow *= .65;
  const travel = actor.speed * slow * (actor.combatSpeedMult || 1) * duration;
  const predicted = { x: actor.x, y: actor.y, radius: actor.radius || 12 };
  moveEntity(game.map, predicted, (movement.mx || 0) / length * travel, (movement.my || 0) / length * travel);
  return distance(predicted, boss) <= boss.radius + range - 4
    && lineClear(game.map, predicted, boss, 1);
}

function castAtBoss(game, actor, boss, d, { allowMovement = true, avoidAttack = null, movement = {}, dt = 1 / 60 } = {}) {
  if (actor.meleeAction) return -1;
  const edge = Math.max(0, d - boss.radius);
  for (let i = 0; i < (actor.activeSkills || []).length; i++) {
    const id = actor.activeSkills[i], rank = actor.skills?.[id] || 1;
    if ((actor.cooldowns?.[id] || 0) > 0) continue;
    if (id === 'bladeWard' && (!(actor.shieldHp > 0) || !(actor.shieldT > 0)) && edge <= 200) return i;
    if (id === 'fireball' && edge <= ACTIVES.fireball.speed * ACTIVES.fireball.ttl * 0.8) return i;
    if (id === 'chainLightning' && edge <= ACTIVES.chainLightning.firstRange) return i;
    if (id === 'frostNova' && edge <= frostNovaRadius(rank)) return i;
    if (id === 'quake' && edge <= quakeRadius(rank)) return i;
    if (id === 'whirlwind' && edge <= whirlwindRadius(rank)) return i;
    if (id === 'heavySlash' && edge <= heavySlashRange(rank) - 4
      && windupInRange(game, actor, boss, id, heavySlashRange(rank), movement, dt)) return i;
    if (id === 'piercingThrust' && edge <= piercingThrustRange(rank) - 4
      && windupInRange(game, actor, boss, id, piercingThrustRange(rank), movement, dt)) return i;
    // A dash must stop outside the solid Boss body. Do not waste movement
    // skills by charging into its center, even if the final shock could hit.
    const reach = id === 'lunge' ? lungeDistance(rank) : id === 'dash' ? dashDistance(rank) : 0;
    const finalRange = id === 'lunge' ? actor.attackRange || 68 : id === 'dash' ? dashRadius(rank) : 0;
    if (id === 'lunge' && allowMovement && !avoidAttack && edge <= reach + finalRange - 6) {
      // The real lunge stops at the solid Boss body. Predict that same movement
      // instead of requiring its full nominal distance to fit before the Boss.
      const end = { x: actor.x, y: actor.y, radius: actor.radius || 12 };
      moveEntity(game.map, end, (boss.x - actor.x) / d * reach, (boss.y - actor.y) / d * reach);
      if (validPoint(game, boss, actor, end) && distance(end, boss) <= boss.radius + finalRange - 6
        && lineClear(game.map, actor, end, actor.radius || 12)) return i;
      continue;
    }
    if (id !== 'lunge' && allowMovement && reach && edge >= reach + (actor.radius || 12) + 6 && edge <= reach + finalRange - 6) {
      const ratio = reach / d;
      const end = { x: actor.x + (boss.x - actor.x) * ratio, y: actor.y + (boss.y - actor.y) * ratio };
      if (validPoint(game, boss, actor, end) && lineClear(game.map, actor, end, actor.radius || 12)
        && (!avoidAttack || !bossAttackContains(avoidAttack, boss, end, (actor.radius || 12) + 6))) return i;
    }
  }
  return -1;
}

export function thinkBoss(game, actor, dt = 1 / 30, fallbackThink) {
  if (!game?.map || !live(actor)) return idle(actor);
  actor.ai ||= {};
  const boss = game.boss;
  const protectedActor = actor.invulnerableUntil > game.time;
  const shadow = shadowGame(game, actor);
  if (!live(boss)) {
    const result = fallbackThink(shadow, actor, dt);
    return protectedActor ? { ...result, castSlot: -1, attackHeld: false, attackPressed: false } : result;
  }
  const attack = boss.attack;
  const dangerous = bossAttackThreatensStep(attack, game.time, dt);
  const hazard = spikeDanger(game, actor, actor.radius || 12);
  if ((dangerous && bossAttackContains(attack, boss, actor, (actor.radius || 12) + 24)) || hazard) {
    const target = dodgeTarget(game, actor, boss, dangerous ? attack : null);
    const movement = target ? moveToward(game, actor, boss, target, dt, fallbackThink) : { mx: 0, my: 0 };
    const d = distance(actor, boss), melee = modeOf(actor.combatMode || game.mode).weaponType === 'sword';
    const visible = lineClear(game.map, actor, boss, 1);
    const castSlot = !protectedActor && visible ? castAtBoss(game, actor, boss, d, { allowMovement: false, movement, dt }) : -1;
    return { ...movement, aimX: boss.x, aimY: boss.y, castSlot,
      attackHeld: !!(melee && !protectedActor && visible && d <= (actor.attackRange || 68) + boss.radius - 4 && !actor.meleeAction && castSlot < 0) };
  }

  // Short healing excursions prevent repeated deaths without letting low HP
  // keep a contestant away from the damage race indefinitely.
  const health = actor.maxHp > 0 ? actor.hp / actor.maxHp : 1;
  const state = actor.ai;
  if (state.bossRecoverUntil && (health >= 0.55 || game.time >= state.bossRecoverUntil)) {
    state.bossRecoverUntil = 0;
    state.bossRecoverRetryAt = game.time + 8;
  }
  if (health < 0.35 && !state.bossRecoverUntil && game.time >= (state.bossRecoverRetryAt || 0)) state.bossRecoverUntil = game.time + 8;
  if (state.bossRecoverUntil > game.time) {
    const heal = (game.gems || []).filter(gem => gem.kind === 'heal' && distance(actor, gem) <= 760
      && validPoint(game, boss, actor, gem)
      && (!dangerous || !bossAttackContains(attack, boss, gem, (actor.radius || 12) + 15)))
      .sort((a, b) => distance(actor, a) - distance(actor, b))[0];
    if (heal) {
      const movement = moveToward(game, actor, boss, heal, dt, fallbackThink);
      const farming = fallbackThink({ ...shadow, gems: [heal] }, actor, dt);
      return { ...farming, ...movement, ...(protectedActor ? { castSlot: -1, attackHeld: false, attackPressed: false } : {}) };
    }
    state.bossRecoverUntil = 0;
    state.bossRecoverRetryAt = game.time + 8;
  }

  const targetLevel = Math.min(15, 1 + Math.floor(game.time / 35));
  if ((actor.level || 1) < targetLevel) {
    // Catch-up has a time budget. An unreachable level target must not keep a
    // contestant farming the perimeter for the entire remaining match.
    if (game.time >= (state.bossFightUntil || 0)) {
      state.bossFarmUntil = game.time + 8;
      state.bossFightUntil = game.time + 30;
    }
    shadow.monsters = (game.monsters || []).filter(monster => distance(monster, boss) >= 440);
    shadow.gems = (game.gems || []).filter(gem => distance(gem, boss) >= 440);
    if (game.time < state.bossFarmUntil && (shadow.monsters.some(live) || shadow.gems.length)) {
      const result = fallbackThink(shadow, actor, dt);
      // Reject a farming step that walks back into a telegraphed attack.
      const next = { x: actor.x + result.mx * 65, y: actor.y + result.my * 65 };
      if (!dangerous || !bossAttackContains(attack, boss, next, actor.radius || 12)) {
        return protectedActor ? { ...result, castSlot: -1, attackHeld: false, attackPressed: false } : result;
      }
    }
  }

  const melee = modeOf(actor.combatMode || game.mode).weaponType === 'sword';
  const d = distance(actor, boss), range = actor.attackRange || (melee ? 68 : 220);
  const desired = boss.radius + (melee ? Math.max((actor.radius || 12) + 10, range * 0.72) : range * 0.75);
  const angle = d > 0 ? Math.atan2(actor.y - boss.y, actor.x - boss.x) : String(actor.id).length * 2.399;
  let movement = { mx: 0, my: 0 };
  if (Math.abs(d - desired) > 10) {
    const target = { x: boss.x + Math.cos(angle) * desired, y: boss.y + Math.sin(angle) * desired };
    if (!dangerous || !bossAttackContains(attack, boss, target, (actor.radius || 12) + 16)) movement = moveToward(game, actor, boss, target, dt, fallbackThink);
  }
  const visible = lineClear(game.map, actor, boss, 1);
  const castSlot = !protectedActor && visible ? castAtBoss(game, actor, boss, d,
    { avoidAttack: dangerous ? attack : null, movement, dt }) : -1;
  return {
    ...movement, aimX: boss.x, aimY: boss.y, castSlot,
    attackHeld: !!(melee && !protectedActor && visible && d <= range + boss.radius - 4 && !actor.meleeAction && castSlot < 0),
  };
}
