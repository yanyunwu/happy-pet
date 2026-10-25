// Real admin form with controlled HTTP responses; run after build-admin.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const base = path.join(root, 'admin', 'dist');
const output = path.join(root, 'artifacts', 'qa-single-rule');
assert(fs.existsSync(path.join(base, 'index.html')), 'Build admin before form QA');
fs.mkdirSync(output, { recursive: true });
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};
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
const waitHeld = async (pending, name) => {
  let timer;
  try {
    return await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${name}`)), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const legacy = {
  id: 'legacy',
  entry: 'standard',
  mode: 'classic',
  ordinal: 1,
  title: '历史多规则关卡',
  draftVersion: 1,
  revisionId: '',
  enabled: false,
  updatedAt: '2026-10-25T01:00:00Z',
  config: {
    rulesVersion: 'pet-rules-2',
    rules: [[3], [2, 2]],
    mode: 'classic',
    columns: 6,
    rows: 1,
    layers: [{ z: 0, cells: Array.from({ length: 6 }, (_, i) => ({ x: i * 2, y: 0 })) }],
    counts: [6, ...Array(14).fill(0)],
    capacity: 7,
    freeTools: { undo: 1, shovel: 1, hint: 3, shuffle: 1 },
    rewardCoins: 20,
  },
};

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const levels = [structuredClone(legacy)];
  const writes = [];
  let holdSave = null;
  let holdPreview = null;
  let replyRules = null;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/v1/admin/auth/me')
      return respond(route, 200, { id: 'qa-admin', nickname: '测试管理员', role: 'admin' });
    if (pathname === '/api/v1/admin/level-templates') return respond(route, 200, []);
    if (pathname === '/api/v1/admin/levels/preview') {
      if (holdPreview) return holdPreview.resolve(route);
      return respond(route, 200, {
        tiles: [],
        tray: [],
        reserve: [],
        status: 'playing',
        matches: 0,
        cleared: 0,
        moves: 0,
        tools: {},
        capacity: 7,
        mode: 'classic',
        rulesVersion: 'pet-rules-2',
        rules: request.postDataJSON().config.rules,
      });
    }
    if (pathname === '/api/v1/admin/levels' && request.method() === 'GET')
      return respond(route, 200, levels);
    if (pathname.startsWith('/api/v1/admin/levels') && ['PUT', 'POST'].includes(request.method())) {
      const input = request.postDataJSON();
      writes.push(input);
      if (holdSave) return holdSave.resolve(route);
      const id = request.method() === 'POST' ? `new-${levels.length}` : pathname.split('/').at(-1);
      const next = {
        ...input,
        id,
        draftVersion: input.draftVersion + (replyRules ? 0 : 1),
        revisionId: '',
        enabled: false,
        updatedAt: '2026-10-25T02:00:00Z',
        config: {
          ...input.config,
          rules:
            replyRules ||
            input.config.rules.map((pattern) => pattern.slice().sort((a, b) => b - a)),
        },
      };
      const index = levels.findIndex((item) => item.id === id);
      if (index < 0) levels.push(next);
      else levels[index] = next;
      return respond(route, 200, next);
    }
    return respond(route, 404, { error: { message: `Unexpected API: ${pathname}` } });
  });
  const save = page.getByRole('button', { name: /保存草稿$/ });
  const preview = page.getByRole('button', { name: '校验并预览', exact: true });
  const close = page.locator('.ant-drawer-extra').getByRole('button', { name: /关\s*闭/ });
  const closeDraft = async () => {
    await close.click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  };
  const choice = (name) => page.getByRole('radio', { name, exact: true });
  const select = (name) =>
    page
      .locator('.rule-editor label')
      .filter({ has: choice(name) })
      .click();
  const custom = page.getByLabel('其他消除组合', { exact: true });
  const openLegacy = () =>
    page
      .locator('tr[data-row-key="legacy"]')
      .getByRole('button', { name: '编辑', exact: true })
      .click();
  const waitUnlocked = () =>
    page.waitForFunction(() => {
      const editor = document.querySelector('.rule-editor');
      return (
        editor &&
        !editor.disabled &&
        [...editor.querySelectorAll('input')].every((input) => !input.disabled)
      );
    });
  const saveRules = async (expected) => {
    assert.equal(
      await save.isEnabled(),
      true,
      `valid selection must enable saving: ${JSON.stringify(expected)}`,
    );
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/admin/levels') &&
          ['PUT', 'POST'].includes(r.request().method()),
      ),
      save.click(),
    ]);
    assert.equal(response.status(), 200);
    await waitUnlocked();
    assert.deepEqual(
      writes.at(-1).config.rules,
      expected,
      'saving must send exactly the selected combination',
    );
  };
  try {
    await page.goto(origin + '/admin/levels', { waitUntil: 'networkidle' });
    await openLegacy();
    assert.equal(
      await save.isDisabled(),
      true,
      'legacy multiple rules require an explicit single selection',
    );
    assert.equal(await preview.isDisabled(), true);
    await page.getByText('每关只能选择一种消除规则，请重新选择', { exact: true }).waitFor();
    assert.equal(await page.locator('.rule-editor input[type="radio"]:checked').count(), 0);
    assert.equal(await page.getByRole('button', { name: '添加规则', exact: true }).count(), 0);
    assert.deepEqual(
      levels[0].config.rules,
      [[3], [2, 2]],
      'opening must not silently truncate legacy rules',
    );

    for (const [name, expected] of [
      ['3', [[3]]],
      ['4', [[4]]],
      ['2+2', [[2, 2]]],
    ]) {
      await select(name);
      assert.equal(await page.locator('.rule-editor input[type="radio"]:checked').count(), 1);
      await saveRules(expected);
    }
    await select('其他');
    assert.equal(await custom.inputValue(), '');
    assert.equal(await save.isDisabled(), true);
    for (const invalid of ['1', '8', '1.5', '0+2', '-1+3', '2++2', '2+6', '2e0', '3/2', '']) {
      await custom.fill(invalid);
      assert.equal(
        await save.isDisabled(),
        true,
        `invalid combination must block save: ${invalid}`,
      );
      assert.equal(
        await preview.isDisabled(),
        true,
        `invalid combination must block preview: ${invalid}`,
      );
    }
    await custom.pressSequentially('3+2');
    assert.equal(
      await choice('其他').isChecked(),
      true,
      'typing 3 must not close Other before +2 is entered',
    );
    assert.equal(await custom.inputValue(), '3+2');
    await saveRules([[3, 2]]);
    await custom.fill('2＋2＋2');
    await saveRules([[2, 2, 2]]);
    await custom.fill(' 2 + 3 ');
    await saveRules([[2, 3]]);
    assert.equal(
      await custom.inputValue(),
      '3+2',
      'server-normalized controlled values must replace stale input text',
    );

    // Keep the same editor instance to exercise controlled prop updates directly.
    await custom.fill('3');
    replyRules = [[4]];
    await saveRules([[3]]);
    assert.equal(await choice('4').isChecked(), true);
    replyRules = [[3]];
    await saveRules([[4]]);
    assert.equal(
      await choice('3').isChecked(),
      true,
      'controlled changes back to a prior rule must not revive stale Other input',
    );
    assert.equal(await custom.count(), 0);
    replyRules = null;
    await select('其他');
    await custom.fill('3+2');
    await saveRules([[3, 2]]);

    holdSave = deferred();
    await save.click();
    const pendingSave = await waitHeld(holdSave.promise, 'held save');
    for (const name of ['3', '4', '2+2', '其他'])
      assert.equal(await choice(name).isDisabled(), true);
    assert.equal(await custom.isDisabled(), true);
    assert.equal(await preview.isDisabled(), true);
    assert.equal(await close.isDisabled(), true);
    holdSave = null;
    await respond(pendingSave, 503, { error: { message: '保存暂不可用' } });
    await page.getByText('保存暂不可用', { exact: true }).waitFor();
    await waitUnlocked();
    assert.equal(await custom.inputValue(), '3+2');
    assert.equal(await custom.isEnabled(), true);
    await select('4');
    await saveRules([[4]]);

    holdPreview = deferred();
    await preview.click();
    const pendingPreview = await waitHeld(holdPreview.promise, 'held preview');
    assert.deepEqual(pendingPreview.request().postDataJSON().config.rules, [[4]]);
    for (const name of ['3', '4', '2+2', '其他'])
      assert.equal(await choice(name).isDisabled(), true);
    holdPreview = null;
    await respond(pendingPreview, 422, { error: { message: '请调整萌宠数量' } });
    await page.getByText('请调整萌宠数量', { exact: true }).waitFor();
    await waitUnlocked();
    assert.equal(await choice('4').isChecked(), true);
    await closeDraft();
    await openLegacy();
    assert.equal(await choice('4').isChecked(), true, 'reopening must reflect the saved preset');
    assert.equal(await custom.count(), 0);
    await select('其他');
    await custom.fill('2+2+2');
    await closeDraft();
    await openLegacy();
    assert.equal(await choice('4').isChecked(), true, 'reopening must discard unsaved Other text');
    await closeDraft();

    await page.getByLabel('玩法入口', { exact: true }).click();
    await page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')
      .getByText('趣味规则消', { exact: true })
      .click();
    await page.getByRole('button', { name: '新增关卡' }).click();
    assert.equal(await choice('2+2').isChecked(), true, 'new fun levels default to two pairs only');
    assert.equal(await page.getByLabel('鼠数量', { exact: true }).inputValue(), '2');
    assert.equal(await page.getByLabel('牛数量', { exact: true }).inputValue(), '2');
    await page.getByText('格子 4 个 · 萌宠 4 块 · 2 种', { exact: true }).waitFor();
    await saveRules([[2, 2]]);
    assert.equal(writes.at(-1).config.layers[0].cells.length, 4);
    assert.deepEqual(writes.at(-1).config.counts, [2, 2, ...Array(13).fill(0)]);
    await page.screenshot({
      path: path.join(output, 'admin-single-rule.png'),
      fullPage: true,
      animations: 'disabled',
    });
    assert.deepEqual(errors, []);
    console.log(
      'PASS — single preset/Other selection, validation, legacy choice, save/preview locks, recovery, reopen and valid fun defaults.',
    );
  } catch (error) {
    fs.writeFileSync(path.join(output, 'admin-single-rule-failure.html'), await page.content());
    fs.writeFileSync(
      path.join(output, 'admin-single-rule-failure-aria.txt'),
      await page.locator('body').ariaSnapshot(),
    );
    await page
      .screenshot({ path: path.join(output, 'admin-single-rule-failure.png'), fullPage: true })
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
