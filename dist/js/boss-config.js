export const BOSS_CONFIG = Object.freeze({
  spawnAt: 90,
  noticeAt: 85,
  timeLimit: 600,
  maxHp: 180000,
  radius: 64,
  respawnSeconds: 8,
  protectionSeconds: 2,
  nearGuardRadius: 160,
  nearGuardReduction: 0.2,
  xpInterval: 10,
  xpMultiplier: 1.5,
  participationXp: 4,
  basicDamageMultipliers: Object.freeze({ classic: 2, melee: 1 }),
  skillDamageMultipliers: Object.freeze({ classic: 0.95, melee: 1 }),
});

// Shared by combat and presentation; distances are measured between centers.
export function bossGuardActive(game, actor) {
  const boss = game?.boss;
  return game?.ruleset === 'boss' && !!boss && boss.alive !== false && boss.hp > 0
    && !!actor && actor.alive !== false && actor.hp > 0
    && (actor.isPlayer === true || (Array.isArray(game.actors) && game.actors.includes(actor)))
    && Math.hypot(actor.x - boss.x, actor.y - boss.y) <= BOSS_CONFIG.nearGuardRadius;
}

export function bossIncomingMultiplier(game, actor, source) {
  return source === game?.boss && bossGuardActive(game, actor) ? 1 - BOSS_CONFIG.nearGuardReduction : 1;
}
