import { damage } from './combat.js';
import { BOSS_CONFIG } from './boss-config.js';

const ATTACKS = ['sweep', 'rocks', 'cross'];
const STAGE_DAMAGE = [1, 1.15, 1.3];
const STAGE_INTERVAL = [1, 0.85, 0.7];
const alive = actor => actor?.alive !== false && actor?.hp > 0;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createBoss(game) {
  const x = game.map.width / 2, y = game.map.height / 2;
  return {
    id: 'boss', type: 'boss', isBoss: true, name: '余烬巨像',
    x, y, prevX: x, prevY: y, radius: BOSS_CONFIG.radius,
    hp: BOSS_CONFIG.maxHp, maxHp: BOSS_CONFIG.maxHp, alive: true,
    stage: 1, attack: null, nextAttackAt: game.time + 1.2, attackSequence: 0,
    color: '#ff725d', hitFlash: 0,
  };
}

// Exact circle-vs-sector/rectangle geometry; shared by damage, AI and rendering.
// Sweep arc is in radians. Cross consists of four finite outward rectangles.
export function bossAttackContains(attack, boss, point, padding = 0) {
  if (!attack || !boss || !point) return false;
  padding = Math.max(0, padding);
  if (attack.kind === 'rocks') return (attack.targets || []).some(target => distance(point, target) <= target.radius + padding);
  const dx = point.x - boss.x, dy = point.y - boss.y;
  const radius = attack.radius || 0;
  if (attack.kind === 'cross') {
    for (let i = 0; i < 4; i++) {
      const angle = attack.angle + i * Math.PI / 2;
      const along = dx * Math.cos(angle) + dy * Math.sin(angle);
      const across = -dx * Math.sin(angle) + dy * Math.cos(angle);
      const ex = Math.max(0, -along, along - radius);
      const ey = Math.max(0, Math.abs(across) - attack.width / 2);
      if (ex * ex + ey * ey <= padding * padding) return true;
    }
    return false;
  }
  if (attack.kind !== 'sweep') return false;
  const d = Math.hypot(dx, dy);
  if (d > radius + padding) return false;
  const delta = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - attack.angle), Math.cos(Math.atan2(dy, dx) - attack.angle)));
  const halfArc = (attack.arc || 0) / 2;
  if (d <= padding || delta <= halfArc) return true;
  // Outside the sector angle, the closest point is on either radial edge.
  for (const edge of [attack.angle - halfArc, attack.angle + halfArc]) {
    const along = Math.max(0, Math.min(radius, dx * Math.cos(edge) + dy * Math.sin(edge)));
    if (Math.hypot(dx - Math.cos(edge) * along, dy - Math.sin(edge) * along) <= padding) return true;
  }
  return false;
}

function startAttack(game, boss) {
  const sequence = boss.attackSequence++;
  const kind = ATTACKS[sequence % ATTACKS.length];
  const actors = (game.actors || []).filter(actor => alive(actor) && !(actor.invulnerableUntil > game.time));
  // Only aimed attacks draw from the match's seeded stream. Cross orientation
  // stays on its fixed alternation, and protected actors cannot be locked.
  const target = kind === 'sweep' && actors.length ? actors[Math.floor(game.rng() * actors.length)] : null;
  const attack = {
    id: `boss:${sequence + 1}`, kind, startedAt: game.time,
    // A base-speed swordsman must be able to leave the 200px sweep on foot;
    // later phases accelerate the cadence without removing that escape time.
    windup: kind === 'sweep' ? 1.35 : Math.max(0.65, 1.1 * STAGE_INTERVAL[boss.stage - 1]),
    active: 0.15, recovery: 0.6,
    angle: kind === 'cross' ? (Math.floor(sequence / 3) % 2) * Math.PI / 4
      : target ? Math.atan2(target.y - boss.y, target.x - boss.x) : -Math.PI / 2,
    radius: kind === 'sweep' ? 200 : 480,
    arc: 160 * Math.PI / 180, width: 80,
    damage: ({ sweep: 45, rocks: 40, cross: 38 })[kind] * STAGE_DAMAGE[boss.stage - 1],
    hitIds: new Set(),
  };
  if (kind === 'rocks') {
    attack.targets = [];
    while (actors.length && attack.targets.length < 3) {
      const index = Math.floor(game.rng() * actors.length);
      const [actor] = actors.splice(index, 1);
      attack.targets.push({ x: actor.x, y: actor.y, radius: 64 });
    }
  }
  boss.attack = attack;
  boss.nextAttackAt = game.time + attack.windup + attack.active + attack.recovery + 1.1 * STAGE_INTERVAL[boss.stage - 1];
}

// Includes the warning and any elapsed step overlapping the active window.
// AI runs after time advances but before damage, so both must use this boundary.
export function bossAttackThreatensStep(attack, time, dt) {
  return !!attack && time - dt < attack.startedAt + attack.windup + attack.active;
}

export function tickBoss(game, dt) {
  const boss = game.boss;
  if (!boss || !(dt > 0)) return;
  if (!alive(boss)) { boss.alive = false; boss.attack = null; return; }
  boss.x = game.map.width / 2; boss.y = game.map.height / 2;
  boss.stage = boss.hp <= boss.maxHp * 0.33 ? 3 : boss.hp <= boss.maxHp * 0.66 ? 2 : 1;
  boss.hitFlash = Math.max(0, (boss.hitFlash || 0) - dt);
  if (!boss.attack && game.time >= boss.nextAttackAt) startAttack(game, boss);
  const attack = boss.attack;
  if (!attack) return;
  const activeAt = attack.startedAt + attack.windup;
  const activeEnd = activeAt + attack.active;
  // Intersect the elapsed step with the window, so coarse headless steps cannot skip hits.
  if (game.time >= activeAt && bossAttackThreatensStep(attack, game.time, dt)) {
    for (const actor of game.actors || []) {
      if (!alive(actor) || actor.invulnerableUntil > game.time || attack.hitIds.has(actor.id)) continue;
      if (!bossAttackContains(attack, boss, actor, actor.radius || 12)) continue;
      attack.hitIds.add(actor.id);
      damage(game, actor, attack.damage, boss);
    }
  }
  if (game.time >= activeEnd + attack.recovery) boss.attack = null;
}
