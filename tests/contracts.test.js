import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import * as world from '../dist/js/world.js';
import * as combat from '../dist/js/combat.js';
import { think } from '../dist/js/ai.js';
import * as simulation from '../dist/js/simulation.js';

const { rngFromSeed, generateMap, blocked } = world;
const { PROGRESSION, COMBAT_BALANCE, SKILLS, createActor, addXp, xpNeeded, getChoices, chooseSkill, castSkill, updateCombat, damage } = combat;
const { CONFIG, createGame, stepGame, startFinale } = simulation;

function actorsOf(game) {
  return game.actors ?? [];
}

function playerOf(game) {
  return actorsOf(game).find(actor => actor.isPlayer) ?? actorsOf(game)[0];
}

function mapCell(map, x, y) {
  return !blocked(map, x, y, 16);
}

function connectedSpawnPoints(map) {
  const step = 32;
  const cols = Math.ceil(map.width / step);
  const rows = Math.ceil(map.height / step);
  const open = new Uint8Array(cols * rows);
  const id = (x, y) => y * cols + x;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = Math.min(map.width - 16, x * step + 16);
      const py = Math.min(map.height - 16, y * step + 16);
      open[id(x, y)] = mapCell(map, px, py) ? 1 : 0;
    }
  }
  const start = map.spawnPoints[0];
  const sx = Math.max(0, Math.min(cols - 1, Math.floor(start.x / step)));
  const sy = Math.max(0, Math.min(rows - 1, Math.floor(start.y / step)));
  const seen = new Uint8Array(open.length);
  const queue = [id(sx, sy)];
  seen[queue[0]] = 1;
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    const x = n % cols;
    const y = Math.floor(n / cols);
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = id(nx, ny);
      if (open[next] && !seen[next]) {
        seen[next] = 1;
        queue.push(next);
      }
    }
  }
  return map.spawnPoints.map(point => {
    const x = Math.max(0, Math.min(cols - 1, Math.floor(point.x / step)));
    const y = Math.max(0, Math.min(rows - 1, Math.floor(point.y / step)));
    return seen[id(x, y)] === 1 && mapCell(map, point.x, point.y);
  });
}

test('seeded world generation and RNG are reproducible', () => {
  for (const seed of ['contract-alpha', 'contract-beta', 91723]) {
    assert.ok(isDeepStrictEqual(generateMap(seed), generateMap(seed)), `map differs for ${seed}`);
    const a = rngFromSeed(seed);
    const b = rngFromSeed(seed);
    assert.deepEqual(Array.from({ length: 32 }, a), Array.from({ length: 32 }, b));
  }
});

test('world collision index supports handwritten maps and obstacle array changes', () => {
  const map = { width: 300, height: 300, obstacles: [], traps: [] };
  assert.equal(blocked(map, 110, 100, 12), false);
  map.obstacles.push({ x: 120, y: 80, w: 30, h: 40, kind: 'wall' });
  assert.equal(blocked(map, 110, 100, 12), true, 'pushed obstacle was missing from the index');
  assert.equal(world.lineClear(map, { x: 90, y: 100 }, { x: 150, y: 100 }), false);
  map.obstacles.pop();
  assert.equal(blocked(map, 110, 100, 12), false, 'popped obstacle remained in the index');
  map.obstacles = [{ x: 120, y: 80, w: 30, h: 40, kind: 'wall' }];
  assert.equal(blocked(map, 110, 100, 12), true, 'replaced obstacle array was missing from the index');
});

test('finale AI pursues nearby living actors and uses ready active skills', () => {
  const map = generateMap('finale-ai-contract');
  const [actor, closest, farther] = [
    createActor('pursuer', 'Pursuer', 874, 1024, false, '#fff'),
    createActor('closest', 'Closest', 1174, 1024, false, '#fff'),
    createActor('farther', 'Farther', 1274, 1024, false, '#fff'),
  ];
  actor.skills.fireball = 1;
  actor.activeSkills = ['fireball'];
  const game = { map, phase: 'finale', time: 200, zone: { x: 1024, y: 1024, radius: 700 }, actors: [actor, closest, farther], monsters: [], gems: [] };
  const command = think(game, actor, 1 / 60);
  assert.equal(command.castSlot, 0, 'AI did not select its ready active skill');
  assert.equal(command.aimX, closest.x, 'AI did not aim at the nearest living actor');
  assert.equal(command.aimY, closest.y);
  assert.ok(command.mx > 0, 'AI did not move toward the nearby actor');
});

test('finale AI steers an actor back inside the shrinking circle', () => {
  const map = generateMap('finale-zone-ai-contract');
  const actor = createActor('zone-seeker', 'Zone Seeker', 1164, 1024, false, '#fff');
  const game = { map, phase: 'finale', time: 200, zone: { x: 1024, y: 1024, radius: 100 }, actors: [actor], monsters: [], gems: [] };
  const command = think(game, actor, 1 / 60);
  assert.ok(command.mx < 0, 'outside actor was not steered toward the safe center');
  assert.ok(Math.hypot(command.mx, command.my) <= 1.001);
});

test('hunt AI uses nearby actors for combat and retreat without chasing across the map', () => {
  const map = generateMap('hunt-ai-contract');
  const actor = createActor('hunter', 'Hunter', 874, 1024, false, '#fff');
  const nearby = createActor('nearby', 'Nearby', 1124, 1024, false, '#fff');
  const far = createActor('far', 'Far', 1600, 1024, false, '#fff');
  actor.skills.fireball = 1;
  actor.activeSkills = ['fireball'];
  const game = { map, phase: 'hunt', time: 100, zone: null, actors: [actor, nearby], monsters: [], gems: [] };
  const attack = think(game, actor, 1 / 60);
  assert.equal(attack.castSlot, 0, 'hunt AI ignored a nearby actor as a skill target');
  assert.equal(attack.aimX, nearby.x);
  assert.ok(attack.mx > 0, 'hunt AI did not approach an actor within combat range');

  actor.ai = {};
  game.actors = [actor, far];
  const wander = think(game, actor, 1 / 60);
  assert.equal(wander.castSlot, -1, 'hunt AI attacked a distant actor across the map');
  assert.notEqual(wander.aimX, far.x);

  actor.ai = {};
  actor.hp = 40;
  game.actors = [actor, nearby];
  const retreat = think(game, actor, 1 / 60);
  assert.ok(retreat.mx < 0, 'low-health hunt AI did not retreat from a nearby actor');
  assert.equal(retreat.castSlot, 0, 'low-health retreat should still return fire with a ready active skill');
  assert.equal(retreat.aimX, nearby.x, 'retreating AI should aim its skill at the visible threat');
});

test('hunt AI retreats before lethal exchanges and aims escape dash along its retreat', () => {
  const map = { width: 2048, height: 2048, obstacles: [], traps: [] };
  const actor = createActor('runner', 'Runner', 900, 1024, false);
  const opponent = createActor('opponent', 'Opponent', 1150, 1024, false);
  actor.hp = actor.maxHp * 0.55;
  actor.skills.dash = 1;
  actor.activeSkills = ['dash'];
  const game = { map, phase: 'hunt', time: 100, zone: null, actors: [actor, opponent], monsters: [], gems: [] };
  const escape = think(game, actor, 1 / 60);
  assert.ok(escape.mx < 0, 'moderately wounded actor did not retreat from a rival');
  assert.equal(escape.castSlot, 0, 'retreating actor did not use its ready dash');
  assert.ok(escape.aimX < actor.x, 'escape dash aimed back into the rival');
  actor.ai = {};
  game.phase = 'finale';
  const finalFight = think(game, actor, 1 / 60);
  assert.ok(finalFight.mx > 0, 'finale actor retreated at the hunt-only threshold');
});

test('generated maps have legal, connected spawn points and a clear finale center', () => {
  for (const seed of ['connect-a', 'connect-b', 'connect-c']) {
    const map = generateMap(seed);
    assert.equal(map.spawnPoints.length, 8);
    assert.ok(map.spawnPoints.every(p => p.x >= 16 && p.x <= map.width - 16 && p.y >= 16 && p.y <= map.height - 16));
    assert.ok(map.spawnPoints.every(p => mapCell(map, p.x, p.y)), `blocked spawn in ${seed}`);
    assert.ok(connectedSpawnPoints(map).every(Boolean), `disconnected spawn in ${seed}`);
    assert.equal(mapCell(map, map.width / 2, map.height / 2), true, `center blocked in ${seed}`);
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 12) {
      assert.equal(mapCell(map, map.width / 2 + Math.cos(angle) * 99, map.height / 2 + Math.sin(angle) * 99), true, `finale center ring blocked in ${seed}`);
    }
  }
});

test('actor protection blocks friendly damage for 90 seconds and expires afterward', () => {
  const game = createGame('protection-contract');
  const actors = actorsOf(game);
  assert.ok(actors.length >= 2, 'expected player and at least one AI actor');
  const target = actors.find(actor => actor.isPlayer) ?? actors[0];
  const source = actors.find(actor => actor !== target);
  const hp = target.hp;
  game.time = 89.99;
  damage(game, target, Math.max(1, hp / 2), source);
  assert.equal(target.hp, hp, 'friendly damage landed during protection');
  stepGame(game, 1 / 30, { autoPlayer: true });
  assert.ok(game.time >= 90);
  assert.equal(game.phase, 'hunt', 'grace did not end at 90 seconds');
  damage(game, target, Math.max(1, hp / 2), source);
  assert.ok(target.hp < hp, 'friendly damage remained blocked after protection');
});

test('PvP release notice warns once from ten seconds before grace ends, respects pause, and resets on replay', () => {
  const game = createGame('pvp-notice-contract');
  const [target, source] = actorsOf(game);
  const noticeText = '全场公告：10 秒后解除保护，旅者可互相攻击！';
  const notices = () => game.events.filter(event => event.text === noticeText);
  const noticeAt = CONFIG.grace - CONFIG.pvpNotice;

  game.time = noticeAt - 0.1;
  stepGame(game, 1 / 30, { autoPlayer: false, mx: 0, my: 0 });
  assert.equal(notices().length, 0, 'notice appeared before the 10-second window');
  assert.equal(game.pvpNoticeSent, false);

  stepGame(game, 0.11, { autoPlayer: false, mx: 0, my: 0 });
  assert.equal(game.time >= noticeAt, true);
  assert.equal(notices().length, 1, 'notice did not appear when the warning window opened');
  assert.equal(game.pvpNoticeSent, true);
  const noticeTime = game.time;
  for (let i = 0; i < 5; i++) stepGame(game, 1 / 30, { autoPlayer: false, mx: 0, my: 0 });
  assert.equal(notices().length, 1, 'notice repeated on subsequent simulation ticks');

  game.paused = true;
  const pausedTime = game.time;
  const pausedCountdown = CONFIG.grace - game.time;
  stepGame(game, 2, { autoPlayer: false, mx: 0, my: 0 });
  assert.equal(game.time, pausedTime, 'paused simulation advanced the warning countdown');
  assert.equal(CONFIG.grace - game.time, pausedCountdown);
  assert.equal(notices().length, 1);
  game.paused = false;

  game.time = CONFIG.grace - 0.1;
  stepGame(game, 0.05, { autoPlayer: false, mx: 0, my: 0 });
  assert.equal(game.phase, 'grace', 'protection ended before its full duration');
  const protectedHp = target.hp;
  damage(game, target, 100, source);
  assert.equal(target.hp, protectedHp, 'mutual damage landed before grace ended');
  stepGame(game, 0.1, { autoPlayer: false, mx: 0, my: 0 });
  assert.equal(game.phase, 'hunt', 'protection did not end at its configured duration');
  const openHp = target.hp;
  damage(game, target, 10, source);
  assert.ok(target.hp < openHp, 'mutual damage remained blocked after grace ended');
  assert.equal(notices().length, 1, 'notice repeated when protection ended');
  assert.ok(noticeTime < CONFIG.grace);

  const replay = createGame('pvp-notice-contract-replay');
  assert.equal(replay.pvpNoticeSent, false, 'new game inherited the previous notice state');
  assert.equal(replay.events.some(event => event.text === noticeText), false, 'new game inherited the previous notice event');
});

test('actor damage uses exported hunt and finale multipliers and records its cause', () => {
  for (const [phase, expected] of [['hunt', COMBAT_BALANCE.huntDamageMultiplier], ['finale', COMBAT_BALANCE.finaleDamageMultiplier]]) {
    const target = createActor(`${phase}-target`, 'Target', 100, 100, true);
    const source = createActor(`${phase}-source`, 'Source', 200, 100, false);
    const game = { actors: [target, source], phase, time: 100, effects: [], events: [], nextId: 1 };
    const dealt = damage(game, target, 100, source);
    assert.ok(Math.abs(dealt - 100 * expected) < 1e-9, `${phase} damage multiplier was ${dealt / 100}`);
    assert.equal(target.lastDamageKind, 'actor');
    assert.equal(target.lastDamageSource, source.id);
    assert.ok(Math.abs(target.damageTakenByKind.actor - 100 * expected) < 1e-9);
  }
});

test('progression grants one choice at each exported milestone and consumes queued choices one at a time', () => {
  assert.equal(PROGRESSION.maxLevel, 15);
  assert.deepEqual(PROGRESSION.milestones, [2, 4, 6, 8, 10, 12, 14, 15]);
  assert.equal(PROGRESSION.milestones.length, 8);
  assert.equal(PROGRESSION.maxActiveSkills, 3);
  const actor = createActor('milestones', 'Milestones', 100, 100, true, '#fff');
  const observed = [];
  const game = { actors: [actor], time: 0, events: [], effects: [], rng: () => 0 };
  for (let level = 1; level < PROGRESSION.maxLevel; level++) {
    const gained = addXp(game, actor, xpNeeded(level));
    assert.equal(gained, 1, `XP threshold did not advance level ${level}`);
    if (actor.pendingChoices > 0) observed.push(actor.level);
    if (PROGRESSION.milestones.includes(actor.level)) {
      assert.equal(actor.pendingChoices, 1, `level ${actor.level} should add one choice`);
      getChoices(game, actor);
      assert.equal(actor.choices.length, 3);
      const chosen = actor.choices[0];
      assert.equal(chooseSkill(game, actor, chosen), true);
      assert.equal(actor.pendingChoices, 0);
    } else {
      assert.equal(actor.pendingChoices, 0, `unexpected choice at level ${actor.level}`);
    }
  }
  assert.deepEqual(observed, PROGRESSION.milestones);
  assert.equal(actor.level, PROGRESSION.maxLevel);

  const queued = createActor('queued', 'Queued', 100, 100, true, '#fff');
  const queuedGame = { actors: [queued], time: 0, events: [], effects: [], rng: () => 0 };
  const queueThrough = PROGRESSION.milestones[3];
  const requiredXp = Array.from({ length: queueThrough - 1 }, (_, i) => xpNeeded(i + 1)).reduce((sum, value) => sum + value, 0);
  addXp(queuedGame, queued, requiredXp);
  assert.equal(queued.level, queueThrough);
  const totalQueuedChoices = PROGRESSION.milestones.filter(level => level <= queueThrough).length;
  assert.equal(queued.pendingChoices, totalQueuedChoices);
  let consumedChoices = 0;
  while (queued.pendingChoices > 0) {
    const options = getChoices(queuedGame, queued);
    assert.equal(options.length, 3);
    assert.equal(chooseSkill(queuedGame, queued, options[0]), true);
    consumedChoices++;
    assert.equal(queued.pendingChoices, totalQueuedChoices - consumedChoices);
  }
  assert.equal(queued.pendingChoices, 0);
});

test('level HP and attack damage grow linearly from their exported base values', () => {
  const actor = createActor('growth', 'Growth', 100, 100, true, '#fff');
  const game = { actors: [actor], time: 0, events: [], effects: [], rng: () => 0 };
  const hp = [actor.maxHp];
  const attack = [actor.attackDamage];
  for (let level = 1; level < PROGRESSION.maxLevel; level++) {
    addXp(game, actor, xpNeeded(level));
    hp.push(actor.maxHp);
    attack.push(actor.attackDamage);
  }
  const hpSteps = hp.slice(1).map((value, i) => value - hp[i]);
  const attackSteps = attack.slice(1).map((value, i) => value - attack[i]);
  assert.ok(hpSteps[0] > 0 && hpSteps.every(step => Math.abs(step - hpSteps[0]) < 1e-9));
  assert.ok(attackSteps[0] > 0 && attackSteps.every(step => Math.abs(step - attackSteps[0]) < 1e-9));
  assert.equal(actor.level, PROGRESSION.maxLevel);
  assert.equal(actor.hp, actor.maxHp);
  const pending = actor.pendingChoices;
  addXp(game, actor, xpNeeded(PROGRESSION.maxLevel) * 100);
  assert.equal(actor.level, PROGRESSION.maxLevel);
  assert.equal(actor.xp, 0, 'max-level XP overflow was retained');
  assert.equal(actor.pendingChoices, pending, 'max level granted another choice');
});

test('active skill selection is capped by the exported progression limit', () => {
  const actor = createActor('active-cap', 'Active Cap', 100, 100, true, '#fff');
  const game = { actors: [actor], time: 0, events: [], effects: [], rng: () => 0 };
  const activeIds = Object.keys(SKILLS).filter(id => SKILLS[id].type === 'active');
  for (const skillId of activeIds.slice(0, PROGRESSION.maxActiveSkills)) {
    actor.pendingChoices = 1;
    actor.choices = [skillId];
    assert.equal(chooseSkill(game, actor, skillId), true);
    assert.ok(actor.activeSkills.length <= PROGRESSION.maxActiveSkills);
  }
  const rejectedSkill = activeIds[PROGRESSION.maxActiveSkills];
  assert.equal(actor.activeSkills.length, PROGRESSION.maxActiveSkills);
  if (rejectedSkill) {
    actor.pendingChoices = 1;
    actor.choices = [rejectedSkill];
    assert.equal(chooseSkill(game, actor, rejectedSkill), false);
    assert.equal(actor.skills[rejectedSkill] || 0, 0);
  }
});

test('PvP rewards apply once on a real first death and exclude self/environment kills', () => {
  const attacker = createActor('reward-attacker', 'Attacker', 100, 100, true, '#fff');
  const victim = createActor('reward-victim', 'Victim', 200, 100, false, '#fff');
  victim.level = 4;
  const game = { actors: [attacker, victim], time: 100, phase: 'hunt', events: [], effects: [], nextId: 1 };
  const expectedXp = COMBAT_BALANCE.actorKillXpBase + victim.level * COMBAT_BALANCE.actorKillXpPerLevel;
  damage(game, victim, victim.hp * 100, attacker);
  assert.equal(victim.alive, false);
  assert.equal(attacker.kills, 1);
  assert.equal(attacker.xp, expectedXp);
  assert.equal(victim.monsterKills, 0);
  damage(game, victim, victim.hp * 100, attacker);
  assert.equal(attacker.kills, 1, 'dead victim awarded a repeated kill');
  assert.equal(attacker.xp, expectedXp, 'dead victim awarded repeated XP');

  const selfVictim = createActor('self', 'Self', 300, 100, true, '#fff');
  const environmentVictim = createActor('environment', 'Environment', 400, 100, false, '#fff');
  game.actors.push(selfVictim, environmentVictim);
  damage(game, selfVictim, selfVictim.hp * 100, selfVictim);
  damage(game, environmentVictim, environmentVictim.hp * 100, null);
  assert.equal(attacker.xp, expectedXp, 'self/environment deaths awarded PvP XP');
  assert.equal(attacker.kills, 1, 'self/environment death credited a PvP kill');

  const maxed = createActor('maxed', 'Maxed', 500, 100, false, '#fff');
  const maxVictim = createActor('max-victim', 'Max Victim', 600, 100, false, '#fff');
  maxed.level = PROGRESSION.maxLevel;
  maxed.xp = 0;
  game.actors.push(maxed, maxVictim);
  damage(game, maxVictim, maxVictim.hp * 100, maxed);
  assert.equal(maxed.xp, 0, 'max-level actor retained overflow PvP XP');
});

test('skill selections do not pause simulation and a pending choice does not prevent death', () => {
  const game = createGame('choice-live-contract');
  const player = playerOf(game);
  assert.ok(player);
  player.pendingChoices = 1;
  player.choices = getChoices(game, player);
  const before = game.time;
  stepGame(game, 1 / 30, { autoPlayer: false, mx: 0, my: 0, castSlot: -1 });
  assert.ok(game.time > before, 'time stopped while the player had an open choice');

  const enemy = actorsOf(game).find(actor => actor !== player);
  assert.ok(enemy);
  game.phase = 'hunt';
  player.pendingChoices = 1;
  player.choices = getChoices(game, player);
  player.hp = 1;
  damage(game, player, 100, enemy);
  assert.equal(player.alive, false, 'actor with an open choice could not die');
});

test('an actor can cast an active skill while a choice is pending', () => {
  const game = createGame('cast-during-choice-contract');
  const player = playerOf(game);
  player.pendingChoices = 1;
  player.choices = getChoices(game, player);
  player.skills.fireball = 1;
  player.activeSkills = ['fireball'];
  player.cooldowns.fireball = 0;
  assert.equal(castSkill(game, player, 0, player.x + 100, player.y), true);
  assert.ok(game.bullets.some(bullet => bullet.kind === 'fireball' && bullet.ownerId === player.id));
});

test('protection blocks automatic actor attacks, then attacks resume after grace', () => {
  const game = createGame('actor-attack-contract');
  const [attacker, target] = actorsOf(game);
  game.monsters = [];
  game.bullets = [];
  attacker.x = game.map.width / 2 - 100;
  attacker.y = game.map.height / 2;
  target.x = game.map.width / 2 + 100;
  target.y = game.map.height / 2;
  attacker.attackTimer = 0;
  const startingHp = target.hp;
  game.phase = 'grace';
  updateCombat(game, 1 / 30);
  assert.equal(target.hp, startingHp, 'automatic attack landed during protection');
  game.phase = 'hunt';
  attacker.attackTimer = 0;
  for (let i = 0; i < 40; i++) updateCombat(game, 1 / 30);
  assert.ok(target.hp < startingHp, 'automatic attacks never resumed after protection');
});

test('dash moves the actor and stops at a wall', () => {
  const map = { width: 400, height: 240, obstacles: [{ x: 140, y: 0, w: 40, h: 240 }], traps: [] };
  const actor = createActor('dasher', 'Dasher', 80, 120, true, '#fff');
  actor.skills.dash = 1;
  actor.activeSkills = ['dash'];
  const game = { map, actors: [actor], monsters: [], gems: [], bullets: [], effects: [], events: [], nextId: 1, phase: 'hunt' };
  assert.equal(castSkill(game, actor, 0, 300, 120), true);
  assert.ok(actor.x > 80, 'dash did not move actor');
  assert.ok(actor.x + actor.radius <= 140, `dash crossed wall (x=${actor.x})`);
});

test('a max-level player or AI starts one finale and disables later mob and crystal spawns', () => {
  const game = createGame('finale-once-contract');
  assert.equal(CONFIG.maxLevel, PROGRESSION.maxLevel);
  const player = playerOf(game);
  assert.ok(player);
  player.level = PROGRESSION.maxLevel;
  stepGame(game, 1 / 30, { autoPlayer: false, mx: 0, my: 0 });
  assert.equal(game.phase, 'finale', 'a player reaching max level did not start the finale');
  const startTime = game.time;
  const zone = game.zone;
  assert.ok(zone);
  assert.ok(zone.radius >= Math.hypot(game.map.width, game.map.height) / 2, 'initial zone should cover the full map');
  assert.equal(blocked(game.map, zone.x, zone.y, 100), false, 'finale center must be clear for radius 100');
  startFinale(game);
  assert.equal(game.zone.startedAt, startTime, 'second finale start should be ignored');
  for (let i = 0; i < 40; i++) stepGame(game, 1 / 30, { autoPlayer: false, mx: 0, my: 0 });
  assert.ok(Math.abs((game.time - startTime) - 40 / 30) < 1e-10);
  assert.equal(game.phase, 'finale');
  assert.equal(game.events.filter(event => event.text.includes('满级')).length, 1, 'finale announcement repeated');
  assert.ok(game.zone.radius >= game.zone.initialRadius, 'zone shrank during the warning period');
  const monsterCount = game.monsters.length;
  const gemCount = game.gems.length;
  const spawnedMonsters = game.spawnCount;
  const spawnedGems = game.gemSpawnCount;
  for (let i = 0; i < 120; i++) stepGame(game, 1 / 30, { autoPlayer: false, mx: 0, my: 0 });
  assert.ok(game.monsters.length <= monsterCount, 'new monsters spawned during finale');
  assert.ok(game.gems.length <= gemCount, 'new crystals spawned during finale');
  assert.equal(game.spawnCount, spawnedMonsters, 'monster spawn counter advanced during finale');
  assert.equal(game.gemSpawnCount, spawnedGems, 'crystal spawn counter advanced during finale');

  const aiGame = createGame('ai-maxlevel-contract');
  const bot = actorsOf(aiGame).find(actor => !actor.isPlayer);
  bot.level = PROGRESSION.maxLevel;
  stepGame(aiGame, 1 / 30, { autoPlayer: true });
  assert.equal(aiGame.phase, 'finale', 'an AI reaching max level did not start the finale');
});

test('final shrink reaches its center and same-tick last deaths settle as a draw', () => {
  const game = createGame('finale-draw-contract');
  const alive = actorsOf(game).slice(0, 2);
  assert.equal(alive.length, 2);
  for (const actor of actorsOf(game).slice(2)) actor.alive = false;
  game.monsters = [];
  game.bullets = [];
  game.gems = [];
  game.phase = 'finale';
  game.time = 190;
  game.zone = { x: game.map.width / 2, y: game.map.height / 2, radius: 0, initialRadius: Math.hypot(game.map.width, game.map.height) / 2, startedAt: 0 };
  for (const [index, actor] of alive.entries()) {
    actor.x = index === 0 ? 0 : game.map.width;
    actor.y = index === 0 ? 0 : game.map.height;
    actor.hp = 0.1;
  }
  stepGame(game, 1 / 30, { autoPlayer: false, mx: 0, my: 0 });
  assert.ok(game.result, 'final tick did not resolve');
  assert.equal(game.result.winnerId, null, 'simultaneous final deaths should be a draw');
  assert.ok(game.zone.radius <= 0.01, 'zone did not reach its final radius');

  const restarted = createGame('finale-draw-contract');
  assert.equal(restarted.result, null);
  assert.equal(restarted.time, 0);
});
