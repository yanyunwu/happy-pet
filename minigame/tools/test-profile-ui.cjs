const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  chromium,
} = require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output = path.resolve(__dirname, '../output/qa-profile');
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const click = (x, y) => page.mouse.click(x * 0.6, y * 0.6);
  const waitModal = (name) =>
    page.waitForFunction((name) => {
      const m = window.profileApp.modal;
      return m?.name === name && Math.abs(m.scale.x - 1) < 0.001;
    }, name);
  try {
    await page.route('https://thirdwx.qlogo.cn/**', (route) =>
      route.fulfill({
        status: route.request().url().includes('qa-expired') ? 404 : 200,
        contentType: route.request().url().includes('qa-expired') ? 'text/plain' : 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: route.request().url().includes('qa-expired')
          ? 'expired avatar'
          : fs.readFileSync(path.resolve(__dirname, '../assets/resources/cartoon/pets/1.png')),
      }),
    );
    await page.addInitScript(() => {
      window.profileControls = [];
      window.profileWrites = [];
      window.serverProfile = { id: 'qa-player', nickname: '林间旅人', avatarUrl: '' };
      window.wx = {
        getDeviceInfo: () => ({ platform: 'ios' }),
        getWindowInfo: () => ({ windowWidth: 432, windowHeight: 936 }),
        getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
        login: (opts) => opts.success({ code: 'qa-profile-code' }),
        request: (opts) => {
          if (opts.method === 'PATCH') throw new Error('Native wx.request does not support PATCH');
          let body = {};
          if (opts.url.endsWith('/auth/wechat'))
            body = { accessToken: 'qa-profile-token', user: { ...window.serverProfile } };
          else if (opts.url.endsWith('/user/assets'))
            body = {
              coins: 20,
              bag: { undo: 1, shovel: 1, hint: 1, shuffle: 1 },
              signInCount: 0,
              signedOn: '',
            };
          else if (opts.url.endsWith('/user/me')) {
            if (opts.method === 'PUT') {
              window.profileWrites.push(opts.data);
              if (window.switchAccountOnSave) {
                window.switchAccountOnSave = false;
                window.serverProfile = { id: 'qa-player-b', nickname: '另一位玩家', avatarUrl: '' };
                return opts.success({
                  statusCode: 401,
                  data: { error: { code: 'UNAUTHORIZED', message: '请重新登录' } },
                });
              }
              if (window.failProfileSave)
                return opts.success({
                  statusCode: 503,
                  data: { error: { code: 'UNAVAILABLE', message: '请稍后再试' } },
                });
              Object.assign(window.serverProfile, opts.data);
            }
            body = { ...window.serverProfile };
          }
          opts.success({ statusCode: 200, data: body });
        },
        createUserInfoButton: (opts) => {
          const b = {
            style: opts.style,
            visible: true,
            destroyed: false,
            listener: null,
            onTap(fn) {
              this.listener = fn;
              this.lastListener = fn;
            },
            offTap() {
              this.listener = null;
            },
            show() {
              this.visible = true;
            },
            hide() {
              this.visible = false;
            },
            destroy() {
              this.destroyed = true;
              this.visible = false;
            },
          };
          window.profileControls.push(b);
          return b;
        },
      };
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
      window.profileApp = cc.director
        .getScene()
        .getChildByName('StarIsleGame')
        .getComponent('StarIsle');
    });
    await click(56, 75);
    await waitModal('HomeMenu');
    const entries = await page.evaluate(() => window.profileApp.modal.children.map((n) => n.name));
    assert(entries.includes('PersonalSettings'), 'home menu needs a personal-settings entry');
    for (const name of ['CustomerService', 'Announcements']) {
      assert(
        await page.evaluate(
          (name) =>
            !!window.profileApp.modal
              .getChildByName(name)
              .getChildByName('MenuIcon')
              ?.getComponent('cc.Sprite'),
          name,
        ),
        'menu actions use textured woodland icons',
      );
    }
    await page.screenshot({ path: path.join(output, 'menu.png') });
    const personal = await page.evaluate(() => {
      const n = window.profileApp.modal.getChildByName('PersonalSettings');
      return { x: n.position.x, y: -n.position.y };
    });
    await click(personal.x, personal.y);
    await waitModal('PersonalSettings');
    await page.waitForFunction(() => window.profileControls.some((b) => b.visible && !b.destroyed));
    await page.screenshot({ path: path.join(output, 'personal.png') });
    await click(360, 901);
    const input = page.locator('input:visible');
    await input.fill('森林小伙伴');
    await input.press('Tab');
    await page.waitForFunction(() => window.profileControls.some((b) => b.visible && !b.destroyed));
    await page.evaluate(() => {
      const b = window.profileControls.findLast((b) => b.visible && !b.destroyed);
      window.oldProfileCallback = b.listener;
      b.listener({
        errMsg: 'getUserInfo:ok',
        userInfo: { avatarUrl: 'https://thirdwx.qlogo.cn/qa-avatar/132', nickName: '微信昵称' },
      });
    });
    assert.equal(
      await page.evaluate(() => window.profileWrites.length),
      0,
      'avatar sync only updates the draft',
    );
    await page.waitForFunction(
      () => window.profileApp.modal.getComponent('PlayerProfileDialog').avatarChanged,
    );
    await page.evaluate(() => {
      window.failProfileSave = true;
    });
    await click(360, 1138);
    assert.equal(await page.evaluate(() => window.serverProfile.nickname), '林间旅人');
    await page.evaluate(() => {
      window.failProfileSave = false;
    });
    await click(360, 1138);
    await page.waitForFunction(() => window.serverProfile.nickname === '森林小伙伴');
    assert.equal(
      await page.evaluate(() => window.serverProfile.avatarUrl),
      'https://thirdwx.qlogo.cn/qa-avatar/132',
    );
    await page.evaluate(() => cc.game.emit(cc.Game.EVENT_HIDE));
    assert(await page.evaluate(() => window.profileControls.every((b) => !b.visible)));
    await page.evaluate(() => cc.game.emit(cc.Game.EVENT_SHOW));
    await page.waitForFunction(() => window.profileControls.some((b) => b.visible && !b.destroyed));
    await page.screenshot({ path: path.join(output, 'saved.png') });
    await page.evaluate(() => window.profileApp.closeModal());
    assert(
      await page.evaluate(() => window.profileControls.every((b) => !b.visible)),
      'close immediately hides native authorization',
    );
    await page.waitForFunction(() => !window.profileApp.modal);
    await page.evaluate(() =>
      window.oldProfileCallback({
        userInfo: { avatarUrl: 'https://thirdwx.qlogo.cn/stale/132', nickName: '旧回调' },
      }),
    );
    assert.equal(
      await page.evaluate(() => window.serverProfile.avatarUrl),
      'https://thirdwx.qlogo.cn/qa-avatar/132',
    );
    await page.evaluate(() => window.profileApp.showPersonalSettings());
    await waitModal('PersonalSettings');
    await page.waitForFunction(() => window.profileControls.some((b) => b.visible && !b.destroyed));
    assert.equal(
      await page.evaluate(
        () =>
          window.profileApp.modal
            .getChildByName('NicknameField')
            .getChildByName('NicknameInput')
            .getComponent('cc.EditBox').string,
      ),
      '森林小伙伴',
    );
    await page.evaluate(() =>
      window.profileControls
        .findLast((b) => b.visible && !b.destroyed)
        .listener({ userInfo: { avatarUrl: 'https://thirdwx.qlogo.cn/qa-expired/132' } }),
    );
    await page.waitForFunction(() =>
      window.profileApp.modal
        .getChildByName('ProfileStatus')
        .getComponent('cc.Label')
        .string.includes('读取失败'),
    );
    await click(360, 1138);
    await page.waitForFunction(
      () => !window.profileApp.modal.getComponent('PlayerProfileDialog').saving,
    );
    assert.equal(
      await page.evaluate(() => window.serverProfile.avatarUrl),
      'https://thirdwx.qlogo.cn/qa-avatar/132',
      'a failed image candidate cannot replace the saved avatar',
    );

    await page.evaluate(() => {
      window.profileApp.modal
        .getChildByName('NicknameField')
        .getChildByName('NicknameInput')
        .getComponent('cc.EditBox').string = '旧账号草稿';
      window.switchAccountOnSave = true;
    });
    await click(360, 1138);
    await page.waitForFunction(
      () =>
        window.serverProfile.id === 'qa-player-b' &&
        !window.profileApp.modal.getComponent('PlayerProfileDialog').ready,
    );
    const writesBeforeReload = await page.evaluate(() => window.profileWrites.length);
    await click(360, 1138);
    await page.waitForFunction(
      () => window.profileApp.modal.getComponent('PlayerProfileDialog').ready,
    );
    assert.equal(
      await page.evaluate(() => window.profileWrites.length),
      writesBeforeReload,
      'second Save after an account switch reloads instead of writing the old draft',
    );
    assert.equal(await page.evaluate(() => window.serverProfile.nickname), '另一位玩家');
    await page.evaluate(async () => {
      window.serverProfile = { id: 'qa-player-c', nickname: '第三位玩家', avatarUrl: '' };
      await window.profileApp.online.login();
    });
    await page.waitForFunction(
      () => !window.profileApp.modal.getComponent('PlayerProfileDialog').ready,
    );
    await click(360, 1138);
    await page.waitForFunction(
      () => window.profileApp.modal.getComponent('PlayerProfileDialog').ready,
    );
    assert.equal(
      await page.evaluate(() => window.profileWrites.length),
      writesBeforeReload,
      'an idle account switch also invalidates the draft',
    );
    await page.evaluate(() => window.profileApp.home());
    assert(await page.evaluate(() => window.profileControls.every((b) => !b.visible)));
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({ success: true, errors }, null, 2),
    );
    console.log(
      'PASS — woodland menu, editable nickname, avatar draft/save, failure preservation and native control lifecycle.',
    );
  } catch (e) {
    console.error('Runtime errors:', errors);
    await page.screenshot({ path: path.join(output, 'failure.png') });
    throw e;
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
