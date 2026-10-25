// Real built admin against an isolated PostgreSQL-backed API; never use production accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
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
if (!playwright) throw new Error('Playwright is required for the admin integration check');
const root = path.resolve(__dirname, '..');
const built = path.join(root, 'admin/dist');
const output = path.join(root, 'artifacts/admin-identity');
const upstream = process.env.QA_API_ORIGIN;
if (!upstream) throw new Error('Run TestAdminIdentityBrowserIntegration with BROWSER_QA=1');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
};
const server = http.createServer((request, response) => {
  if (request.url.startsWith('/api/')) {
    const proxy = http.request(
      upstream + (request.url === '/api/health' ? '/health' : request.url),
      {
        method: request.method,
        headers: { ...request.headers, origin: 'http://127.0.0.1:5173' },
      },
      (result) => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      },
    );
    proxy.on('error', () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(proxy);
    return;
  }
  const pathname = decodeURIComponent(request.url.split('?')[0]);
  let file = path.resolve(built, pathname.replace(/^\/admin\/?/, '') || 'index.html');
  if (!file.startsWith(built + path.sep) && file !== built) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = path.join(built, 'index.html');
  response.writeHead(200, {
    'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
  });
  response.end(fs.readFileSync(file));
});

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await playwright.chromium.launch({ headless: true });
  const checks = [];
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const login = async (password) => {
      await page.goto(origin + '/admin/');
      await page.getByLabel('管理账号').fill('qa-admin');
      await page.getByLabel('密码', { exact: true }).fill(password);
      await page.getByRole('button', { name: '登录控制台' }).click();
      await page.getByRole('heading', { name: '用户管理', exact: true }).waitFor();
    };
    const personalSettings = async () => {
      await page.getByRole('button', { name: '账户菜单' }).click();
      await page.getByRole('menuitem', { name: '个人设置' }).click();
      const dialog = page.getByRole('dialog', { name: '个人设置' });
      await dialog.waitFor();
      await dialog.getByLabel('当前密码', { exact: true }).click();
      await page.waitForFunction(() => {
        const element = document.querySelector('.personal-settings-modal');
        if (!element) return false;
        const style = getComputedStyle(element);
        return style.opacity === '1' && style.transform === 'none';
      });
      return dialog;
    };
    const endpoint = async (method, pathname, body, headers = {}) => {
      const response = await context.request.fetch(origin + '/api/v1' + pathname, {
        method,
        headers,
        ...(body === undefined ? {} : { data: body }),
      });
      return response;
    };
    await login('qa-password-123');
    const players = await (await endpoint('GET', '/admin/users')).json();
    assert.equal(players.total, 0, 'fresh administrator must not be listed as a player');
    await page.getByRole('menuitem', { name: '管理员账号', exact: true }).click();
    await page.getByRole('heading', { name: '管理员账号', exact: true }).waitFor();
    await page.getByRole('button', { name: '新增管理员', exact: true }).click();
    const account = page.getByRole('dialog');
    await account.getByLabel('管理员账号', { exact: true }).fill('qa-secondary');
    await account.getByLabel('初始密码', { exact: true }).fill('qa-secondary-password-123');
    await account.getByLabel('昵称', { exact: true }).fill('后台验证管理员');
    await account.getByRole('button', { name: '保存', exact: true }).click();
    await account.waitFor({ state: 'hidden' });
    await page.getByRole('cell', { name: 'qa-secondary', exact: true }).waitFor();
    const accounts = await (await endpoint('GET', '/admin/accounts')).json();
    assert.equal(accounts.total, 2);
    assert.equal((await (await endpoint('GET', '/admin/users')).json()).total, 0);
    await page.screenshot({
      path: path.join(output, 'administrator-accounts.png'),
      fullPage: true,
      animations: 'disabled',
    });
    checks.push('administrator creation and list are separate from players');

    let settings = await personalSettings();
    await settings.getByText('尚未配置', { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(output, 'personal-settings.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await settings.getByRole('button', { name: '生成新 Token', exact: true }).click();
    const generated = settings.getByLabel('本次生成的 Token', { exact: true });
    await generated.waitFor();
    const token = await generated.inputValue();
    assert.ok(token.length >= 32);
    const bearer = { Authorization: `Bearer ${token}` };
    assert.equal((await endpoint('GET', '/admin/accounts', undefined, bearer)).status(), 200);
    assert.equal(
      (
        await endpoint('GET', '/admin/accounts', undefined, { Authorization: 'Bearer invalid' })
      ).status(),
      401,
      'invalid explicit Bearer must not fall back to the logged-in cookie',
    );
    const playerLogin = await endpoint('POST', '/auth/wechat', { code: 'qa-admin-token-player' });
    const player = await playerLogin.json();
    const assets = await endpoint('GET', '/user/assets', undefined, {
      ...bearer,
      'X-User-ID': player.user.id,
    });
    assert.equal(assets.status(), 200);
    assert.equal(
      (await endpoint('GET', '/admin/auth/access-token')).status(),
      200,
      'token use does not revoke the UI session',
    );
    await settings
      .locator('.ant-modal-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    await settings.waitFor({ state: 'hidden' });
    settings = await personalSettings();
    assert.equal(await settings.getByLabel('本次生成的 Token', { exact: true }).count(), 0);
    await settings.getByRole('button', { name: '撤销 Token', exact: true }).click();
    await page.getByRole('button', { name: '确认撤销', exact: true }).click();
    await settings.getByText('尚未配置', { exact: true }).waitFor();
    assert.equal((await endpoint('GET', '/admin/accounts', undefined, bearer)).status(), 401);
    const custom = randomBytes(24).toString('hex');
    await settings.getByLabel('自定义 Token', { exact: true }).fill(custom);
    await settings.getByRole('button', { name: '保存自定义 Token', exact: true }).click();
    await settings.getByLabel('本次生成的 Token', { exact: true }).waitFor();
    assert.ok((await settings.getByLabel('本次生成的 Token').inputValue()) === custom);
    assert.equal(
      (
        await endpoint('GET', '/admin/settings', undefined, { Authorization: `Bearer ${custom}` })
      ).status(),
      200,
    );
    await settings
      .locator('.ant-modal-footer')
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    await settings.waitFor({ state: 'hidden' });
    checks.push(
      'personal token generation, one-time display, custom value, all API access and revocation',
    );

    await page.getByRole('menuitem', { name: '接口文档', exact: true }).click();
    const swagger = page.frameLocator('iframe[title="交互式 API 文档"]');
    await swagger.locator('.swagger-ui .opblock').first().waitFor({ timeout: 30000 });
    const specResponse = await endpoint('GET', '/openapi.json');
    const spec = await specResponse.json();
    const operationCount = Object.values(spec.paths).reduce(
      (count, item) =>
        count +
        Object.keys(item).filter((key) => /^(get|post|put|patch|delete|head|options)$/.test(key))
          .length,
      0,
    );
    assert.equal(await swagger.locator('.swagger-ui .opblock').count(), operationCount);
    const tryOperation = async (pathname) => {
      const operation = swagger.locator('.opblock').filter({ hasText: pathname }).first();
      await operation.locator('.opblock-summary').click();
      await operation.getByRole('button', { name: 'Try it out', exact: true }).click();
      const response = page.waitForResponse(
        (result) => new URL(result.url()).pathname === pathname,
      );
      await operation.getByRole('button', { name: 'Execute', exact: true }).click();
      return response;
    };
    assert.equal((await tryOperation('/api/v1/info')).status(), 200);
    await swagger
      .locator('.auth-wrapper')
      .getByRole('button', { name: /Authorize/ })
      .click();
    const tokenAuthorization = swagger.locator('.auth-container').filter({ hasText: 'AdminToken' });
    await tokenAuthorization.getByRole('textbox').fill(custom);
    await tokenAuthorization
      .getByRole('button', { name: 'Apply credentials', exact: true })
      .click();
    await tokenAuthorization.locator('.btn-done').click();
    const authorizedCall = await tryOperation('/api/v1/admin/settings');
    assert.equal(authorizedCall.status(), 200);
    assert.ok(authorizedCall.request().headers().authorization === `Bearer ${custom}`);
    const skill = await context.request.get(origin + '/admin/SKILL.md');
    assert.equal(skill.status(), 200);
    assert.match(skill.headers()['content-type'], /text\/markdown/);
    assert.equal(await skill.text(), fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8'));
    await page.screenshot({
      path: path.join(output, 'api-documentation.png'),
      fullPage: false,
      animations: 'disabled',
    });
    checks.push(
      'Swagger renders every operation, executes public/token API calls, and SKILL.md is served verbatim',
    );

    settings = await personalSettings();
    await settings.getByLabel('当前密码', { exact: true }).fill('incorrect-current-password');
    await settings.getByLabel('新密码', { exact: true }).fill('qa-updated-password-456');
    await settings.getByLabel('确认新密码', { exact: true }).fill('qa-updated-password-456');
    const rejectedPassword = page.waitForResponse(
      (result) => new URL(result.url()).pathname === '/api/v1/admin/auth/password',
    );
    await settings.getByRole('button', { name: '更新密码', exact: true }).click();
    assert.equal((await rejectedPassword).status(), 401);
    await page.getByText('当前密码不正确', { exact: true }).waitFor();
    assert.ok(await settings.isVisible());
    await settings.getByLabel('当前密码', { exact: true }).fill('qa-password-123');
    await settings.getByRole('button', { name: '更新密码', exact: true }).click();
    await page.getByRole('button', { name: '登录控制台' }).waitFor();
    assert.equal((await endpoint('GET', '/admin/auth/me')).status(), 401);
    assert.equal(
      (
        await endpoint('GET', '/admin/auth/me', undefined, { Authorization: `Bearer ${custom}` })
      ).status(),
      401,
    );
    assert.equal(
      (
        await endpoint('POST', '/admin/auth/login', {
          username: 'qa-admin',
          password: 'qa-password-123',
        })
      ).status(),
      401,
    );
    await login('qa-updated-password-456');
    await page.setViewportSize({ width: 390, height: 844 });
    settings = await personalSettings();
    await settings.getByText('尚未配置', { exact: true }).waitFor();
    assert.ok(await settings.isVisible());
    await page.screenshot({
      path: path.join(output, 'personal-settings-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    });
    assert.deepEqual(errors, []);
    checks.push('password change invalidates old passwords/sessions/tokens; mobile modal works');
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({ ok: true, checks }, null, 2),
    );
    console.log(JSON.stringify({ ok: true, checks }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
