// Own-application integration test: isolated Go test API, real admin and Cocos builds.
const fs = require('node:fs'),
  path = require('node:path'),
  http = require('node:http'),
  assert = require('node:assert/strict');
let playwright;
for (const p of [
  'playwright',
  'C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
]) {
  try {
    playwright = require(p);
    break;
  } catch {}
}
const root = path.resolve(__dirname, '..'),
  out = path.join(root, 'artifacts');
fs.mkdirSync(out, { recursive: true });
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg',
};
const upstream = process.env.QA_API_ORIGIN;
if (!upstream) throw new Error('Run through make test-browser (isolated API required)');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const proxy = http.request(
      upstream + req.url,
      { method: req.method, headers: { ...req.headers, origin: 'http://127.0.0.1:5173' } },
      (response) => {
        res.writeHead(response.statusCode, response.headers);
        response.pipe(res);
      },
    );
    proxy.on('error', () => {
      res.writeHead(502);
      res.end('unavailable');
    });
    req.pipe(proxy);
    return;
  }
  const isGame = req.url.startsWith('/minigame/'),
    base = path.join(root, isGame ? 'minigame/build/web-mobile' : 'admin/dist');
  let file = path.resolve(
    base,
    decodeURIComponent(req.url.split('?')[0].replace(/^\/(?:admin|minigame)\/?/, '')) ||
      'index.html',
  );
  if (!file.startsWith(base + path.sep) && file !== base) {
    res.writeHead(403);
    return res.end();
  }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && !isGame) file = path.join(base, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end();
  }
  let body = fs.readFileSync(file);
  if (isGame && file.endsWith('.json'))
    body = Buffer.from(body.toString().replace(/"apiBaseUrl"\s*:\s*""/g, '"apiBaseUrl":"/api/v1"'));
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(body);
});
(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ['--no-proxy-server', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const errors = [],
    checks = [];
  try {
    const admin = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
    admin.on('pageerror', (e) => errors.push('admin: ' + e.message));
    await admin.goto(origin + '/admin/');
    await admin.getByLabel('管理账号').fill('qa-admin');
    await admin.getByLabel('密码', { exact: true }).fill('qa-password-123');
    await admin.getByRole('button', { name: '登录控制台' }).click();
    await admin.getByRole('heading', { name: '用户管理' }).waitFor();
    await admin.screenshot({ path: path.join(out, 'admin-users.png'), fullPage: true });
    checks.push('admin login and reference UI');
    await admin.getByRole('menuitem', { name: '闯关关卡' }).click();
    await admin.getByRole('heading', { name: '闯关关卡' }).waitFor();
    await admin.getByRole('button', { name: '编辑', exact: true }).first().click();
    await admin.getByText('15 种萌宠配比').waitFor();
    await admin.getByRole('button', { name: '校验并预览' }).click();
    await admin.getByText('棋盘预览 · 固定种子 2026').waitFor();
    await admin.locator('.ant-modal .replay-tile').first().waitFor();
    await admin.screenshot({ path: path.join(out, 'admin-level-editor.png'), fullPage: true });
    await admin.locator('.ant-modal-close').click();
    await admin.locator('.ant-modal-wrap').waitFor({ state: 'hidden' });
    fs.writeFileSync(
      path.join(out, 'admin-after-preview.txt'),
      await admin.locator('body').innerText(),
    );
    await admin.screenshot({ path: path.join(out, 'admin-grid-editor.png'), fullPage: true });
    await admin.goto(origin + '/admin/levels');
    checks.push('grid layers, counts and live preview');
    const game = await browser.newPage({
      viewport: { width: 432, height: 936 },
      deviceScaleFactor: 1,
    });
    game.on('pageerror', (e) => errors.push('game: ' + e.message));
    await game.addInitScript(() => {
      window.wx = {
        login: (options) => options.success({ code: 'qa-browser-player' }),
        request: (options) =>
          fetch(options.url, {
            method: options.method,
            headers: options.header,
            body: options.data === undefined ? undefined : JSON.stringify(options.data),
          })
            .then(async (r) => options.success({ statusCode: r.status, data: await r.json() }))
            .catch(options.fail),
      };
    });
    await game.goto(origin + '/minigame/');
    await game.waitForFunction(
      () =>
        window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
      {},
      { timeout: 45000 },
    );
    await game.evaluate(() => {
      window.qaApp = window.cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
    });
    await game.waitForFunction(() => !!window.qaApp.online);
    await game.waitForFunction(() =>
      window.qaApp.homeRoot
        .getChildByName('WelcomePanel')
        .children.filter((n) => n.getComponent(cc.Button))
        .every((n) => Math.abs(n.scale.x - 1) < 0.001),
    );
    await game.screenshot({ path: path.join(out, 'game-campaign-home.png') });
    const tap = (x, y) => game.mouse.click(x * 0.6, y * 0.6);
    const settle = () =>
      game.waitForFunction(() => !window.qaApp.busy && !window.qaApp.networkBusy);
    assert.deepEqual(
      await game.evaluate(() =>
        window.qaApp.homeRoot
          .getChildByName('WelcomePanel')
          .children.filter((n) => n.getComponent(cc.Button))
          .map((n) => n.name),
      ),
      ['Mode-classic', 'Mode-quartet', 'Mode-fun', 'CampaignButton'],
    );
    for (const [index, mode] of ['classic', 'quartet', 'fun'].entries()) {
      await tap(360, 1048 + index * 124);
      await game.waitForFunction(() => window.qaApp.modal?.name === 'Rules');
      assert.deepEqual(
        await game.evaluate(() => ({
          entry: window.qaApp.online.active.entry,
          mode: window.qaApp.game.mode.id,
          level: window.qaApp.game.level.id,
        })),
        { entry: 'standard', mode, level: 1 },
      );
      await tap(360, 1203);
      await tap(56, 77);
      await game.waitForFunction(() => window.qaApp.modal?.name === 'Settings');
      await tap(360, 1080);
      await game.waitForFunction(() => window.qaApp.currentScreen === 'home');
    }
    checks.push('three direct home entries start independent standard games');
    await tap(360, 1442);
    await game.waitForFunction(() => window.qaApp.modal?.name === 'Campaign');
    await tap(360, 570);
    await game.waitForFunction(() => window.qaApp.modal?.name === 'Rules');
    assert.equal(await game.evaluate(() => window.qaApp.online.active.entry), 'campaign');
    await game.screenshot({ path: path.join(out, 'game-online-rules.png') });
    // The rules button is authored in design coordinates; find its actual position.
    const begin = await game.evaluate(() => {
      const n = window.qaApp.modal.getChildByName('Understood');
      return n && { x: n.position.x, y: -n.position.y };
    });
    assert(begin);
    await tap(begin.x, begin.y);
    await game.waitForFunction(() => !window.qaApp.modal);
    const pick = async (id) => {
      const p = await game.evaluate((id) => {
        const a = window.qaApp,
          t = a.game.tiles[id];
        return a.game.reserve.includes(id)
          ? { x: 87 + a.game.reserve.indexOf(id) * 91, y: 1115 }
          : { x: 360 + t.x, y: 590 + t.y };
      }, id);
      await tap(p.x, p.y);
      await settle();
    };
    let first = await game.evaluate(() => window.qaApp.game.availableTiles()[0].id);
    await pick(first);
    await tap(120, 1434);
    await settle();
    await game.waitForFunction(() => window.qaApp.game.moves === 0);
    await pick(first);
    await tap(280, 1434);
    await settle();
    await game.waitForFunction(() => window.qaApp.game.reserve.length === 1);
    await pick(first);
    await tap(440, 1434);
    await settle();
    await tap(600, 1434);
    await settle();
    await game.waitForFunction(() => window.qaApp.game.tray.length === 0);
    checks.push('real picks, undo, shovel, reserve, hint and server shuffle');
    for (let guard = 0; guard < 30; guard++) {
      const next = await game.evaluate(() => {
        const a = window.qaApp;
        if (a.game.level.id !== 1 || a.game.status !== 'playing') return null;
        return a.game.availableTiles()[0]?.id;
      });
      if (next === null) break;
      await pick(next);
    }
    await game.waitForFunction(
      () => window.qaApp.game?.level.id === 2 && !window.qaApp.networkBusy,
      {},
      { timeout: 15000 },
    );
    assert.equal(
      await game.evaluate(() => new Set(window.qaApp.game.tiles.map((t) => t.kind)).size),
      15,
    );
    checks.push('continuous level 1 to configured level 2 with 15 animals');
    await game.screenshot({ path: path.join(out, 'game-online-hard.png') });
    for (let guard = 0; guard < 150; guard++) {
      const next = await game.evaluate(() => {
        const g = window.qaApp.game;
        if (g.status !== 'playing') return null;
        return g
          .availableTiles()
          .sort(
            (a, b) =>
              g.tray.filter((id) => g.tiles[id].kind === a.kind).length -
              g.tray.filter((id) => g.tiles[id].kind === b.kind).length,
          )[0]?.id;
      });
      if (next === null) break;
      await pick(next);
    }
    await game.waitForFunction(
      () => window.qaApp.modal?.name === 'TryAgain',
      {},
      { timeout: 15000 },
    );
    const summary = await game.evaluate(() => ({
      sessionId: window.qaApp.online.active.id,
      userCoins: window.qaApp.save.coins,
      status: window.qaApp.game.status,
    }));
    assert.equal(summary.status, 'lost');
    await tap(360, 1020);
    await game.waitForFunction(
      () => window.qaApp.game?.level.id === 1 && window.qaApp.modal?.name === 'Rules',
    );
    checks.push('loss uploaded and restart returns to first level');
    // A legal fun-mode pair match can leave an impossible multiset. A rejected
    // shuffle must restore the confirmed board, retain the charge and allow undo.
    await tap(360, 1203);
    await tap(56, 77);
    await game.waitForFunction(() => window.qaApp.modal?.name === 'Settings');
    await tap(360, 1080);
    await game.waitForFunction(() => window.qaApp.currentScreen === 'home');
    await tap(360, 1442);
    await tap(360, 920);
    await game.waitForFunction(() => window.qaApp.modal?.name === 'Rules');
    await tap(360, 1203);
    const pairIds = await game.evaluate(() =>
      [
        ...window.qaApp.game.tiles.filter((t) => t.kind === 0).slice(0, 2),
        ...window.qaApp.game.tiles.filter((t) => t.kind === 1).slice(0, 2),
      ].map((t) => t.id),
    );
    for (const id of pairIds) await pick(id);
    await tap(600, 1434);
    await settle();
    await game.waitForFunction(() => !window.qaApp.reconciling && !window.qaApp.networkBusy);
    assert.deepEqual(
      await game.evaluate(() => ({
        modal: window.qaApp.modal?.name || null,
        charge: window.qaApp.game.shuffleLeft,
        cleared: window.qaApp.game.cleared,
        canUndo: window.qaApp.game.hasUndo,
      })),
      { modal: null, charge: 1, cleared: 4, canUndo: true },
    );
    await tap(120, 1434);
    await settle();
    assert.equal(await game.evaluate(() => window.qaApp.game.cleared), 0);
    checks.push(
      'rejected fun shuffle restores authoritative board and undo history without spending',
    );
    await admin.getByRole('menuitem', { name: '对局记录' }).click();
    await admin.getByRole('button', { name: /刷\s*新/ }).click();
    await admin
      .getByRole('button', { name: /回\s*放/ })
      .first()
      .waitFor();
    const rows = admin.locator('.ant-table-tbody tr');
    await rows
      .filter({ hasText: '失败' })
      .first()
      .getByRole('button', { name: /回\s*放/ })
      .click();
    await admin.getByText('对局回放', { exact: true }).waitFor();
    await admin.getByRole('button', { name: '下一步', exact: true }).click();
    await admin.screenshot({ path: path.join(out, 'admin-game-replay.png'), fullPage: true });
    await admin.getByRole('button', { name: /播\s*放/ }).click();
    await admin.waitForTimeout(750);
    assert((await admin.getByText(/第 [2-9]\d* \/ .* 步/).count()) > 0);
    checks.push('admin displays failure and replays server snapshots');
    await admin.goto(origin + '/admin/users');
    await admin.getByRole('button', { name: '萌宠玩家', exact: true }).click();
    await admin.getByText('个人资产与背包', { exact: true }).waitFor();
    await admin.getByRole('button', { name: '调整资产', exact: true }).click();
    await admin.getByLabel('调整数量（正数增加，负数扣减）').fill('25');
    await admin.getByLabel('调整原因').fill('界面联调资产补偿');
    await admin.getByRole('button', { name: '保存调整', exact: true }).click();
    await admin
      .locator('.ant-modal-wrap')
      .filter({ hasText: '调整用户资产' })
      .waitFor({ state: 'hidden' });
    await admin.getByRole('cell', { name: '界面联调资产补偿', exact: true }).waitFor();
    await admin.getByText('个人资产与背包', { exact: true }).scrollIntoViewIfNeeded();
    await admin.screenshot({ path: path.join(out, 'admin-player-assets.png'), fullPage: true });
    const userId = await game.evaluate(() => window.qaApp.online.userId);
    const assetResult = await (
      await admin.request.get(origin + `/api/v1/admin/users/${userId}/assets`)
    ).json();
    assert.equal(assetResult.coins, 35);
    checks.push('admin changes player assets and ledger with required reason');
    await admin.goto(origin + '/admin/levels');
    await admin.getByRole('button', { name: '新增关卡' }).click();
    await admin.getByLabel('关卡名称').fill('界面联调新关卡');
    await admin.getByRole('button', { name: '保存草稿', exact: true }).click();
    await admin.getByText('草稿已保存', { exact: true }).waitFor();
    await admin.goto(origin + '/admin/levels');
    const newRow = admin.locator('.ant-table-tbody tr').filter({ hasText: '界面联调新关卡' });
    await newRow.getByRole('button', { name: /发\s*布/ }).click();
    await admin.getByRole('button', { name: '发布关卡', exact: true }).click();
    await admin.getByText('新版本已发布', { exact: true }).waitFor();
    const liveLevels = await game.evaluate(() => window.qaApp.online.request('/user/levels'));
    assert(liveLevels.some((l) => l.title === '界面联调新关卡' && l.ordinal === 3));
    await admin.screenshot({ path: path.join(out, 'admin-levels.png'), fullPage: true });
    checks.push('new level saved, validated, published and visible through game API');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(out, 'browser-qa.json'),
      JSON.stringify({ ok: true, checks, summary, errors }, null, 2),
    );
    console.log(JSON.stringify({ ok: true, checks }));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  server.close();
  process.exitCode = 1;
});
