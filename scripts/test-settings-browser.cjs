// Built admin and mini-game talking to the same isolated Go API and PostgreSQL schema.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'qa-settings');
fs.mkdirSync(output, { recursive: true });
const upstream = process.env.QA_API_ORIGIN;
if (!upstream) throw new Error('Use make test-announcement-browser for an isolated API');
for (const entry of ['admin/dist/index.html', 'minigame/build/web-mobile/index.html'])
  assert(fs.existsSync(path.join(root, entry)), `Build required before integration: ${entry}`);
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
  const isGame = req.url.startsWith('/minigame/');
  const base = path.join(root, isGame ? 'minigame/build/web-mobile' : 'admin/dist');
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
    body = Buffer.from(
      body
        .toString()
        .replace(
          /"apiBaseUrl"\s*:\s*"(?:\\.|[^"\\])*"/g,
          '"apiBaseUrl":' + JSON.stringify(`http://127.0.0.1:${server.address().port}/api/v1`),
        ),
    );
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(body);
});
(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-proxy-server', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const errors = [];
  let game;
  try {
    const admin = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    admin.on('pageerror', (error) => errors.push(error.message));
    await admin.goto(origin + '/admin/');
    await admin.getByLabel('管理账号').fill('qa-admin');
    await admin.getByLabel('密码', { exact: true }).fill('qa-password-123');
    await admin.getByRole('button', { name: '登录控制台' }).click();
    await admin.getByRole('heading', { name: '用户管理' }).waitFor();
    assert.equal(
      await admin.getByRole('menuitem', { name: '设置', exact: true }).count(),
      1,
      'admin needs the settings menu',
    );
    await admin.getByRole('menuitem', { name: '设置', exact: true }).click();
    await admin.getByRole('heading', { name: '设置', exact: true }).waitFor();
    const input = admin.getByLabel('公告正文', { exact: true });
    await input.waitFor();
    await admin.waitForFunction(() =>
      document.querySelector('textarea')?.value.includes('三种玩法'),
    );
    const save = async (text) => {
      await input.fill(text);
      const response = admin.waitForResponse(
        (r) => r.url().endsWith('/api/v1/admin/settings') && r.request().method() === 'PUT',
      );
      await admin.getByRole('button', { name: '保存设置' }).click();
      assert.equal((await response).status(), 200);
      await admin.getByRole('button', { name: '保存设置' }).waitFor({ state: 'visible' });
    };
    const announcement =
      '亲爱的小伙伴：\n\n欢迎来到快乐萌宠消！\n\n每天来森林签到，收下金币和道具；带上你的萌宠，一起挑战新的关卡。\n\n愿你今天也有消除烦恼的小快乐。';
    await save(announcement);
    await admin.reload();
    await admin.waitForFunction(
      (text) => document.querySelector('textarea')?.value === text,
      announcement,
    );
    const settings = await (await admin.request.get(origin + '/api/v1/admin/settings')).json();
    assert.equal(settings.announcement, announcement);
    assert.equal(settings.version, 2);
    await admin.screenshot({ path: path.join(output, 'admin-settings.png'), fullPage: true });
    game = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
    game.on('pageerror', (error) => errors.push(error.message));
    await game.goto(origin + '/minigame/', { waitUntil: 'networkidle' });
    await game.waitForFunction(
      () =>
        window.cc?.director.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
    );
    await game.evaluate(() => {
      window.settingsApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
      window.settingsApp.toasts.reset();
    });
    const waitModal = (name) =>
      game.waitForFunction((name) => {
        const m = window.settingsApp.modal;
        return (
          m?.name === name &&
          Math.abs(m.scale.x - 1) < 0.001 &&
          m.getComponent('cc.UIOpacity')?.opacity === 255
        );
      }, name);
    const click = async (name) => {
      const p = await game.evaluate((name) => {
        const n = window.settingsApp.modal.getChildByName(name);
        return [n.position.x / 2, -n.position.y / 2];
      }, name);
      await game.mouse.click(...p);
    };
    const open = async () => {
      await game.mouse.click(28, 37.5);
      await waitModal('HomeMenu');
      await click('Announcements');
      await waitModal('Announcements');
    };
    const waitText = (text) =>
      game.waitForFunction(
        (text) =>
          window.settingsApp.modal
            ?.getComponentsInChildren('cc.Label')
            .map((l) => l.string)
            .join('')
            .includes(text),
        text,
      );
    const close = async () => {
      await click('Close');
      await game.waitForFunction(() => !window.settingsApp.modal);
    };
    await open();
    await waitText('愿你今天也有消除烦恼的小快乐。');
    assert.equal(
      await game.evaluate(() => !!window.settingsApp.modal.getChildByName('NewsCard')),
      false,
    );
    await game.screenshot({ path: path.join(output, 'game-announcement.png') });
    await close();
    await save('管理员更新后的正文\n\n<b>按文字显示</b>');
    await open();
    await waitText('<b>按文字显示</b>');
    await close();
    await save('');
    await open();
    await waitText('暂无公告');
    await close();
    await save(announcement);
    await open();
    await waitText('愿你今天也有消除烦恼的小快乐。');
    assert.deepEqual(errors, []);
    console.log(
      'PASS — admin menu, save/reload, persisted version, public game news refresh, literal text and empty content using one isolated API.',
    );
  } catch (error) {
    if (game) await game.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
