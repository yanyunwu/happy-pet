// Built admin + isolated PostgreSQL-backed API. Fixtures belong to the Go test schema.
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
if (!playwright) throw new Error('Playwright is required');
const built = path.resolve(__dirname, '../admin/dist');
const output = path.resolve(__dirname, '../artifacts/level-analytics-integration');
const upstream = process.env.QA_API_ORIGIN;
if (!upstream) throw new Error('Run make test-level-analytics-browser');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const server = http.createServer((request, response) => {
  if (request.url.startsWith('/api/')) {
    const proxy = http.request(
      upstream + request.url,
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(origin + '/admin/');
    await page.getByLabel('管理账号').fill('qa-admin');
    await page.getByLabel('密码', { exact: true }).fill('qa-password-123');
    await page.getByRole('button', { name: '登录控制台' }).click();
    await page.getByRole('heading', { name: '用户管理', exact: true }).waitFor();
    await page.getByRole('menuitem', { name: '关卡管理' }).click();
    const row = page.getByRole('row').filter({ hasText: '数据分析验收关卡' });
    await row.getByRole('button', { name: '数据分析', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '关卡数据分析' });
    const metric = (name, value) =>
      drawer.getByLabel(name, { exact: true }).getByText(value, { exact: true }).waitFor();
    await metric('通过率', '40.0%');
    await metric('开局次数', '5');
    await metric('参与人数', '2');
    await metric('通关次数', '2');
    await metric('平均通关耗时', '1分30秒');
    await metric('平均通关步数', '12.0');
    await drawer.getByText('已结束对局通过率 50.0%', { exact: true }).waitFor();
    const hints = drawer
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: '提示', exact: true }) });
    assert.deepEqual(await hints.getByRole('cell').allTextContents(), ['提示', '3', '2']);
    const response = await page.request.get(
      origin + '/api/v1/admin/levels/standard-classic-1/analytics',
    );
    assert.equal(response.status(), 200);
    const actual = await response.json();
    assert.equal(actual.summary.attempts, 5);
    assert.equal(actual.summary.unfinished, 1);
    await page.screenshot({
      path: path.join(output, 'desktop.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await drawer.getByText('近7天', { exact: true }).click();
    await metric('通过率', '40.0%');
    await drawer.getByText('每日明细', { exact: true }).click();
    const day = actual.daily.find((entry) => entry.attempts === 5);
    const dayRow = drawer
      .getByRole('row')
      .filter({ has: page.getByRole('cell', { name: day.date, exact: true }) });
    assert.deepEqual(await dayRow.getByRole('cell').allTextContents(), [
      day.date,
      '5',
      '2',
      '1',
      '1',
      '1',
      '40.0%',
    ]);
    await drawer.getByText('全部', { exact: true }).click();
    await metric('开局次数', '6');
    await metric('通过率', '50.0%');
    await drawer.getByText('最近90天趋势', { exact: true }).waitFor();
    await drawer.getByRole('combobox', { name: '发布版本' }).click();
    await page.getByText('v1 · 历史版本', { exact: true }).click();
    await metric('通过率', '66.7%');
    await drawer.getByText('近7天', { exact: true }).click();
    await metric('开局次数', '2');
    await metric('通过率', '50.0%');
    await drawer.getByRole('button', { name: '关闭分析' }).click();
    await page
      .getByRole('row')
      .filter({ hasText: '暂无样本的草稿' })
      .getByRole('button', { name: '数据分析', exact: true })
      .click();
    await drawer.getByText('暂无对局数据', { exact: true }).waitFor();
    await metric('通过率', '—');
    await metric('开局次数', '0');
    await drawer.getByRole('button', { name: '关闭分析' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await row.getByRole('button', { name: '数据分析', exact: true }).click();
    await metric('通过率', '40.0%');
    await page.screenshot({
      path: path.join(output, 'mobile.png'),
      fullPage: true,
      animations: 'disabled',
    });
    const bounds = await drawer.boundingBox();
    assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= 391, 'drawer fits a narrow screen');
    assert.deepEqual(errors, []);
    const checks = [
      'administrator login and per-row analytics',
      'real SQL totals, rates, unique players, duration, moves and tools',
      'daily details, calendar and revision filters, all-history totals versus 90-day trend',
      'unpublished empty level and mobile layout',
    ];
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
