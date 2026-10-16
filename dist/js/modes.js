export const MODES = Object.freeze({
  classic: Object.freeze({ id: 'classic', name: '经典远程', description: '自动索敌射击，收集经验强化技能。', controls: 'WASD移动，Q/E/R施放技能，1/2/3选择强化' }),
  melee: Object.freeze({ id: 'melee', name: '近战刀战', description: '鼠标瞄准，挥刀与突进斩击。', controls: 'WASD移动，鼠标瞄准，按住左键连续挥刀，Q/E/R施放技能，1/2/3选择强化' }),
});
export function normalizeMode(mode) { return Object.hasOwn(MODES, mode) ? mode : 'classic'; }
export const MELEE_BALANCE = Object.freeze({ range: 68, arc: 2 * Math.PI / 3, interval: 0.65, windup: 0.20, active: 0.08, damageMultiplier: 2.2 });
