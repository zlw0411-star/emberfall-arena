import test from 'node:test';
import assert from 'node:assert/strict';
import { think } from '../dist/js/ai.js';
import { createActor } from '../dist/js/combat.js';

function makeGame({ mode = 'classic', phase = 'hunt', skills = [], monsters = [], travelers = [], obstacles = [] } = {}) {
  const actor = createActor('ai', 'AI', 300, 300, false, '#fff');
  actor.activeSkills = skills;
  actor.skills = Object.fromEntries(skills.map(id => [id, 1]));
  actor.cooldowns = Object.fromEntries(skills.map(id => [id, 0]));
  const others = travelers.map(([id, x, y]) => createActor(id, id, x, y, false, '#fff'));
  const game = {
    mode, phase, time: 30, map: { width: 800, height: 800, obstacles, traps: [] },
    zone: null, actors: [actor, ...others], monsters, gems: [],
  };
  return { actor, game };
}

function monster(id, x, y) {
  return { id, x, y, radius: 10, hp: 40, maxHp: 40, alive: true, type: 'slime' };
}

test('chain lightning casts only on a visible enemy within its first range', () => {
  let { actor, game } = makeGame({ skills: ['chainLightning'], monsters: [monster('visible', 560, 300)] });
  assert.equal(think(game, actor).castSlot, 0, 'enemy exactly at firstRange should be in range');

  ({ actor, game } = makeGame({
    skills: ['chainLightning'], monsters: [monster('behind-wall', 450, 300)],
    obstacles: [{ x: 380, y: 250, w: 24, h: 100, kind: 'wall' }],
  }));
  assert.equal(think(game, actor).castSlot, -1, 'wall should block the first lightning target');

  ({ actor, game } = makeGame({ skills: ['chainLightning'], monsters: [monster('too-far', 561, 300)] }));
  assert.equal(think(game, actor).castSlot, -1, 'enemy beyond firstRange should not trigger the cast');
});

test('frost nova casts under close pressure or against multiple nearby enemies', () => {
  let { actor, game } = makeGame({ skills: ['frostNova'], monsters: [monster('pressuring', 400, 300)] });
  assert.equal(think(game, actor).castSlot, 0, 'a single close enemy should trigger the nova');

  ({ actor, game } = makeGame({
    skills: ['frostNova'],
    monsters: [monster('one', 430, 300), monster('two', 300, 430)],
  }));
  assert.equal(think(game, actor).castSlot, 0, 'multiple enemies in the nova radius should trigger it');

  ({ actor, game } = makeGame({ skills: ['frostNova'], monsters: [monster('distant', 500, 300)] }));
  assert.equal(think(game, actor).castSlot, -1, 'one distant enemy should not waste the nova cooldown');
});

test('piercing thrust requires a nearby visible target', () => {
  let { actor, game } = makeGame({ mode: 'melee', skills: ['piercingThrust'], travelers: [['nearby', 440, 300]] });
  assert.equal(think(game, actor).castSlot, 0, 'near target should trigger piercing thrust');

  ({ actor, game } = makeGame({ mode: 'melee', skills: ['piercingThrust'], travelers: [['distant', 470, 300]] }));
  assert.equal(think(game, actor).castSlot, -1, 'target outside thrust reach should not trigger it');
});

test('blade ward casts in engagement or crisis and preserves an active shield', () => {
  let { actor, game } = makeGame({ mode: 'melee', skills: ['bladeWard'], travelers: [['engaged', 450, 300]] });
  assert.equal(think(game, actor).castSlot, 0, 'near engagement should trigger ward');

  ({ actor, game } = makeGame({ mode: 'melee', skills: ['bladeWard'], travelers: [['threat', 560, 300]] }));
  actor.hp = 140;
  assert.equal(think(game, actor).castSlot, 0, 'low health with a nearby threat should trigger ward');

  ({ actor, game } = makeGame({ mode: 'melee', skills: ['bladeWard'], travelers: [['engaged', 450, 300]] }));
  actor.shieldHp = 20;
  actor.shieldT = 2;
  assert.equal(think(game, actor).castSlot, -1, 'ward should not replace a live shield');
});

test('grace protection excludes other travelers while allowing monster targeting', () => {
  let { actor, game } = makeGame({
    phase: 'grace', skills: ['chainLightning'], travelers: [['protected-traveler', 400, 300]],
  });
  assert.equal(think(game, actor).castSlot, -1, 'protected travelers should not trigger an active cast');

  ({ actor, game } = makeGame({
    phase: 'grace', skills: ['chainLightning'], travelers: [['protected-traveler', 400, 300]],
    monsters: [monster('monster', 500, 300)],
  }));
  const command = think(game, actor);
  assert.equal(command.castSlot, 0, 'a monster remains a valid target during protection');
  assert.equal(command.aimX, 500, 'AI should aim the cast at the monster');
});

test('classic and melee legacy active selection remains intact', () => {
  let { actor, game } = makeGame({ skills: ['fireball'], travelers: [['opponent', 600, 300]] });
  assert.equal(think(game, actor).castSlot, 0, 'classic fireball still casts at a visible opponent');

  ({ actor, game } = makeGame({
    mode: 'melee', skills: ['lunge', 'whirlwind'], travelers: [['opponent', 370, 300]],
  }));
  actor.cooldowns.lunge = 1;
  assert.equal(think(game, actor).castSlot, 1, 'melee AI still traverses slots to use ready whirlwind');
});
