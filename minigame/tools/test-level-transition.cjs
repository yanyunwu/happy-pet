const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../artifacts/rule-fixtures.json'), 'utf8'),
)[0];
const output = path.resolve(__dirname, '../output/qa-level-transition');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 432, height: 936 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:7457/?qa=level-transition', { waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
    );
    await page.evaluate((fixture) => {
      window.qaApp = cc.director.getScene().getChildByName('StarIsleGame').getComponent('StarIsle');
      window.wx = {};
      window.transitionMode = 'hold';
      window.transitionFixture = {
        id: 'transition-qa',
        entry: 'standard',
        levelId: 'standard-classic-1',
        revisionId: 'qa-revision',
        ordinal: 1,
        title: '林间练习',
        seed: 97,
        state: fixture.initial,
        lastSeq: 0,
        settled: false,
        rewardCoins: 0,
      };
      window.qaApp.online.start = async () => {
        if (window.transitionMode === 'fail') throw new Error('测试连接中断');
        if (window.transitionMode === 'hold')
          await new Promise((resolve) => {
            window.releaseLevel = resolve;
          });
        return window.transitionFixture;
      };
    }, fixture);
    await page.mouse.click(185 * 0.6, 1220 * 0.6);
    await page.waitForFunction(() => window.qaApp.networkBusy);
    const state = await page.evaluate(() => {
      const cover = window.qaApp.stage.getChildByName('LevelTransition');
      return {
        exists: !!cover,
        labels: cover?.getComponentsInChildren(cc.Label).length,
        leaves: cover?.children.filter((node) => node.name === 'LeafParticle').length,
        moves: window.qaApp.game?.moves ?? 0,
      };
    });
    assert.equal(state.exists, true, 'level requests use a text-free leaf transition');
    assert.equal(state.labels, 0);
    assert(state.leaves >= 5);
    await page.mouse.click(610 * 0.6, 1036 * 0.6);
    assert.equal(
      await page.evaluate(() => window.qaApp.modal?.name ?? null),
      null,
      'loading mask blocks home shortcuts',
    );
    await page.waitForTimeout(350);
    await page.screenshot({ path: path.join(output, 'leaves-loading.png') });
    await page.evaluate(() => window.releaseLevel());
    await page.waitForFunction(
      () => !window.qaApp.networkBusy && window.qaApp.modal?.name === 'Rules',
    );
    assert.equal(
      await page.evaluate(() => !!window.qaApp.stage.getChildByName('LevelTransition')),
      false,
    );
    await page.evaluate(() => window.qaApp.closeModal());
    await page.waitForFunction(() => !window.qaApp.modal);
    const pausedTime = await page.evaluate(() => {
      window.transitionMode = 'hold';
      void window.qaApp.startCloud('classic');
      return window.qaApp.playTime;
    });
    await page.waitForTimeout(350);
    assert(
      Math.abs((await page.evaluate(() => window.qaApp.playTime)) - pausedTime) < 0.04,
      'the level timer pauses while loading',
    );
    await page.evaluate(() => window.qaApp.home());
    await page.evaluate(() => window.releaseLevel());
    await page.waitForFunction(() => window.qaApp.currentScreen === 'home' && !window.qaApp.modal);
    await page.evaluate(() => {
      window.transitionMode = 'fail';
    });
    await page.mouse.click(185 * 0.6, 1220 * 0.6);
    await page.waitForFunction(
      () => !window.qaApp.networkBusy && window.qaApp.modal?.name === 'NetworkRetry',
    );
    assert.equal(
      await page.evaluate(() => !!window.qaApp.stage.getChildByName('LevelTransition')),
      false,
    );
    await page.waitForFunction(() => Math.abs(window.qaApp.modal.scale.x - 1) < 0.001);
    await page.evaluate(() => {
      window.transitionMode = 'success';
    });
    await page.mouse.click(360 * 0.6, 897 * 0.6);
    await page.waitForFunction(
      () => !window.qaApp.networkBusy && window.qaApp.modal?.name === 'Rules',
    );
    assert.equal(
      await page.evaluate(() => !!window.qaApp.stage.getChildByName('LevelTransition')),
      false,
    );
    await page.evaluate(() => window.qaApp.home());
    await page.waitForFunction(() => window.qaApp.currentScreen === 'home' && !window.qaApp.modal);
    await page.evaluate(() => {
      window.transitionMode = 'hold';
    });
    await page.mouse.click(185 * 0.6, 1220 * 0.6);
    await page.waitForFunction(() => window.qaApp.networkBusy);
    await page.evaluate(() => window.qaApp.home());
    await page.evaluate(() => window.releaseLevel());
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.qaApp.currentScreen), 'home');
    assert.equal(await page.evaluate(() => window.qaApp.game), null);
    assert.equal(
      await page.evaluate(() => !!window.qaApp.stage.getChildByName('LevelTransition')),
      false,
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify(
        {
          success: true,
          checks: [
            'text-free animated leaf mask',
            'input blocked during request',
            'success and failure dismiss mask',
            'retry loads board',
            'level clock pauses and late responses cannot reopen a left screen',
          ],
          errors,
        },
        null,
        2,
      ),
    );
    console.log(
      'PASS — text-free leaf transition, input blocking, success/failure cleanup and retry.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
