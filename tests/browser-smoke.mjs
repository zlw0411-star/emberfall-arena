// Real Chromium keyboard/layout regression, using CDP without npm dependencies.
// BROWSER_EXECUTABLE can select Chrome/Edge/Chromium; absence is a failure, not a skip.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const candidates = [process.env.BROWSER_EXECUTABLE,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
const executable = candidates.find(existsSync);
assert.ok(executable, 'Install Chrome/Edge/Chromium or set BROWSER_EXECUTABLE');
const base = fileURLToPath(new URL('../dist/', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    let path = resolve(base, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    const root = resolve(base);
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if (path === root) path = resolve(base, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript',
      '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await mkdtemp(resolve(tmpdir(), 'emberfall-browser-'));
let browser, socket, send;
try {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  const address = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 15000);
    browser.on('error', error => { clearTimeout(timer); reject(error); });
    browser.stderr.on('data', chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    browser.on('exit', code => { clearTimeout(timer); reject(new Error(`Browser exited: ${code}\n${output}`)); });
  });
  socket = new WebSocket(address); await once(socket, 'open');
  let serial = 0;
  const pending = new Map(), errors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result);
      }
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params);
  });
  send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); },
      reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const cmd = (method, params) => send(method, params, sessionId);
  async function evaluate(fn) {
    const result = await cmd('Runtime.evaluate', { expression: `(${fn.toString()})()`, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  async function key(key, code, keyCode, type = 'keyDown', autoRepeat = false) {
    await cmd('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: keyCode, autoRepeat });
  }
  await cmd('Page.enable'); await cmd('Runtime.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cmd('Page.navigate', { url: `http://127.0.0.1:${server.address().port}` });
  let loaded = false;
  for (let i = 0; i < 100; i++) {
    if (await evaluate(() => !!window.__emberfall)) { loaded = true; break; }
    await wait(100);
  }
  assert.ok(loaded, 'app.js did not start');
  await cmd('Page.bringToFront');
  await evaluate(() => { window.requestAnimationFrame = callback => { window.testFrame = callback; return 1; }; });
  for (let i = 0; i < 50 && !await evaluate(() => !!window.testFrame); i++) await wait(20);
  assert.equal(await evaluate(() => typeof window.testFrame), 'function');
  await evaluate(() => {
    const state = window.__emberfall.state;
    window.testNow = state.previous;
    window.pump = count => { for (let i = 0; i < count; i++) window.testFrame(window.testNow += 1000 / 60); };
    window.startTestGame = (mode = 'classic') => {
      document.getElementById('menu-pause').click();
      document.querySelector(`[data-mode="${mode}"]`).click();
      document.getElementById('start-button').click();
      window.testNow = state.previous; state.lastHud = testNow; pump(8);
      const game = state.game;
      game.monsters = []; game.gems = [];
      for (const actor of game.actors) { actor.isPlayer = true; actor.attackTimer = Infinity; }
      return game;
    };
  });

  const choiceBefore = await evaluate(() => {
    const game = startTestGame(), player = game.actors[0];
    player.pendingChoices = 1; player.choices = ['power', 'vitality', 'focus']; pump(8);
    document.querySelector('#choices button').focus(); window.scrollTo(0, 0);
    return { y: player.y, scroll: scrollY };
  });
  await key('ArrowDown', 'ArrowDown', 40);
  await evaluate(() => pump(8)); await wait(250);
  const choiceAfter = await evaluate(() => ({ y: __emberfall.state.game.actors[0].y, scroll: scrollY }));
  await key('ArrowDown', 'ArrowDown', 40, 'keyUp');
  assert.ok(choiceAfter.y > choiceBefore.y, 'focused choice card must still permit movement');
  assert.equal(choiceAfter.scroll, choiceBefore.scroll, 'movement must not scroll the page');
  await key(' ', 'Space', 32); await key(' ', 'Space', 32, 'keyUp');
  assert.equal(await evaluate(() => __emberfall.state.game.actors[0].skills.power), 1, 'native Space must still select a card');
  console.log('ok choice focus: movement without page scroll; native Space selection');

  const respawn = await evaluate(async () => {
    const { damage } = await import('/js/combat.js');
    const game = startTestGame('boss'), state = __emberfall.state, player = game.actors[0];
    damage(game, player, 10000, { type: 'trap' }); pump(8);
    game.time = player.respawnAt - 1 / 120; state.lastHud = testNow; state.accumulator = 1 / 120;
    document.getElementById('game-shell').focus();
    return { spawnX: game.map.spawnPoints[0].x };
  });
  await key('d', 'KeyD', 68); // stale input arriving during the last death-wait frame
  const revived = await evaluate(() => { pump(1); const p = __emberfall.state.game.actors[0]; return { alive: p.alive, x: p.x }; });
  assert.equal(revived.alive, true); assert.equal(revived.x, respawn.spawnX);
  await key('d', 'KeyD', 68, 'keyUp'); await key('d', 'KeyD', 68);
  const acrossHud = await evaluate(() => { pump(9); return { x: __emberfall.state.game.actors[0].x, held: __emberfall.state.keys.has('d') }; });
  assert.equal(acrossHud.held, true); assert.ok(acrossHud.x > revived.x);
  await key('d', 'KeyD', 68, 'keyDown', true);
  const heldX = await evaluate(() => { pump(30); return __emberfall.state.game.actors[0].x; });
  await key('d', 'KeyD', 68, 'keyUp');
  assert.ok(heldX > acrossHud.x, 'fresh movement after respawn must survive HUD updates and repeat');
  console.log('ok respawn: stale input cleared; fresh held movement survives HUD');

  const menu = await evaluate(() => {
    startTestGame(); document.getElementById('menu-pause').click(); pump(8);
    const renderer = __emberfall.state.renderer, original = renderer.drawMap;
    let paints = 0;
    renderer.drawMap = function (...args) { paints++; return original.apply(this, args); };
    pump(60); const idlePaints = paints;
    document.querySelector('[data-map="frost"]').click(); pump(1);
    const switchedPaints = paints;
    renderer.drawMap = original;
    return { idlePaints, switchedPaints };
  });
  assert.equal(menu.idlePaints, 0); assert.equal(menu.switchedPaints, 1);
  await cmd('Emulation.setDeviceMetricsOverride', { width: 760, height: 700, deviceScaleFactor: 1, mobile: false });
  await wait(100);
  const resized = await evaluate(() => {
    pump(2); const mini = document.getElementById('minimap');
    return { width: mini.width, height: mini.height, cssWidth: Math.round(mini.clientWidth), cssHeight: Math.round(mini.clientHeight) };
  });
  assert.ok(resized.width > 0 && resized.height > 0);
  assert.equal(resized.width, resized.cssWidth); assert.equal(resized.height, resized.cssHeight);
  console.log('ok minimap: static menu cached; map selection and real viewport resize refreshed');
  assert.deepEqual(errors, [], 'browser runtime exceptions');
  console.log(JSON.stringify({ browser: (await send('Browser.getVersion')).product, checks: 3, errors }));
} finally {
  if (send && socket?.readyState === WebSocket.OPEN) {
    try { await send('Browser.close'); } catch { /* cleanup below handles an exited browser */ }
  }
  socket?.close();
  if (browser && browser.exitCode === null) {
    for (let i = 0; i < 30 && browser.exitCode === null; i++) await wait(100);
    if (browser.exitCode === null) {
      if (process.platform === 'win32') {
        try { execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already exited */ }
      } else browser.kill('SIGKILL');
    }
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
