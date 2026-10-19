// Boss-race lifecycle stays separate from last-survivor arena rules.
import { rngFromSeed, moveEntity, blocked } from './world.js';
import { normalizeMode, modeOf } from './modes.js';
import { BIOMES, normalizeBiome } from './biomes.js';
import { createActor, configureActorForMode, updateCombat, castSkill, addXp } from './combat.js';
import { combatModeOf } from './targeting.js';
import { BOSS_CONFIG } from './boss-config.js';
import { generateBossMap } from './boss-map.js';
import { createBoss, tickBoss } from './boss.js';
import { think } from './ai.js';

export function createBossGame(seed, options, config, names, colors, spawnGem, spawnMonster) {
  const maps = Object.keys(BIOMES);
  const biome = options.mapId === 'random'
    ? maps[Math.floor(rngFromSeed('biome:' + seed)() * maps.length)] : normalizeBiome(options.mapId);
  const game = { seed, ruleset: 'boss', map: generateBossMap(seed, { biome }), rng: rngFromSeed(seed),
    time: 0, phase: 'grace', actors: [], monsters: [], gems: [], bullets: [], effects: [], events: [],
    zone: null, boss: null, result: null, paused: false, nextId: 100, spawnTimer: 0, gemTimer: 0,
    spawnCount: 0, gemSpawnCount: 0, bossNoticeSent: false, nextParticipationAt: BOSS_CONFIG.spawnAt + BOSS_CONFIG.xpInterval };
  Object.defineProperty(game, 'mode', { value: normalizeMode(options.mode), enumerable: true });
  const weapons = Array.from({ length: 11 }, (_, i) => i < (game.mode === 'classic' ? 5 : 6) ? 'classic' : 'melee');
  const weaponRng = rngFromSeed('boss-weapons:' + seed);
  for (let i = weapons.length - 1; i > 0; i--) {
    const j = Math.floor(weaponRng() * (i + 1)); [weapons[i], weapons[j]] = [weapons[j], weapons[i]];
  }
  game.actors = game.map.spawnPoints.map((p, i) => {
    const actor = createActor('a' + i, names[i], p.x, p.y, i === 0, colors[i]);
    actor.combatMode = i === 0 ? game.mode : weapons[i - 1];
    configureActorForMode(actor, actor.combatMode);
    return Object.assign(actor, { bossDamage: 0, bossParticipated: false, deaths: 0, respawnAt: null, invulnerableUntil: 0 });
  });
  for (let i = 0; i < config.initialGems; i++) spawnGem(game);
  for (let i = 0; i < config.initialMonsters; i++) spawnMonster(game);
  game.events.push({ text: '首领竞伤开启 · 90 秒发育，旅者全程互不伤害', time: 0, color: '#f2be65' });
  return game;
}

export function bossRankings(game) {
  const total = game.actors.reduce((sum, a) => sum + (a.bossDamage || 0), 0);
  const rows = game.actors.map((a, index) => ({ id: a.id, name: a.name, combatMode: a.combatMode,
    damage: a.bossDamage || 0, deaths: a.deaths || 0, share: total ? (a.bossDamage || 0) / total : 0, index }));
  rows.sort((a, b) => b.damage - a.damage || a.index - b.index);
  return rows.map((row, i) => ({ ...row, rank: i && Math.abs(row.damage - rows[i - 1].damage) <= 1e-6
    ? rows.findIndex(r => Math.abs(r.damage - row.damage) <= 1e-6) + 1 : i + 1 }));
}

function settle(game, reason) {
  const ranking = bossRankings(game), top = ranking[0]?.damage || 0;
  const winnerIds = top > 1e-6 ? ranking.filter(row => Math.abs(row.damage - top) <= 1e-6).map(row => row.id) : [];
  game.result = { winnerId: winnerIds.length === 1 ? winnerIds[0] : null, winnerIds, reason, time: game.time, ranking };
  game.events.push({ text: reason === 'bossDefeated' ? '余烬巨像已被击败 · 竞伤结束' : '10 分钟时限已到 · 竞伤结算', time: game.time, color: '#f2be65' });
}

function respawn(game, actor) {
  const points = game.map.spawnPoints, original = points[game.actors.indexOf(actor) % points.length];
  const threats = game.monsters.filter(m => m.alive);
  const safety = p => Math.min(10000, ...threats.map(m => Math.hypot(m.x - p.x, m.y - p.y)));
  const position = safety(original) > 120 ? original : [...points].sort((a, b) => safety(b) - safety(a))[0];
  Object.assign(actor, { x: position.x, y: position.y, prevX: position.x, prevY: position.y,
    alive: true, hp: actor.maxHp, respawnAt: null, invulnerableUntil: game.time + BOSS_CONFIG.protectionSeconds,
    shieldHp: 0, shieldT: 0, slowUntil: 0, speedBoostT: 0, combatSpeedMult: 1, hitFlash: 0, regenTimer: 0,
    attackHeld: false, attackPressed: false, meleeAction: null, meleeVisuals: [], moving: false, trapDamageTimer: 0 });
  actor.ai = {};
  actor.pendingChoices = actor.respawnChoices?.pendingChoices || 0;
  actor.choices = actor.respawnChoices?.choices?.slice() || [];
  delete actor.respawnChoices;
  game.events.push({ text: `${actor.name} 重返战场 · 2 秒保护`, time: game.time, color: actor.color });
}

function revealBoss(game) {
  game.boss = createBoss(game); game.map.movementCircles = [game.boss]; game.phase = 'boss';
  for (const entity of [...game.actors, ...game.monsters]) {
    const d = Math.hypot(entity.x - game.boss.x, entity.y - game.boss.y);
    if (d >= game.boss.radius + entity.radius + 2) continue;
    const angle = d > 0 ? Math.atan2(entity.y - game.boss.y, entity.x - game.boss.x) : game.actors.indexOf(entity) * Math.PI / 6;
    const r = game.boss.radius + entity.radius + 3;
    entity.x = entity.prevX = game.boss.x + Math.cos(angle) * r;
    entity.y = entity.prevY = game.boss.y + Math.sin(angle) * r;
  }
  game.events.push({ text: '余烬巨像降临 · 只计首领实际伤害，打怪探索继续成长', time: game.time, color: '#edbd81' });
}

export function stepBossGame(game, dt, input, config, spawnMonster, spawnGem) {
  if (game.paused || game.result || !(dt > 0)) return;
  for (const e of [...game.actors, ...game.monsters, ...game.bullets]) { e.prevX = e.x; e.prevY = e.y; }
  dt = Math.min(dt, Math.max(0, BOSS_CONFIG.timeLimit - game.time)); game.time += dt;
  if (!game.bossNoticeSent && game.time >= BOSS_CONFIG.noticeAt) {
    game.bossNoticeSent = true;
    game.events.push({ text: '全场公告 · 余烬巨像即将降临！', time: game.time, color: '#edbd81' });
  }
  if (!game.boss && game.time >= BOSS_CONFIG.spawnAt) revealBoss(game);
  for (const a of game.actors) {
    if (!a.alive && a.respawnAt != null && game.time + 1e-9 >= a.respawnAt) respawn(game, a);
    if (!a.alive) continue;
    const command = !a.isPlayer || input.autoPlayer ? think(game, a, dt) : input;
    if (modeOf(combatModeOf(game, a)).usesPointerAttack) {
      a.attackHeld = !!command.attackHeld; a.attackPressed = !!command.attackPressed;
      const dx = (command.aimX ?? a.x) - a.x, dy = (command.aimY ?? a.y) - a.y;
      if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > .001) a.aimAngle = Math.atan2(dy, dx);
    }
    let mx = command.mx || 0, my = command.my || 0;
    const length = Math.hypot(mx, my); if (length > 1) { mx /= length; my /= length; }
    let slow = 1;
    for (const trap of game.map.traps) if (trap.type === 'mud' && Math.hypot(a.x - trap.x, a.y - trap.y) < trap.r + a.radius) slow = .55;
    if (a.slowUntil > game.time) slow *= .65;
    moveEntity(game.map, a, mx * a.speed * slow * (a.combatSpeedMult || 1) * dt, my * a.speed * slow * (a.combatSpeedMult || 1) * dt);
    a.moving = length > .05; if (a.moving) { a.faceX = mx; a.faceY = my; }
    if ((command.castSlot ?? -1) >= 0) castSkill(game, a, command.castSlot, command.aimX, command.aimY);
  }
  updateCombat(game, dt); tickBoss(game, dt);
  game.monsters = game.monsters.filter(m => m.alive);
  game.spawnTimer += dt; game.gemTimer += dt;
  if (game.spawnTimer >= config.monsterInterval) { game.spawnTimer %= config.monsterInterval; for (let i = 0; i < 3; i++) spawnMonster(game); }
  if (game.gemTimer >= config.gemInterval) { game.gemTimer %= config.gemInterval; if (game.gems.length < config.gemCap) for (let i = 0; i < 5; i++) spawnGem(game); }
  if (game.boss && game.time + 1e-9 >= game.nextParticipationAt) {
    for (const actor of game.actors) {
      if (actor.alive && actor.bossParticipated) addXp(game, actor, BOSS_CONFIG.participationXp);
      actor.bossParticipated = false;
    }
    do { game.nextParticipationAt += BOSS_CONFIG.xpInterval; } while (game.nextParticipationAt <= game.time);
  }
  if (game.boss && !game.boss.alive) settle(game, 'bossDefeated');
  else if (game.time >= BOSS_CONFIG.timeLimit) settle(game, 'timeLimit');
  game.events = game.events.slice(-30);
}

export function bossResourcePoint(game, padding) {
  const points = (game.map.freePoints || []).filter(p => Math.hypot(p.x - game.map.width / 2, p.y - game.map.height / 2) >= 470
    && !blocked(game.map, p.x, p.y, padding));
  if (!points.length) return game.map.spawnPoints[0];
  return points[Math.floor(game.rng() * points.length)];
}
