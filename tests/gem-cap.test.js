import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, createGame, stepGame, spawnGem } from '../dist/js/simulation.js';
import { dropGem } from '../dist/js/combat.js';

for (const ruleset of ['arena', 'boss']) {
  for (const room of [0, 1, 3, 5]) {
    test(`${ruleset}: map replenishment respects a remaining capacity of ${room}`, () => {
      const game = createGame(`gem-cap-${ruleset}-${room}`, { ruleset });
      game.gems = [];
      for (let i = 0; i < CONFIG.gemCap - room; i++) spawnGem(game);
      // Keep this boundary fixture free of resource pickups, enemies and movement.
      for (const actor of game.actors) {
        actor.isPlayer = true; actor.attackTimer = Infinity; actor.x = 16; actor.y = 16;
      }
      game.monsters = [];
      game.gemTimer = CONFIG.gemInterval;
      const spawned = game.gemSpawnCount;
      stepGame(game, 1 / 60);
      assert.equal(game.gems.length, CONFIG.gemCap);
      assert.equal(game.gemSpawnCount - spawned, room);
      assert.equal(spawnGem(game), null, 'direct map spawns must honor the same cap');
    });
  }

  test(`${ruleset}: earned monster loot is kept even when map supply is capped`, () => {
    const game = createGame(`gem-cap-loot-${ruleset}`, { ruleset });
    game.gems = Array.from({ length: CONFIG.gemCap }, (_, i) => ({ id: i, x: 400, y: 400, value: 5, kind: 'xp' }));
    dropGem(game, { id: 'loot', type: 'slime', x: 800, y: 800 }, 9.75);
    assert.equal(game.gems.length, CONFIG.gemCap + 1);
    assert.equal(game.gems.at(-1).value, 9.75);
    assert.equal(spawnGem(game), null, 'loot may exceed the cap, but further map supply must wait');
  });
}
