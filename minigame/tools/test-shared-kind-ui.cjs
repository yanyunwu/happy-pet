// Verify the exported game applies shared-kind rules through actual tile clicks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
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
const output = path.resolve(__dirname, '../output/qa-shared-kind');
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await playwright.chromium.launch({
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
      window.ruleApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
      ruleApp.practice = true;
      ruleApp.startLevel(2, 42, 'fun');
      ruleApp.closeModal();
    });
    await page.waitForFunction(() => !ruleApp.busy && !ruleApp.modal && !ruleApp.boardTransition);
    for (const [name, rules, kinds, expected] of [
      ['two-pairs-same', [[2, 2]], [0, 0, 0, 0], 'won'],
      ['three-one-same', [[1, 3]], [1, 1, 1, 1], 'won'],
      ['three-pairs-partial-merge', [[2, 2, 2]], [0, 0, 0, 0, 1, 1], 'won'],
      ['two-pairs-reject-three-one', [[2, 2]], [0, 0, 0, 1], 'lost'],
      ['three-one-reject-two-pairs', [[1, 3]], [0, 0, 1, 1], 'lost'],
    ]) {
      await page.evaluate(
        ({ rules, kinds }) => {
          ruleApp.modals.reset();
          const game = ruleApp.game.constructor.fromCloud({
            ordinal: 2,
            title: '同种组合验证',
            seed: 42,
            state: {
              rulesVersion: 'pet-rules-2',
              rules,
              mode: 'fun',
              capacity: 7,
              tiles: kinds.map((kind, id) => ({
                id,
                kind,
                x: ((id % 3) - 1) * 130,
                y: Math.floor(id / 3) * 120 - 100,
                layer: 0,
                removed: false,
              })),
              tray: [],
              reserve: [],
              status: 'playing',
              matches: 0,
              cleared: 0,
              moves: 0,
              tools: { undo: 1, shovel: 1, hint: 3, shuffle: 1 },
            },
          });
          ruleApp.mountLevel(game, false);
          ruleApp.toasts.reset();
        },
        { rules, kinds },
      );
      await page.waitForFunction(() => !ruleApp.busy && !ruleApp.modal && !ruleApp.boardTransition);
      if (name === 'two-pairs-same') {
        await page.evaluate(() => ruleApp.showRules(false));
        await page.waitForFunction(
          () => ruleApp.modal?.name === 'Rules' && Math.abs(ruleApp.modal.scale.x - 1) < 0.001,
        );
        const labels = await page.evaluate(() =>
          ruleApp.modal.getComponentsInChildren('cc.Label').map((label) => label.string),
        );
        assert(labels.some((text) => text.includes('或四个相同')));
        assert(labels.some((text) => text.includes('组间也可相同')));
        await page.screenshot({ path: path.join(output, 'rule-help.png') });
        await page.evaluate(() => ruleApp.closeModal());
        await page.waitForFunction(() => !ruleApp.modal);
      }
      for (let id = 0; id < kinds.length; id++) {
        const point = await page.evaluate((id) => {
          const tile = ruleApp.tileNodes.get(id);
          return { x: tile.position.x / 2, y: -tile.position.y / 2 };
        }, id);
        await page.mouse.click(point.x, point.y);
        await page.waitForFunction(() => !ruleApp.busy && !ruleApp.boardTransition);
        if (id < kinds.length - 1)
          assert.equal(await page.evaluate(() => ruleApp.game.cleared), 0, name);
      }
      await page.waitForFunction(() => ['Victory', 'TryAgain'].includes(ruleApp.modal?.name));
      const result = await page.evaluate(() => ({
        status: ruleApp.game.status,
        cleared: ruleApp.game.cleared,
        matches: ruleApp.game.matches,
      }));
      assert.deepEqual(
        result,
        {
          status: expected,
          cleared: expected === 'won' ? kinds.length : 0,
          matches: expected === 'won' ? 1 : 0,
        },
        name,
      );
      if (expected === 'won') await page.screenshot({ path: path.join(output, name + '.png') });
    }
    assert.deepEqual(errors, []);
    console.log(
      'PASS — built game click flow: same-kind 2+2 and 1+3, partial 2+2+2, invalid mixtures and rule help.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
