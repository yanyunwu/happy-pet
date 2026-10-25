// Real browser input against the Creator build, including overlapping animations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let playwright;
for (const candidate of ['playwright', process.env.PLAYWRIGHT_PATH, 'C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch {}
}
if (!playwright) throw new Error('Install Playwright or set PLAYWRIGHT_PATH.');
const output = path.resolve(__dirname, '../output/qa-rapid');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await playwright.chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const errors = [], checks = [];
  let page;
  const click = (x, y) => page.mouse.click(x * .6, y * .6);
  const read = () => page.evaluate(() => {
    const a = window.__qaApp, g = a.game;
    return { screen: a.currentScreen, busy: a.busy, modal: a.modal?.name, coins: a.save.coins,
      moves: g?.moves, remaining: g?.remaining, matches: g?.matches, status: g?.status, tray: g?.tray.slice(),
      visual: a.rack?.children.filter(n => n.active && n.name.startsWith('tray-')).map(n => ({ id: Number(n.name.slice(5)), x: n.position.x, y: n.position.y })),
      moving: a.trayMotions?.size || 0, clearing: a.clearingGroups?.size || 0 };
  });
  const ready = () => page.waitForFunction(() => window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')?.frames?.length === 15);
  const fixture = async (level = 1, seed = 42) => {
    await page.evaluate(({ level, seed }) => { const a = window.cc.director.getScene().getChildByName('StarIsleGame').getComponent('StarIsle'); window.__qaApp = a; a.startLevel(level, seed); a.closeModal(); }, { level, seed });
    await page.waitForTimeout(40);
  };
  const openTiles = () => page.evaluate(() => { const a = window.__qaApp; return a.game.availableTiles().map(t => { const n = a.reserveNodes.get(t.id) || a.tileNodes.get(t.id); return { id: t.id, kind: t.kind, x: n.position.x, y: -n.position.y }; }); });
  const tap = tile => click(tile.x, tile.y);
  const settle = () => page.waitForFunction(() => !window.__qaApp.busy);
  const assertRack = async () => {
    await settle(); const state = await read();
    const shades = await page.evaluate(() => { const a = window.__qaApp; return [...a.tileNodes.entries()].map(([id,n]) => ({id, available:a.game.isAvailable(id), count:n.children.filter(c=>c.name==='Covered').length, active:n.children.filter(c=>c.name==='Covered'&&c.active).length})); });
    shades.forEach(t => { assert.ok(t.count <= 1, `one shade per tile ${t.id}`); assert.equal(t.active, t.available ? 0 : 1, `shade reflects availability for tile ${t.id}`); });
    assert.equal(state.moving, 0); assert.equal(state.clearing, 0);
    assert.equal(state.visual.length, state.tray.length, 'no leftover or duplicate tray sprites');
    const sorted = state.visual.slice().sort((a, b) => a.x - b.x);
    assert.deepEqual(sorted.map(n => n.id), state.tray, 'visual order agrees with logical order');
    sorted.forEach((n, i) => { assert.ok(Math.abs(n.x - (87 + 91 * i)) < .1); assert.ok(Math.abs(n.y + 1287) < .1); });
  };
  try {
    page = await browser.newPage({ viewport: { width: 432, height: 936 }, deviceScaleFactor: 1 });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:7457', { waitUntil: 'networkidle' }); await ready();

    await fixture();
    let open = await openTiles();
    await tap(open[0]); assert.equal((await read()).busy, true, 'first card is still moving');
    await tap(open[1]); assert.equal((await read()).moves, 2, 'second click is accepted during first flight');
    await assertRack(); checks.push('second click during flight');

    await fixture(); open = await openTiles();
    const groups = Map.groupBy(open, t => t.kind);
    const triple = [...groups.values()].find(g => g.length >= 3).slice(0, 3);
    const fourth = open.find(t => t.kind !== triple[0].kind);
    for (const t of triple) await tap(t);
    assert.equal((await read()).matches, 1); assert.equal((await read()).busy, true, 'triple effect is in progress');
    await tap(fourth);
    let state = await read(); assert.equal(state.moves, 4); assert.deepEqual(state.tray, [fourth.id]);
    await assertRack(); checks.push('fourth click during triple effect');

    await fixture(); open = await openTiles();
    const pair = [...Map.groupBy(open, t => t.kind).values()].find(g => g.length >= 2).slice(0, 2);
    const different = open.find(t => t.kind !== pair[0].kind);
    for (const t of [pair[0], different, pair[1]]) await tap(t);
    await assertRack(); assert.deepEqual((await read()).tray, [pair[0].id, pair[1].id, different.id]);
    await click(120, 1434); await assertRack();
    state = await read(); assert.equal(state.moves, 2); assert.deepEqual(state.tray, [pair[0].id, different.id]);
    checks.push('retarget moving cards and undo most recent tap');

    await fixture();
    await page.evaluate(() => { const a = window.__qaApp, id = a.game.availableTiles()[0].id, n = a.tileNodes.get(id); n.emit(window.cc.Node.EventType.TOUCH_END); n.emit(window.cc.Node.EventType.TOUCH_END); });
    assert.equal((await read()).moves, 1, 'duplicate event collects a tile only once'); await assertRack();
    checks.push('duplicate event ignored');

    await fixture(); open = await openTiles();
    await tap(open[0]); await click(664, 77);
    assert.equal((await read()).modal, 'Pause'); await tap(open[1]);
    assert.equal((await read()).moves, 1, 'modal still blocks board input'); await settle();
    await click(360, 850); await tap(open[1]); await assertRack(); assert.equal((await read()).moves, 2);
    checks.push('pause responds during flight; modal blocks input');

    await fixture(); open = await openTiles();
    await tap(open[0]); await click(664, 77); await click(360, 1070);
    await page.waitForTimeout(500); state = await read(); assert.equal(state.screen, 'home'); assert.equal(state.busy, false);
    assert.equal(state.visual.length, 0); assert.ok(!state.modal);
    await fixture(); open = await openTiles();
    await tap(open[0]); await click(664, 77); await click(360, 962); await page.evaluate(() => window.__qaApp.closeModal());
    await page.waitForTimeout(500); state = await read(); assert.equal(state.moves, 0); assert.equal(state.remaining, 18);
    await assertRack(); checks.push('home and restart cancel stale animation callbacks');

    await fixture(); const coinsBefore = (await read()).coins;
    const route = await page.evaluate(() => { const a = window.__qaApp; return a.game.solution.map(id => { const n = a.tileNodes.get(id); return { id, x: n.position.x, y: -n.position.y }; }); });
    for (const t of route) await tap(t);
    assert.equal((await read()).moves, 18, 'a fast full solution drops no taps');
    await page.waitForFunction(() => window.__qaApp.game?.level.id === 2); await assertRack();
    await page.waitForTimeout(500); state = await read(); assert.equal(state.coins, coinsBefore + 6, 'first stage awards once');
    assert.equal(state.remaining, 108); assert.equal(state.matches, 0); assert.ok(!state.modal); checks.push('fast first clear automatically continues to second stage, reward once');

    await fixture(2, 42); let last;
    for (let move = 0; move < 108 && (await read()).status === 'playing'; move++) {
      last = await page.evaluate(() => { const a = window.__qaApp, g = a.game, count = k => g.tray.filter(id => g.tiles[id].kind === k).length; const t = g.availableTiles().sort((a, b) => count(a.kind) - count(b.kind))[0], n = a.tileNodes.get(t.id); return { id: t.id, x: n.position.x, y: -n.position.y }; });
      await tap(last);
    }
    state = await read(); assert.equal(state.status, 'lost'); assert.equal(state.tray.length, 7);
    const lostMoves = state.moves; open = await openTiles(); await tap(open[0]);
    assert.equal((await read()).moves, lostMoves, 'terminal state rejects an eighth selection');
    await page.waitForFunction(() => window.__qaApp.modal?.name === 'TryAgain'); await assertRack();
    const failedCoins = (await read()).coins;
    const failureButtons = await page.evaluate(() => window.__qaApp.modal.children.filter(n => n.name.startsWith('Result')).map(n=>n.name));
    assert.ok(failureButtons.includes('ResultPrimary') && failureButtons.includes('ResultHome'));
    assert.equal(await page.evaluate(()=>window.__qaApp.game.canUndo), false);
    await click(360, 1020); assert.equal((await read()).modal, 'Rules');
    assert.equal(await page.evaluate(()=>window.__qaApp.game.level.id), 1);
    assert.equal((await read()).coins, failedCoins); checks.push('rapid overflow rejects eighth card; failure restarts at stage one with no undo');

    const touchPage = await browser.newPage({ viewport: { width: 432, height: 936 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.close(); page = touchPage; page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:7457', { waitUntil: 'networkidle' }); await ready(); await fixture();
    open = await openTiles();
    for (const t of open.slice(0, 3)) await page.touchscreen.tap(t.x * .6, t.y * .6);
    assert.equal((await read()).moves, 3, 'rapid mobile taps are accepted'); await assertRack(); checks.push('mobile rapid touch');

    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ success: true, checks, errors }, null, 2));
    console.log(`PASS — ${checks.length} rapid-input scenarios, desktop mouse + mobile touch, no runtime errors.`);
  } catch (error) {
    if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, 'failure.png') }); console.log('Failure state:', await read().catch(() => null)); }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
