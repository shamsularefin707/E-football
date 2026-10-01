// End-to-end check of the built game in a real browser.
// Usage: npm run build && npm run test:e2e   (CHROMIUM=/path/to/chrome to override the browser)
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('../../dist/', import.meta.url).pathname;
const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
if (!existsSync(join(root, 'index.html'))) {
  console.error('dist/ missing: run npm run build first');
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  let file = join(root, path || 'index.html');
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// Two fake gamepads so the 2v2 test can drive pads.
const FAKE_PADS = () => {
  const mk = (i) => ({ id: `Fake pad ${i}`, index: i, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) });
  window.__fakePads = [mk(0), mk(1)];
  navigator.getGamepads = () => window.__fakePads;
};

async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text()) && !/ERR_(TUNNEL|PROXY|NAME|CONNECTION|FAILED)/.test(m.text())) errors.push(m.text());
  });
  await page.addInitScript(FAKE_PADS);
  // Block external fonts so tests don't depend on the network.
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);
  return { page, errors };
}

const state = (page) =>
  page.evaluate(() => {
    const g = window.__efb.game;
    if (!g) return null;
    const m = g.m;
    return {
      phase: m.phase,
      clock: m.clock,
      half: m.half,
      score: [...m.score],
      ctrl: m.controllers.map((c) => ({ id: c.id, team: c.team, player: c.player, pos: { ...m.players[c.player].pos } })),
      paused: g.paused,
      fps: g.hud.fps,
      subs: [...m.subsUsed],
    };
  });

/** Run the sim forward quickly (inside the page) until a phase is reached. */
const fastForward = (page, phase, extraSeconds = 0, maxTicks = 60 * 60 * 30) =>
  page.evaluate(
    ({ phase, extraSeconds, maxTicks }) => {
      const g = window.__efb.game;
      let n = 0;
      while (g.m.phase !== phase && n < maxTicks) {
        g.step();
        n++;
      }
      for (let i = 0; i < extraSeconds * 60; i++) g.step();
      return { reached: g.m.phase === phase, ticks: n };
    },
    { phase, extraSeconds, maxTicks },
  );

async function hold(page, key, ms) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

/** Wait until play is live (kick-off taken) so controlled players can move freely. */
async function waitLive(page) {
  await page.evaluate(() => {
    const g = window.__efb.game;
    let n = 0;
    while (g.m.phase !== 'play' && n < 60 * 30) {
      g.step();
      n++;
    }
  });
}

async function startMode(page, mode, half = 2) {
  await page.click('[data-id="kickoff"]');
  await page.click(`[data-mode="${mode}"]`);
  await page.selectOption('.half-select', String(half));
  await page.click('#start-match');
  await page.waitForFunction(() => !!window.__efb.game);
  await page.waitForTimeout(800);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ------------------------------------------------------------------ main menu
{
  const { page, errors } = await newPage();
  await page.waitForSelector('.tile');
  await page.screenshot({ path: join(out, '01-main-menu.png') });
  check('main menu renders 4 tiles', (await page.locator('.tile').count()) === 4);
  await page.click('[data-id="kickoff"]');
  await page.screenshot({ path: join(out, '02-kickoff.png') });
  check('kick-off screen shows both team cards', (await page.locator('[data-team]').count()) === 2);
  // Duplicate devices are blocked.
  await page.click('[data-mode="1v1"]');
  await page.selectOption('.device-select >> nth=1', 'kb1');
  check('duplicate controller device disables Play', await page.locator('#start-match').isDisabled());
  await page.click('.btn.small'); // back
  await page.click('[data-id="editor"]');
  check('team editor lists a squad', (await page.locator('table.squad tbody tr').count()) >= 11);
  await page.click('.btn.small'); // back
  await page.click('[data-id="controls"]');
  check('controls screen lists bindings', (await page.locator('.kbd-btn').count()) === 20);
  await page.click('.btn.small');
  await page.click('[data-id="settings"]');
  check('settings screen renders', (await page.locator('.field').count()) >= 6);
  check('no page errors on menus', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ------------------------------------------------------------------ vs CPU
{
  const { page, errors } = await newPage();
  await startMode(page, 'cpu');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, '10-cpu-kickoff.png') });
  let s = await state(page);
  check('vs CPU: one controller on home team', s.ctrl.length === 1 && s.ctrl[0].team === 0);
  await waitLive(page);
  s = await state(page);
  const before = s.ctrl[0].pos;
  const pBefore = s.ctrl[0].player;
  await hold(page, 'KeyW', 900);
  s = await state(page);
  const after = s.ctrl[0].pos;
  check('vs CPU: WASD moves the controlled player', s.ctrl[0].player !== pBefore || dist(before, after) > 1.5, `moved ${dist(before, after).toFixed(1)} m`);
  // Real-time play for a few seconds to measure frame rate and check the clock runs.
  const c0 = s.clock;
  await page.waitForTimeout(4000);
  s = await state(page);
  check('vs CPU: clock advances in real time', s.clock > c0 + 30, `${(s.clock - c0).toFixed(0)} game-s in 4 s`);
  check('vs CPU: frame rate measured', s.fps > 0, `${s.fps} fps (software GPU)`);
  await page.screenshot({ path: join(out, '11-cpu-play.png') });
  // Pause menu and team management.
  await page.keyboard.press('Escape');
  await page.waitForSelector('#resume');
  s = await state(page);
  check('pause: Escape pauses the match', s.paused);
  const clockPaused = s.clock;
  await page.waitForTimeout(600);
  s = await state(page);
  check('pause: clock frozen while paused', s.clock === clockPaused);
  await page.click('text=Team management');
  await page.locator('tr[data-bench]:not([data-pos="GK"])').first().click();
  await page.click('tr[data-slot="9"]');
  s = await state(page);
  check('team management: substitution made', s.subs[0] === 1);
  await page.screenshot({ path: join(out, '12-team-management.png') });
  await page.click('text=Done');
  await page.click('#resume');
  s = await state(page);
  check('pause: resume continues', !s.paused);
  // Half time and full time.
  let r = await fastForward(page, 'halftime', 1.5);
  check('vs CPU: reaches half time', r.reached);
  await page.waitForSelector('#continue', { timeout: 5000 });
  await page.screenshot({ path: join(out, '13-half-time.png') });
  await page.click('#continue');
  await page.waitForTimeout(300);
  s = await state(page);
  check('vs CPU: second half starts after Continue', s.half === 2 && s.phase !== 'halftime', `${s.phase}`);
  r = await fastForward(page, 'fulltime', 2.5);
  check('vs CPU: reaches full time', r.reached);
  await page.waitForSelector('#rematch', { timeout: 5000 });
  await page.screenshot({ path: join(out, '14-full-time.png') });
  s = await state(page);
  check('vs CPU: final clock at least 90:00', s.clock >= 5400, `${(s.clock / 60).toFixed(1)} min, ${s.score.join('-')}`);
  await page.click('#rematch');
  await page.waitForTimeout(500);
  s = await state(page);
  check('rematch starts a fresh match', s.clock < 60 && s.score[0] + s.score[1] === 0);
  await page.keyboard.press('Escape');
  await page.click('#quit');
  check('quit returns to main menu', (await page.locator('.tile').count()) === 4);
  check('vs CPU: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ------------------------------------------------------------------ 1v1
{
  const { page, errors } = await newPage();
  await startMode(page, '1v1');
  await waitLive(page);
  let s = await state(page);
  check('1v1: two controllers, one per team', s.ctrl.length === 2 && s.ctrl[0].team === 0 && s.ctrl[1].team === 1);
  const b0 = s.ctrl[0].pos;
  const b1 = s.ctrl[1].pos;
  const p0 = s.ctrl[0].player;
  const p1 = s.ctrl[1].player;
  await page.keyboard.down('KeyS');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyS');
  await page.keyboard.up('ArrowUp');
  s = await state(page);
  check('1v1: P1 (WASD) moves', s.ctrl[0].player !== p0 || dist(b0, s.ctrl[0].pos) > 1.5, `${dist(b0, s.ctrl[0].pos).toFixed(1)} m`);
  check('1v1: P2 (arrows) moves', s.ctrl[1].player !== p1 || dist(b1, s.ctrl[1].pos) > 1.5, `${dist(b1, s.ctrl[1].pos).toFixed(1)} m`);
  check('1v1: P1 and P2 never control the same player', s.ctrl[0].player !== s.ctrl[1].player);
  await page.screenshot({ path: join(out, '20-1v1.png') });
  const r = await fastForward(page, 'halftime', 1.5);
  check('1v1: reaches half time', r.reached);
  await page.waitForSelector('#continue', { timeout: 5000 });
  await page.click('#continue');
  const r2 = await fastForward(page, 'fulltime', 2.5);
  check('1v1: reaches full time', r2.reached);
  await page.waitForSelector('#rematch', { timeout: 5000 });
  check('1v1: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ------------------------------------------------------------------ 2v2 (two keyboards + two fake gamepads)
{
  const { page, errors } = await newPage();
  await startMode(page, '2v2');
  await waitLive(page);
  let s = await state(page);
  check('2v2: four controllers, two per team', s.ctrl.length === 4 && s.ctrl.filter((c) => c.team === 0).length === 2);
  check('2v2: four different players controlled', new Set(s.ctrl.map((c) => c.player)).size === 4);
  const before = s.ctrl.map((c) => ({ ...c.pos }));
  const players = s.ctrl.map((c) => c.player);
  await page.evaluate(() => {
    window.__fakePads[0].axes[1] = 1; // pad 1 stick down
    window.__fakePads[1].axes[1] = -1; // pad 2 stick up
  });
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(900);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ArrowDown');
  await page.evaluate(() => {
    window.__fakePads[0].axes[1] = 0;
    window.__fakePads[1].axes[1] = 0;
  });
  s = await state(page);
  ['P1 keyboard', 'P2 gamepad', 'P3 keyboard', 'P4 gamepad'].forEach((label, i) => {
    const d = dist(before[i], s.ctrl[i].pos);
    check(`2v2: ${label} moves`, s.ctrl[i].player !== players[i] || d > 1.5, `${d.toFixed(1)} m`);
  });
  check('2v2: still four different players', new Set(s.ctrl.map((c) => c.player)).size === 4);
  await page.screenshot({ path: join(out, '30-2v2.png') });
  const r = await fastForward(page, 'halftime', 1.5);
  check('2v2: reaches half time', r.reached);
  await page.waitForSelector('#continue', { timeout: 5000 });
  await page.click('#continue');
  const r2 = await fastForward(page, 'fulltime', 2.5);
  check('2v2: reaches full time', r2.reached);
  check('2v2: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ------------------------------------------------------------------ co-op
{
  const { page, errors } = await newPage();
  await startMode(page, 'coop');
  const s = await state(page);
  check('co-op: two controllers on the same team', s.ctrl.length === 2 && s.ctrl[0].team === s.ctrl[1].team);
  const r = await fastForward(page, 'fulltime', 0, 60 * 60 * 15);
  check('co-op: plays through to full time without stalling', r.reached);
  check('co-op: no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
server.close();
console.log(`\n${results.length - failures}/${results.length} checks passed. Screenshots in tests/e2e/out/`);
process.exit(failures ? 1 : 0);
