/**
 * HUD 刷新。
 *
 * 原来这是一个约 835 字符的单行函数，同时负责状态栏、名册、技能栏、
 * 选技卡、事件日志、死亡/结算浮层和音效播报，改一行要横着滚很久。
 * 现在按「刷新区域」拆成若干小函数，updateHud 只负责按顺序调用。
 *
 * 行为红线：这些函数只读 game、只写 DOM，绝不修改 game 状态 ——
 * 唯一的例外是 getChoices（它本来就会填充 actor.choices，属于模拟侧 API）。
 */
import { CONFIG } from './simulation.js';
import {
  getSkills, getChoices, xpNeeded, PROGRESSION, COMBAT_BALANCE,
} from './combat.js';
import { MODES } from './modes.js';
import { $, show, timeText, beep, toast } from './dom.js';

const SKILL_KEYS = ['Q', 'E', 'R'];
const PHASE_NAMES = { grace: '发育保护', hunt: '自由争夺', finale: '终局决战' };
const TIMELINE_PHASES = ['grace', 'hunt', 'finale'];
/** 决战阶段：10 秒预警 + 180 秒缩圈。 */
const FINALE_WARNING = 10;
const FINALE_SHRINK = 180;
const FINALE_TOTAL = FINALE_WARNING + FINALE_SHRINK;

export function createHud(state, actions) {
  const skillLevelLabel = PROGRESSION.milestones.join(' / ');

  // ---- 顶部数字与资源条 -------------------------------------------------

  function renderVitals(game, player) {
    const mode = MODES[game.mode];
    const level = player.level;
    const atMaxLevel = level >= CONFIG.maxLevel;
    $('clock').textContent = timeText(game.time);
    $('seed-label').textContent = `SEED ${game.seed}`;
    $('player-level').textContent = `LV. ${String(level).padStart(2, '0')}`;
    $('hp-fill').style.width = `${100 * player.hp / player.maxHp}%`;
    $('hp-text').textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
    $('xp-fill').style.width = atMaxLevel ? '100%' : `${100 * player.xp / xpNeeded(level)}%`;
    $('xp-text').textContent = atMaxLevel
      ? '最高等级'
      : `XP ${Math.floor(player.xp)} / ${xpNeeded(level)}`;
    const attack = player.attackDamage * mode.damageDisplayMultiplier
      * (1 + (player.skills.power || 0) * COMBAT_BALANCE.powerDamagePerRank);
    $('attack-stat').textContent = `${mode.damageLabel} ${attack.toFixed(1)}`;
  }

  // ---- 存活人数与阶段进度条 ---------------------------------------------

  /**
   * 阶段描述。返回 {label, remaining, progress, description}，
   * 阶段横幅与最终风暴提示单独由 renderZoneBanner 处理。
   */
  function stageOf(game) {
    const phase = game.phase;
    if (phase === 'hunt') {
      return { label: '争夺进行中', remaining: 0, progress: 1, description: '已开放互伤 · 任意旅者满级后开启决战。' };
    }
    if (phase === 'finale') {
      const elapsed = game.time - game.zone.startedAt;
      const remaining = elapsed < FINALE_WARNING ? FINALE_WARNING - elapsed : FINALE_TOTAL - elapsed;
      return {
        label: elapsed < FINALE_WARNING ? '风暴即将降临' : '安全区正在缩小',
        remaining,
        progress: Math.max(0, (FINALE_TOTAL - elapsed) / FINALE_TOTAL),
        description: elapsed < FINALE_WARNING
          ? '刷怪已停止 · 向地图标记的圆心移动。'
          : '圈外持续受伤 · 最后一位旅者获胜。',
      };
    }
    const remaining = CONFIG.grace - game.time;
    return {
      label: '发育保护期',
      remaining,
      progress: Math.max(0, remaining / CONFIG.grace),
      description: '角色暂不互伤，打怪拾取经验以成长。',
    };
  }

  function renderStage(game) {
    const stage = stageOf(game);
    $('stage-label').textContent = stage.label;
    $('stage-time').textContent = game.phase === 'hunt' ? '已解除保护' : timeText(stage.remaining);
    $('stage-fill').style.width = `${stage.progress * 100}%`;
    $('stage-description').textContent = stage.description;
    for (const phase of TIMELINE_PHASES) {
      $(`timeline-${phase}`).classList.toggle('active', phase === game.phase);
    }
    $('phase-tag').textContent = state.started ? PHASE_NAMES[game.phase] : '准备进入';
    $('phase-tag').className = `phase-tag ${game.phase}`;
  }

  // ---- 阶段公告横幅 -----------------------------------------------------

  function renderZoneBanner(game) {
    const phase = game.phase;
    const inMatch = state.started && !game.result;
    if (phase === 'finale') {
      const elapsed = game.time - game.zone.startedAt;
      show('zone-banner', inMatch);
      $('zone-banner').textContent = elapsed < FINALE_WARNING
        ? `⚠ 决战开启 · ${Math.ceil(FINALE_WARNING - elapsed)} 秒后缩圈`
        : `⚠ 余烬风暴 · 安全区半径 ${Math.round(game.zone.radius)}m`;
      if (game.time >= CONFIG.matchLimit - FINALE_WARNING) {
        $('zone-banner').textContent = `⚠ 最终风暴 · ${Math.ceil(CONFIG.matchLimit - game.time)} 秒后吞没全部遗迹`;
      }
      return;
    }
    const remaining = CONFIG.grace - game.time;
    const notice = phase === 'grace' && remaining > 0 && remaining <= CONFIG.pvpNotice;
    show('zone-banner', inMatch && notice);
    if (notice) {
      $('zone-banner').textContent = `⚠ 全场公告 · ${Math.ceil(remaining)} 秒后允许旅者互相攻击`;
    }
  }

  // ---- 页脚状态文字 -----------------------------------------------------

  function footerText(game, player) {
    const phase = game.phase;
    if (!state.started) return '遗迹已就绪，等待你的到来';
    if (game.result) return '试炼已结束';
    if (game.paused) return '世界已暂停';
    if (!player.alive) return '正在观战 · 点击试炼者切换视角';
    if (player.pendingChoices) return '觉醒待选 · 战场持续运行，请保持移动';
    if (phase === 'grace') return `保护生效中 · 2 级首次觉醒 · ${CONFIG.maxLevel} 级进入决战`;
    return '危险无处不在，留意你的四周';
  }

  // ---- 右侧名册 ---------------------------------------------------------

  function renderRoster(game, player) {
    const canSpectate = !player.alive;
    $('roster').innerHTML = game.actors.map((actor) => {
      const classes = ['roster-row', actor.isPlayer ? 'you' : '', actor.alive ? '' : 'dead']
        .filter(Boolean).join(' ');
      const interactive = canSpectate && actor.alive ? 'role="button" tabindex="0"' : '';
      const avatar = actor.alive ? '♟' : '×';
      const name = actor.isPlayer ? '灰烬旅者 <small>你</small>' : actor.name;
      return `<div class="${classes}" data-actor="${actor.id}" ${interactive}>`
        + `<span class="roster-avatar" style="color:${actor.color}">${avatar}</span>`
        + `<span class="roster-name">${name}</span>`
        + `<span class="roster-level">LV.${String(actor.level).padStart(2, '0')}</span>`
        + `<span class="roster-state">${actor.alive ? '存活' : '陨落'}</span>`
        + '</div>';
    }).join('');
  }

  // ---- 技能栏 -----------------------------------------------------------

  function renderSkills(game, player, skills) {
    $('skills-bar').innerHTML = Array.from({ length: PROGRESSION.maxActiveSkills }, (_, slot) => {
      const id = player.activeSkills[slot];
      const def = skills[id];
      const cooldown = player.cooldowns[id] || 0;
      const title = def
        ? `${def.name} · ${def.description}`
        : `在 ${skillLevelLabel} 级选择强化，最多三个主动技能`;
      const mask = cooldown
        ? `<i class="cooldown-mask" style="height:${Math.min(100, cooldown / def.cooldown * 100)}%"></i>`
          + `<span class="cooldown-number">${cooldown.toFixed(1)}</span>`
        : '';
      return `<div class="skill-slot ${def ? '' : 'locked'}" title="${title}">`
        + `<kbd>${SKILL_KEYS[slot]}</kbd>${def ? def.icon : '◇'}`
        + `<small>${def ? def.name : '待觉醒'}</small>${mask}</div>`;
    }).join('');
  }

  // ---- 选技卡 -----------------------------------------------------------

  function renderChoices(game, player, skills) {
    const shouldShow = player.alive && player.pendingChoices && !game.result;
    if (!shouldShow) {
      show('choices', false);
      state.choiceKey = '';
      return;
    }
    if (!player.choices.length) getChoices(game, player);
    // 只在选项真正变化时重建 DOM，否则每次 HUD 刷新都会重排卡片。
    const key = `${player.choices.join(',')}:${player.pendingChoices}`;
    if (key !== state.choiceKey) {
      state.choiceKey = key;
      $('choices').innerHTML = player.choices.map((id, index) => {
        const def = skills[id];
        const rank = player.skills[id] || 0;
        const badge = rank
          ? `强化 ${rank} → ${rank + 1}`
          : def.type === 'active' ? '主动技能' : '被动强化';
        return `<button class="choice-card" data-choice="${index}">`
          + `<kbd>${index + 1}</kbd>`
          + `<span style="color:${def.color}">${def.icon}</span>`
          + `<h3>${def.name}<small class="choice-rank">${badge}</small></h3>`
          + `<p>${def.description}</p></button>`;
      }).join('');
    }
    show('choices', true);
  }

  // ---- 事件日志 ---------------------------------------------------------

  function renderEventLog(game) {
    $('event-log').innerHTML = game.events.slice(-3).reverse()
      .map((event) => `<p><time>${timeText(event.time)}</time>`
        + `<span style="color:${event.color || '#97aa84'}">${event.text}</span></p>`)
      .join('');
  }

  // ---- 死亡与结算浮层 ---------------------------------------------------

  function renderDeathAndResult(game, player, living) {
    if (state.started && !player.alive && !game.result) {
      actions.clearInput();
      $('game-shell').classList.add('spectating');
      show('death-card', !state.deathDismissed);
      if (!state.spectateId || !living.some((actor) => actor.id === state.spectateId)) {
        state.spectateId = living[0]?.id ?? null;
      }
    }
    if (!(state.started && game.result)) return;

    actions.clearInput();
    show('result-overlay', true);
    show('death-card', false);
    show('choices', false);
    show('zone-banner', false);

    const winner = game.actors.find((actor) => actor.id === game.result.winnerId);
    const playerWon = Boolean(winner?.isPlayer);
    $('result-kicker').textContent = playerWon ? 'THE LAST LIGHT STANDING' : 'TRIAL COMPLETE';
    $('result-title').textContent = playerWon
      ? '你是最后的微光'
      : winner ? `${winner.name} 赢得试炼` : '余烬之下，无人生还';
    $('result-subtitle').textContent = playerWon
      ? '风暴散去，遗迹记住了你的名字。'
      : '每一次陨落，都是下一次觉醒的开始。';
    $('result-stats').innerHTML = `<div><strong>${timeText(game.time)}</strong><small>存活试炼时间</small></div>`
      + `<div><strong>${player.level}</strong><small>最终等级</small></div>`
      + `<div><strong>${player.monsterKills}</strong><small>击败怪物</small></div>`;
  }

  // ---- 音效与播报 -------------------------------------------------------

  function announce(game, player, count) {
    if (!state.started) return;
    if (player.kills > state.lastKills) {
      toast(player.level < CONFIG.maxLevel ? '击败旅者 · 经验已获取' : '击败旅者');
      beep(state, 880, 0.16);
    }
    if (player.level > state.lastLevel) {
      toast(player.pendingChoices ? '力量觉醒 · 选择一项强化' : `等级提升 · LV.${player.level}`);
      beep(state, 784, 0.14);
    }
    if (game.phase !== state.lastPhase) {
      const finaleMessage = game.zone?.reason === 'time'
        ? '时限将至！准备迎接余烬风暴'
        : '有人满级！准备迎接余烬风暴';
      toast(game.phase === 'finale' ? finaleMessage : '保护结束 · 旅者之间可以互相攻击');
      beep(state, 220, 0.4);
    }
    if (count < state.lastAlive) beep(state, 196, 0.15);
    if (player.hp < state.lastHp - 1) beep(state, 110, 0.04, 0.012);
  }

  // ---- 入口：按顺序刷新各区域 -------------------------------------------

  function update() {
    const game = state.game;
    const player = game.actors[0];
    const living = game.actors.filter((actor) => actor.alive);
    const count = living.length;
    const skills = getSkills(game);

    renderVitals(game, player);
    $('alive-count').textContent = String(count).padStart(2, '0');
    $('roster-count').textContent = `${count} IN THE RUINS`;
    $('total-count').textContent = String(game.actors.length).padStart(2, '0');
    renderStage(game);
    renderZoneBanner(game);
    $('footer-status').textContent = footerText(game, player);
    renderRoster(game, player);
    renderSkills(game, player, skills);
    renderChoices(game, player, skills);
    renderEventLog(game);
    renderDeathAndResult(game, player, living);
    announce(game, player, count);

    state.lastLevel = player.level;
    state.lastPhase = game.phase;
    state.lastAlive = count;
    state.lastHp = player.hp;
    state.lastKills = player.kills;
  }

  return { update, stageOf };
}
