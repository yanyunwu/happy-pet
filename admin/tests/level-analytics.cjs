// Built UI contract checks; the real database/API flow is tested separately.
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
const { chromium } = playwright;
const dist = path.resolve(__dirname, '../dist');
const output = path.resolve(__dirname, '../../artifacts/qa-level-analytics');
const stamp = '2026-10-25T10:00:00+08:00';
const levels = [
  { id: 'level-analysis', title: '森林小径', revisionId: 'revision-2', enabled: true },
  { id: 'level-empty', title: '等待发布的关卡', revisionId: '', enabled: false },
].map((level, i) => ({
  ...level,
  entry: 'standard',
  mode: 'classic',
  ordinal: i + 1,
  draftVersion: 2,
  updatedAt: stamp,
  config: {
    rulesVersion: 'pet-rules-2',
    rules: [[3]],
    columns: 3,
    rows: 1,
    layers: [
      {
        z: 0,
        cells: [
          { x: 0, y: 0 },
          { x: 2, y: 0 },
          { x: 4, y: 0 },
        ],
      },
    ],
    counts: [3],
    freeTools: {},
    rewardCoins: 20,
  },
}));
function fixture(id, range, revisionId) {
  const empty = id === 'level-empty';
  const attempts = empty ? 0 : revisionId ? 1 : range === '7d' ? 4 : 5;
  const won = empty ? 0 : revisionId ? 1 : 2;
  const selected = levels.find((level) => level.id === id);
  return {
    level: { ...selected, publishedRevisionId: selected.revisionId },
    range,
    revisionId,
    from: range === 'all' ? null : '2026-09-26T00:00:00+08:00',
    to: stamp,
    trendFrom: range === 'all' ? '2026-07-28' : '2026-09-26',
    timezone: 'Asia/Shanghai',
    generatedAt: stamp,
    summary: {
      attempts,
      players: empty ? 0 : 2,
      won,
      lost: attempts > 1 ? 1 : 0,
      abandoned: attempts > 1 ? 1 : 0,
      unfinished: attempts === 5 ? 1 : 0,
      winRate: attempts ? (won / attempts) * 100 : null,
      finishedWinRate: attempts ? (won / (won + (attempts > 1 ? 2 : 0))) * 100 : null,
      avgWinDurationSeconds: empty ? null : 90,
      winDurationSamples: won,
      avgWinMoves: empty ? null : 12,
    },
    daily: Array.from({ length: range === 'all' ? 90 : range === '7d' ? 7 : 30 }, (_, i) => ({
      date: new Date(Date.UTC(2026, 9, 25 - i)).toISOString().slice(0, 10),
      attempts: i === 0 ? attempts : 0,
      won: i === 0 ? won : 0,
      lost: i === 0 && attempts > 1 ? 1 : 0,
      abandoned: i === 0 && attempts > 1 ? 1 : 0,
      unfinished: i === 0 && attempts === 5 ? 1 : 0,
      winRate: i === 0 && attempts ? (won / attempts) * 100 : null,
    })).reverse(),
    revisions: empty
      ? []
      : [2, 1].map((version) => ({
          id: `revision-${version}`,
          version,
          title: selected.title,
          publishedAt: stamp,
          current: version === 2,
        })),
    tools: ['undo', 'shovel', 'hint', 'shuffle', 'unlock_slot'].map((type) => ({
      type,
      uses: !empty && type === 'hint' ? 3 : 0,
      sessions: !empty && type === 'hint' ? 2 : 0,
    })),
  };
}
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
  res.setHeader(
    'Content-Type',
    {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.woff2': 'font/woff2',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
    }[path.extname(file)] || 'application/octet-stream',
  );
  res.end(fs.readFileSync(file));
});
(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(6000);
  const errors = [],
    requests = [];
  let fail = false,
    hold = false,
    held,
    heldReady;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/admin/auth/me'))
      return route.fulfill({
        json: { id: 'qa-admin', username: 'qa-admin', nickname: '管理员', status: 'active' },
      });
    if (url.pathname.endsWith('/admin/levels')) return route.fulfill({ json: levels });
    if (url.pathname.endsWith('/admin/level-templates')) return route.fulfill({ json: [] });
    const match = url.pathname.match(/\/admin\/levels\/([^/]+)\/analytics$/);
    if (match) {
      requests.push(url);
      if (fail)
        return route.fulfill({
          status: 500,
          json: { error: { code: 'INTERNAL_ERROR', message: '统计服务暂不可用' } },
        });
      const json = fixture(
        match[1],
        url.searchParams.get('range') || '30d',
        url.searchParams.get('revisionId') || '',
      );
      if (hold) {
        hold = false;
        held = { route, json };
        heldReady?.();
        return;
      }
      return route.fulfill({ json });
    }
    throw new Error(`Unexpected API ${url.pathname}`);
  });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/admin/levels`);
    const row = page.getByRole('row').filter({ hasText: '森林小径' });
    await row.waitFor();
    assert.equal(requests.length, 0, 'do not fetch analytics for every table row');
    await row.getByRole('button', { name: '数据分析', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '关卡数据分析' });
    await drawer.getByText('森林小径', { exact: true }).waitFor();
    await drawer.getByLabel('通过率', { exact: true }).getByText('40.0%').waitFor();
    await drawer.getByText('通关次数 ÷ 开局次数', { exact: true }).waitFor();
    assert.equal(requests[0].searchParams.get('range'), '30d');
    await page.screenshot({
      path: path.join(output, 'desktop.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await drawer.getByText('近7天', { exact: true }).click();
    await drawer.getByLabel('通过率', { exact: true }).getByText('50.0%').waitFor();
    await drawer.getByRole('combobox', { name: '发布版本' }).click();
    await page.getByText('v1 · 历史版本', { exact: true }).click();
    await drawer.getByLabel('通过率', { exact: true }).getByText('100.0%').waitFor();
    assert.equal(requests.at(-1).searchParams.get('revisionId'), 'revision-1');
    await drawer.getByText('全部', { exact: true }).click();
    await drawer.getByText('最近90天趋势', { exact: true }).waitFor();
    await drawer.getByRole('button', { name: '关闭分析' }).click();
    await page
      .getByRole('row')
      .filter({ hasText: '等待发布的关卡' })
      .getByRole('button', { name: '数据分析', exact: true })
      .click();
    await drawer.getByText('暂无对局数据', { exact: true }).waitFor();
    assert.equal(await drawer.getByLabel('通过率', { exact: true }).getByText('—').count(), 1);
    await drawer.getByRole('button', { name: '关闭分析' }).click();
    fail = true;
    await row.getByRole('button', { name: '数据分析', exact: true }).click();
    await drawer.getByText('统计服务暂不可用', { exact: true }).waitFor();
    fail = false;
    await drawer.getByRole('button', { name: '重试', exact: true }).click();
    await drawer.getByLabel('通过率', { exact: true }).getByText('40.0%').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => {
      const panel =
        document.querySelector('.analytics-drawer [role="dialog"]') ||
        document.querySelector('[role="dialog"].analytics-drawer');
      if (!panel) return false;
      const rect = panel.getBoundingClientRect();
      return rect.x >= -1 && rect.right <= innerWidth + 1;
    });
    const bounds = await drawer.boundingBox();
    assert.ok(
      bounds.x >= -1 && bounds.x + bounds.width <= 391,
      `drawer fits mobile: ${JSON.stringify(bounds)}`,
    );
    await page.screenshot({
      path: path.join(output, 'mobile.png'),
      fullPage: true,
      animations: 'disabled',
    });
    const chart = drawer.getByRole('img', { name: '每日开局次数与通过率趋势图' });
    await chart.scrollIntoViewIfNeeded();
    const labelSize = await chart.evaluate((svg) => {
      const text = svg.querySelector('text');
      return parseFloat(getComputedStyle(text).fontSize) * svg.getScreenCTM().a;
    });
    assert.ok(labelSize >= 11, `mobile chart labels must remain readable, got ${labelSize}px`);
    await page.screenshot({ path: path.join(output, 'mobile-trend.png'), animations: 'disabled' });
    await drawer.getByRole('button', { name: '关闭分析' }).click();
    await row.getByRole('button', { name: /更多操作/ }).waitFor();
    const columns = await row.getByRole('cell').evaluateAll((cells) => ({
      titleRight: cells[0].getBoundingClientRect().right,
      actionsLeft: cells.at(-1).getBoundingClientRect().left,
    }));
    assert.ok(
      columns.titleRight <= columns.actionsLeft + 1,
      'mobile actions leave the level title visible',
    );
    await page.screenshot({ path: path.join(output, 'mobile-list.png'), animations: 'disabled' });
    await row.getByRole('button', { name: /更多操作/ }).click();
    await page.getByRole('menuitem', { name: '编辑' }).waitFor();
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForFunction(() => innerWidth === 320);
    const narrow = await row.getByRole('cell').evaluateAll((cells) => ({
      titleRight: cells[0].getBoundingClientRect().right,
      actionsLeft: cells.at(-1).getBoundingClientRect().left,
    }));
    assert.ok(narrow.titleRight <= narrow.actionsLeft + 1, 'level title also fits a 320px screen');
    await page.setViewportSize({ width: 390, height: 844 });
    hold = true;
    const pending = new Promise((resolve) => {
      heldReady = resolve;
    });
    await row.getByRole('button', { name: '数据分析', exact: true }).click();
    await pending;
    await drawer.getByText('近7天', { exact: true }).click();
    await drawer.getByLabel('通过率', { exact: true }).getByText('50.0%').waitFor();
    assert.ok(held, 'held response exists');
    await held.route.fulfill({ json: held.json }).catch(() => {});
    await drawer.getByText('近7天', { exact: true }).click();
    assert.ok(
      await drawer.getByLabel('通过率', { exact: true }).getByText('50.0%').isVisible(),
      'old result does not replace latest filter',
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS — row analytics, rates, version/date filters, empty states, retry, stale responses and mobile layout.',
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
