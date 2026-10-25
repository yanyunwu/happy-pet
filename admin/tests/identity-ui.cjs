// Focused UI contract checks. Build the admin app before running this file.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
let playwright;
for (const location of [
  'playwright',
  'C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
]) {
  try {
    playwright = require(location);
    break;
  } catch {}
}
if (!playwright) throw new Error('Playwright is required for the administrator UI checks');
const { chromium } = playwright;

const dist = path.resolve(__dirname, '../dist');
const output = path.resolve(__dirname, '../../artifacts/qa-admin-identity');
const now = '2026-10-25T01:00:00Z';
const admin = {
  id: 'admin-1',
  username: 'qa-admin',
  nickname: '管理测试',
  status: 'active',
  remark: '',
  createdAt: now,
  updatedAt: now,
  lastLoginAt: now,
  deletedAt: null,
};
const player = {
  ...admin,
  username: 'qa-player',
  nickname: '玩家测试',
  role: 'user',
  source: 'manual',
  avatarUrl: '',
};
const generated = 'generated-access-token-for-browser-qa-123456789';
const custom = 'custom-access-token-for-browser-qa-123456789';
const requests = [];
let accounts = [admin];
let token = { configured: false, hint: '', updatedAt: null };
const spec = {
  openapi: '3.0.3',
  info: { title: '管理 API', version: '1.0.0' },
  servers: [{ url: '/api/v1' }],
  components: { securitySchemes: { AdminBearer: { type: 'http', scheme: 'bearer' } } },
  paths: {
    '/admin/accounts': {
      get: {
        tags: ['管理员'],
        summary: '列出管理员账号',
        security: [{ AdminBearer: [] }],
        responses: { 200: { description: '成功' } },
      },
    },
    '/user/me': {
      get: {
        tags: ['玩家'],
        summary: '查看目标玩家',
        security: [{ AdminBearer: [] }],
        parameters: [{ name: 'X-User-ID', in: 'header', schema: { type: 'string' } }],
        responses: { 200: { description: '成功' } },
      },
    },
  },
};
const mime = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.md': 'text/markdown; charset=utf-8',
};
const server = http.createServer((req, res) => {
  let file = path.resolve(
    dist,
    decodeURIComponent(req.url.split('?')[0].replace(/^\/admin\/?/, '')) || 'index.html',
  );
  if (!file.startsWith(dist + path.sep) && file !== dist) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  assert(fs.existsSync(path.join(dist, 'index.html')), 'Build admin before UI QA');
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  page.setDefaultTimeout(10000);
  const errors = [];
  const external = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (!request.url().startsWith(origin)) external.push(request.url());
  });
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const body = route.request().postDataJSON();
    requests.push({
      path: url.pathname,
      method,
      body,
      authorization: route.request().headers().authorization,
    });
    const json = (value) => route.fulfill({ status: 200, json: value });
    const empty = () => route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/auth/me')) return json(admin);
    if (url.pathname.endsWith('/users/stats'))
      return json({ total: 1, wechat: 0, disabled: 0, today: 1 });
    if (url.pathname.endsWith('/admin/users'))
      return json({ items: [player], total: 1, page: 1, pageSize: 20 });
    if (url.pathname.endsWith('/openapi.json')) return json(spec);
    if (url.pathname.endsWith('/auth/access-token')) {
      if (method === 'GET') return json(token);
      if (method === 'DELETE') {
        token = { configured: false, hint: '', updatedAt: null };
        return empty();
      }
      const accessToken = body.accessToken || generated;
      token = { configured: true, hint: `••••${accessToken.slice(-6)}`, updatedAt: now };
      return json({ accessToken, hint: token.hint, updatedAt: now });
    }
    if (url.pathname.endsWith('/auth/password')) {
      if (body.currentPassword === 'wrong-current-password')
        return route.fulfill({
          status: 401,
          json: { error: { code: 'INVALID_CREDENTIALS', message: '当前密码不正确' } },
        });
      return empty();
    }
    if (url.pathname.endsWith('/admin/accounts')) {
      if (method === 'POST') {
        const added = { ...admin, ...body, id: 'admin-2' };
        delete added.password;
        accounts.push(added);
        return json(added);
      }
      const status = url.searchParams.get('status');
      const items = accounts.filter((account) =>
        status === 'deleted'
          ? !!account.deletedAt
          : !account.deletedAt && (!status || account.status === status),
      );
      return json({ items, total: items.length, page: 1, pageSize: 20 });
    }
    if (url.pathname.endsWith('/accounts/admin-2')) {
      if (method === 'PATCH') {
        accounts[1] = { ...accounts[1], ...body };
        return json(accounts[1]);
      }
      if (method === 'DELETE') {
        accounts[1].deletedAt = now;
        accounts[1].status = 'disabled';
        return empty();
      }
      return json(accounts[1]);
    }
    if (url.pathname.endsWith('/accounts/admin-2/restore')) {
      accounts[1].deletedAt = null;
      return json(accounts[1]);
    }
    if (url.pathname.endsWith('/accounts/admin-2/password')) return empty();
    return route.fulfill({
      status: 404,
      json: { error: { code: 'QA_UNEXPECTED_REQUEST', message: url.pathname } },
    });
  });
  const settings = async () => {
    await page.getByRole('button', { name: '账户菜单', exact: true }).click();
    await page.getByRole('menuitem', { name: '个人设置', exact: true }).click();
    await page.getByRole('dialog', { name: '个人设置', exact: true }).waitFor();
  };
  const closeSettings = async () => {
    await page
      .getByRole('dialog', { name: '个人设置', exact: true })
      .getByRole('button', { name: '关闭', exact: true })
      .last()
      .click();
    await page.getByRole('dialog', { name: '个人设置', exact: true }).waitFor({ state: 'hidden' });
  };
  try {
    await page.goto(origin + '/admin/users');
    await page.getByRole('heading', { name: '用户管理', exact: true }).waitFor();
    await page.getByRole('button', { name: '新增玩家账号', exact: true }).waitFor();
    assert.equal(
      await page.getByText('当前账号', { exact: true }).count(),
      0,
      'Player ID must never be compared with admin ID',
    );
    assert.equal(await page.getByRole('button', { name: '新增管理账号', exact: true }).count(), 0);
    await page.getByRole('menuitem', { name: '管理员账号', exact: true }).click();
    await page.getByRole('heading', { name: '管理员账号', exact: true }).waitFor();
    await page.getByText('当前账号', { exact: true }).waitFor();
    await page.getByRole('button', { name: '新增管理员', exact: true }).click();
    await page.getByLabel('管理员账号', { exact: true }).fill('qa-second');
    await page.getByLabel('初始密码', { exact: true }).fill('initial-password-123');
    await page.getByLabel('昵称', { exact: true }).fill('第二管理员');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '第二管理员', exact: true }).waitFor();
    assert(
      requests.some(
        (r) =>
          r.path.endsWith('/admin/accounts') &&
          r.method === 'POST' &&
          r.body.username === 'qa-second',
      ),
    );

    const secondAccount = page.locator('tr[data-row-key="admin-2"]');
    await secondAccount.getByRole('button', { name: '编辑', exact: true }).click();
    await page.getByLabel('内部备注', { exact: true }).fill('账号维护测试');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(accounts[1].remark, '账号维护测试');
    await secondAccount.getByRole('button', { name: '更多操作：第二管理员', exact: true }).click();
    await page.getByRole('menuitem', { name: '重置密码' }).click();
    await page.getByLabel('新密码', { exact: true }).fill('account-reset-password-123');
    await page.getByLabel('确认新密码', { exact: true }).fill('account-reset-password-123');
    await page.getByRole('button', { name: '确认重置', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert(
      requests.some(
        (request) =>
          request.path.endsWith('/accounts/admin-2/password') &&
          request.body.password === 'account-reset-password-123',
      ),
    );
    await secondAccount.getByRole('button', { name: '更多操作：第二管理员', exact: true }).click();
    await page.getByRole('menuitem', { name: '停用管理员' }).click();
    await page.getByRole('button', { name: /^确\s*认$/ }).click();
    await secondAccount.getByText('已停用', { exact: true }).waitFor();
    await secondAccount.getByRole('button', { name: '更多操作：第二管理员', exact: true }).click();
    await page.getByRole('menuitem', { name: '移入回收站' }).click();
    await page.getByRole('button', { name: /^确\s*认$/ }).click();
    await secondAccount.waitFor({ state: 'hidden' });
    await page.getByRole('combobox', { name: '管理员状态', exact: true }).click();
    await page.getByText('已删除', { exact: true }).click();
    await secondAccount.getByRole('button', { name: '恢复' }).click();
    await page.getByRole('button', { name: /^确\s*认$/ }).click();
    await secondAccount.waitFor({ state: 'hidden' });
    assert.equal(accounts[1].deletedAt, null);
    assert.equal(accounts[1].status, 'disabled');

    await settings();
    await page.getByLabel('当前密码', { exact: true }).fill('current-password-123');
    await page.getByLabel('新密码', { exact: true }).fill('new-password-123');
    await page.getByLabel('确认新密码', { exact: true }).fill('mismatching-password');
    await page.getByRole('button', { name: '更新密码', exact: true }).click();
    await page.getByText('两次输入的新密码不一致', { exact: true }).waitFor();
    assert(!requests.some((r) => r.path.endsWith('/auth/password')));
    await page.getByLabel('当前密码', { exact: true }).fill('wrong-current-password');
    await page.getByLabel('确认新密码', { exact: true }).fill('new-password-123');
    await page.getByRole('button', { name: '更新密码', exact: true }).click();
    await page.getByText('当前密码不正确', { exact: true }).waitFor();
    assert(await page.getByRole('dialog', { name: '个人设置', exact: true }).isVisible());
    assert.equal(await page.getByRole('button', { name: '登录控制台', exact: true }).count(), 0);
    await page.getByLabel('自定义 Token', { exact: true }).fill('invalid token');
    await page.getByRole('button', { name: '保存自定义 Token', exact: true }).click();
    await page.getByText('请输入 32–128 位无空白的可打印 ASCII 字符', { exact: true }).waitFor();
    assert(!requests.some((r) => r.path.endsWith('/auth/access-token') && r.method === 'PUT'));
    await page.getByRole('button', { name: '生成新 Token', exact: true }).click();
    await page.getByLabel('本次生成的 Token', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('本次生成的 Token', { exact: true }).inputValue(),
      generated,
    );
    await page.getByRole('button', { name: '复制 Token', exact: true }).click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), generated);
    await page.screenshot({ path: path.join(output, 'personal-settings.png'), fullPage: true });
    await closeSettings();
    await settings();
    assert.equal(await page.getByLabel('当前密码', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('新密码', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('确认新密码', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('自定义 Token', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('本次生成的 Token', { exact: true }).count(), 0);
    await page.getByLabel('自定义 Token', { exact: true }).fill(custom);
    await page.getByRole('button', { name: '保存自定义 Token', exact: true }).click();
    await page.getByRole('button', { name: '确认替换', exact: true }).click();
    await page.getByLabel('本次生成的 Token', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('本次生成的 Token', { exact: true }).inputValue(), custom);
    await page.getByRole('button', { name: '撤销 Token', exact: true }).click();
    await page.getByRole('button', { name: '确认撤销', exact: true }).click();
    await page.getByText('尚未配置', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('本次生成的 Token', { exact: true }).count(), 0);
    await closeSettings();
    assert(
      !(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(
        'access-token-for-browser-qa',
      ),
    );

    await page.getByRole('menuitem', { name: '接口文档', exact: true }).click();
    const docs = page.frameLocator('iframe[title="交互式 API 文档"]');
    await docs.locator('.swagger-ui .opblock').first().waitFor();
    assert.equal(await docs.locator('.swagger-ui .opblock').count(), 2);
    assert.equal(
      await page.getByRole('link', { name: '查看 SKILL.md', exact: true }).getAttribute('href'),
      '/admin/SKILL.md',
    );
    await page.screenshot({ path: path.join(output, 'api-docs.png'), fullPage: true });
    await docs.getByRole('button', { name: 'Authorize', exact: true }).click();
    await docs.locator('.dialog-ux input').fill(custom);
    await docs
      .locator('.dialog-ux')
      .getByRole('button', { name: 'Apply credentials', exact: true })
      .click();
    await docs.locator('.dialog-ux .btn-done').click();
    const listOperation = docs.locator('.opblock').filter({ hasText: '列出管理员账号' });
    await listOperation.locator('.opblock-summary').click();
    await listOperation.getByRole('button', { name: 'Try it out', exact: true }).click();
    const executed = page.waitForRequest(
      (request) =>
        request.url() === origin + '/api/v1/admin/accounts' &&
        request.headers().authorization === `Bearer ${custom}`,
    );
    await listOperation.getByRole('button', { name: 'Execute', exact: true }).click();
    await executed;
    await listOperation
      .locator('.responses-inner .response-col_status')
      .filter({ hasText: '200' })
      .first()
      .waitFor();
    assert(
      !(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).includes(
        custom,
      ),
    );
    await page.getByRole('menuitem', { name: '管理员账号', exact: true }).click();
    await page.getByRole('heading', { name: '管理员账号', exact: true }).waitFor();
    await page.getByRole('menuitem', { name: '接口文档', exact: true }).click();
    await docs.getByRole('button', { name: 'Authorize', exact: true }).click();
    assert.equal(
      await docs.locator('.dialog-ux input').inputValue(),
      '',
      'Swagger authorization must clear when leaving the document page',
    );
    await docs.locator('.dialog-ux .btn-done').click();
    assert.deepEqual(external, [], 'Swagger must use only local assets and no online validator');

    await page.setViewportSize({ width: 390, height: 844 });
    await settings();
    const modalBounds = await page
      .getByRole('dialog', { name: '个人设置', exact: true })
      .boundingBox();
    assert(
      modalBounds.x >= 0 && modalBounds.x + modalBounds.width <= 390,
      'Personal settings should fit narrow screens',
    );
    await page.getByLabel('当前密码', { exact: true }).fill('current-password-123');
    await page.getByLabel('新密码', { exact: true }).fill('new-password-123');
    await page.getByLabel('确认新密码', { exact: true }).fill('new-password-123');
    await page.screenshot({
      path: path.join(output, 'personal-settings-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.getByRole('button', { name: '更新密码', exact: true }).click();
    await page.getByRole('button', { name: '登录控制台', exact: true }).waitFor();
    assert.deepEqual(requests.filter((r) => r.path.endsWith('/auth/password')).at(-1).body, {
      currentPassword: 'current-password-123',
      password: 'new-password-123',
    });
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        ok: true,
        checks: [
          'player/admin separation',
          'administrator create/edit/password/disable/delete/restore',
          'password confirmation',
          'token validation/generate/copy/rotate/revoke',
          'modal secret clearing',
          'Swagger local assets and operation inventory',
          'Swagger Bearer execution and nonpersistent authorization',
          'mobile personal settings',
          'password change logs out',
        ],
      }),
    );
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    console.error(await page.locator('body').innerText());
    if (page.frames().length > 1) console.error(await page.frames()[1].locator('body').innerText());
    console.error({ errors, external, recentRequests: requests.slice(-5) });
    throw error;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
