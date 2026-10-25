const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve(__dirname, '../output/qa-announcement');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({
    viewport: { width: 360, height: 780 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let content =
    '亲爱的小伙伴：\n\n后台保存的新公告已送达。\n\n<b>这也是文字</b> &lt;猫&gt;\n&quot; &apos; &nbsp;\n\n祝大家游戏愉快！';
  let fail = false;
  let delayed = false;
  const pending = [];
  let requests = 0;
  const respond = (route, text = content) =>
    route.fulfill({
      status: fail ? 503 : 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(
        fail
          ? { error: { message: '暂不可用' } }
          : { content: text, updatedAt: '2026-10-25T03:00:00Z' },
      ),
    });
  await page.route('**/api/v1/settings/announcement', async (route) => {
    requests++;
    if (delayed) pending.push(route);
    else await respond(route);
  });
  const waitModal = (name) =>
    page.waitForFunction((name) => {
      const m = window.newsApp.modal;
      return (
        m?.name === name &&
        Math.abs(m.scale.x - 1) < 0.001 &&
        m.getComponent('cc.UIOpacity')?.opacity === 255
      );
    }, name);
  const open = async () => {
    await page.evaluate(() => window.newsApp.showAnnouncements());
    await waitModal('Announcements');
  };
  const text = () =>
    page.evaluate(() =>
      window.newsApp.modal
        .getComponentsInChildren('cc.Label')
        .map((l) => l.string)
        .join(''),
    );
  const waitText = (value) =>
    page.waitForFunction(
      (value) =>
        window.newsApp.modal
          ?.getComponentsInChildren('cc.Label')
          .map((l) => l.string)
          .join('')
          .includes(value),
      value,
    );
  const click = async (name) => {
    const p = await page.evaluate((name) => {
      const n = window.newsApp.modal.getChildByName(name);
      return { x: n.position.x, y: -n.position.y };
    }, name);
    const viewport = page.viewportSize(),
      scale = Math.min(viewport.width / 720, viewport.height / 1560);
    await page.mouse.click(
      (viewport.width - 720 * scale) / 2 + p.x * scale,
      (viewport.height - 1560 * scale) / 2 + p.y * scale,
    );
  };
  const close = async () => {
    await click('Close');
    await page.waitForFunction(() => !window.newsApp.modal);
  };
  try {
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:7457', {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(
      () =>
        window.cc?.director.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
    );
    await page.evaluate(() => {
      window.newsApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
      window.newsApp.toasts.reset();
      window.announcementReads = 0;
      const read = window.newsApp.online.announcement.bind(window.newsApp.online);
      window.newsApp.online.announcement = async () => {
        try {
          return await read();
        } finally {
          window.announcementReads++;
        }
      };
    });
    await open();
    assert.equal(
      await page.evaluate(
        () =>
          !!window.newsApp.modal.getChildByName('NewsCard') ||
          !!window.newsApp.modal.getChildByName('AnnouncementHorn'),
      ),
      false,
      'news must be plain text without old cards or icons',
    );
    await waitText('后台保存的新公告已送达。');
    assert(
      (await text()).includes('<b>这也是文字</b> &lt;猫&gt;'),
      'markup and entities must render as literal text',
    );
    assert(
      (await text()).includes('&quot; &apos; &nbsp;'),
      'quote entities must remain literal text too',
    );
    assert.deepEqual(
      await page.evaluate(() => {
        const l = window.newsApp.modal
          .getComponentsInChildren('cc.Label')
          .find((l) => l.string.includes('亲爱'));
        return [l.fontSize, l.color.r, l.color.g, l.color.b];
      }),
      [32, 23, 23, 23],
    );
    await page.screenshot({ path: path.join(output, 'announcement.png') });
    await close();
    const firstRequests = requests;
    content = '';
    await open();
    await waitText('暂无公告');
    assert(requests > firstRequests, 'reopening fetches current settings');
    await close();
    fail = true;
    await open();
    await waitText('重新加载');
    fail = false;
    content = '重试成功，正文来自后台';
    await click('NewsDone');
    await waitText(content);
    await close();
    content =
      Array.from(
        { length: 45 },
        (_, i) => `第${i + 1}段：森林小伙伴等你来，每天一起开心消除。`,
      ).join('\n\n') + '\n公告到这里结束。';
    await page.setViewportSize({ width: 320, height: 700 });
    await open();
    await waitText('公告到这里结束。');
    await page.screenshot({ path: path.join(output, 'announcement-narrow.png') });
    await page.mouse.move(160, 475);
    await page.mouse.down();
    await page.mouse.move(160, 260, { steps: 12 });
    await page.mouse.up();
    await page.waitForFunction(
      () => window.newsApp.modal.getComponentInChildren('cc.ScrollView').getScrollOffset().y > 50,
    );
    await page.evaluate(() => {
      const s = window.newsApp.modal.getComponentInChildren('cc.ScrollView');
      s.stopAutoScroll();
      s.scrollToBottom(0);
    });
    await page.screenshot({ path: path.join(output, 'announcement-bottom.png') });
    assert.equal(
      await page.evaluate(() =>
        window.newsApp.modal
          .getComponentsInChildren('cc.Label')
          .filter((l) => l.node.parent?.name === 'AnnouncementText')
          .every((l) => l.fontSize === 32),
      ),
      true,
      'scrolling must keep the readable font size',
    );
    await close();
    delayed = true;
    const beginHeld = async () => {
      await open();
      await waitText('公告加载中');
      assert(pending.length, 'announcement request is held for lifecycle test');
      return pending.shift();
    };
    const finishHeld = async (route, value) => {
      const before = await page.evaluate(() => window.announcementReads);
      await respond(route, value);
      await page.waitForFunction((before) => window.announcementReads > before, before);
    };
    for (const scenario of ['close', 'replace', 'destroy']) {
      const held = await beginHeld();
      if (scenario === 'destroy') {
        await page.evaluate(() => {
          window.destroyedAnnouncement = window.newsApp.announcementDialog;
          window.destroyedAnnouncement.destroy();
        });
        await page.waitForFunction(() => !window.destroyedAnnouncement.isValid);
      } else {
        if (scenario === 'close') await close();
        await page.evaluate(() => window.newsApp.showBag());
        await waitModal('Bag');
      }
      await finishHeld(held, '迟到的公告');
      assert.equal(
        await page.evaluate(() => window.newsApp.modal?.name),
        scenario === 'destroy' ? 'Announcements' : 'Bag',
      );
      assert(!(await text()).includes('迟到的公告'), `${scenario} must ignore the late result`);
      await close();
    }
    const old = await beginHeld();
    await close();
    const latest = await beginHeld();
    await finishHeld(latest, '最新打开的公告');
    await waitText('最新打开的公告');
    await finishHeld(old, '旧公告不应覆盖新公告');
    assert((await text()).includes('最新打开的公告'));
    assert(!(await text()).includes('旧公告不应覆盖新公告'));
    assert.deepEqual(errors, []);
    console.log(
      'PASS — managed plain-text news, literal markup, readable scroll, empty/error/retry and late response isolation.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
