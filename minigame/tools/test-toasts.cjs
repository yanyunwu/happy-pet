const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve(__dirname, '../output/qa-toasts');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const page = await browser.newPage({
    viewport: { width: 432, height: 936 },
    deviceScaleFactor: 2,
  });
  const errors = [],
    checks = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const read = () =>
    page.evaluate(() => {
      const node = window.noticeApp.stage.children.find((n) => n.name === 'Toast' && n.active);
      if (!node) return null;
      const label = node.getChildByName('ToastMessage').getComponent('cc.Label');
      const size = node.getComponent('cc.UITransform').contentSize;
      return {
        id: node.uuid,
        x: node.position.x,
        y: -node.position.y,
        width: size.width,
        height: size.height,
        alpha: node.getComponent('cc.UIOpacity').opacity,
        message: label.string,
        fontSize: label.actualFontSize,
        wrap: label.enableWrapText,
        labelHeight: label.node.getComponent('cc.UITransform').height,
        order: node.getSiblingIndex(),
        modalOrder: window.noticeApp.modal?.getSiblingIndex(),
        count: window.noticeApp.stage.children.filter((n) => n.name === 'Toast' && n.active).length,
      };
    });
  const show = (text) => page.evaluate((text) => window.noticeApp.toast(text), text);
  const settled = () =>
    page.waitForFunction(() => {
      const node = window.noticeApp.stage.children.find((n) => n.name === 'Toast' && n.active);
      return node?.getComponent('cc.UIOpacity').opacity === 255;
    });
  try {
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:7457', {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(
      () =>
        window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
    );
    await page.evaluate(() => {
      window.noticeApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
    });
    await show('金币和道具已经放进背包啦！');
    assert((await read()).alpha < 255, 'notice must animate into view');
    await settled();
    let state = await read();
    assert(state.y < 350, 'all notices belong at the top of the screen');
    assert(state.y - state.height / 2 >= 180, 'notice sits below the main header');
    assert(state.x - state.width / 2 >= 30 && state.x + state.width / 2 <= 690);
    assert(state.wrap, 'long messages must wrap');
    await page.screenshot({ path: path.join(output, 'home.png') });
    checks.push('top placement, animated entrance and side margins');

    const id = state.id;
    await show('金币和道具已经放进背包啦！');
    state = await read();
    assert.equal(state.id, id, 'duplicate notice reuses its node');
    assert.equal(state.alpha, 255, 'duplicate notice must not flash');
    const long = '网络暂时有些拥挤，你刚才的操作已经保存，请稍后再试，萌宠们会在这里等你回来。';
    await show(long);
    state = await read();
    assert.equal(state.id, id, 'a newer notice replaces the active text in place');
    assert.equal(state.message, long);
    assert.equal(state.count, 1);
    assert(state.height > 90 && state.height <= 170, 'long notice grows within a bounded height');
    assert(state.fontSize >= 20, 'ordinary long notices stay readable');
    await page.screenshot({ path: path.join(output, 'long.png') });
    checks.push('deduplicated replacement and readable wrapping');

    await page.evaluate(() => window.noticeApp.showSettings());
    await page.waitForFunction(() => Math.abs(window.noticeApp.modal?.scale.x - 1) < 0.001);
    state = await read();
    assert(state.order > state.modalOrder, 'notice remains above a newly opened dialog');
    await show('声音设置已保存');
    await page.screenshot({ path: path.join(output, 'modal.png') });
    checks.push('one common notice layer above dialogs');

    await page.evaluate(() => {
      window.noticeApp.modals.reset();
      window.noticeApp.startLevel(1, 42);
      window.noticeApp.modals.reset();
    });
    assert.equal(await read(), null, 'changing screens clears stale notices');
    await show('优先收集发光的小伙伴吧！');
    await settled();
    const rulesPosition = await page.evaluate(() => {
      const n = window.noticeApp.gameRoot.getChildByName('Instruction');
      return { x: n.position.x, y: -n.position.y };
    });
    await page.mouse.click(rulesPosition.x * 0.6, rulesPosition.y * 0.6);
    await page.waitForFunction(() => window.noticeApp.modal?.name === 'Rules');
    checks.push('notice passes touches through to the rule control below it');
    await page.evaluate(() => window.noticeApp.modals.reset());
    await show('已撤回刚才那一步');
    await page.screenshot({ path: path.join(output, 'game.png') });

    await page.evaluate(() => {
      window.originalSafeArea = cc.sys.getSafeAreaRect;
      cc.sys.getSafeAreaRect = () => new cc.Rect(46, 0, 628, 1330);
      window.noticeApp.toast('提示也会避开屏幕边缘');
    });
    await settled();
    state = await read();
    assert(state.y - state.height / 2 >= 230 + 16, 'respect a large top safe inset');
    assert(state.x - state.width / 2 >= 46 + 16 && state.x + state.width / 2 <= 674 - 16);
    await page.evaluate(() => {
      cc.sys.getSafeAreaRect = window.originalSafeArea;
    });
    checks.push('safe-area positioning');

    await show('提示即将更新');
    await page.waitForTimeout(2200);
    await show('新的提示');
    await page.waitForTimeout(800);
    assert.equal(
      (await read()).message,
      '新的提示',
      'the old expiration cannot remove a replacement',
    );
    await page.waitForFunction(
      () => !window.noticeApp.stage.children.some((n) => n.name === 'Toast' && n.active),
      null,
      { timeout: 6000 },
    );
    checks.push('replacement resets lifetime and notices disappear automatically');

    await show('加载下一关');
    await page.evaluate(() => {
      window.noticeToken = window.noticeApp.levelTransition.show();
      window.noticeApp.toast('正在准备冒险，请稍等一下');
    });
    assert(
      await page.evaluate(() => window.noticeApp.stage.children.at(-1).name === 'LevelTransition'),
      'loading remains a text-free cover',
    );
    await page.evaluate(() => window.noticeApp.levelTransition.reset());
    await page.evaluate(() => window.noticeApp.home());
    assert.equal(await read(), null);
    await page.waitForTimeout(3000);
    assert.equal(await read(), null, 'old animation callbacks cannot resurrect a notice');
    checks.push('loading cover and stale-notice cleanup');
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({ success: true, checks, errors }, null, 2),
    );
    console.log(`PASS — ${checks.length} top-notice scenarios, no runtime errors.`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    throw error;
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
