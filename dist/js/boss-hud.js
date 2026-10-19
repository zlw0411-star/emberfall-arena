import { $, show, timeText } from './dom.js';
import { bossRankings } from './boss-rules.js';
import { BOSS_CONFIG, bossGuardActive } from './boss-config.js';

const CAST_NAMES = { sweep: '扇形横扫', rocks: '定点落石', cross: '十字震地' };
export function bossRankingHtml(rows, playerId) {
  return rows.map(row => `<div class="boss-rank-row ${row.id === playerId ? 'you' : ''}">`
    + `<b>${String(row.rank).padStart(2, '0')}</b><span>${row.name}<small>${row.combatMode === 'melee' ? '⚔ 近战' : '⌖ 远程'} · ${row.deaths} 次倒下</small></span>`
    + `<strong>${Math.floor(row.damage).toLocaleString()}<small>${(row.share * 100).toFixed(1)}%</small></strong></div>`).join('');
}

export function updateBossHud(state, actions) {
  const game = state.game, player = game.actors[0], boss = game.boss;
  const active = state.started && !game.result;
  const ranking = game.result?.ranking || bossRankings(game);
  const own = ranking.find(row => row.id === player.id);
  show('boss-panel', state.started);
  show('boss-ranking-panel', true);
  $('boss-ranking').innerHTML = bossRankingHtml(ranking, player.id);
  $('boss-personal').textContent = `你 · 第 ${own.rank} 名 · ${Math.floor(own.damage).toLocaleString()} 伤害`;
  $('boss-name').textContent = '余烬巨像';
  $('boss-stage').textContent = boss ? `阶段 ${boss.stage} / 3` : '降临准备';
  $('boss-hp-fill').style.width = `${boss ? Math.max(0, boss.hp / boss.maxHp) * 100 : 100}%`;
  $('boss-hp-text').textContent = boss ? `${Math.ceil(boss.hp).toLocaleString()} / ${boss.maxHp.toLocaleString()}` : `${Math.max(0, Math.ceil(BOSS_CONFIG.spawnAt - game.time))} 秒后降临`;
  const attack = boss?.attack;
  $('boss-cast').textContent = attack ? `${CAST_NAMES[attack.kind]}${game.time < attack.startedAt + attack.windup ? ' · 蓄力' : ' · 避让'}` : boss ? '抓住输出空隙' : '先清怪探索，构筑力量';
  const guard = bossGuardActive(game, player);
  $('boss-guard-status').textContent = guard
    ? `◆ 近身护佑生效 · 首领伤害 -${Math.round(BOSS_CONFIG.nearGuardReduction * 100)}% · 仍需躲避招式`
    : `近身护佑 · 距首领中心 ${BOSS_CONFIG.nearGuardRadius} 像素内，首领伤害降低 ${Math.round(BOSS_CONFIG.nearGuardReduction * 100)}%`;
  $('boss-guard-status').classList.toggle('active', guard);
  $('stage-label').textContent = boss ? '首领竞伤中' : '发育准备';
  $('stage-time').textContent = timeText(Math.max(0, (boss ? BOSS_CONFIG.timeLimit : BOSS_CONFIG.spawnAt) - game.time));
  $('stage-fill').style.width = `${Math.max(0, 1 - game.time / BOSS_CONFIG.timeLimit) * 100}%`;
  $('stage-description').textContent = '全场互不伤害 · 满级继续发育 · 死亡8秒复活';
  $('timeline-grace').textContent = '01 发育'; $('timeline-hunt').textContent = '02 竞伤'; $('timeline-finale').textContent = '03 排名';
  for (const key of ['grace', 'hunt', 'finale']) $(`timeline-${key}`).classList.toggle('active', key === (game.result ? 'finale' : boss ? 'hunt' : 'grace'));
  $('phase-tag').textContent = game.result ? '竞伤结算' : boss ? '首领竞伤' : '发育准备';
  $('phase-tag').className = `phase-tag ${boss ? 'hunt' : 'grace'}`;
  $('alive-count').textContent = String(game.actors.filter(a => a.alive).length).padStart(2, '0');
  $('total-count').textContent = '12';
  show('zone-banner', active && !boss && game.time >= BOSS_CONFIG.noticeAt);
  if (!boss) $('zone-banner').textContent = `⚠ 全场公告 · ${Math.max(0, Math.ceil(BOSS_CONFIG.spawnAt - game.time))} 秒后首领降临`;
  const protectedPlayer = player.invulnerableUntil > game.time;
  $('footer-status').textContent = game.result ? '竞伤已结束' : game.paused ? '世界已暂停' : !player.alive
    ? `复活倒计时 ${Math.max(0, Math.ceil(player.respawnAt - game.time))} 秒 · 分数与构筑保留`
    : protectedPlayer ? `重生保护 ${Math.ceil(player.invulnerableUntil - game.time)} 秒 · 可以移动，暂不能攻击`
      : player.pendingChoices ? '觉醒待选 · 继续移动，战场不会暂停' : '首领伤害计分 · 清怪与探索可以更快成长';
  if (!player.alive && active) {
    actions.clearInput();
    $('game-shell').classList.add('spectating');
    $('death-title').textContent = `${Math.max(0, Math.ceil(player.respawnAt - game.time))} 秒后重返战场`;
    $('death-description').textContent = '等级、技能、待选卡和累计伤害全部保留。';
    show('death-card', !state.deathDismissed);
    const living = game.actors.filter(a => a.alive);
    if (!living.some(a => a.id === state.spectateId)) state.spectateId = living[0]?.id || null;
  } else if (player.alive) {
    if (state.bossWasDead) actions.clearInput();
    $('game-shell').classList.remove('spectating');
    state.spectateId = null; state.deathDismissed = false;
    show('death-card', false);
  }
  state.bossWasDead = !player.alive;
  if (!game.result) return;
  actions.clearInput(); show('death-card', false); show('choices', false); show('result-overlay', true); show('zone-banner', false);
  const winners = game.result.winnerIds;
  $('result-kicker').textContent = 'BOSS DAMAGE RACE COMPLETE';
  $('result-title').textContent = !winners.length ? '本局无人得分' : winners.includes(player.id)
    ? winners.length > 1 ? '你并列竞伤第一' : '你夺得竞伤第一' : winners.length > 1 ? '本局并列第一' : `${ranking[0].name} 赢得竞伤`;
  $('result-subtitle').textContent = `${game.result.reason === 'bossDefeated' ? '余烬巨像已被击败' : '10 分钟时限已到'} · 按首领实际伤害排名`;
  $('result-stats').innerHTML = `<div><strong>${timeText(game.time)}</strong><small>对局时间</small></div><div><strong>${Math.floor(own.damage).toLocaleString()}</strong><small>你的首领伤害</small></div><div><strong>${own.rank}</strong><small>最终名次</small></div><section class="result-ranking">${bossRankingHtml(ranking, player.id)}</section>`;
}
