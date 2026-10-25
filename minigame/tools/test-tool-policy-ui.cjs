const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve(__dirname, '../output/qa-tool-policy');
fs.mkdirSync(output, { recursive: true });
const toolX = { undo: 120, shovel: 280, hint: 440, shuffle: 600 };

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
  const settle = () =>
    page.waitForFunction(() => !policyApp.busy && !policyApp.boardTransition && !policyApp.modal);
  const click = async (x, y) => {
    const viewport = page.viewportSize();
    const scale = Math.min(viewport.width / 720, viewport.height / 1560);
    await page.mouse.click(
      (viewport.width - 720 * scale) / 2 + x * scale,
      (viewport.height - 1560 * scale) / 2 + y * scale,
    );
  };
  const fixture = async (entry, mode, free = 1, inventory = 3) => {
    await page.evaluate(
      ({ entry, mode, free, inventory }) => {
        const a = policyApp;
        a.modals.reset();
        a.practice = true;
        a.selectedEntry = entry;
        a.selectedMode = mode;
        a.startLevel(1, 42, mode);
        a.closeModal();
        a.save.bag = { undo: inventory, shovel: inventory, hint: inventory, shuffle: inventory };
        for (const key of ['undo', 'shovel', 'hint', 'shuffle']) a.game[`${key}Left`] = free;
        a.updateControls();
      },
      { entry, mode, free, inventory },
    );
    await settle();
  };
  const read = () =>
    page.evaluate(() => {
      const a = policyApp;
      return {
        bag: { ...a.save.bag },
        tools: Object.fromEntries(
          ['undo', 'shovel', 'hint', 'shuffle'].map((key) => {
            const node = a.gameRoot.getChildByName('Toolbar').getChildByName(`Tool-${key}`);
            return [
              key,
              {
                count: node.getChildByName('Count').getComponent('cc.Label').string,
                enabled: node.getComponent('cc.Button').interactable,
                free: a.game[`${key}Left`],
              },
            ];
          }),
        ),
        game: JSON.stringify({
          tiles: a.game.tiles,
          tray: a.game.tray,
          reserve: a.game.reserve,
          moves: a.game.moves,
          status: a.game.status,
        }),
      };
    });
  const prepare = async (tool) => {
    if (tool !== 'undo' && tool !== 'shovel') return;
    const position = await page.evaluate(() => {
      const a = policyApp;
      const tile = a.game.availableTiles().find((tile) => !tile.removed);
      const node = a.tileNodes.get(tile.id);
      return { x: node.position.x, y: -node.position.y };
    });
    await click(position.x, position.y);
    await settle();
  };
  try {
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:7457', {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(
      () =>
        cc?.director.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
    );
    await page.evaluate(() => {
      window.policyApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
    });

    for (const mode of ['classic', 'quartet', 'fun'])
      for (const tool of Object.keys(toolX)) {
        await fixture('standard', mode);
        await prepare(tool);
        assert.equal((await read()).tools[tool].count, '1');
        await click(toolX[tool], 1434);
        await settle();
        let state = await read();
        assert.equal(state.tools[tool].free, 0, `${mode}/${tool} uses its free allowance`);
        assert.equal(state.bag[tool], 3);
        assert.equal(state.tools[tool].count, '0');
        assert.equal(state.tools[tool].enabled, false);
        await prepare(tool);
        state = await read();
        await click(toolX[tool], 1434);
        await settle();
        assert.deepEqual(
          await read(),
          state,
          `${mode}/${tool} cannot spend a bag item after free use`,
        );
      }
    await page.screenshot({ path: path.join(output, 'challenge-exhausted.png') });

    for (const tool of Object.keys(toolX)) {
      await fixture('campaign', 'classic');
      await prepare(tool);
      assert.equal((await read()).tools[tool].count, '4');
      await click(toolX[tool], 1434);
      await settle();
      assert.equal((await read()).bag[tool], 3, 'campaign uses its free allowance before stock');
      for (const left of [2, 1, 0]) {
        await prepare(tool);
        await click(toolX[tool], 1434);
        await settle();
        const state = await read();
        assert.equal(state.bag[tool], left, `${tool} can repeatedly spend bag stock`);
        assert.equal(state.tools[tool].count, String(left));
      }
      assert.equal((await read()).tools[tool].enabled, false);
    }

    await fixture('standard', 'classic', 0);
    await page.evaluate(() => {
      policyApp.practice = false;
      policyApp.receiveAssets({
        coins: 20,
        bag: { undo: 9, shovel: 9, hint: 9, shuffle: 9 },
        signInCount: 1,
        signedOn: '2026-10-25',
      });
    });
    assert(
      Object.values((await read()).tools).every((tool) => tool.count === '0' && !tool.enabled),
      'asset refresh cannot re-enable challenge stock',
    );
    await fixture('campaign', 'classic', 0, 9);
    assert(
      Object.values((await read()).tools).every((tool) => tool.count === '9'),
      'entering campaign exposes the same available inventory',
    );
    await page.screenshot({ path: path.join(output, 'campaign-inventory.png') });
    await page.evaluate(() => {
      policyApp.showBag();
    });
    await page.waitForFunction(
      () => policyApp.modal?.name === 'Bag' && Math.abs(policyApp.modal.scale.x - 1) < 0.001,
    );
    const text = await page.evaluate(() =>
      policyApp.modal
        .getComponentsInChildren('cc.Label')
        .map((label) => label.string)
        .join('\n'),
    );
    assert(text.includes('仅限闯关模式使用'));
    assert(text.includes('直至库存用完'));
    await page.screenshot({ path: path.join(output, 'bag-policy.png') });
    assert.deepEqual(errors, []);
    console.log(
      'PASS — all three challenge modes enforce four free-only tools; campaign spends every available bag item; counts, disabled buttons, asset refresh, entry changes and bag instructions agree.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
