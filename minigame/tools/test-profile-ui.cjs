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
  let delayedAvatar;
  let avatarRequested;
  const delayedAvatarReady = new Promise((resolve) => {
    avatarRequested = resolve;
  });
  page.on('pageerror', (e) => errors.push(e.message));
  const click = (x, y) => page.mouse.click(x * 0.6, y * 0.6);
  const waitModal = (name) =>
    page.waitForFunction((name) => {
      const m = window.profileApp.modal;
      return m?.name === name && Math.abs(m.scale.x - 1) < 0.001;
    }, name);
  try {
    await page.route('https://thirdwx.qlogo.cn/**', (route) => {
      if (route.request().url().includes('qa-delayed')) {
        if (delayedAvatar)
          return route.fulfill({ status: 404, contentType: 'text/plain', body: 'delayed failure' });
        delayedAvatar = route;
        avatarRequested();
        return;
      }
      return route.fulfill({
        status: route.request().url().includes('qa-expired') ? 404 : 200,
        contentType: route.request().url().includes('qa-expired') ? 'text/plain' : 'image/png',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: route.request().url().includes('qa-expired')
          ? 'expired avatar'
          : fs.readFileSync(path.resolve(__dirname, '../assets/resources/cartoon/pets/1.png')),
      });
    });
    await page.addInitScript(() => {
      window.profileControls = [];
      window.profileWrites = [];
      window.serverProfile = {
        id: 'qa-player',
        nickname: '林间旅人',
        avatarUrl: 'https://thirdwx.qlogo.cn/qa-delayed/132',
      };
      window.profileAuthorized = sessionStorage.getItem('qa-authorized') === 'true';
      window.profileReads = 0;
      window.wechatProfile = {
        nickName: '微信新昵称',
        avatarUrl: 'https://thirdwx.qlogo.cn/qa-latest/132',
      };
      window.wx = {
        getDeviceInfo: () => ({ platform: 'ios' }),
        getWindowInfo: () => ({ windowWidth: 432, windowHeight: 936 }),
        getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop' } }),
        login: (opts) => opts.success({ code: 'qa-profile-code' }),
        getSetting: ({ success }) =>
          success({ authSetting: { 'scope.userInfo': window.profileAuthorized } }),
        getPrivacySetting: ({ success }) => success({ needAuthorization: false }),
        getUserInfo: ({ success, fail }) => {
          window.profileReads++;
          if (!window.profileAuthorized) return fail({ errMsg: 'getUserInfo:fail auth deny' });
          success({ errMsg: 'getUserInfo:ok', userInfo: { ...window.wechatProfile } });
        },
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
                window.profileAuthorized = false;
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
    assert.equal(
      await page.evaluate(
        () => window.profileApp.modal.getComponentsInChildren('cc.EditBox').length,
      ),
      0,
      'nickname must be read-only and come from WeChat',
    );
    assert.equal(
      await page.evaluate(() => !!window.profileApp.modal.getChildByName('SaveProfile')),
      false,
      'no separate Save step',
    );
    assert.equal(
      await page.evaluate(() => window.profileReads),
      0,
      'no user-info reads before consent',
    );
    await click(360, 862);
    assert.equal(await page.locator('input:visible').count(), 0);
    const waitButton = () =>
      page.waitForFunction(() => window.profileControls.some((b) => b.visible && !b.destroyed));
    const nickname = () =>
      page.evaluate(
        () =>
          window.profileApp.modal.getChildByName('WechatNickname').getComponent('cc.Label').string,
      );
    const authorize = async (nickName, avatar = 'qa-avatar') => {
      await waitButton();
      await page.evaluate(
        ({ nickName, avatar }) => {
          const b = window.profileControls.findLast((b) => b.visible && !b.destroyed);
          window.oldProfileCallback = b.listener;
          window.profileAuthorized = true;
          sessionStorage.setItem('qa-authorized', 'true');
          window.wechatProfile = {
            nickName,
            avatarUrl: 'https://thirdwx.qlogo.cn/' + avatar + '/132',
          };
          b.listener({ errMsg: 'getUserInfo:ok', userInfo: { ...window.wechatProfile } });
        },
        { nickName, avatar },
      );
    };
    await delayedAvatarReady;
    await page.evaluate(() => {
      const b = window.profileControls.findLast((b) => b.visible && !b.destroyed);
      b.listener({
        errMsg: 'getUserInfo:fail please go to mp to announce your privacy usage',
        errno: 1026,
      });
    });
    assert.equal(
      await page.evaluate(
        () =>
          window.profileApp.modal.getChildByName('ProfileStatus').getComponent('cc.Label').string,
      ),
      '微信资料授权暂不可用，请稍后再试',
      'the platform failure remains visible after the toast disappears',
    );
    assert.equal(await nickname(), '林间旅人');
    assert.equal(await page.evaluate(() => window.profileWrites.length), 0);
    await delayedAvatar.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: 'delayed failure',
    });
    await page.waitForFunction(
      () => window.profileApp.modal.getComponent('PlayerProfileDialog').avatarFailed,
    );
    assert.equal(
      await page.evaluate(
        () =>
          window.profileApp.modal.getChildByName('ProfileStatus').getComponent('cc.Label').string,
      ),
      '微信资料授权暂不可用，请稍后再试',
      'an earlier image failure cannot replace the latest authorization error',
    );
    await page.screenshot({ path: path.join(output, 'privacy-unavailable.png') });

    await authorize('微信昵称 🌲');
    await page.waitForFunction(() => window.serverProfile.nickname === '微信昵称 🌲');
    assert.equal(await nickname(), '微信昵称 🌲');
    await page.waitForFunction(
      () => !!window.profileApp.modal.getComponent('PlayerProfileDialog').remoteFrame,
    );
    assert.equal(
      await page.evaluate(() => window.serverProfile.avatarUrl),
      'https://thirdwx.qlogo.cn/qa-avatar/132',
    );
    await waitButton();
    await page.screenshot({ path: path.join(output, 'saved.png') });

    await page.evaluate(() => {
      window.failProfileSave = true;
    });
    await authorize('保存失败的新昵称');
    await page.waitForFunction(
      () => !window.profileApp.modal.getComponent('PlayerProfileDialog').syncing,
    );
    assert.equal(await nickname(), '微信昵称 🌲', 'failed writes preserve confirmed display');
    assert.equal(await page.evaluate(() => window.serverProfile.nickname), '微信昵称 🌲');
    await page.evaluate(() => {
      window.failProfileSave = false;
    });
    await click(360, 1138);
    await page.waitForFunction(() => window.serverProfile.nickname === '保存失败的新昵称');

    await authorize('头像不可用但昵称有效', 'qa-expired');
    await page.waitForFunction(() => window.serverProfile.nickname === '头像不可用但昵称有效');
    await page.waitForFunction(() =>
      window.profileApp.modal
        .getChildByName('ProfileStatus')
        .getComponent('cc.Label')
        .string.includes('暂时无法显示'),
    );
    assert.equal(await nickname(), '头像不可用但昵称有效');
    assert.equal(
      await page.evaluate(() => window.serverProfile.avatarUrl),
      'https://thirdwx.qlogo.cn/qa-expired/132',
      'image failures must not prevent persistence',
    );

    await page.evaluate(() => cc.game.emit(cc.Game.EVENT_HIDE));
    assert(await page.evaluate(() => window.profileControls.every((b) => !b.visible)));
    await page.evaluate(() => {
      window.wechatProfile = {
        nickName: '返回后自动同步',
        avatarUrl: 'https://thirdwx.qlogo.cn/qa-return/132',
      };
      cc.game.emit(cc.Game.EVENT_SHOW);
    });
    await page.waitForFunction(() => window.serverProfile.nickname === '返回后自动同步');
    await waitButton();
    await page.evaluate(() => window.profileApp.closeModal());
    assert(await page.evaluate(() => window.profileControls.every((b) => !b.visible)));
    await page.waitForFunction(() => !window.profileApp.modal);
    await page.evaluate(() =>
      window.oldProfileCallback({
        userInfo: { avatarUrl: 'https://thirdwx.qlogo.cn/stale/132', nickName: '旧回调' },
      }),
    );
    assert.equal(await page.evaluate(() => window.serverProfile.nickname), '返回后自动同步');

    await page.evaluate(() => window.profileApp.showPersonalSettings());
    await waitModal('PersonalSettings');
    await waitButton();
    assert.equal(await nickname(), '返回后自动同步');
    await page.evaluate(() => {
      window.switchAccountOnSave = true;
    });
    await authorize('旧账号资料');
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
    assert.equal(await page.evaluate(() => window.profileWrites.length), writesBeforeReload);
    assert.equal(await nickname(), '另一位玩家');
    await page.evaluate(() => window.profileApp.home());
    assert(await page.evaluate(() => window.profileControls.every((b) => !b.visible)));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.serverProfile.nickname === '微信新昵称');
    assert.equal(
      await page.evaluate(() => window.profileControls.length),
      0,
      'authorized players sync at login without opening settings',
    );
    assert.equal(await page.evaluate(() => window.profileWrites.length), 1);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, 'result.json'),
      JSON.stringify({ success: true, errors }, null, 2),
    );
    console.log(
      'PASS — read-only WeChat identity, first consent/autosave, login auto-sync, retry, image failure, account isolation and native control lifecycle.',
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
