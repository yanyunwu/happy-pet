const assert = require('node:assert/strict');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');

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
      window.reviveApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
      reviveApp.practice = true;
      reviveApp.startLevel(1, 42, 'classic');
      reviveApp.closeModal();
      const g = reviveApp.game;
      for (let i = 0; i < 7; i++) g.tiles[i].removed = true;
      g.tray = [0, 1, 2, 3, 4, 5, 6];
      g.status = 'lost';
      reviveApp.showResult(false);
      window.adInstances = [];
      window.wx = {
        createRewardedVideoAd() {
          const ad = {
            onClose(fn) {
              this.close = fn;
            },
            offClose() {},
            onError(fn) {
              this.error = fn;
            },
            offError() {},
            show() {
              return Promise.resolve();
            },
            load() {
              return Promise.resolve();
            },
            destroy() {},
          };
          adInstances.push(ad);
          return ad;
        },
      };
      reviveApp.slotAdUnitId = 'adunit-ui-fixture';
    });
    await page.waitForTimeout(600);
    const boxes = await page.evaluate(() => {
      const names = ['ResultRevive', 'ResultPrimary', 'ResultHome'];
      return names.map((name) => {
        const node = reviveApp.modal.getChildByName(name),
          size = node.getComponent('cc.UITransform').contentSize;
        return {
          name,
          x: node.position.x,
          y: -node.position.y,
          width: size.width,
          height: size.height,
        };
      });
    });
    for (let i = 1; i < boxes.length; i++)
      assert(
        boxes[i].y - boxes[i - 1].y >= (boxes[i].height + boxes[i - 1].height) / 2,
        `${boxes[i].name} overlaps`,
      );
    await page.screenshot({ path: path.resolve(__dirname, '../output/revive-result.png') });
    await page.mouse.click(180, 965 / 2);
    await page.waitForFunction(() => window.adInstances.length === 1);
    await page.evaluate(() => adInstances[0].close({ isEnded: false }));
    await page.waitForFunction(() => !reviveApp.slotAdPending);
    assert.equal(await page.evaluate(() => reviveApp.game.status), 'lost');
    await page.mouse.click(180, 965 / 2);
    await page.waitForFunction(() => window.adInstances.length === 2);
    await page.evaluate(() => adInstances[1].close({ isEnded: true }));
    await page.waitForFunction(() => reviveApp.game.status === 'playing' && !reviveApp.modal);
    assert.deepEqual(await page.evaluate(() => reviveApp.game.reserve), [0, 1, 2]);
    assert.equal(await page.evaluate(() => reviveApp.game.reviveUsed), true);
    await page.evaluate(() => {
      reviveApp.game.status = 'lost';
      reviveApp.showResult(false);
    });
    assert.equal(
      await page.evaluate(() => !!reviveApp.modal.getChildByName('ResultRevive')),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS — revive result layout, ad completion and cancellation on the real Cocos page',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
