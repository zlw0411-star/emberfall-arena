import { normalizeBiome } from './biomes.js';

export const MATCH_SIZE = 12;
const WORLD_SIZE = 2048;
const TILE_SIZE = 32;
const INDEX_CELL_SIZE = 128;
const obstacleIndexes = new WeakMap();

function buildObstacleIndex(map) {
  const obstacles = Array.isArray(map.obstacles) ? map.obstacles : [];
  const cells = new Map();
  const cols = Math.ceil(map.width / INDEX_CELL_SIZE);
  const rows = Math.ceil(map.height / INDEX_CELL_SIZE);
  const large = [];
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.w) || !Number.isFinite(o.h)) continue;
    const minX = Math.floor(o.x / INDEX_CELL_SIZE);
    const maxX = Math.floor((o.x + o.w) / INDEX_CELL_SIZE);
    const minY = Math.floor(o.y / INDEX_CELL_SIZE);
    const maxY = Math.floor((o.y + o.h) / INDEX_CELL_SIZE);
    const span = (maxX - minX + 1) * (maxY - minY + 1);
    if (span > 256) { large.push(i); continue; }
    for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      const key = cy * cols + cx;
      let bucket = cells.get(key);
      if (!bucket) cells.set(key, bucket = []);
      bucket.push(i);
    }
  }
  const index = { obstacles, length: obstacles.length, revision: map.obstacleRevision ?? map._obstacleRevision, cols, rows, cells, large };
  obstacleIndexes.set(map, index);
  return index;
}

function getObstacleIndex(map) {
  let index = obstacleIndexes.get(map);
  const obstacles = Array.isArray(map.obstacles) ? map.obstacles : [];
  const revision = map.obstacleRevision ?? map._obstacleRevision;
  if (!index || index.obstacles !== obstacles || index.length !== obstacles.length || index.revision !== revision) {
    index = buildObstacleIndex(map);
  }
  return index;
}

function hashSeed(seed) {
  const text = String(seed ?? 1);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rngFromSeed(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return function random() {
    state |= 0;
    state = state + 0x6d2b79f5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function circleIntersectsRect(x, y, radius, rect) {
  const px = Math.max(rect.x, Math.min(x, rect.x + rect.w));
  const py = Math.max(rect.y, Math.min(y, rect.y + rect.h));
  const dx = x - px;
  const dy = y - py;
  return dx * dx + dy * dy < radius * radius;
}

export function blocked(map, x, y, radius = 12) {
  if (!map || x - radius < 0 || y - radius < 0 || x + radius > map.width || y + radius > map.height) return true;
  const index = getObstacleIndex(map);
  const minX = Math.floor((x - radius) / INDEX_CELL_SIZE);
  const maxX = Math.floor((x + radius) / INDEX_CELL_SIZE);
  const minY = Math.floor((y - radius) / INDEX_CELL_SIZE);
  const maxY = Math.floor((y + radius) / INDEX_CELL_SIZE);
  const checked = new Set(index.large);
  for (let cy = minY; cy <= maxY; cy++) for (let cx = minX; cx <= maxX; cx++) {
    if (cx < 0 || cy < 0 || cx >= index.cols || cy >= index.rows) continue;
    const bucket = index.cells.get(cy * index.cols + cx);
    if (bucket) for (const obstacleId of bucket) checked.add(obstacleId);
  }
  for (const obstacleId of checked) {
    if (circleIntersectsRect(x, y, radius, index.obstacles[obstacleId])) return true;
  }
  return false;
}

export function lineClear(map, a, b, radius = 0) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 8));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (blocked(map, a.x + dx * t, a.y + dy * t, Math.max(0.5, radius))) return false;
  }
  return true;
}

export function moveEntity(map, entity, dx, dy) {
  if (!entity || !Number.isFinite(dx) || !Number.isFinite(dy)) return entity;
  const radius = Math.max(0, Number.isFinite(entity.radius) ? entity.radius : 12);
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / Math.max(2, radius * 0.45)));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    const nx = entity.x + sx;
    const ny = entity.y + sy;
    if (!blocked(map, nx, entity.y, radius)) entity.x = nx;
    if (!blocked(map, entity.x, ny, radius)) entity.y = ny;
  }
  return entity;
}

export function randomFree(map, rng, padding = 24) {
  // rng 必传：以前默认回退到 Math.random，一旦某个调用点漏传，
  // 地图就会静默变成不可复现的，而所有测试仍会通过。宁可直接报错。
  if (typeof rng !== 'function') {
    throw new TypeError('randomFree 需要一个确定性的 rng 函数（不要回退到 Math.random）');
  }
  for (let i = 0; i < 900; i++) {
    const x = padding + rng() * (map.width - padding * 2);
    const y = padding + rng() * (map.height - padding * 2);
    if (!blocked(map, x, y, padding)) return { x, y };
  }
  for (let y = padding; y < map.height - padding; y += 12) {
    for (let x = padding; x < map.width - padding; x += 12) {
      if (!blocked(map, x, y, padding)) return { x, y };
    }
  }
  return { x: map.width / 2, y: map.height / 2 };
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

export function generateMap(seed = 1, { biome = 'courtyard' } = {}) {
  biome = normalizeBiome(biome);
  if (biome !== 'courtyard') return generateBiomeMap(seed, biome);
  const rng = rngFromSeed(seed);
  const map = {
    width: WORLD_SIZE, height: WORLD_SIZE, tileSize: TILE_SIZE,
    obstacles: [], traps: [], spawnPoints: [], freePoints: [], seed
  };
  const center = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
  const spawnRadius = 790;
  for (let i = 0; i < MATCH_SIZE; i++) {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / MATCH_SIZE;
    map.spawnPoints.push({
      x: center.x + Math.cos(angle) * spawnRadius,
      y: center.y + Math.sin(angle) * spawnRadius
    });
  }

  // Small ruin clusters sit on a broad lattice. The 32 px movement radius
  // always has a wide route between clusters, including around the center.
  const grid = [220, 486, 752, 1018, 1284, 1550, 1816];
  for (const cy of grid) for (const cx of grid) {
    const site = { x: cx, y: cy };
    if (dist(site, center) < 205 || map.spawnPoints.some(p => dist(site, p) < 118)) continue;
    if (rng() > 0.69) continue;
    const count = 2 + Math.floor(rng() * 3);
    for (let j = 0; j < count; j++) {
      const w = 34 + Math.floor(rng() * 25);
      const h = 34 + Math.floor(rng() * 25);
      const x = cx + (rng() - 0.5) * 112 - w / 2;
      const y = cy + (rng() - 0.5) * 112 - h / 2;
      map.obstacles.push({ x, y, w, h, kind: rng() < 0.72 ? 'ruin' : 'rock' });
    }
    if (rng() < 0.34) {
      const x = cx - 42 + rng() * 35;
      const y = cy - 42 + rng() * 35;
      map.obstacles.push({ x, y, w: 48, h: 24, kind: 'wall' });
    }
  }

  // Traps are placed on open ground, away from spawn pads and the finale pad.
  for (let i = 0; i < 58; i++) {
    let point = null;
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = { x: 70 + rng() * 1908, y: 70 + rng() * 1908 };
      if (blocked(map, candidate.x, candidate.y, 38)) continue;
      if (dist(candidate, center) < 150 || map.spawnPoints.some(p => dist(candidate, p) < 90)) continue;
      if (map.traps.some(t => dist(candidate, t) < t.r + 65)) continue;
      point = candidate;
      break;
    }
    if (point) map.traps.push({ x: point.x, y: point.y, r: 21 + rng() * 10, type: rng() < 0.55 ? 'spike' : 'mud', offset: rng() * 4 });
  }

  // Spawn points and resource points are always clear for a 16 px body.
  map.spawnPoints = map.spawnPoints.map(p => blocked(map, p.x, p.y, 16) ? randomFree(map, rng, 30) : p);
  for (let i = 0; i < 56; i++) {
    const p = randomFree(map, rng, 28);
    if (map.freePoints.every(q => dist(q, p) >= 38) && !map.traps.some(t => dist(t, p) < t.r + 22)) map.freePoints.push(p);
  }
  return map;
}

// Biome geometry uses isolated, connected clusters on a 320 px lattice.
// Every lattice cluster fits inside a 224 px square, leaving >= 96 px geometric
// lanes (64 px of center travel for a radius-16 body) and a clear perimeter.
// Frost and swamp also retain a 96 px central cross; desert pillars interrupt
// the direct center approach with open detours outside the 160 px finale pad.
// Clusters have no loops, keeping free spawns and resources out of sealed rooms.
function generateBiomeMap(seed, biome) {
  const rng = rngFromSeed(seed);
  const map = {
    width: WORLD_SIZE, height: WORLD_SIZE, tileSize: TILE_SIZE,
    obstacles: [], traps: [], spawnPoints: [], freePoints: [], seed, biome
  };
  const center = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
  for (let i = 0; i < MATCH_SIZE; i++) {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / MATCH_SIZE;
    map.spawnPoints.push({ x: center.x + Math.cos(angle) * 790, y: center.y + Math.sin(angle) * 790 });
  }

  // Rotating whole clusters creates varied corners while preserving their
  // connected, hole-free shape and the open lanes around their footprint.
  function placeCluster(cx, cy, pieces, turns) {
    const rectangles = pieces.map(piece => {
      let { x, y, w, h, kind } = piece;
      for (let i = 0; i < turns; i++) [x, y, w, h] = [-y - h, x, h, w];
      return { x: cx + x, y: cy + y, w, h, kind };
    });
    if (rectangles.some(rect =>
      circleIntersectsRect(center.x, center.y, 160, rect) ||
      map.spawnPoints.some(p => circleIntersectsRect(p.x, p.y, 100, rect)))) return;
    map.obstacles.push(...rectangles);
  }

  const grid = [224, 544, 864, 1184, 1504, 1824];
  for (let row = 0; row < grid.length; row++) for (let col = 0; col < grid.length; col++) {
    const cx = grid[col], cy = grid[row];
    const chance = biome === 'desert' ? 0.56 : biome === 'frost' ? 0.86 : 0.82;
    if (rng() > chance) continue;
    const turns = Math.floor(rng() * 4);
    let pieces;
    if (biome === 'desert') {
      const w = 70 + Math.floor(rng() * 31), h = 96 + Math.floor(rng() * 39);
      // Broad pillars and attached boulders leave long, open sight lines.
      pieces = [{ x: -w / 2, y: -h / 2, w, h, kind: 'rock' }];
      if (rng() < 0.72) pieces.push({ x: w / 2 - 12, y: -24, w: 44 + Math.floor(rng() * 18), h: 48, kind: 'rock' });
      if (rng() < 0.35) pieces.push({ x: -w / 2 - 30, y: 10, w: 42, h: 42, kind: 'rock' });
    } else if (biome === 'frost') {
      const length = 176 + Math.floor(rng() * 49), thickness = 28 + Math.floor(rng() * 9);
      const half = length / 2;
      // Alternating long walls and open L shapes form staggered passages.
      pieces = [{ x: -half, y: -half, w: thickness, h: length, kind: 'wall' }];
      if ((row + col) % 3 !== 0) pieces.push({ x: -half, y: half - thickness, w: length, h: thickness, kind: 'wall' });
    } else {
      const trunk = 144 + Math.floor(rng() * 29);
      // Roots join the trunk with a solid overlap. The branching silhouette
      // shelters dry landing spots without making small enclosed rooms.
      pieces = [
        { x: -20, y: -trunk / 2, w: 40, h: trunk, kind: 'rock' },
        { x: -88, y: -42, w: 108, h: 30, kind: 'rock' },
        { x: -20, y: 22, w: 108, h: 30, kind: 'rock' }
      ];
      if (rng() < 0.45) pieces.push({ x: -62, y: -66, w: 28, h: 42, kind: 'ruin' });
    }
    placeCluster(cx, cy, pieces, turns);
  }

  if (biome === 'desert') {
    // Four pillars break direct sight lines into the center while retaining
    // the sparse outer rock field and a clear 180 px radius inside the pillars.
    for (let side = 0; side < 4; side++) {
      placeCluster(center.x, center.y, [{ x: -236, y: -72, w: 56, h: 144, kind: 'rock' }], side);
    }
  }

  const trapPlan = biome === 'desert'
    ? [{ type: 'mud', count: 12, min: 27, span: 12 }, { type: 'spike', count: 16, min: 21, span: 8 }]
    : biome === 'frost'
      ? [{ type: 'mud', count: 12, min: 25, span: 11 }, { type: 'spike', count: 22, min: 21, span: 9 }]
      : [{ type: 'mud', count: 27, min: 38, span: 22 }, { type: 'spike', count: 10, min: 21, span: 8 }];
  for (const plan of trapPlan) for (let i = 0; i < plan.count; i++) {
    const r = plan.min + rng() * plan.span;
    for (let attempt = 0; attempt < 180; attempt++) {
      const p = { x: 112 + rng() * 1824, y: 112 + rng() * 1824 };
      // The cross and perimeter stay dry so every quadrant retains a broad
      // route around even the swamp's larger slowing pools.
      if (Math.abs(p.x - center.x) < 48 + r || Math.abs(p.y - center.y) < 48 + r) continue;
      if (blocked(map, p.x, p.y, r + 8)) continue;
      if (dist(p, center) < 160 + r || map.spawnPoints.some(spawn => dist(p, spawn) < 100 + r)) continue;
      if (map.traps.some(trap => dist(p, trap) < trap.r + r + 40)) continue;
      map.traps.push({ x: p.x, y: p.y, r, type: plan.type, offset: rng() * 4 });
      break;
    }
  }

  for (let attempt = 0; attempt < 1800 && map.freePoints.length < 56; attempt++) {
    const p = randomFree(map, rng, 28);
    if (map.freePoints.every(q => dist(q, p) >= 38) && !map.traps.some(trap => dist(trap, p) < trap.r + 22)) map.freePoints.push(p);
  }
  return map;
}
