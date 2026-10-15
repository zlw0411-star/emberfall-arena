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

export function randomFree(map, rng = Math.random, padding = 24) {
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

export function generateMap(seed = 1) {
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
