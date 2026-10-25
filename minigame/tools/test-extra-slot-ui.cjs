const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve(__dirname, '../output/qa-extra-slot');
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
  const settle = () =>
    page.waitForFunction(
      () => !window.slotApp.busy && !window.slotApp.modal && !window.slotApp.boardTransition,
    );
  const click = async (x, y) => {
    const viewport = page.viewportSize();
    const scale = Math.min(viewport.width / 720, viewport.height / 1560);
    await page.mouse.click(
      (viewport.width - 720 * scale) / 2 + x * scale,
      (viewport.height - 1560 * scale) / 2 + y * scale,
    );
  };
  const fixture = async (reserve = 0) => {
    await page.evaluate((reserve) => {
      const a = window.slotApp;
      a.modals.reset();
      const g = new a.game.constructor(2, 42, 'classic');
      g.tiles = Array.from({ length: 24 }, (_, id) => ({
        id,
        kind: id % 8,
        x: ((id % 6) - 2.5) * 100,
        y: (Math.floor(id / 6) - 1.5) * 115,
        layer: 0,
        removed: id < reserve,
      }));
      g.reserve = Array.from({ length: reserve }, (_, id) => id);
      g.level.total = g.tiles.length;
      a.mountLevel(g, false);
      a.toasts.reset();
    }, reserve);
    await settle();
  };
  const nativeAd = () =>
    page.evaluate(() => {
      window.adInstances = [];
      window.wx = {
        createRewardedVideoAd(options) {
          const ad = {
            options,
            close: null,
            error: null,
            shown: 0,
            destroyed: false,
            onClose(fn) {
              this.close = fn;
            },
            offClose(fn) {
              if (this.close === fn) this.close = null;
            },
            onError(fn) {
              this.error = fn;
            },
            offError(fn) {
              if (this.error === fn) this.error = null;
            },
            show() {
              this.shown++;
              return Promise.resolve();
            },
            load() {
              return Promise.resolve();
            },
            destroy() {
              this.destroyed = true;
            },
          };
          window.adInstances.push(ad);
          return ad;
        },
      };
      window.slotApp.slotAdUnitId = 'adunit-ui-fixture';
    });
  const state = () =>
    page.evaluate(() => {
      const a = window.slotApp;
      return {
        capacity: a.game.capacity,
        tray: [...a.game.tray],
        reserve: [...a.game.reserve],
        status: a.game.status,
        pending: a.slotAdPending,
        prompt: a.extraSlot.node.getChildByName('UnlockPrompt').active,
        ads: window.adInstances?.length || 0,
      };
    });
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
      window.slotApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
      slotApp.practice = true;
      slotApp.startLevel(2, 42, 'classic');
      slotApp.closeModal();
    });
    await settle();
    await fixture(7);
    const layout = await page.evaluate(() => {
      const a = slotApp;
      const area = a.gameRoot.getChildByName('ReserveArea');
      const slot = a.extraSlot.node;
      const bounds = slot.getComponent('cc.UITransform').contentSize;
      return {
        oldText: !!area.getChildByName('ReserveTitle'),
        oldPanel: !!area.getChildByName('ReservePanel'),
        slotLeft: slot.position.x - bounds.width / 2,
        slotRight: slot.position.x + bounds.width / 2,
        slotBottom: -slot.position.y + bounds.height / 2,
        cards: [...a.reserveNodes.values()].map((n) => ({
          x: n.position.x,
          y: -n.position.y,
          right: n.position.x + (94 * n.scale.x) / 2,
        })),
      };
    });
    assert.equal(layout.oldText, false);
    assert.equal(layout.oldPanel, false);
    assert.equal(layout.cards.length, 7);
    assert(
      layout.cards.every((n) => n.right < layout.slotLeft - 8),
      'all seven reserve cards fit left of the extra pocket',
    );
    assert(
      layout.slotRight <= 704 && layout.slotBottom < 1168,
      'pocket fits above the main wooden rack',
    );
    await page.screenshot({ path: path.join(output, 'locked.png') });
    await page.screenshot({
      path: path.join(output, 'slot-detail.png'),
      clip: { x: 0, y: 508, width: 360, height: 160 },
    });
    await click(636, 1097);
    await page.waitForFunction(() => !slotApp.slotAdPending);
    assert.equal((await state()).capacity, 7, 'unconfigured ads never give a free slot');

    await nativeAd();
    await click(636, 1097);
    await click(636, 1097);
    assert.equal((await state()).ads, 1, 'duplicate taps start one native video');
    await page.evaluate(() => {
      const before = slotApp.game.moves;
      slotApp.pick(7);
      slotApp.onGameAction(null, 'shovel');
      if (slotApp.game.moves !== before) throw new Error('input was not blocked while watching');
      adInstances[0].close({ isEnded: false });
    });
    await page.waitForFunction(() => !slotApp.slotAdPending);
    assert.equal((await state()).capacity, 7);
    await click(636, 1097);
    await page.evaluate(() => adInstances[1].error({ errCode: 1004 }));
    await page.waitForFunction(() => !slotApp.slotAdPending);
    assert.equal((await state()).capacity, 7);
    await click(636, 1097);
    await page.evaluate(() => adInstances[2].close({ isEnded: true }));
    await page.waitForFunction(() => !slotApp.slotAdPending);
    assert.equal((await state()).capacity, 8);
    assert.equal((await state()).prompt, false);
    await click(636, 1097);
    assert.equal((await state()).ads, 3, 'unlocked pocket cannot start another video');

    await fixture();
    await click(636, 1097);
    await page.evaluate(() => adInstances.at(-1).close({ isEnded: true }));
    await page.waitForFunction(() => !slotApp.slotAdPending);
    // Eight distinct tiles fill the normal rack plus the separate eighth pocket.
    await page.evaluate(() => {
      for (let id = 0; id < 8; id++) slotApp.pick(id);
    });
    await page.waitForFunction(
      () => slotApp.game.status === 'lost' && slotApp.modal?.name === 'TryAgain',
    );
    const rack = await page.evaluate(() =>
      [...slotApp.trayNodes.entries()].map(([id, n]) => ({
        id,
        x: n.position.x,
        y: -n.position.y,
      })),
    );
    assert.equal(rack.length, 8);
    assert.deepEqual(
      rack.find((n) => n.id === 7),
      { id: 7, x: 636, y: 1090 },
    );
    await page.evaluate(() => {
      slotApp.modals.reset();
      slotApp.toasts.reset();
    });
    await page.screenshot({ path: path.join(output, 'unlocked-filled.png') });

    await fixture();
    assert.equal((await state()).capacity, 7, 'new round resets the extra pocket');
    await click(636, 1097);
    await page.evaluate(() => {
      window.retiredCallback = adInstances.at(-1).close;
    });
    await fixture();
    await page.evaluate(() => retiredCallback({ isEnded: true }));
    assert.equal((await state()).capacity, 7, 'a late old-round callback grants nothing');

    // Take seven cards with capacity eight, shovel, return one and undo it.
    await click(636, 1097);
    await page.evaluate(() => adInstances.at(-1).close({ isEnded: true }));
    await page.waitForFunction(() => !slotApp.slotAdPending);
    await page.evaluate(() => {
      for (let id = 0; id < 7; id++) slotApp.pick(id);
    });
    await settle();
    assert.equal((await state()).status, 'playing');
    await click(280, 1434);
    await settle();
    assert.equal((await state()).reserve.length, 7);
    await click(64, 1090);
    await settle();
    assert.equal((await state()).reserve.length, 6);
    await click(120, 1434);
    await settle();
    assert.equal((await state()).reserve.length, 7);
    assert.equal((await state()).capacity, 8);

    await page.setViewportSize({ width: 320, height: 640 });
    await fixture(7);
    await page.screenshot({ path: path.join(output, 'narrow.png') });
    await click(636, 1097);
    assert.equal((await state()).pending, true, 'narrow-screen native ad hit area works');
    await page.evaluate(() => adInstances.at(-1).close({ isEnded: false }));
    await page.waitForFunction(() => !slotApp.slotAdPending);

    // Cloud mounting happens under networkBusy; its first tap must work after the transition.
    await page.evaluate(async () => {
      const a = slotApp;
      const g = a.game;
      const session = {
        id: 'ui-cloud-slot',
        ordinal: 2,
        title: '广告槽回归',
        seed: 42,
        state: {
          tiles: g.tiles,
          tray: g.tray,
          reserve: g.reserve,
          status: 'playing',
          matches: 0,
          cleared: 0,
          moves: 0,
          capacity: 7,
          mode: 'classic',
          rulesVersion: 'pet-rules-2',
          rules: [[3]],
          tools: { undo: 1, shovel: 1, hint: 3, shuffle: 1 },
        },
      };
      window.cloudActions = [];
      a.online = {
        start: async () => session,
        record: (type) => cloudActions.push(type),
        flush: async () => {},
        detach() {},
      };
      a.practice = false;
      await a.startCloud('classic');
      a.closeModal();
    });
    await settle();
    await click(636, 1097);
    assert.equal((await state()).pending, true, 'first tap after cloud startup starts the video');
    await page.evaluate(() => adInstances.at(-1).close({ isEnded: true }));
    await page.waitForFunction(() => !slotApp.slotAdPending);
    assert.deepEqual(await page.evaluate(() => cloudActions), ['unlock_slot']);
    assert.equal((await state()).capacity, 8);
    await page.evaluate(async () => {
      const a = slotApp;
      const g = a.game;
      const held = [7, 8, 9, 10, 11, 12, 13];
      a.online.start = async () => ({
        id: 'ui-cloud-restored',
        ordinal: 2,
        title: '恢复棋盘',
        seed: 42,
        state: {
          tiles: g.tiles.map((tile) => ({
            ...tile,
            removed: tile.removed || held.includes(tile.id),
          })),
          tray: held,
          reserve: g.reserve,
          status: 'playing',
          matches: 0,
          cleared: 0,
          moves: 7,
          capacity: 8,
          mode: 'classic',
          rulesVersion: 'pet-rules-2',
          rules: [[3]],
          tools: { undo: 1, shovel: 1, hint: 3, shuffle: 1 },
        },
      });
      await a.startCloud('classic', 'ui-cloud-slot');
    });
    await settle();
    assert.equal(
      await page.evaluate(() => slotApp.trayNodes.size),
      7,
      'cloud recovery renders the held tiles immediately',
    );
    assert.equal((await state()).capacity, 8);
    assert.equal((await state()).prompt, false);

    await page.evaluate(() => {
      slotApp.practice = true;
    });
    await fixture();
    await click(636, 1097);
    await page.evaluate(() => adInstances.at(-1).close({ isEnded: true }));
    await page.waitForFunction(() => !slotApp.slotAdPending);
    await page.evaluate(() => {
      slotApp.game.tiles[6].kind = 5;
      slotApp.game.tiles[7].kind = 5;
      slotApp.disposeChildren(slotApp.board);
      slotApp.buildBoard();
      for (let id = 0; id < 7; id++) slotApp.pick(id);
    });
    await settle();
    await page.evaluate(() => slotApp.pick(7));
    await settle();
    assert.equal((await state()).status, 'playing');
    assert.equal(
      (await state()).tray.length,
      5,
      'matching resolves on the eighth slot before the full-rack loss',
    );
    assert.equal(await page.evaluate(() => slotApp.game.matches), 1);
    assert.equal(await page.evaluate(() => slotApp.trayNodes.size), 5);
    assert.equal(
      await page.evaluate(() => slotApp.extraSlot.node.getComponentsInChildren('cc.Label').length),
      0,
      'the pocket has only a video icon, no text or +1',
    );
    assert.deepEqual(errors, []);
    console.log(
      'PASS — extra-slot layout, real ad callbacks, cancelled/failed/completed viewing, eight-card landing, replay-safe lifecycle, seven-card shovel/undo and narrow-screen input.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
