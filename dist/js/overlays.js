/**
 * 对局流程与浮层：开始、暂停、返回菜单、选技、帮助、观战、声音。
 *
 * 原来这些是 app.js 里的十余个短函数 + 一大段 onclick 赋值。
 * 拆出来后，app.js 只负责把它们接到 DOM 上并驱动主循环。
 */
import { createGame, CONFIG } from './simulation.js';
import { getSkills, chooseSkill } from './combat.js';
import { MODES, normalizeMode } from './modes.js';
import { BIOMES, biomeOf, normalizeBiome } from './biomes.js';
import { $, show, beep, toast } from './dom.js';
import { drawHero } from './renderer.js';
import { BOSS_CONFIG } from './boss-config.js';

/** 主菜单/结算里出现过、需要统一隐藏的浮层 id。 */
const FLOW_OVERLAYS = ['start-overlay', 'pause-overlay', 'result-overlay', 'death-card', 'choices', 'zone-banner'];
const MENU_OVERLAYS = ['pause-overlay', 'result-overlay', 'death-card', 'choices', 'zone-banner', 'world-toast', 'help-overlay'];

export function createFlow(state, input, renderer, portraitCtx) {
  const options = () => ({ mode: state.selectedMode, mapId: state.selectedMap, ruleset: state.selectedRuleset });
  function resetComparisons() {
    state.choiceKey = '';
    state.lastLevel = 1;
    state.lastPhase = 'grace';
    state.lastAlive = state.game.actors.length;
    state.lastHp = state.game.actors[0].hp;
    state.lastKills = 0;
  }

  function setPauseButton(paused) {
    $('pause-button').textContent = paused ? '▷' : 'Ⅱ';
    $('pause-button').setAttribute('aria-label', paused ? '继续' : '暂停');
  }

  // ---- 模式选择 ---------------------------------------------------------

  function syncMap() {
    const info = biomeOf(state.game.map);
    $('world-map-name').textContent = info.name;
    $('world-map-en').textContent = info.en.toUpperCase();
    $('result-map').textContent = info.name;
    document.body.dataset.biome = info.id;
    $('map-description').textContent = state.selectedMap === 'random'
      ? `每局从${Object.keys(BIOMES).length}张地图中随机选择，开局后显示本局战场。`
      : `${info.description} ${info.hazards.mud}会减速，${info.hazards.spike}预警后造成伤害。`;
    for (const card of document.querySelectorAll('[data-map]')) {
      const selected = card.dataset.map === state.selectedMap;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    }
  }

  function selectMap(mapId) {
    if (state.started) return;
    state.selectedMap = mapId === 'random' ? 'random' : normalizeBiome(mapId);
    input.clearInput();
    state.game = createGame(state.game.seed, options());
    state.choiceKey = '';
    syncMode();
    return state.game;
  }

  function syncMode() {
    const mode = state.started ? state.game.mode : state.selectedMode;
    const info = MODES[mode];
    const boss = state.started ? state.game.ruleset === 'boss' : state.selectedRuleset === 'boss';
    const label = boss ? `首领竞伤 · ${info.name}` : info.name;
    document.body.classList.toggle('rules-boss', boss);
    show('boss-weapon-picker', boss);
    $('round-duration').textContent = boss ? '90 秒发育 · 最长 10 分钟' : '单局约 5–10 分钟 · 最长 12 分钟';
    $('party-description').textContent = boss ? '12 位竞伤者 · 6 近战 / 6 远程' : '1 位旅者 · 11 位对手';
    for (const card of document.querySelectorAll('[data-weapon]')) {
      const selected = card.dataset.weapon === mode;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    }
    document.body.classList.toggle('mode-melee', Boolean(info.bodyClass));
    for (const id of ['mode-label', 'world-mode', 'result-mode']) $(id).textContent = label;
    for (const card of document.querySelectorAll('[data-mode]')) {
      const selected = boss ? card.dataset.mode === 'boss' : card.dataset.mode === mode;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    }
    $('mode-description').textContent = boss ? '随机成长，挑战余烬巨像。累计首领伤害最高者获胜，旅者全程互不伤害。' : info.description;
    $('start-button').innerHTML = `开始${boss ? '首领竞伤' : info.name} <span>↗</span>`;
    $('attack-control').innerHTML = info.attackControlHtml;
    $('choices').dataset.title = `${label} · 选择你的力量`;
    portraitCtx.clearRect(0, 0, 48, 48);
    drawHero(portraitCtx, 24, 25, '#f2be65', 0, false, 1.45, false,
      info.portraitPose ? { ...info.portraitPose } : null);
    syncMap();
  }

  function syncBossHelpValues() {
    const participationXp = BOSS_CONFIG.participationXp * BOSS_CONFIG.xpMultiplier;
    const mapGemXp = CONFIG.mapGemXp * BOSS_CONFIG.xpMultiplier;
    for (const id of ['boss-participation-xp', 'boss-ranking-participation-xp', 'help-participation-xp']) {
      $(id).textContent = String(participationXp);
    }
    for (const id of ['boss-map-gem-xp', 'boss-ranking-map-gem-xp', 'help-map-gem-xp']) {
      $(id).textContent = String(mapGemXp);
    }
    for (const id of ['boss-participation-interval', 'boss-ranking-participation-interval', 'help-participation-interval']) {
      $(id).textContent = String(BOSS_CONFIG.xpInterval);
    }
    $('help-boss-spawn').textContent = String(BOSS_CONFIG.spawnAt);
    $('help-boss-minutes').textContent = String(BOSS_CONFIG.timeLimit / 60);
    $('help-guard-radius').textContent = String(BOSS_CONFIG.nearGuardRadius);
    $('help-guard-reduction').textContent = String(Math.round(BOSS_CONFIG.nearGuardReduction * 100));
  }

  function selectMode(mode) {
    if (state.started) return;
    state.selectedRuleset = mode === 'boss' ? 'boss' : 'arena';
    if (mode !== 'boss') state.selectedMode = normalizeMode(mode);
    input.clearInput();
    state.game = createGame(state.game.seed, options());
    state.choiceKey = '';
    syncMode();
    return state.game;
  }

  // ---- 开始 / 重开 ------------------------------------------------------

  function begin() {
    if (state.helpOpen) closeHelp();
    input.clearInput();
    state.game = createGame(Date.now(), options());
    state.started = true;
    state.deathDismissed = false;
    state.spectateId = null;
    resetComparisons();
    for (const id of FLOW_OVERLAYS) show(id, false);
    $('game-shell').classList.remove('spectating');
    setPauseButton(false);
    renderer.seed = null;
    renderer.lastMap = 0;
    state.accumulator = 0;
    state.previous = performance.now();
    state.pointer.x = $('game').clientWidth / 2 + 100;
    state.pointer.y = $('game').clientHeight / 2;
    $('game-shell').focus({ preventScroll: true });
    syncMode();
    beep(state, 330, 0.2);
    toast(state.game.ruleset === 'boss' ? '首领竞伤 · 90 秒发育，10 分钟竞伤' : `${MODES[state.game.mode].name} · 90 秒发育保护`);
  }

  function returnMenu() {
    const helpWasOpen = state.helpOpen;
    if (helpWasOpen) closeHelp();
    state.selectedMode = state.game.mode;
    state.selectedRuleset = state.game.ruleset || 'arena';
    input.clearInput();
    state.started = false;
    state.deathDismissed = false;
    state.spectateId = null;
    state.choiceKey = '';
    state.game = createGame(Date.now(), options());
    state.accumulator = 0;
    clearTimeout(toast.timer);
    for (const id of MENU_OVERLAYS) show(id, false);
    show('start-overlay', true);
    $('game-shell').classList.remove('spectating');
    setPauseButton(false);
    renderer.seed = null;
    renderer.lastMap = 0;
    syncMode();
    $('start-button').focus({ preventScroll: true });
  }

  // ---- 暂停 -------------------------------------------------------------

  function pause(yes) {
    if (state.helpOpen) return;
    if (!state.started || state.game.result) return;
    state.game.paused = yes;
    input.clearInput();
    show('pause-overlay', yes);
    setPauseButton(yes);
  }

  /** 帮助层存在期间，暂停/恢复入口必须服从它保存的原始状态。 */
  function pauseWhileHelpOpen() {
    if (state.helpOpen) {
      state.game.paused = true;
      show('pause-overlay', false);
      setPauseButton(true);
      return;
    }
    pause(true);
  }

  function togglePause() {
    if (state.helpOpen) return;
    pause(!state.game.paused);
  }

  // ---- 选技 -------------------------------------------------------------

  function pick(index, expectedId, expectedVersion) {
    const player = state.game.actors[0];
    if (!state.started || state.game.paused || state.game.result || !player.alive) return;
    const id = player.choices[index];
    const version = Number(state.choiceVersion) || 1;
    const eventVersion = Number(expectedVersion);
    if (!Number.isInteger(eventVersion) || expectedId !== id || eventVersion !== version) return;
    if (!id || !chooseSkill(state.game, player, id)) return;
    // 选择成功后立即作废旧 DOM；即使下一轮同槽位抽到同一技能也拒绝旧事件。
    state.choiceVersion = Math.max(version, Number(state.choiceVersion) || 0) + 1;
    $('choices').dataset.choiceVersion = String(state.choiceVersion);
    state.choiceKey = '';
    beep(state, 660, 0.1);
    toast(`已觉醒 · ${getSkills(state.game)[id].name}`);
  }

  /** 数字键只选择当前已经渲染给玩家的选项。 */
  function pickVisible(index) {
    const choices = $('choices');
    if (choices.classList.contains('hidden')) return;
    const card = choices.querySelector(`[data-choice="${index}"]`);
    if (!card) return;
    pick(index, card.dataset.choiceId, card.dataset.choiceVersion);
  }

  // ---- 帮助 -------------------------------------------------------------

  function openHelp() {
    if (state.helpOpen) return;
    state.helpOpen = true;
    state.helpWasPaused = state.game.paused;
    state.helpPauseOverlayWasShown = !$('pause-overlay').classList.contains('hidden');
    const active = document.activeElement;
    state.helpReturnFocus = active && active !== document.body ? active : $('help-button');
    input.clearInput();
    if (state.started && !state.game.result) {
      state.game.paused = true;
      input.clearInput();
      setPauseButton(true);
    }
    show('pause-overlay', false);
    $('app').inert = true;
    $('app').setAttribute('inert', '');
    $('help-overlay').inert = false;
    show('help-overlay', true);
    $('close-help').focus({ preventScroll: true });
  }

  function closeHelp() {
    if (!state.helpOpen) return;
    show('help-overlay', false);
    $('app').inert = false;
    $('app').removeAttribute('inert');
    state.helpOpen = false;
    if (state.started && !state.game.result) {
      state.game.paused = state.helpWasPaused;
      input.clearInput();
      show('pause-overlay', state.helpWasPaused && state.helpPauseOverlayWasShown);
      setPauseButton(state.helpWasPaused);
    }
    const restoreFocus = state.helpReturnFocus;
    state.helpReturnFocus = null;
    if (restoreFocus?.isConnected !== false && typeof restoreFocus?.focus === 'function') {
      restoreFocus.focus({ preventScroll: true });
    }
  }

  function trapHelpFocus(event) {
    if (!state.helpOpen) return;
    if (event.key === 'Escape') {
      closeHelp();
      event.preventDefault();
      event.stopPropagation?.();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = $('help-overlay').querySelector('.help-dialog');
    if (!dialog) return;
    const focusable = [...dialog.querySelectorAll('button')]
      .filter((element) => element.tabIndex >= 0 && !element.disabled);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!dialog.contains(event.target)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus({ preventScroll: true });
    } else if (event.shiftKey && event.target === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  // ---- 观战与声音 -------------------------------------------------------

  function spectate() {
    state.deathDismissed = true;
    show('death-card', false);
    toast('观战中 · 点击右侧存活旅者，或用 Enter / 空格切换视角');
  }

  function selectSpectateTarget(event) {
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    const game = state.game;
    if (!state.started || game.result || game.actors[0].alive) return;
    const row = event.target.closest('[data-actor]');
    if (!row || !game.actors.some(actor => actor.id === row.dataset.actor && actor.alive)) return;
    if (event.type === 'keydown') event.preventDefault();
    state.spectateId = row.dataset.actor;
  }

  function toggleSound() {
    state.soundOn = !state.soundOn;
    $('sound-button').textContent = state.soundOn ? '♫' : '♪';
    $('sound-button').style.color = state.soundOn ? '#e6bd79' : '';
    $('sound-button').setAttribute('aria-label', state.soundOn ? '关闭声音' : '开启声音');
    beep(state, 523, 0.13);
  }

  // ---- 绑定到 DOM -------------------------------------------------------

  function bind() {
    syncBossHelpValues();
    $('map-count').textContent = `${String(Object.keys(BIOMES).length).padStart(2, '0')} ARENAS`;
    $('map-picker').innerHTML = Object.values(BIOMES).map((info) =>
      `<button class="map-card" data-map="${info.id}" aria-pressed="false" style="--map-accent:${info.accent}">`
      + `<span class="map-art map-art-${info.id}" aria-hidden="true">${info.icon}</span>`
      + `<span class="map-title">${info.name}</span></button>`).join('');
    for (const card of document.querySelectorAll('[data-map]')) {
      card.onclick = () => selectMap(card.dataset.map);
    }
    $('start-button').onclick = begin;
    for (const id of ['restart-pause', 'restart-death', 'restart-result']) $(id).onclick = begin;
    for (const card of document.querySelectorAll('[data-mode]')) {
      card.onclick = () => selectMode(card.dataset.mode);
    }
    for (const card of document.querySelectorAll('[data-weapon]')) {
      card.onclick = () => {
        if (state.started || state.selectedRuleset !== 'boss') return;
        state.selectedMode = normalizeMode(card.dataset.weapon);
        input.clearInput();
        state.game = createGame(state.game.seed, options());
        syncMode();
      };
    }
    for (const id of ['menu-pause', 'menu-death', 'menu-result']) $(id).onclick = returnMenu;
    $('pause-button').onclick = togglePause;
    $('resume-button').onclick = () => pause(false);
    $('help-button').onclick = openHelp;
    $('close-help').onclick = closeHelp;
    $('help-done').onclick = closeHelp;
    $('help-overlay').addEventListener('keydown', trapHelpFocus);
    $('sound-button').onclick = toggleSound;
    $('spectate-button').onclick = spectate;

    $('choices').addEventListener('click', (event) => {
      const card = event.target.closest('[data-choice]');
      if (card) pick(Number(card.dataset.choice), card.dataset.choiceId, card.dataset.choiceVersion);
    });
    for (const id of ['roster', 'boss-ranking']) {
      $(id).addEventListener('click', selectSpectateTarget);
      $(id).addEventListener('keydown', selectSpectateTarget);
    }
    $('game-shell').tabIndex = -1;
  }

  return {
    bind, syncMode, selectMode, selectMap, begin, returnMenu,
    pause, pauseWhileHelpOpen, togglePause, pick, pickVisible, openHelp, closeHelp, spectate, toggleSound,
    /** 供 HUD 复用的对比基线重置。 */
    resetComparisons,
  };
}
