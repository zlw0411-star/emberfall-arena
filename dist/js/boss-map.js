import { blocked, generateMap, lineClear, MATCH_SIZE, rngFromSeed } from './world.js';

const CENTER_CLEAR = 440;
const SPAWN_RADIUS = 640;
const CORRIDOR_HALF_WIDTH = 58;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const circleRect = (point, radius, rect) => Math.hypot(point.x - Math.max(rect.x, Math.min(point.x, rect.x + rect.w)), point.y - Math.max(rect.y, Math.min(point.y, rect.y + rect.h))) <= radius;

function inCorridor(point, center, radius = 0) {
  for (let i = 0; i < MATCH_SIZE; i++) {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / MATCH_SIZE;
    const dx = point.x - center.x, dy = point.y - center.y;
    const along = dx * Math.cos(angle) + dy * Math.sin(angle);
    const across = Math.abs(-dx * Math.sin(angle) + dy * Math.cos(angle));
    if (along >= -radius && along <= 940 + radius && across <= CORRIDOR_HALF_WIDTH + radius) return true;
  }
  return false;
}

export function generateBossMap(seed = 1, { biome = 'courtyard' } = {}) {
  const map = generateMap(seed, { biome });
  map.biome ||= 'courtyard';
  map.layout = 'boss';
  map.seed = `${String(seed)}:boss`;
  const center = { x: map.width / 2, y: map.height / 2 };
  map.spawnPoints = Array.from({ length: MATCH_SIZE }, (_, i) => {
    const angle = -Math.PI / 2 + i * Math.PI * 2 / MATCH_SIZE;
    return { x: center.x + Math.cos(angle) * SPAWN_RADIUS, y: center.y + Math.sin(angle) * SPAWN_RADIUS };
  });
  map.obstacles = map.obstacles.filter(rect => {
    if (circleRect(center, CENTER_CLEAR, rect) || map.spawnPoints.some(point => circleRect(point, 100, rect))) return false;
    const point = { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
    return !inCorridor(point, center, Math.hypot(rect.w, rect.h) / 2);
  });
  map.traps = map.traps.filter(trap => distance(trap, center) > CENTER_CLEAR + trap.r
    && map.spawnPoints.every(point => distance(point, trap) > 100 + trap.r)
    && !inCorridor(trap, center, trap.r));

  // Resources only use radius-16 reachable ground. Cardinal flood edges are
  // checked continuously rather than assuming free grid centers imply a route.
  const step = 32, cols = map.width / step, rows = map.height / step;
  const start = Math.floor(center.y / step) * cols + Math.floor(center.x / step);
  const reached = new Set([start]), queue = [start];
  const pointFor = index => ({ x: (index % cols) * step + step / 2, y: Math.floor(index / cols) * step + step / 2 });
  for (let n = 0; n < queue.length; n++) {
    const index = queue[n], x = index % cols, y = Math.floor(index / cols);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, next = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || reached.has(next)) continue;
      const point = pointFor(next);
      if (blocked(map, point.x, point.y, 20) || !lineClear(map, pointFor(index), point, 16)) continue;
      reached.add(next); queue.push(next);
    }
  }
  const rng = rngFromSeed(`${map.seed}:resources`);
  const candidates = queue.filter(index => distance(pointFor(index), center) >= 510);
  // Shuffle with a dedicated stream, leaving game.rng entirely untouched.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  map.freePoints = [];
  for (const index of candidates) {
    const point = pointFor(index);
    if (map.traps.some(trap => distance(point, trap) < trap.r + 30)
      || map.spawnPoints.some(spawn => distance(point, spawn) < 70)
      || map.freePoints.some(other => distance(point, other) < 64)) continue;
    map.freePoints.push(point);
    if (map.freePoints.length >= 72) break;
  }
  return map;
}
