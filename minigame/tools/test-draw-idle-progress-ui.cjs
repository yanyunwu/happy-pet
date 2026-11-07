const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const output = path.resolve(__dirname, '../output/qa-draw-idle-progress');
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
  const click = async (x, y) => page.mouse.click(x / 2, y / 2);
  const settle = () =>
    page.waitForFunction(() => !qaApp.busy && !qaApp.boardTransition && !qaApp.modal);
  const start = async () => {
    await page.evaluate(() => {
      const app = window.qaApp;
      app.modals.reset();
      app.practice = true;
      app.selectedEntry = 'standard';
      app.selectedMode = 'classic';
      app.startLevel(2, 42, 'classic');
      app.closeModal();
    });
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
      window.qaApp = cc.director.getScene().getChildByName('StarIsleGame').getComponent('StarIsle');
    });

    await start();
    const before = await page.evaluate(() => ({
      covered: qaApp.game.tiles
        .filter((tile) => !tile.removed && !qaApp.game.isAvailable(tile.id))
        .map((tile) => tile.id),
      removed: qaApp.game.tiles.filter((tile) => tile.removed).map((tile) => tile.id),
      free: qaApp.game.hintLeft,
      tray: qaApp.game.tray.length,
      label: qaApp.gameRoot
        .getChildByName('Toolbar')
        .getChildByName('Tool-hint')
        .getComponentsInChildren('cc.Label')
        .map((label) => label.string)
        .join(' '),
    }));
    assert(before.covered.length > 0, 'test board has covered cards');
    assert(before.label.includes('抽卡'), 'toolbar labels the draw action');
    await click(600, 1434);
    await settle();
    const after = await page.evaluate(() => ({
      removed: qaApp.game.tiles.filter((tile) => tile.removed).map((tile) => tile.id),
      free: qaApp.game.hintLeft,
      tray: qaApp.game.tray.length,
    }));
    const selected = after.removed.filter((id) => !before.removed.includes(id));
    assert.equal(selected.length, 1, 'draw removes exactly one board tile');
    assert(before.covered.includes(selected[0]), 'draw selects a covered tile');
    assert.equal(after.tray, before.tray + 1);
    assert.equal(after.free, before.free - 1);
    await page.screenshot({ path: path.join(output, 'draw.png') });

    await start();
    const pair = await page.evaluate(() => {
      const a = qaApp;
      const available = a.game.availableTiles().filter((tile) => !tile.removed);
      const first = available.find((tile) =>
        available.some((other) => other.id !== tile.id && other.kind === tile.kind),
      );
      if (!first) return null;
      const node = a.tileNodes.get(first.id);
      return { x: node.position.x, y: -node.position.y };
    });
    assert(pair, 'test board has a visible pair');
    await click(pair.x, pair.y);
    await settle();
    await page.waitForFunction(() => !!qaApp.idleBounce, null, { timeout: 14000 });
    const idle = await page.evaluate(() => ({
      id: Number(qaApp.idleBounce.node.name.replace('tile-', '')),
      top: qaApp.game.isAvailable(Number(qaApp.idleBounce.node.name.replace('tile-', ''))),
      kind: qaApp.game.tiles[Number(qaApp.idleBounce.node.name.replace('tile-', ''))].kind,
      held: qaApp.game.tray.map((id) => qaApp.game.tiles[id].kind),
      origin: qaApp.idleBounce.origin.y,
    }));
    assert(
      idle.top && idle.held.includes(idle.kind),
      'idle bounce belongs to a visible matching tile',
    );
    await page.waitForFunction(
      () =>
        qaApp.idleBounce &&
        Math.abs(qaApp.idleBounce.node.position.y - qaApp.idleBounce.origin.y) > 1,
    );
    await page.screenshot({ path: path.join(output, 'idle-bounce.png') });
    await click(20, 300);
    await page.waitForFunction(() => !qaApp.idleBounce);
    await page.waitForTimeout(1000);
    assert.equal(
      await page.evaluate(() => !!qaApp.idleBounce),
      false,
      'touch resets the idle hint',
    );

    await page.evaluate(() => {
      qaApp.home();
      qaApp.online = {
        campaignProgress: async () => ({
          classic: { current: 8, position: 2, total: 5, completed: 1 },
          quartet: { current: 3, position: 3, total: 3, completed: 3 },
          fun: { current: 0, position: 0, total: 0, completed: 0 },
        }),
      };
      qaApp.showCampaign();
    });
    await page.waitForFunction(
      () =>
        qaApp.modal?.name === 'Campaign' &&
        qaApp.modal
          .getChildByName('Progress-classic')
          ?.getComponent('cc.Label')
          .string.includes('2/5'),
      null,
      { timeout: 5000 },
    );
    const labels = await page.evaluate(() =>
      Object.fromEntries(
        ['classic', 'quartet', 'fun'].map((mode) => [
          mode,
          qaApp.modal.getChildByName(`Progress-${mode}`).getComponent('cc.Label').string,
        ]),
      ),
    );
    assert.match(labels.classic, /2\/5/);
    assert.match(labels.classic, /第 8 关/);
    assert.match(labels.quartet, /3\/3/);
    assert.match(labels.fun, /暂无关卡/);
    await page.waitForFunction(() => Math.abs(qaApp.modal.scale.x - 1) < 0.001);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, 'campaign-progress.png') });
    assert.deepEqual(errors, []);
    console.log(
      'PASS — actual draw button, covered tile selection, idle bounce and interaction reset, campaign progress.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
