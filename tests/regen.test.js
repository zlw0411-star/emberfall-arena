import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseSkill, configureActorForMode, createActor, damage, updateCombat } from '../dist/js/combat.js';
import { createGame, stepGame } from '../dist/js/simulation.js';
import { PASSIVE } from '../dist/js/balance.js';
import { rngFromSeed } from '../dist/js/world.js';

const DT = 1 / 60;
function arena(mode) {
  const actor = createActor('a0', 'player', 300, 300, true);
  configureActorForMode(actor, mode);
  actor.attackTimer = Infinity;
  const game = { mode, time: 0, phase: 'grace', rng: rngFromSeed('regen'),
    map: { width: 800, height: 800, obstacles: [], traps: [] }, actors: [actor],
    monsters: [], gems: [], bullets: [], effects: [], events: [] };
  return { game, actor };
}
function advance(game, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    game.time += DT;
    updateCombat(game, DT);
  }
}
function learn(game, actor) {
  actor.pendingChoices = 1;
  actor.choices = ['vitality'];
  assert.equal(chooseSkill(game, actor, 'vitality'), true);
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

for (const mode of ['classic', 'melee']) {
  test(`${mode}: full health discards old regeneration ticks instead of banking heals`, () => {
    const { game, actor } = arena(mode);
    learn(game, actor);
    advance(game, 300.1);
    damage(game, actor, 100, { type: 'trap' });
    const hp = actor.hp;
    advance(game, DT);
    close(actor.hp, hp);
    advance(game, 2.5);
    close(actor.hp, hp + 0.57);
  });

  test(`${mode}: learning vitality starts its timer without retroactive regeneration`, () => {
    const { game, actor } = arena(mode);
    advance(game, 300);
    learn(game, actor);
    damage(game, actor, 100, { type: 'trap' });
    const hp = actor.hp;
    advance(game, DT);
    close(actor.hp, hp);
    advance(game, 2.5);
    close(actor.hp, hp + 0.57);
  });

  test(`${mode}: vitality upgrades preserve the partial cycle and use the new rank`, () => {
    const { game, actor } = arena(mode);
    learn(game, actor);
    actor.hp -= 100;
    advance(game, 1.25);
    learn(game, actor);
    const hp = actor.hp;
    advance(game, 1.25 + DT);
    close(actor.hp, hp + 0.79);
    assert.ok(actor.regenTimer < 2 * DT);
  });

  test(`${mode}: boss respawn starts a fresh regeneration cycle and pause freezes it`, () => {
    const game = createGame(`regen-respawn-${mode}`, { mode, ruleset: 'boss' });
    for (const actor of game.actors) { actor.isPlayer = true; actor.attackTimer = Infinity; }
    game.monsters = []; game.gems = [];
    const actor = game.actors[0];
    learn(game, actor);
    actor.regenTimer = 2.4;
    damage(game, actor, actor.maxHp + 1, { type: 'trap' });
    game.time = actor.respawnAt - DT;
    stepGame(game, DT);
    assert.equal(actor.alive, true);
    assert.ok(actor.regenTimer < 2 * DT, 'respawn must discard the old partial cycle');
    const timer = actor.regenTimer;
    game.paused = true;
    stepGame(game, 10);
    close(actor.regenTimer, timer);
    game.paused = false;
    actor.hp -= 20;
    advance(game, 2.4);
    close(actor.hp, actor.maxHp - 20);
    advance(game, 0.1);
    close(actor.hp, actor.maxHp - 20 + 0.57);
  });
}

test('regeneration handles coarse steps without exceeding max HP or retaining full-health ticks', () => {
  const { game, actor } = arena('classic');
  learn(game, actor);
  actor.hp -= 0.2;
  updateCombat(game, PASSIVE.vitalityRegenInterval * 3);
  close(actor.hp, actor.maxHp);
  actor.hp -= 10;
  updateCombat(game, DT);
  close(actor.hp, actor.maxHp - 10);
});
