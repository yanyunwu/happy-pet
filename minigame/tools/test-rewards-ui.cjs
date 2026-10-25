const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve(__dirname, '../output/qa-rewards');
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
  try {
    await page.addInitScript(() => {
      window.clubControls = [];
      window.clubResizes = new Set();
      window.clubOpens = 0;
      window.wx = {
        getWindowInfo: () => ({ windowWidth: innerWidth, windowHeight: innerHeight }),
        getDeviceInfo: () => ({ platform: 'devtools' }),
        getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
        login: ({ fail }) => fail(),
        onWindowResize: (callback) => window.clubResizes.add(callback),
        offWindowResize: (callback) => window.clubResizes.delete(callback),
        createGameClubButton: (options) => {
          const element = document.createElement('button');
          element.dataset.gameClub = 'true';
          Object.assign(element.style, {
            position: 'fixed',
            left: options.style.left + 'px',
            top: options.style.top + 'px',
            width: options.style.width + 'px',
            height: options.style.height + 'px',
            zIndex: 999,
            background: 'transparent',
            border: 'none',
            padding: 0,
          });
          document.body.append(element);
          const b = {
            options,
            element,
            visible: true,
            destroyed: false,
            listener: null,
            onTap(fn) {
              this.listener = fn;
            },
            offTap() {
              this.listener = null;
            },
            show() {
              this.visible = true;
              element.style.display = '';
            },
            hide() {
              this.visible = false;
              element.style.display = 'none';
            },
            destroy() {
              this.destroyed = true;
              this.visible = false;
              element.remove();
            },
          };
          element.onclick = () => {
            window.clubOpens++;
            b.listener?.({ errMsg: 'gameClubButton:ok' });
          };
          window.clubControls.push(b);
          return b;
        },
      };
      addEventListener('resize', () =>
        window.clubResizes.forEach((callback) =>
          callback({ windowWidth: innerWidth, windowHeight: innerHeight }),
        ),
      );
    });
    await page.goto(process.env.PREVIEW_URL || 'http://127.0.0.1:7457', {
      waitUntil: 'networkidle',
    });
    await page.waitForFunction(
      () =>
        window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')
          ?.onlineReady,
    );
    await page.evaluate(() => {
      window.rewardApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
      window.rewardApp.practice = true;
      Object.assign(window.rewardApp.save, {
        coins: 50,
        signInCount: 0,
        signedOn: '',
        bag: { undo: 0, shovel: 0, hint: 1, shuffle: 0 },
      });
      window.rewardApp.refreshHome();
      window.rewardApp.toasts.reset();
    });
    const waitModal = (name) =>
      page.waitForFunction((name) => {
        const m = window.rewardApp.modal;
        return (
          m?.name === name &&
          Math.abs(m.scale.x - 1) < 0.001 &&
          m.getComponent('cc.UIOpacity')?.opacity === 255
        );
      }, name);
    const clickNode = async (name) => {
      const p = await page.evaluate((name) => {
        const n = window.rewardApp.modal.getChildByName(name);
        return { x: n.position.x, y: -n.position.y };
      }, name);
      const viewport = page.viewportSize(),
        scale = Math.min(viewport.width / 720, viewport.height / 1560);
      await page.mouse.click(
        (viewport.width - 720 * scale) / 2 + p.x * scale,
        (viewport.height - 1560 * scale) / 2 + p.y * scale,
      );
    };
    const capture = async (name) => {
      await page.evaluate(() => window.rewardApp.toasts.reset());
      await page.screenshot({ path: path.join(output, name) });
    };
    const open = async (method, name) => {
      await page.evaluate((method) => window.rewardApp[method](), method);
      await waitModal(name);
    };
    const close = async () => {
      await clickNode('Close');
      await page.waitForFunction(() => !window.rewardApp.modal);
    };

    // Late acknowledgements cannot reopen a closed page or replace the player's next view.
    for (const scenario of ['close', 'replace', 'screen']) {
      await page.evaluate(() => {
        window.rewardApp.practice = false;
        window.claimRequests = 0;
        window.finishClaim = null;
        window.rewardApp.online = {
          signIn: () => {
            window.claimRequests++;
            return new Promise((resolve) => {
              window.finishClaim = resolve;
            });
          },
          detach() {},
        };
      });
      await open('showSignIn', 'SignIn');
      for (let i = 0; i < 3; i++) await clickNode('ClaimSignIn');
      await page.waitForFunction(() => !!window.finishClaim);
      assert.equal(await page.evaluate(() => window.claimRequests), 1, 'one request while pending');
      if (scenario === 'close') await close();
      else if (scenario === 'replace') await open('showBag', 'Bag');
      else await page.evaluate(() => window.rewardApp.clearScreen('game'));
      await page.evaluate(() => window.finishClaim());
      await page.waitForFunction(() => !window.rewardApp.networkBusy);
      // Screen changes retire the old overlay with its normal exit animation.
      if (scenario === 'screen') await page.waitForFunction(() => !window.rewardApp.modal);
      assert.equal(
        await page.evaluate(() => window.rewardApp.modal?.name ?? null),
        scenario === 'replace' ? 'Bag' : null,
        `late claim acknowledgement preserves ${scenario} destination`,
      );
      if (scenario === 'replace') await close();
      if (scenario === 'screen') {
        assert.equal(await page.evaluate(() => window.rewardApp.currentScreen), 'game');
        await page.evaluate(() => window.rewardApp.clearScreen('home'));
      }
    }

    await page.evaluate(() => {
      window.rewardApp.practice = true;
    });
    await open('showSignIn', 'SignIn');
    assert.equal(
      await page.locator('[data-game-club]:visible').count(),
      0,
      'native game-club control must not cover dialogs',
    );
    const labels = () =>
      page.evaluate(() =>
        window.rewardApp.modal.getComponentsInChildren('cc.Label').map((l) => l.string),
      );
    let words = await labels();
    assert(!words.includes('今日奖励'));
    assert(!words.includes('每天一份森林好礼'));
    assert(words.includes('七日补给'));
    assert(words.includes('+20'));
    assert(words.some((word) => word.includes('第7天')));
    await capture('signin-ready.png');
    await clickNode('ClaimSignIn');
    await waitModal('SignIn');
    assert.deepEqual(
      await page.evaluate(() => [
        window.rewardApp.save.coins,
        window.rewardApp.save.bag.hint,
        window.rewardApp.save.signInCount,
      ]),
      [70, 2, 1],
    );
    await clickNode('ClaimSignIn');
    assert.equal(
      await page.evaluate(() => window.rewardApp.save.signInCount),
      1,
      'claimed rewards are not granted twice',
    );
    await capture('signin-claimed.png');
    await close();
    await page.evaluate(() => {
      window.rewardApp.save.signInCount = 6;
      window.rewardApp.save.signedOn = '';
    });
    await open('showSignIn', 'SignIn');
    words = await labels();
    assert(words.includes('+120'));
    await clickNode('ClaimSignIn');
    await waitModal('SignIn');
    assert.equal(await page.evaluate(() => window.rewardApp.save.signInCount), 7);
    await capture('signin-seven.png');
    await close();
    await page.evaluate(() => {
      window.rewardApp.save.signedOn = '';
    });
    await open('showSignIn', 'SignIn');
    assert((await labels()).includes('+20'), 'new cycle returns to first reward');
    await close();

    await open('showBag', 'Bag');
    await capture('bag.png');
    assert((await labels()).includes('×0'));
    assert.equal(await page.locator('[data-game-club]:visible').count(), 0);
    await close();
    await page.evaluate(() => {
      window.rewardApp.save.bag = { undo: 123456, shovel: 0, hint: 123, shuffle: 0 };
    });
    await page.setViewportSize({ width: 320, height: 700 });
    await open('showBag', 'Bag');
    assert((await labels()).includes('×123456'));
    await capture('bag-narrow.png');
    await close();
    await open('showSignIn', 'SignIn');
    await capture('signin-narrow.png');
    await close();
    await page.setViewportSize({ width: 360, height: 780 });
    await page.waitForFunction(
      () => document.querySelector('[data-game-club]')?.getBoundingClientRect().width > 0,
    );
    assert.equal(await page.locator('[data-game-club]:visible').count(), 1);
    await capture('home.png');
    await page.locator('[data-game-club]:visible').click();
    assert.equal(await page.evaluate(() => window.clubOpens), 1);
    const opts = await page.evaluate(
      () => window.clubControls.findLast((b) => b.visible && !b.destroyed).options,
    );
    assert.equal(opts.openlink, undefined, 'default destination is this mini-game game club');
    await open('showMenu', 'HomeMenu');
    assert.equal(await page.locator('[data-game-club]:visible').count(), 0);
    await page.evaluate(() => window.rewardApp.showSettings());
    await waitModal('Settings');
    await close();
    await page.evaluate(() => cc.game.emit(cc.Game.EVENT_HIDE));
    assert.equal(await page.locator('[data-game-club]:visible').count(), 0);
    await page.evaluate(() => cc.game.emit(cc.Game.EVENT_SHOW));
    await page.waitForFunction(() => document.querySelector('[data-game-club]'));
    await page.evaluate(() => window.rewardApp.clearScreen('game'));
    assert.equal(await page.locator('[data-game-club]:visible').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      'PASS — reward states, claim lifecycle, inventory counts, narrow layout and native game-club visibility.',
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
