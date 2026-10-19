// Shared combat rules. These helpers never consume RNG or mutate entities.
export const isBossGame = game => game?.ruleset === 'boss';
export const combatModeOf = (game, actor) => actor?.combatMode ?? game?.mode;
const alive = entity => !!entity && entity.alive !== false && (entity.hp == null || entity.hp > 0);
const actors = game => Array.isArray(game?.actors) ? game.actors : [];
const isActor = (game, entity) => !!entity && (entity.isPlayer === true || actors(game).includes(entity));

export function canTarget(game, actor, target) {
  if (!alive(target) || target === actor) return false;
  const sourceIsActor = isActor(game, actor), targetIsActor = isActor(game, target);
  if (isBossGame(game)) return sourceIsActor ? !targetIsActor : targetIsActor;
  return !(sourceIsActor && targetIsActor && game?.phase === 'grace');
}

export function combatTargets(game, actor) {
  if (isBossGame(game) && !isActor(game, actor)) return actors(game).filter(target => canTarget(game, actor, target));
  const monsters = Array.isArray(game?.monsters) ? game.monsters : [];
  const targets = isBossGame(game) && game.boss ? [...monsters, game.boss] : [...monsters];
  if (!isBossGame(game) && game?.phase !== 'grace') targets.push(...actors(game));
  return [...new Set(targets)].filter(target => canTarget(game, actor, target));
}

export function canAct(game, actor) {
  return alive(actor) && !(isBossGame(game) && actor.invulnerableUntil > (game.time || 0));
}
