import test from 'node:test';
import assert from 'node:assert/strict';
import { BIOMES, DEFAULT_BIOME, biomeOf, normalizeBiome } from '../dist/js/biomes.js';
import { CONFIG, createGame, spawnGem, spawnMonster, stepGame } from '../dist/js/simulation.js';
import { blocked, generateMap, lineClear } from '../dist/js/world.js';

const NEW_BIOMES = ['desert', 'frost', 'swamp'];
const SEEDS = ['map-connect-a', 'map-connect-b', 'map-connect-c', 'map-connect-d'];
const GRID = 32;
const BODY = 16;

function gridFor(map) {
  const cols = Math.floor(map.width / GRID);
  const rows = Math.floor(map.height / GRID);
  const points = [];
  const open = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const point = { x: x * GRID + GRID / 2, y: y * GRID + GRID / 2 };
    const index = y * cols + x;
    points.push(point);
    if (!blocked(map, point.x, point.y, BODY)) open[index] = 1;
  }
  return { cols, rows, points, open };
}

function floodMap(map) {
  const grid = gridFor(map);
  const { cols, rows, points, open } = grid;
  const start = open.findIndex(Boolean);
  assert.notEqual(start, -1, `${map.biome}: map has no walkable grid cells`);
  const seen = new Uint8Array(open.length);
  const queue = [start];
  seen[start] = 1;
  for (let head = 0; head < queue.length; head++) {
    const index = queue[head];
    const x = index % cols;
    const y = Math.floor(index / cols);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = ny * cols + nx;
      if (seen[next] || !open[next]) continue;
      if (!lineClear(map, points[index], points[next], BODY)) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  assert.equal(seen.reduce((sum, value) => sum + value, 0), open.reduce((sum, value) => sum + value, 0),
    `${map.biome}: walkable regions are disconnected`);
  return { ...grid, seen };
}

function nearestOpen(map, grid, point) {
  let nearest = -1;
  let nearestDistance = Infinity;
  for (let i = 0; i < grid.points.length; i++) {
    if (!grid.open[i]) continue;
    const candidate = grid.points[i];
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < nearestDistance) { nearest = i; nearestDistance = distance; }
  }
  assert.notEqual(nearest, -1, `${map.biome}: no open grid cell near resource`);
  assert.ok(lineClear(map, point, grid.points[nearest], BODY),
    `${map.biome}: resource at (${point.x.toFixed(1)}, ${point.y.toFixed(1)}) cannot reach nearest open cell`);
  return nearest;
}

function obstacleLayout(map) {
  return JSON.stringify(map.obstacles.map(({ x, y, w, h, kind }) => [x, y, w, h, kind]));
}

test('biome registry normalizes all supported ids and keeps courtyard as the default', () => {
  assert.equal(DEFAULT_BIOME, 'courtyard');
  assert.equal(Object.hasOwn(generateMap('courtyard-default-contract'), 'biome'), false,
    'default courtyard map must preserve its original shape without a biome field');
  for (const id of ['courtyard', ...NEW_BIOMES]) {
    assert.ok(BIOMES[id], `missing biome definition ${id}`);
    assert.equal(normalizeBiome(id), id);
  }
  assert.equal(normalizeBiome('unknown'), DEFAULT_BIOME);
  assert.equal(biomeOf('desert'), BIOMES.desert);
  assert.equal(biomeOf({ biome: 'swamp' }), BIOMES.swamp);
});

test('each new biome is reproducible, distinct, fully connected, and has reachable starts and resources', () => {
  for (const biome of NEW_BIOMES) {
    const layouts = new Set();
    for (const seed of SEEDS) {
      const map = generateMap(seed, { biome });
      const replay = generateMap(seed, { biome });
      assert.deepEqual(replay, map, `${biome}/${seed}: map generation is not reproducible`);
      assert.equal(map.biome, biome, `${biome}/${seed}: biome id missing from map`);

      const grid = floodMap(map);
      assert.equal(map.spawnPoints.length, 12, `${biome}/${seed}: expected twelve spawn points`);
      assert.equal(new Set(map.spawnPoints.map(p => `${p.x},${p.y}`)).size, 12,
        `${biome}/${seed}: spawn points must be unique`);
      for (const [i, point] of map.spawnPoints.entries()) {
        assert.equal(blocked(map, point.x, point.y, BODY), false, `${biome}/${seed}: blocked spawn ${i}`);
        const cell = nearestOpen(map, grid, point);
        assert.equal(grid.seen[cell], 1, `${biome}/${seed}: spawn ${i} is unreachable`);
      }

      const center = { x: map.width / 2, y: map.height / 2 };
      assert.equal(blocked(map, center.x, center.y, 100), false, `${biome}/${seed}: finale center is blocked`);
      for (let radius = 0; radius <= 100; radius += 16) for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        assert.equal(blocked(map, center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius, BODY), false,
          `${biome}/${seed}: blocked point inside finale center radius 100`);
      }
      assert.equal(grid.seen[nearestOpen(map, grid, center)], 1, `${biome}/${seed}: center is unreachable`);

      for (const point of map.freePoints) {
        assert.equal(grid.seen[nearestOpen(map, grid, point)], 1, `${biome}/${seed}: free point is unreachable`);
      }

      const game = createGame(seed, { mode: 'classic', mapId: biome });
      assert.equal(game.map.biome, biome);
      for (const point of [...game.gems, ...game.monsters]) {
        assert.equal(grid.seen[nearestOpen(map, grid, point)], 1, `${biome}/${seed}: initial resource is unreachable`);
      }
      layouts.add(obstacleLayout(map));
    }
    assert.equal(layouts.size, SEEDS.length, `${biome}: seeds produced repeated obstacle layouts`);
  }

  const signatures = NEW_BIOMES.map(biome => obstacleLayout(generateMap('map-biome-shape', { biome })));
  assert.equal(new Set(signatures).size, NEW_BIOMES.length, 'new biomes do not have distinct obstacle layouts');
});

test('both game modes can select each map and random selection is deterministic and resolved', () => {
  for (const mapId of ['courtyard', ...NEW_BIOMES]) for (const mode of ['classic', 'melee']) {
    const game = createGame(`map-mode-${mapId}-${mode}`, { mode, mapId });
    assert.equal(game.mode, mode);
    assert.equal(game.map.biome || game.map.id || DEFAULT_BIOME, mapId);
  }
  for (const seed of SEEDS) {
    const a = createGame(seed, { mapId: 'random' });
    const b = createGame(seed, { mapId: 'random' });
    const actualA = a.map.biome || a.map.id || DEFAULT_BIOME;
    const actualB = b.map.biome || b.map.id || DEFAULT_BIOME;
    assert.ok(['courtyard', ...NEW_BIOMES].includes(actualA), `${seed}: random map did not resolve`);
    assert.equal(actualA, actualB, `${seed}: random map selection changed on replay`);
  }
  const sampled = new Set(Array.from({ length: 24 }, (_, i) => biomeOf(createGame(`random-map-${i}`, { mapId: 'random' }).map).id));
  assert.equal(sampled.size, Object.keys(BIOMES).length, 'random selection should reach every registered map across seeds');
});

test('player or AI reaching max level starts a reachable finale without new spawns', () => {
  for (const mapId of NEW_BIOMES) for (const role of ['player', 'AI']) {
    const game = createGame(`map-finale-${mapId}-${role}`, { mode: role === 'AI' ? 'melee' : 'classic', mapId });
    const actor = role === 'player' ? game.actors.find(item => item.isPlayer) : game.actors.find(item => !item.isPlayer);
    actor.level = CONFIG.maxLevel;
    const monsterSpawns = game.spawnCount;
    const gemSpawns = game.gemSpawnCount;
    stepGame(game, 1 / 60);
    assert.equal(game.phase, 'finale', `${mapId}/${role}: max level did not start finale`);
    assert.ok(game.zone && Number.isFinite(game.zone.x) && Number.isFinite(game.zone.y), `${mapId}/${role}: invalid finale center`);
    assert.equal(blocked(game.map, game.zone.x, game.zone.y, 100), false, `${mapId}/${role}: finale center is blocked`);
    const grid = floodMap(game.map);
    assert.equal(grid.seen[nearestOpen(game.map, grid, game.zone)], 1, `${mapId}/${role}: finale center is unreachable`);
    assert.equal(spawnMonster(game), null, `${mapId}/${role}: monster spawned during finale`);
    assert.equal(spawnGem(game), null, `${mapId}/${role}: gem spawned during finale`);
    stepGame(game, 1 / 60);
    assert.equal(game.spawnCount, monsterSpawns, `${mapId}/${role}: monster spawn counter advanced in finale`);
    assert.equal(game.gemSpawnCount, gemSpawns, `${mapId}/${role}: gem spawn counter advanced in finale`);
  }
});

