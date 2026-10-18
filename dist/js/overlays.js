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

/** 主菜单/结算里出现过、需要统一隐藏的浮层 id。 */
const FLOW_OVERLAYS = ['start-overlay', 'pause-overlay', 'result-overlay', 'death-card', 'choices', 'zone-banner'];
const MENU_OVERLAYS = ['pause-overlay', 'result-overlay', 'death-card', 'choices', 'zone-banner', 'world-toast', 'help-overlay'];

export function createFlow(state, input, renderer, portraitCtx) {
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
    state.game = createGame(state.game.seed, { mode: state.selectedMode, mapId: state.selectedMap });
    state.choiceKey = '';
    syncMode();
    return state.game;
  }

  function syncMode() {
    const mode = state.started ? state.game.mode : state.selectedMode;
    const info = MODES[mode];
    document.body.classList.toggle('mode-melee', Boolean(info.bodyClass));
    for (const id of ['mode-label', 'world-mode', 'result-mode']) $(id).textContent = info.name;
    for (const card of document.querySelectorAll('[data-mode]')) {
      const selected = card.dataset.mode === mode;
      card.classList.toggle('selected', selected);
      card.setAttribute('aria-pressed', String(selected));
    }
    $('mode-description').textContent = info.description;
    $('start-button').innerHTML = `开始${info.name} <span>↗</span>`;
    $('attack-control').innerHTML = info.attackControlHtml;
    $('choices').dataset.title = `${info.name} · 选择你的力量`;
    portraitCtx.clearRect(0, 0, 48, 48);
    drawHero(portraitCtx, 24, 25, '#f2be65', 0, false, 1.45, false,
      info.portraitPose ? { ...info.portraitPose } : null);
    syncMap();
  }

  function selectMode(mode) {
    if (state.started) return;
    state.selectedMode = normalizeMode(mode);
    input.clearInput();
    state.game = createGame(state.game.seed, { mode: state.selectedMode, mapId: state.selectedMap });
    state.choiceKey = '';
    syncMode();
    return state.game;
  }

  // ---- 开始 / 重开 ------------------------------------------------------

  function begin() {
    input.clearInput();
    state.game = createGame(Date.now(), { mode: state.selectedMode, mapId: state.selectedMap });
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
    toast(`${MODES[state.game.mode].name} · 90 秒发育保护`);
  }

  function returnMenu() {
    state.selectedMode = state.game.mode;
    input.clearInput();
    state.started = false;
    state.deathDismissed = false;
    state.spectateId = null;
    state.choiceKey = '';
    state.game = createGame(Date.now(), { mode: state.selectedMode, mapId: state.selectedMap });
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
    if (!state.started || state.game.result) return;
    state.game.paused = yes;
    input.clearInput();
    show('pause-overlay', yes);
    setPauseButton(yes);
  }

  function togglePause() {
    pause(!state.game.paused);
  }

  // ---- 选技 -------------------------------------------------------------

  function pick(index) {
    const player = state.game.actors[0];
    if (!state.started || state.game.paused || state.game.result || !player.alive) return;
    const id = player.choices[index];
    if (!id || !chooseSkill(state.game, player, id)) return;
    state.choiceKey = '';
    beep(state, 660, 0.1);
    toast(`已觉醒 · ${getSkills(state.game)[id].name}`);
  }

  // ---- 帮助 -------------------------------------------------------------

  function openHelp() {
    state.helpWasPaused = state.game.paused;
    if (state.started && !state.game.result) pause(true);
    show('help-overlay', true);
  }

  function closeHelp() {
    show('help-overlay', false);
    if (state.started && !state.helpWasPaused) pause(false);
  }

  // ---- 观战与声音 -------------------------------------------------------

  function spectate() {
    state.deathDismissed = true;
    show('death-card', false);
    toast('观战中 · 点击右侧存活旅者切换视角');
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
    for (const id of ['menu-pause', 'menu-death', 'menu-result']) $(id).onclick = returnMenu;
    $('pause-button').onclick = togglePause;
    $('resume-button').onclick = () => pause(false);
    $('help-button').onclick = openHelp;
    $('close-help').onclick = closeHelp;
    $('help-done').onclick = closeHelp;
    $('sound-button').onclick = toggleSound;
    $('spectate-button').onclick = spectate;

    $('choices').addEventListener('click', (event) => {
      const card = event.target.closest('[data-choice]');
      if (card) pick(Number(card.dataset.choice));
    });
    $('roster').addEventListener('click', (event) => {
      const player = state.game.actors[0];
      if (player.alive) return;
      const row = event.target.closest('[data-actor]');
      if (row && state.game.actors.some((actor) => actor.id === row.dataset.actor && actor.alive)) {
        state.spectateId = row.dataset.actor;
      }
    });
    $('game-shell').tabIndex = -1;
  }

  return {
    bind, syncMode, selectMode, selectMap, begin, returnMenu,
    pause, togglePause, pick, openHelp, closeHelp, spectate, toggleSound,
    /** 供 HUD 复用的对比基线重置。 */
    resetComparisons,
  };
}
