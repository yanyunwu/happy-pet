// Exercise the exported Creator game with actual browser clicks.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve(__dirname, '../output/qa-tools'); fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
  const context = await browser.newContext({ viewport: { width: 432, height: 936 }, deviceScaleFactor: 2 });
  const page = await context.newPage(), errors = [], checks = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push(m.text()); });
  const ready = () => page.waitForFunction(() => window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')?.frames?.length === 15);
  const state = () => page.evaluate(() => {
    const a = window.cc.director.getScene().getChildByName('StarIsleGame').getComponent('StarIsle'); window.__qaApp = a;
    return { screen: a.currentScreen, modal: a.modal?.name, busy: a.busy, transition: a.boardTransition, time: a.playTime, save: a.save,
      game: a.game && { level: a.game.level.id, mode: a.game.mode.id, status: a.game.status, remaining: a.game.remaining, tray: a.game.tray.slice(), reserve: a.game.reserve.slice(), cleared: a.game.cleared, matches: a.game.matches, moves: a.game.moves, hint: a.game.hintLeft, undo: a.game.undoLeft, shovel: a.game.shovelLeft } };
  });
  const click = (x, y) => page.mouse.click(x * .6, y * .6);
  const homeClick = async path => {
    const p = await page.evaluate(path => {
      const n = path.split('/').reduce((node, name) => node.getChildByName(name), window.__qaApp.homeRoot);
      return { x: n.position.x, y: -n.position.y };
    }, path);
    await click(p.x, p.y);
  };
  const shot = async name => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(output, `${name}.png`) }); };
  const settle = () => page.waitForFunction(() => !window.__qaApp.busy);
  const close = async () => { const p = await page.evaluate(() => { const n = window.__qaApp.modal.getChildByName('Close'); return { x: n.position.x, y: -n.position.y }; }); await click(p.x, p.y); };
  const pick = async id => {
    const t = await page.evaluate(id => { const a = window.__qaApp, n = a.reserveNodes.get(id) || a.tileNodes.get(id); return { x: n.position.x, y: -n.position.y }; }, id);
    await click(t.x, t.y);
  };
  const solve = async () => {
    const before = await state();
    const route = await page.evaluate(() => window.__qaApp.game.solution.slice());
    for (const id of route) await pick(id);
    if (before.game.level === 1) {
      await page.waitForFunction(mode => window.__qaApp.game?.level.id === 2 && window.__qaApp.game.mode.id === mode, before.game.mode);
      const s = await state(); assert.ok(!s.modal); assert.equal(s.game.moves, 0); assert.equal(s.game.remaining, 108);
    } else {
      await page.waitForFunction(() => window.__qaApp.modal?.name === 'Victory');
      const s = await state(); assert.equal(s.game.remaining, 0); assert.equal(s.game.tray.length, 0); assert.equal(s.game.reserve.length, 0);
    }
    await settle();
  };
  try {
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:7457', { waitUntil: 'networkidle' }); await ready(); await state(); await shot('01-home');
    await click(56, 75); assert.equal((await state()).modal, 'HomeMenu'); await click(199, 178); await click(360, 888); assert.equal((await state()).save.sound, false); await close();
    await homeClick('Shortcuts/SignInButton'); await click(360, 1203); assert.equal((await state()).save.coins, 20); await click(360, 1203); assert.equal((await state()).save.coins, 20); await close();
    await homeClick('Shortcuts/BagButton'); assert.equal((await state()).modal, 'Bag'); await shot('02-four-tool-bag'); await click(360, 1210);
    await homeClick('Shortcuts/AlbumButton'); assert.equal((await state()).modal, 'Album');
    assert.equal(await page.evaluate(() => window.__qaApp.modal.children.filter(n => /^PetCard\d+$/.test(n.name)).length), 15);
    await shot('03-fifteen-pets'); await click(360, 1240); checks.push('15 pet album, four-tool bag, existing sign-in and sound');
    for (const mode of ['classic', 'quartet', 'fun']) {
      await homeClick(`WelcomePanel/Mode-${mode}`); let s = await state();
      assert.equal(s.modal, 'Rules'); assert.equal(s.game.level, 1); assert.equal(s.game.mode, mode);
      await click(360, 590); assert.equal((await state()).game.moves, 0); assert.equal((await state()).time, 0);
      await shot(`04-${mode}-rules`); await click(360, 1203); await shot(`05-${mode}-first-stage`);
      const toolbar = await page.evaluate(() => window.__qaApp.gameRoot.getChildByName('Toolbar').children.filter(n=>n.name.startsWith('Tool-')).map(n=>n.name));
      assert.deepEqual(toolbar, ['Tool-undo','Tool-shovel','Tool-hint','Tool-shuffle']);
      assert.equal(await page.evaluate(() => !!window.__qaApp.gameRoot.getChildByName('HUD')), false);
      const coinsBefore = (await state()).save.coins;
      await solve(); s = await state(); assert.equal(s.save.coins, coinsBefore + { classic: 6, quartet: 4, fun: 2 }[mode]);
      assert.equal(await page.evaluate(() => new Set(window.__qaApp.game.tiles.map(t=>t.kind)).size), 15);
      await shot(`06-${mode}-second-stage`);
      if (mode === 'classic') {
        const first = await page.evaluate(() => window.__qaApp.game.solution.slice(0,2));
        for (const id of first) await pick(id); await settle();
        await click(280,1434); await settle(); s=await state(); assert.deepEqual(s.game.reserve, first); assert.equal(s.game.tray.length,0); assert.equal(s.game.shovel,0);
        await shot('07-shoveled-row');
        await pick(first[0]); await settle(); assert.equal((await state()).game.reserve.length,1); await click(120,1434); assert.deepEqual((await state()).game.reserve,first);
        await pick(first[0]); await settle();
        const heldMoves=(await state()).game.moves;
        await click(600,1434); assert.equal((await state()).transition,true);
        await page.waitForFunction(()=>window.__qaApp.shuffleMotion?.phase>1.15 && window.__qaApp.shuffleMotion.phase<1.7);
        const turn=await page.evaluate(()=> { const a=window.__qaApp; const layer=a.effects.getChildByName('ShuffleAnimation');return {count:layer.children.length,angles:layer.children.map(n=>n.angle),phase:a.shuffleMotion.phase}; });
        assert.equal(turn.count,108); assert.ok(turn.angles.every(a=>a<0 && a>-360));
        await page.screenshot({path:path.join(output,'08-clockwise-rotation.png')});
        await click(360,590); assert.equal((await state()).game.moves,heldMoves); await settle();
        s=await state(); assert.equal(s.game.reserve.length,0); assert.equal(s.game.tray.length,0); assert.equal(s.game.remaining,108);
        await shot('09-rearranged-board');
        for (let n=0;n<4;n++) await click(440,1434); assert.equal((await state()).game.hint,0); assert.equal((await state()).save.bag.hint,0);
        checks.push('shovel transfers all cards, returns and undoes correctly; 108 cards rotate clockwise; input blocked during reshuffle; inventory consumed correctly');
      }
      await solve(); assert.equal((await state()).save.modes[mode].completed,true); await shot(`10-${mode}-complete`);
      await click(360,1140); await page.waitForTimeout(350);
      checks.push(`${mode}: entry starts stage 1, automatic stage 2, both stages solved, all 15 pets appear in hard stage`);
    }
    // Failed hard stage exposes exactly restart/home; restart preserves mode and starts at stage 1.
    await homeClick('WelcomePanel/Mode-fun'); await click(360,1203); await solve();
    while ((await state()).game.status==='playing') {
      const id=await page.evaluate(()=>{const g=window.__qaApp.game,held=k=>g.tray.filter(id=>g.tiles[id].kind===k).length;return g.availableTiles().sort((a,b)=>held(a.kind)-held(b.kind))[0].id;}); await pick(id);
    }
    await page.waitForFunction(()=>window.__qaApp.modal?.name==='TryAgain'); await shot('11-failure-options');
    const labels=await page.evaluate(()=>{const cc=window.cc,a=window.__qaApp;return a.modal.children.flatMap(n=>n.getComponent(cc.Label)?[n.getComponent(cc.Label).string]:n.children.filter(c=>c.getComponent(cc.Label)).map(c=>c.getComponent(cc.Label).string));});
    assert.ok(!labels.some(s=>s.includes('撤回'))); assert.ok(labels.includes('重新开始 · 第一关')); assert.ok(labels.includes('返回主页'));
    assert.equal(await page.evaluate(()=>window.__qaApp.game.canUndo),false);
    await click(360,1020); let s=await state(); assert.equal(s.game.mode,'fun'); assert.equal(s.game.level,1); assert.equal(s.modal,'Rules');
    await click(360,1203); await click(664,77); await click(360,1070); checks.push('failure has no undo, same-mode restart begins stage 1, pause offers home');
    // A leaving transition cannot later resurrect the previous board.
    await homeClick('WelcomePanel/Mode-classic'); await click(360,1203); await click(600,1434); await click(664,77); await click(360,1070); await page.waitForTimeout(1400);
    assert.equal((await state()).screen,'home'); assert.equal((await state()).transition,false); checks.push('leaving during rotation cancels stale animation callbacks');
    await page.reload({waitUntil:'networkidle'}); await ready(); s=await state();
    for(const mode of ['classic','quartet','fun']) assert.equal(s.save.modes[mode].completed,true);
    assert.equal(s.save.sound,false); assert.equal(s.save.bag.shovel,0);
    const entries=await page.evaluate(()=>window.__qaApp.homeRoot.getChildByName('WelcomePanel').children.filter(n=>n.getComponent(cc.Button)).map(n=>n.name));assert.deepEqual(entries,['Mode-classic','Mode-quartet','Mode-fun','CampaignButton']);
    await homeClick('WelcomePanel/CampaignButton');assert.equal((await state()).modal,'Campaign');await click(360,570);assert.equal((await state()).game,null);assert.equal((await state()).modal,'Campaign');await close();checks.push('four home entries; offline campaign does not masquerade as a standard game');
    await page.setViewportSize({width:432,height:768}); await shot('12-short-phone');
    assert.deepEqual(errors,[]); fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({success:true,checks,errors,state:await state()},null,2));
    console.log(`PASS — ${checks.length} flows; all six stages, shovel/rotation/failure/15 pets and persistent state, no runtime errors.`);
  } catch(e) { await page.screenshot({path:path.join(output,'failure.png')}); console.log('Failure:',await state().catch(()=>null));throw e; }
  finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
