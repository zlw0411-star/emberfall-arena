/**
 * DOM 与纯展示工具。
 *
 * 原来这些都塞在 app.js 顶部的一行里（$、show、timeText、beep、toast），
 * 拆分后集中在这里，hud/input/overlays 都从这里取。
 */

export const $ = (id) => document.getElementById(id);

/** 切换 hidden 类，控制浮层显隐。 */
export const show = (id, yes) => $(id).classList.toggle('hidden', !yes);

/** 秒 -> mm:ss。负数按 0 处理，避免倒计时出现 "-0:03"。 */
export const timeText = (t) => {
  const clamped = Math.max(0, t);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(Math.floor(clamped % 60)).padStart(2, '0')}`;
};

/**
 * 极简方波提示音。默认静音（由声音开关控制）。
 * AudioContext 在某些浏览器里首次调用会因自动播放策略抛错，这里静默忽略。
 */
export function beep(state, freq = 440, duration = 0.08, volume = 0.025) {
  if (!state.soundOn) return;
  try {
    state.audio ||= new AudioContext();
    if (state.audio.state === 'suspended') state.audio.resume();
    const osc = state.audio.createOscillator();
    const gain = state.audio.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, state.audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, state.audio.currentTime + duration);
    osc.connect(gain);
    gain.connect(state.audio.destination);
    osc.start();
    osc.stop(state.audio.currentTime + duration);
  } catch {
    // 音频不可用时不影响游戏。
  }
}

/** 战场顶部的短提示。重复调用会重置计时。 */
export function toast(text) {
  $('world-toast').textContent = text;
  show('world-toast', true);
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => show('world-toast', false), 3200);
}
