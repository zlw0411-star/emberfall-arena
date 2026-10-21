import test from 'node:test';
import assert from 'node:assert/strict';
import { Renderer } from '../dist/js/renderer.js';
import { createGame } from '../dist/js/simulation.js';
import { terrainBiome } from '../dist/js/terrain.js';

// Record paint, paths, styles and transforms, with Canvas save/restore semantics.
function canvasMock(width = 240, height = 160) {
  const calls = [], stack = [];
  let path = [];
  let state = {
    fillStyle: '#000000', strokeStyle: '#000000', lineWidth: 1,
    globalAlpha: 1, transform: [1, 1, 0, 0],
  };
  const context = {
    save() { stack.push(structuredClone(state)); },
    restore() {
      assert.ok(stack.length, 'restore without save');
      state = stack.pop();
    },
    translate(x, y) {
      const [sx, sy, tx, ty] = state.transform;
      state.transform = [sx, sy, tx + x * sx, ty + y * sy];
    },
    scale(x, y) {
      const [sx, sy, tx, ty] = state.transform;
      state.transform = [sx * x, sy * y, tx, ty];
    },
    beginPath() { path = []; },
    closePath() { path.push(['closePath']); },
    fill() { record('fill', structuredClone(path)); },
    stroke() { record('stroke', structuredClone(path)); },
    drawImage(image, ...args) { record('drawImage', [image, ...args]); },
  };
  function record(method, args) {
    calls.push({ method, args, ...structuredClone(state) });
  }
  for (const name of ['fillStyle', 'strokeStyle', 'lineWidth', 'globalAlpha']) {
    Object.defineProperty(context, name, {
      get: () => state[name], set: value => { state[name] = value; },
    });
  }
  for (const method of ['fillRect', 'strokeRect', 'moveTo', 'lineTo', 'ellipse', 'arc']) {
    context[method] = (...args) => {
      assert.ok(args.every(Number.isFinite), `${method}: invalid geometry`);
      if (method.endsWith('Rect')) record(method, args);
      else path.push([method, ...args]);
    };
  }
  return {
    canvas: { width, height, clientWidth: width, clientHeight: height, getContext: () => context }, context, calls,
    get depth() { return stack.length; },
    get transform() { return state.transform; },
  };
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
}

function hasRect(calls, color, args) {
  return calls.some(call => call.method === 'fillRect' && call.fillStyle === color &&
    call.args.length === args.length && call.args.every((value, i) => value === args[i]));
}

// Exercise the legacy courtyard map shape (no biome field) as well as explicit ids.
for (const mapId of [undefined, 'courtyard', 'desert', 'frost', 'swamp']) {
  test(`drawMap paints solid obstacles and preserves layers/state: ${mapId ?? 'default courtyard'}`, () => {
    const game = createGame('minimap-regression', { mapId });
    const biome = terrainBiome(game.map);
    if (mapId === 'courtyard') game.map.biome = mapId;
    if (mapId === undefined) assert.equal(Object.hasOwn(game.map, 'biome'), false);
    // All generated obstacles plus distinct wall/rock/ruin footprints on every map.
    const fixtures = [
      { x: 210, y: 320, w: 72, h: 36, kind: 'wall' },
      { x: 510, y: 640, w: 44, h: 32, kind: 'rock' },
      { x: 810, y: 940, w: 58, h: 48, kind: 'ruin' },
    ];
    game.map.obstacles.push(...fixtures);
    game.actors[2].alive = false;
    game.zone = { x: 1024, y: 1050, radius: 570 };
    const rng = () => assert.fail('drawMap consumed simulation RNG');
    game.rng = rng;
    const before = structuredClone({ ...game, rng: undefined });
    freezeDeep(game);

    const main = canvasMock(900, 600), mini = canvasMock();
    const renderer = new Renderer(main.canvas, mini.canvas);
    renderer.biome = biome;
    renderer.terrain = { name: `baked-${biome}` };
    const scale = Math.min(mini.canvas.width / game.map.width, mini.canvas.height / game.map.height);
    const ox = (mini.canvas.width - game.map.width * scale) / 2;
    const transform = [scale, scale, ox, 0];

    renderer.drawMap(game);

    assert.deepEqual({ ...game, rng: undefined }, before, 'drawing mutated game state');
    assert.equal(game.rng, rng);
    assert.equal(main.calls.length, 0, 'drawMap painted the main battlefield');
    assert.equal(mini.depth, 0, 'drawMap leaked saved Canvas state');
    assert.deepEqual(mini.transform, [1, 1, 0, 0]);
    assert.ok(hasRect(mini.calls, '#15231a', [0, 0, 240, 160]), 'missing background');
    const ground = mini.calls.findIndex(call => call.method === 'drawImage');
    assert.ok(ground >= 0, 'missing baked ground');
    assert.equal(mini.calls[ground].args[0], renderer.terrain);
    assert.deepEqual(mini.calls[ground].args.slice(1), [0, 0]);
    assert.deepEqual(mini.calls[ground].transform, transform);

    // Independent colored body rectangles cannot be satisfied by background/markers.
    for (const o of fixtures) {
      const [color, rect] = biome === 'courtyard'
        ? o.kind === 'rock' ? ['#53614a', [o.x, o.y, o.w, o.h - 3]]
          : ['#6b7251', [o.x, o.y - 18, o.w, o.h]]
        : biome === 'desert' ? ['#897257', [o.x, o.y - 9, o.w, o.h + 8]]
          : biome === 'frost' ? ['#7499b0', [o.x + 2, o.y - 14, o.w - 4, o.h + 10]]
            : [o.kind === 'rock' ? '#3b5850' : '#3c4b3a', [o.x + 2, o.y - 15, o.w - 4, o.h + 14]];
      assert.ok(hasRect(mini.calls, color, rect), `${biome}: missing ${o.kind} body at ${o.x},${o.y}`);
    }

    // Compare every obstacle paint operation against the existing battlefield drawer.
    const expected = canvasMock();
    expected.context.fillStyle = '#15231a';
    expected.context.translate(ox, 0);
    expected.context.scale(scale, scale);
    for (const o of game.map.obstacles) renderer.obstacle(expected.context, o);
    const firstGem = mini.calls.findIndex(call => call.method === 'fillRect' && call.fillStyle === '#a6d09a');
    assert.ok(firstGem > ground, 'missing resource markers');
    assert.ok(expected.calls.length > 0);
    assert.deepEqual(mini.calls.slice(ground + 1, firstGem), expected.calls,
      'minimap obstacle colors/geometry/order differ from the battlefield drawer');
    for (const gem of game.gems) {
      assert.ok(hasRect(mini.calls, '#a6d09a', [Math.round(gem.x - 6), Math.round(gem.y - 6), 12, 12]));
    }

    const actors = mini.calls.filter(call => call.method === 'fill' &&
      ['#f6ce79', '#d6977a'].includes(call.fillStyle));
    assert.deepEqual(actors.map(call => [call.fillStyle, call.args, call.transform]),
      game.actors.filter(a => a.alive).map(a => {
        const r = a.isPlayer ? 30 : 21;
        return [a.isPlayer ? '#f6ce79' : '#d6977a',
          [['ellipse', a.x, a.y, r, r, 0, 0, Math.PI * 2]], transform];
      }), 'missing/incorrect player or AI markers, or dead actor painted');
    const zone = mini.calls.find(call => call.method === 'stroke' && call.strokeStyle === '#ead194');
    assert.ok(zone, 'missing safety circle');
    assert.equal(zone.lineWidth, 13);
    assert.deepEqual(zone.args, [['arc', 1024, 1050, 570, 0, Math.PI * 2]]);
    assert.deepEqual(zone.transform, transform);
    assert.ok(hasRect(mini.calls, '#f5d892', [1009, 1035, 30, 30]), 'missing zone center');
    const viewport = mini.calls.at(-1);
    assert.equal(viewport.method, 'strokeRect');
    assert.equal(viewport.strokeStyle, '#b8c6a666');
    assert.deepEqual(viewport.transform, transform);
    assert.ok(mini.calls.indexOf(zone) > firstGem, 'safety circle must overlay obstacles/resources');
  });
}

for (const [width, height] of [[252, 150], [278, 168], [213, 133], [150, 252]]) {
  test(`resized minimap keeps the safety circle round and the map centered: ${width}x${height}`, () => {
    const game = createGame('minimap-resize');
    game.zone = { x: 1024, y: 1024, radius: 570 };
    freezeDeep(game.map);
    const main = canvasMock(900, 600), mini = canvasMock(224, 170);
    const renderer = new Renderer(main.canvas, mini.canvas);
    renderer.terrain = {};
    renderer.lastMap = 42;
    mini.canvas.clientWidth = width;
    mini.canvas.clientHeight = height;
    renderer.resize();
    assert.equal(renderer.lastMap, -Infinity, 'resize must invalidate a paused minimap too');
    renderer.drawMap(game);
    const circle = mini.calls.find(call => call.method === 'stroke' && call.strokeStyle === '#ead194');
    const [sx, sy, ox, oy] = circle.transform;
    const displayedX = sx * width / mini.canvas.width;
    const displayedY = sy * height / mini.canvas.height;
    assert.ok(Math.abs(displayedX - displayedY) < 1e-12, 'CSS display would turn a circle into an ellipse');
    assert.equal(ox + sx * game.map.width / 2, mini.canvas.width / 2);
    assert.equal(oy + sy * game.map.height / 2, mini.canvas.height / 2);
    assert.equal(mini.depth, 0);
    renderer.lastMap = 42;
    renderer.resize();
    assert.equal(renderer.lastMap, 42, 'unchanged dimensions must not invalidate every frame');
    mini.canvas.clientWidth = mini.canvas.clientHeight = 0;
    renderer.resize();
    assert.deepEqual([mini.canvas.width, mini.canvas.height], [width, height], 'hidden canvas must keep its valid buffer');
  });
}
