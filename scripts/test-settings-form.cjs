// Settings form behavior against controlled HTTP responses; run after build-admin.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root = path.resolve(__dirname, '..');
const base = path.join(root, 'admin', 'dist');
const output = path.join(root, 'artifacts', 'qa-settings');
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
};
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  let file = path.resolve(
    base,
    decodeURIComponent(req.url.split('?')[0].replace(/^\/admin\/?/, '')) || 'index.html',
  );
  if (!file.startsWith(base + path.sep) && file !== base) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(base, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const respond = (route, status, json) => route.fulfill({ status, json });
const inspectLayout = () => ({
  viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
  document: {
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    bodyHeight: document.body.scrollHeight,
  },
  desktopSidebar: !!document.querySelector('.admin-sider'),
  fonts: document.fonts.status,
  animations: document.getAnimations().map((animation) => ({
    state: animation.playState,
    target: animation.effect?.target?.outerHTML?.slice(0, 600),
  })),
  overflow: [...document.querySelectorAll('body *')]
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        tag: element.tagName,
        id: element.id,
        class: element.getAttribute('class'),
        rect: rect.toJSON(),
        position: style.position,
        visibility: style.visibility,
        opacity: style.opacity,
        display: style.display,
        css: element.getAttribute('style'),
        html: element.outerHTML.slice(0, 400),
      };
    })
    .filter((element) => element.rect.right > innerWidth || element.rect.left < 0),
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const waitForStillPage = async () => {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((animation) => animation.playState !== 'running' && !animation.pending),
    );
  };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let settings = {
    announcement: '原始公告\n保留换行',
    version: 7,
    updatedAt: '2026-10-25T01:00:00Z',
  };
  let loadMode = 'hold';
  let saveMode = 'failure';
  const heldLoad = deferred();
  const heldSave = deferred();
  const writes = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/admin/auth/me')
      return respond(route, 200, { id: 'qa-admin', nickname: '测试管理员', role: 'admin' });
    if (pathname === '/api/v1/admin/settings') {
      if (request.method() === 'GET') {
        if (loadMode === 'hold') return heldLoad.resolve(route);
        if (loadMode === 'failure')
          return respond(route, 503, { error: { message: '重新加载暂不可用' } });
        return respond(route, 200, settings);
      }
      const input = request.postDataJSON();
      writes.push(input);
      if (saveMode === 'hold') return heldSave.resolve(route);
      if (saveMode === 'failure')
        return respond(route, 503, { error: { message: '保存服务暂不可用' } });
      if (saveMode === 'conflict')
        return respond(route, 409, {
          error: { code: 'CONFLICT', message: '公告已被其他管理员更新，请刷新后重试' },
        });
      assert.equal(input.version, settings.version);
      settings = { ...input, version: input.version + 1, updatedAt: '2026-10-25T03:00:00Z' };
      return respond(route, 200, settings);
    }
    if (pathname === '/api/v1/admin/users/stats')
      return respond(route, 200, { total: 0, wechat: 0, disabled: 0, today: 0 });
    return respond(route, 200, { items: [], total: 0, page: 1, pageSize: 20 });
  });
  try {
    await page.goto(origin + '/admin/settings', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '设置', exact: true }).waitFor();
    const input = page.getByLabel('公告正文', { exact: true });
    const save = page.getByRole('button', { name: '保存设置', exact: true });
    const valueIs = (value) =>
      page.waitForFunction((value) => document.querySelector('textarea')?.value === value, value);
    assert.equal(await input.isDisabled(), true, 'loading must lock the draft');
    assert.equal(await save.isDisabled(), true, 'loading must block saving');
    await respond(await heldLoad.promise, 503, { error: { message: '读取服务暂不可用' } });
    await page.getByText('读取服务暂不可用', { exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true, 'failed initial load must not save an empty draft');
    loadMode = 'success';
    await page.getByRole('button', { name: '重试加载', exact: true }).click();
    await valueIs(settings.announcement);
    assert.equal(await input.isEnabled(), true);

    await input.fill('🐼'.repeat(2000));
    await page.getByText('2000 / 2000', { exact: true }).waitFor();
    assert.equal(await save.isEnabled(), true, 'non-BMP characters count as one code point');
    await input.fill('🐼'.repeat(2001));
    await page.getByText('公告不能超过 2000 个字符', { exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);
    await input.fill('公告\u0007');
    await page.getByText('公告不能包含控制字符', { exact: true }).waitFor();
    assert.equal(await save.isDisabled(), true);

    const draft = '草稿 🐼\n\t<b>保留纯文字</b>';
    await input.fill(draft);
    await save.click();
    await page.getByText('保存服务暂不可用', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), draft, 'failed save must preserve the draft');
    assert.deepEqual(writes[0], { announcement: draft, version: 7 });

    saveMode = 'hold';
    await page.locator('form').evaluate((form) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    const pendingSave = await heldSave.promise;
    assert.equal(await input.isDisabled(), true, 'input must be locked while saving');
    settings = { announcement: draft, version: 8, updatedAt: '2026-10-25T02:00:00Z' };
    await respond(pendingSave, 200, settings);
    await page.getByText('设置已保存', { exact: true }).waitFor();
    assert.equal(writes.length, 2, 'two immediate submits must make one request');
    await page.getByText(/2026\/10\/25.*10:00:00/).waitFor();

    saveMode = 'success';
    await input.fill('');
    await save.click();
    await page.waitForFunction(() => !document.querySelector('textarea')?.disabled);
    assert.deepEqual(
      writes[2],
      { announcement: '', version: 8 },
      'a successful save updates the version for the next save',
    );
    await valueIs('');

    saveMode = 'conflict';
    const conflictDraft = '冲突后仍保留我的编辑';
    await input.fill(conflictDraft);
    await save.click();
    await page.getByText('公告已被其他管理员更新，请刷新后重试', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), conflictDraft);
    assert.equal(await save.isDisabled(), true, 'stale drafts require explicit reload');
    loadMode = 'failure';
    await page.getByRole('button', { name: '重新加载公告', exact: true }).click();
    await page.getByText('重新加载暂不可用', { exact: true }).waitFor();
    assert.equal(await input.inputValue(), conflictDraft, 'failed reload also preserves the draft');
    assert.equal(await save.isDisabled(), true);
    settings = {
      announcement: '另一位管理员保存的内容',
      version: 12,
      updatedAt: '2026-10-25T03:00:00Z',
    };
    loadMode = 'success';
    await page.getByRole('button', { name: '重试加载', exact: true }).click();
    await valueIs(settings.announcement);
    saveMode = 'success';
    await input.fill('重新加载后更新');
    await save.click();
    await page.waitForFunction(() => !document.querySelector('textarea')?.disabled);
    assert.equal(writes.at(-1).version, 12);

    await page.setViewportSize({ width: 390, height: 844 });
    // Grid.useBreakpoint removes the desktop sidebar after the viewport resize event.
    await page.locator('.admin-sider').waitFor({ state: 'detached' });
    await waitForStillPage();
    const mobileLayout = await page.evaluate(inspectLayout);
    fs.writeFileSync(
      path.join(output, 'admin-settings-mobile-layout.json'),
      JSON.stringify(mobileLayout, null, 2),
    );
    assert.equal(
      mobileLayout.document.width <= mobileLayout.viewport.width,
      true,
      `mobile overflow: ${JSON.stringify(mobileLayout)}`,
    );
    await page.screenshot({ path: path.join(output, 'admin-settings-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: '切换到深色模式', exact: true }).click();
    await waitForStillPage();
    await page.screenshot({ path: path.join(output, 'admin-settings-dark.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log(
      'PASS — settings loading/retry, Unicode limits, failed saves, duplicate submit, version updates, conflict/reload, mobile and dark mode.',
    );
  } catch (error) {
    fs.writeFileSync(
      path.join(output, 'admin-settings-failure-layout.json'),
      JSON.stringify(await page.evaluate(inspectLayout).catch(() => null), null, 2),
    );
    await page
      .screenshot({ path: path.join(output, 'admin-settings-form-failure.png'), fullPage: true })
      .catch(() => {});
    throw error;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
