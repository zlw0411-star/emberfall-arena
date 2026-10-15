import { blocked, lineClear } from './world.js';

const GRID = 48;
const BODY = 14;
const SPIKE_ACTIVE_AT = 2.8;

function cellKey(x, y) { return `${x},${y}`; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function alive(entity) { return entity && entity.alive !== false && (entity.hp == null || entity.hp > 0); }
function activeSpike(game, trap) { return trap.type === 'spike' && ((game.time + (trap.offset || 0)) % 4 + 4) % 4 >= SPIKE_ACTIVE_AT; }

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= item.f) break;
      a[i] = a[p]; i = p;
    }
    a[i] = item;
  }
  pop() {
    const a = this.items;
    if (!a.length) return null;
    const first = a[0];
    const tail = a.pop();
    if (a.length) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= a.length) break;
        if (c + 1 < a.length && a[c + 1].f < a[c].f) c++;
        if (a[c].f >= tail.f) break;
        a[i] = a[c]; i = c;
      }
      a[i] = tail;
    }
    return first;
  }
  get length() { return this.items.length; }
}

function dims(map) { return { cols: Math.ceil(map.width / GRID), rows: Math.ceil(map.height / GRID) }; }
function pointFor(map, ix, iy) { return { x: Math.min(map.width - BODY - 1, ix * GRID + GRID / 2), y: Math.min(map.height - BODY - 1, iy * GRID + GRID / 2) }; }
function cellFor(map, p) {
  const { cols, rows } = dims(map);
  return { x: clamp(Math.floor(p.x / GRID), 0, cols - 1), y: clamp(Math.floor(p.y / GRID), 0, rows - 1) };
}
function trapCost(game, p) {
  let cost = 0;
  for (const t of game.map.traps || []) {
    const d = Math.hypot(p.x - t.x, p.y - t.y);
    if (t.type === 'spike' && activeSpike(game, t) && d < t.r + 30) cost += 48;
    else if (t.type === 'spike' && d < t.r + 34) cost += 12;
    else if (t.type === 'mud' && d < t.r + 22) cost += 3.5;
  }
  return cost;
}
function validCell(game, ix, iy) {
  const p = pointFor(game.map, ix, iy);
  return !blocked(game.map, p.x, p.y, BODY);
}
function nearestValidCell(game, origin) {
  const c = cellFor(game.map, origin);
  if (validCell(game, c.x, c.y)) return c;
  const { cols, rows } = dims(game.map);
  for (let r = 1; r < 6; r++) for (let y = c.y - r; y <= c.y + r; y++) for (let x = c.x - r; x <= c.x + r; x++) {
    if (x < 0 || y < 0 || x >= cols || y >= rows || Math.max(Math.abs(x - c.x), Math.abs(y - c.y)) !== r) continue;
    if (validCell(game, x, y)) return { x, y };
  }
  return c;
}

function findPath(game, from, to) {
  const map = game.map;
  const { cols, rows } = dims(map);
  const start = nearestValidCell(game, from);
  const goal = nearestValidCell(game, to);
  if (start.x === goal.x && start.y === goal.y) return [pointFor(map, goal.x, goal.y)];
  const startKey = cellKey(start.x, start.y);
  const goalKey = cellKey(goal.x, goal.y);
  const open = new MinHeap();
  const best = new Map([[startKey, 0]]);
  const parent = new Map();
  const point = pointFor(map, start.x, start.y);
  open.push({ x: start.x, y: start.y, f: Math.hypot(goal.x - start.x, goal.y - start.y), g: 0 });
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let visited = 0;
  while (open.length && visited++ < cols * rows) {
    const node = open.pop();
    const key = cellKey(node.x, node.y);
    if (node.g !== best.get(key)) continue;
    if (key === goalKey) break;
    for (const [dx, dy] of dirs) {
      const x = node.x + dx, y = node.y + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows || !validCell(game, x, y)) continue;
      if (dx && dy && (!validCell(game, node.x + dx, node.y) || !validCell(game, node.x, node.y + dy))) continue;
      const p = pointFor(map, x, y);
      const here = pointFor(map, node.x, node.y);
      if (!lineClear(map, here, p, BODY)) continue;
      const nextKey = cellKey(x, y);
      const g = node.g + (dx && dy ? 1.4142 : 1) + trapCost(game, p);
      if (g >= (best.get(nextKey) ?? Infinity)) continue;
      best.set(nextKey, g);
      parent.set(nextKey, key);
      open.push({ x, y, g, f: g + Math.hypot(goal.x - x, goal.y - y) });
    }
  }
  if (!parent.has(goalKey)) return [to];
  const keys = [goalKey];
  while (keys[keys.length - 1] !== startKey) {
    const previous = parent.get(keys[keys.length - 1]);
    if (!previous) return [to];
    keys.push(previous);
  }
  keys.reverse();
  return keys.slice(1).map(k => {
    const [x, y] = k.split(',').map(Number);
    return pointFor(map, x, y);
  });
}

function pathTo(game, actor, target, mode = 'move') {
  if (!actor.ai) actor.ai = {};
  const state = actor.ai;
  const now = game.time || 0;
  const tc = cellFor(game.map, target);
  const targetKey = `${mode}:${tc.x},${tc.y}`;
  const moved = !state.pathTarget || distance(target, state.pathTarget) > 70;
  const expired = now >= (state.repathAt || 0);
  if (state.map !== game.map || state.pathKey !== targetKey || moved || expired || !state.path) {
    state.path = findPath(game, actor, target);
    state.pathTarget = { x: target.x, y: target.y };
    state.pathKey = targetKey;
    state.map = game.map;
    state.pathIndex = 0;
    state.repathAt = now + 0.65 + ((String(actor.id).length % 4) * 0.06);
  }
  while (state.pathIndex < state.path.length - 1 && distance(actor, state.path[state.pathIndex]) < 20) state.pathIndex++;
  let waypoint = state.path[state.pathIndex] || target;
  // A stale route or moving target may put a wall between adjacent waypoints.
  if (!lineClear(game.map, actor, waypoint, actor.radius || 12)) {
    state.repathAt = 0;
    state.path = findPath(game, actor, target);
    state.pathIndex = 0;
    waypoint = state.path[0] || target;
  }
  return waypoint;
}

function getThreats(game, actor) {
  const threats = (game.monsters || []).filter(m => alive(m) && distance(m, actor) < 390);
  if (game.phase !== 'grace') {
    for (const other of game.actors || []) {
      if (other === actor || (actor.id != null && other?.id === actor.id) || !alive(other)) continue;
      if (distance(other, actor) < 390) threats.push(other);
    }
  }
  return threats.sort((a, b) => distance(a, actor) - distance(b, actor));
}
function lowHealth(actor) { return actor.maxHp > 0 && actor.hp / actor.maxHp < 0.34; }
function healthRatio(actor) { return actor?.maxHp > 0 ? actor.hp / actor.maxHp : 1; }
function isActorThreat(game, threat) {
  return (game.actors || []).some(other => other === threat || (threat?.id != null && other?.id === threat.id));
}
function nearestGem(game, actor, threats) {
  let chosen = null, score = Infinity;
  for (const gem of game.gems || []) {
    if (gem.kind === 'heal' && actor.hp / actor.maxHp > 0.78) continue;
    const d = distance(actor, gem);
    if (d > 760) continue;
    let danger = 0;
    for (const threat of threats) if (distance(threat, gem) < 180) danger++;
    const value = d + danger * 100 - (gem.kind === 'heal' ? 95 : Math.min(45, gem.value || 10));
    if (value < score) { score = value; chosen = gem; }
  }
  return chosen;
}
function safeTarget(game, actor) {
  const z = game.zone;
  if (!z || distance(actor, z) <= z.radius - (actor.radius || 12) - 8) return null;
  const d = distance(actor, z);
  const inset = Math.max(0, z.radius - 70);
  const f = d > 0 ? inset / d : 0;
  return { x: z.x + (actor.x - z.x) * f, y: z.y + (actor.y - z.y) * f };
}
function retreatTarget(game, actor, threats) {
  let vx = 0, vy = 0;
  for (const m of threats) {
    const dx = actor.x - m.x, dy = actor.y - m.y;
    const d2 = Math.max(400, dx * dx + dy * dy);
    vx += dx / d2;
    vy += dy / d2;
  }
  const len = Math.hypot(vx, vy) || 1;
  let target = { x: actor.x + vx / len * 220, y: actor.y + vy / len * 220 };
  target.x = clamp(target.x, 30, game.map.width - 30);
  target.y = clamp(target.y, 30, game.map.height - 30);
  const safe = safeTarget(game, actor);
  if (safe && distance(safe, actor) < distance(target, actor) + 80) target = safe;
  return target;
}
function nearestAliveActor(game, actor) {
  let chosen = null, best = Infinity;
  for (const other of game.actors || []) {
    if (other === actor || (actor.id != null && other?.id === actor.id) || !alive(other)) continue;
    const d = distance(actor, other);
    if (d < best) { best = d; chosen = other; }
  }
  return chosen;
}
function pursuitPoint(game, actor, target) {
  const zone = game.zone;
  if (!target || !zone) return target;
  const maxR = Math.max(0, zone.radius - (actor.radius || 12) - 24);
  const dz = distance(target, zone);
  if (dz <= maxR || dz === 0) return target;
  const scale = maxR / dz;
  return { x: zone.x + (target.x - zone.x) * scale, y: zone.y + (target.y - zone.y) * scale };
}
function aimAndCast(game, actor, target, retreatVector = null, retreating = false) {
  if (!actor.ai) actor.ai = {};
  let direction = target || actor.ai?.lastAim || { x: actor.x + 1, y: actor.y };
  let castSlot = -1;
  if (target) {
    for (let i = 0; i < (actor.activeSkills || []).length; i++) {
      const id = actor.activeSkills[i];
      if ((actor.cooldowns?.[id] || 0) <= 0) { castSlot = i; break; }
    }
  } else if (retreating && retreatVector && Math.hypot(retreatVector.x, retreatVector.y) > 0.1) {
    castSlot = (actor.activeSkills || []).findIndex(id => id === 'dash' && (actor.cooldowns?.[id] || 0) <= 0);
  }
  if (retreating && castSlot >= 0 && actor.activeSkills?.[castSlot] === 'dash' && retreatVector) {
    direction = { x: actor.x + retreatVector.x, y: actor.y + retreatVector.y };
  }
  actor.ai.lastAim = { x: direction.x, y: direction.y };
  return { aimX: direction.x, aimY: direction.y, castSlot };
}

export function think(game, actor, dt = 1 / 30) {
  if (!game?.map || !actor || !alive(actor)) return { mx: 0, my: 0, aimX: actor?.x || 0, aimY: actor?.y || 0, castSlot: -1 };
  if (!actor.ai) actor.ai = {};
  const threats = getThreats(game, actor);
  const actorThreats = threats.filter(threat => isActorThreat(game, threat));
  const nearestOpponent = actorThreats[0] || null;
  const closeThreat = threats[0] && distance(actor, threats[0]) < 270 ? threats[0] : null;
  const finalPursuit = game.phase === 'finale' && !closeThreat ? nearestAliveActor(game, actor) : null;
  const safe = safeTarget(game, actor);
  const selfHp = healthRatio(actor);
  const opponentHp = healthRatio(nearestOpponent);
  const canHarvest = nearestOpponent && selfHp > 0.4 && opponentHp < 0.25;
  const huntPvpRetreat = game.phase === 'hunt' && actorThreats.length > 0 && (
    (selfHp < 0.6 && !canHarvest)
    || actorThreats.length >= 2
    || (actor.level || 1) + 3 <= (nearestOpponent.level || 1)
  );
  const retreating = !safe && (huntPvpRetreat || (lowHealth(actor) && threats.length > 0));
  let destination = null;
  let combatTarget = closeThreat || finalPursuit || threats[0] || null;

  if (safe) {
    destination = safe;
  } else if (retreating) {
    destination = retreatTarget(game, actor, threats);
    if (huntPvpRetreat && nearestOpponent) combatTarget = nearestOpponent;
  } else if (closeThreat && game.phase !== 'grace') {
    // Keep ranged and melee actors near their attack range while avoiding direct contact.
    const d = distance(actor, closeThreat);
    const desired = Math.max(64, (actor.attackRange || 100) * 0.72);
    if (d < desired * 0.68) {
      const away = Math.atan2(actor.y - closeThreat.y, actor.x - closeThreat.x);
      destination = { x: actor.x + Math.cos(away) * 150, y: actor.y + Math.sin(away) * 150 };
    } else if (d > (actor.attackRange || 100) * 0.9 || !lineClear(game.map, actor, closeThreat, actor.radius || 12)) {
      destination = closeThreat;
    }
  } else if (finalPursuit) {
    destination = pursuitPoint(game, actor, finalPursuit);
  }

  const gem = (!destination || (!safe && !retreating && !finalPursuit)) ? nearestGem(game, actor, threats) : null;
  if (gem && !finalPursuit && (!combatTarget || !closeThreat || distance(actor, gem) < distance(actor, combatTarget) * 0.78)) destination = gem;
  if (!destination && !combatTarget) {
    const p = actor.ai?.wanderUntil > game.time ? actor.ai.wanderTarget : null;
    if (p) destination = p;
    else {
      const a = (String(actor.id).length * 2.399) + (game.time || 0) * 0.08;
      destination = { x: clamp(actor.x + Math.cos(a) * 300, 50, game.map.width - 50), y: clamp(actor.y + Math.sin(a) * 300, 50, game.map.height - 50) };
      actor.ai.wanderTarget = destination;
      actor.ai.wanderUntil = (game.time || 0) + 7;
    }
  }

  let mx = 0, my = 0;
  if (destination) {
    const waypoint = pathTo(game, actor, destination, safe ? 'zone' : retreating ? 'retreat' : combatTarget ? 'fight' : gem ? 'xp' : 'wander');
    const dx = waypoint.x - actor.x, dy = waypoint.y - actor.y;
    const len = Math.hypot(dx, dy);
    if (len > 4) { mx = dx / len; my = dy / len; }
    // Avoid picking a trap as a direct local waypoint when crossing its warning ring.
    let hazard = null;
    for (const trap of game.map.traps || []) {
      if (trap.type !== 'spike') continue;
      const d = Math.hypot(actor.x - trap.x, actor.y - trap.y);
      if (d < trap.r + 38 && (activeSpike(game, trap) || ((game.time + (trap.offset || 0)) % 4 + 4) % 4 >= 2.1)) { hazard = trap; break; }
    }
    if (hazard) {
      const away = Math.atan2(actor.y - hazard.y, actor.x - hazard.x);
      mx = Math.cos(away); my = Math.sin(away);
    }
  }

  const aimTarget = combatTarget && lineClear(game.map, actor, combatTarget, actor.radius || 12) ? combatTarget : null;
  const action = aimAndCast(game, actor, aimTarget, { x: mx, y: my }, retreating);
  return { mx, my, aimX: action.aimX, aimY: action.aimY, castSlot: action.castSlot };
}
