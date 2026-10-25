const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');

function load(name) {
  const file = path.resolve(__dirname, `../assets/scripts/core/${name}.ts`);
  const mod = new Module(file);
  mod.require = (request) => load(request.replace(/^\.\//, ''));
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    file,
  );
  return mod.exports;
}

const { OnlineClient, OnlineError } = load('OnlineClient');
const baseURL = 'https://profile.example/api/v1';
const original = { id: 'player-a', nickname: '林间旅人', avatarUrl: 'https://wx.qlogo.cn/old/132' };
const other = {
  id: 'player-b',
  nickname: '另一位玩家',
  avatarUrl: 'https://wx.qlogo.cn/other/132',
};
const assets = {
  coins: 0,
  bag: { undo: 0, shovel: 0, hint: 0, shuffle: 0 },
  signInCount: 0,
  signedOn: '',
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const tests = [];
const test = (name, run) => tests.push({ name, run });

function accountRuntime() {
  const profiles = new Map([
    [original.id, copy(original)],
    [other.id, copy(other)],
  ]);
  const values = new Map();
  const calls = [];
  const tokens = new Map();
  let userId = original.id;
  let loginCount = 0;
  let intercept = null;
  global.wx = {
    login: ({ success }) => success({ code: 'test-login-code' }),
    request: (options) => {
      assert(
        ['OPTIONS', 'GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'TRACE', 'CONNECT'].includes(
          options.method,
        ),
        `wx.request does not support ${options.method}`,
      );
      calls.push(options);
      if (options.url.endsWith('/auth/wechat')) {
        const token = `token-${++loginCount}`;
        tokens.set(token, userId);
        options.success({
          statusCode: 200,
          data: { accessToken: token, user: copy(profiles.get(userId)) },
        });
        return;
      }
      if (options.url.endsWith('/user/assets')) {
        options.success({ statusCode: 200, data: assets });
        return;
      }
      if (intercept?.(options)) return;
      assert.equal(options.url, baseURL + '/user/me');
      const owner = tokens.get(options.header.Authorization?.slice(7));
      if (!owner) return options.success({ statusCode: 401, data: {} });
      if (options.method === 'PUT')
        profiles.set(owner, { ...profiles.get(owner), ...options.data });
      options.success({ statusCode: 200, data: copy(profiles.get(owner)) });
    },
  };
  return {
    calls,
    profiles,
    values,
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    setUser: (id) => {
      userId = id;
    },
    setInterceptor: (handler) => {
      intercept = handler;
    },
    get logins() {
      return loginCount;
    },
  };
}

test('an authorized login automatically saves both WeChat nickname and avatar', async () => {
  const runtime = accountRuntime();
  let reads = 0;
  global.wx.getSetting = ({ success }) => success({ authSetting: { 'scope.userInfo': true } });
  global.wx.getUserInfo = ({ success, withCredentials, lang }) => {
    assert.equal(withCredentials, false);
    assert.equal(lang, 'zh_CN');
    reads++;
    success({ userInfo: { nickName: '微信小伙伴', avatarUrl: 'http://wx.qlogo.cn/new/132' } });
  };
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  await new Promise(setImmediate);
  assert.deepEqual(client.profile, {
    id: original.id,
    nickname: '微信小伙伴',
    avatarUrl: 'https://wx.qlogo.cn/new/132',
  });
  assert.equal(reads, 1);
  assert.equal(runtime.calls.filter((call) => call.method === 'PUT').length, 1);
  await client.syncWechatProfile();
  assert.equal(
    runtime.calls.filter((call) => call.method === 'PUT').length,
    1,
    'unchanged authorized profiles do not create redundant writes',
  );
});

test('unapproved profiles never trigger a silent user-info request or overwrite stored data', async () => {
  for (const allowed of [false, undefined]) {
    const runtime = accountRuntime();
    global.wx.getSetting = ({ success }) => success({ authSetting: { 'scope.userInfo': allowed } });
    global.wx.getUserInfo = () => assert.fail('user information requires prior authorization');
    const client = new OnlineClient(baseURL, runtime.storage);
    await client.login();
    assert.equal(await client.syncWechatProfile(), null);
    assert.deepEqual(client.profile, original);
    assert.equal(runtime.calls.filter((call) => call.method === 'PUT').length, 0);
  }
});

test('native authorization saves the nickname and avatar together, without a separate save', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  await client.syncWechatProfile({
    nickName: '微信名字 🌲',
    avatarUrl: 'https://wx.qlogo.cn/live/132',
  });
  assert.deepEqual(client.profile, {
    id: original.id,
    nickname: '微信名字 🌲',
    avatarUrl: 'https://wx.qlogo.cn/live/132',
  });
  const writes = runtime.calls.filter((call) => call.method === 'PUT');
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].data, {
    nickname: '微信名字 🌲',
    avatarUrl: 'https://wx.qlogo.cn/live/132',
  });
  for (const invalid of [
    { nickName: '', avatarUrl: 'https://wx.qlogo.cn/live/132' },
    { nickName: '微信用户', avatarUrl: '' },
    { nickName: 'bad\nname', avatarUrl: 'https://wx.qlogo.cn/live/132' },
  ])
    await assert.rejects(client.syncWechatProfile(invalid));
  assert.equal(runtime.calls.filter((call) => call.method === 'PUT').length, 1);
});

test('slow authorized reads do not block login and concurrent reads share one synchronization', async () => {
  const runtime = accountRuntime();
  let finish;
  let reads = 0;
  global.wx.getSetting = ({ success }) => success({ authSetting: { 'scope.userInfo': true } });
  global.wx.getUserInfo = ({ success }) => {
    reads++;
    finish = success;
  };
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  await new Promise(setImmediate);
  assert.deepEqual(client.profile, original, 'login completes while WeChat is still pending');
  const first = client.syncWechatProfile();
  const second = client.syncWechatProfile();
  finish({ userInfo: { nickName: '同步完成', avatarUrl: original.avatarUrl } });
  assert.deepEqual(await first, await second);
  assert.equal(reads, 1);
  assert.equal(runtime.calls.filter((call) => call.method === 'PUT').length, 1);
});

test('late WeChat results cannot be saved to an account that changed while reading', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  await new Promise(setImmediate);
  let finish;
  global.wx.getSetting = ({ success }) => success({ authSetting: { 'scope.userInfo': true } });
  global.wx.getUserInfo = ({ success }) => {
    finish = success;
  };
  const syncing = client.syncWechatProfile();
  await new Promise(setImmediate);
  runtime.setUser(other.id);
  global.wx.getSetting = ({ success }) => success({ authSetting: { 'scope.userInfo': false } });
  await client.login();
  finish({ userInfo: { nickName: '旧账号微信名', avatarUrl: original.avatarUrl } });
  await assert.rejects(syncing, (error) => error.code === 'PROFILE_ACCOUNT_CHANGED');
  assert.deepEqual(client.profile, other);
  assert.equal(runtime.calls.filter((call) => call.method === 'PUT').length, 0);
});

test('a new login account starts its own auto-sync while the old SDK callback is pending', async () => {
  const runtime = accountRuntime();
  const reads = [];
  global.wx.getSetting = ({ success }) => success({ authSetting: { 'scope.userInfo': true } });
  global.wx.getUserInfo = ({ success }) => reads.push(success);
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  await new Promise(setImmediate);
  const oldSync = client.syncWechatProfile();
  runtime.setUser(other.id);
  await client.login();
  await new Promise(setImmediate);
  reads[0]({ userInfo: { nickName: '旧微信名', avatarUrl: original.avatarUrl } });
  reads[1]?.({ userInfo: { nickName: '新账号微信名', avatarUrl: other.avatarUrl } });
  await assert.rejects(oldSync, (error) => error.code === 'PROFILE_ACCOUNT_CHANGED');
  await new Promise(setImmediate);
  assert.equal(reads.length, 2, 'account B needs an independent authorized read');
  assert.deepEqual(client.profile, { ...other, nickname: '新账号微信名' });
  assert.deepEqual(runtime.profiles.get(original.id), original);
});

test('authorized reads bound SDK timeouts and reject incomplete data', async () => {
  const { readAuthorizedWechatProfile } = load('WechatProfile');
  global.wx = { getSetting: () => {}, getUserInfo: () => {} };
  await assert.rejects(readAuthorizedWechatProfile(10), /超时/);
  global.wx.getSetting = ({ success }) => success({ authSetting: { 'scope.userInfo': true } });
  global.wx.getUserInfo = ({ success }) => success({ userInfo: { avatarUrl: original.avatarUrl } });
  await assert.rejects(readAuthorizedWechatProfile(), /昵称/);
  global.wx.getUserInfo = ({ fail }) => fail({ errMsg: 'getUserInfo:fail auth deny' });
  await assert.rejects(readAuthorizedWechatProfile(), /微信/);
  delete global.wx;
  assert.equal(await readAuthorizedWechatProfile(), null);
});

test('automatic retrieval waits for privacy consent even when user-info scope is already granted', async () => {
  const { readAuthorizedWechatProfile } = load('WechatProfile');
  let reads = 0;
  global.wx = {
    getSetting: ({ success }) => success({ authSetting: { 'scope.userInfo': true } }),
    getPrivacySetting: ({ success }) => success({ needAuthorization: true }),
    getUserInfo: ({ success }) => {
      reads++;
      success({ userInfo: { nickName: '微信昵称', avatarUrl: original.avatarUrl } });
    },
  };
  const waiting = await readAuthorizedWechatProfile();
  assert.equal(reads, 0, 'calling getUserInfo here would open an unexpected privacy prompt');
  assert.equal(waiting, null);
  global.wx.getPrivacySetting = ({ success }) => success({ needAuthorization: false });
  assert.deepEqual(await readAuthorizedWechatProfile(), {
    nickName: '微信昵称',
    avatarUrl: original.avatarUrl,
  });
  assert.equal(reads, 1);
  global.wx.getPrivacySetting = ({ fail }) => fail();
  await assert.rejects(readAuthorizedWechatProfile(), /微信/);
  assert.equal(reads, 1, 'a failed privacy lookup must not fall through to a privacy API');
});

test('privacy rejection during automatic reads preserves the account and reports the platform error', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  await new Promise(setImmediate);
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    global.wx.getSetting = ({ success }) => success({ authSetting: { 'scope.userInfo': true } });
    // false also means that no privacy collection has been declared in the MP console.
    global.wx.getPrivacySetting = ({ success }) => success({ needAuthorization: false });
    global.wx.getUserInfo = ({ fail }) =>
      fail({
        errMsg: 'getUserInfo:fail please go to mp to announce your privacy usage',
        errno: 1026,
      });
    await assert.rejects(client.syncWechatProfile(), /微信资料授权暂不可用/);
    assert.deepEqual(client.profile, original);
    assert.equal(runtime.calls.filter((call) => call.method === 'PUT').length, 0);
    assert.match(JSON.stringify(warnings), /1026/);
    assert.match(JSON.stringify(warnings), /getUserInfo/);
  } finally {
    console.warn = warn;
  }
});

test('login caches a confirmed profile without exposing mutable draft references', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  assert.equal(client.profile, null);
  const notifications = [];
  client.onProfile = (profile) => {
    notifications.push(copy(profile));
    if (profile) profile.nickname = 'external mutation';
  };
  await client.login();
  assert.deepEqual(client.profile, original);
  client.profile.nickname = 'draft';
  assert.deepEqual(client.profile, original);
  assert.deepEqual(notifications, [original]);
});

test('profile GET and PUT use authenticated native-supported requests and survive a new login', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  assert.deepEqual(await client.getProfile(), original);
  const result = await client.updateProfile({ nickname: '  松果玩家 🌲  ' });
  assert.deepEqual(result, { ...original, nickname: '松果玩家 🌲' });
  const write = runtime.calls.find((call) => call.method === 'PUT');
  assert.equal(write.url, baseURL + '/user/me');
  assert.equal(write.header.Authorization, 'Bearer token-1');
  assert.deepEqual(write.data, { nickname: '松果玩家 🌲' });
  result.nickname = 'unsaved draft';
  assert.equal(client.profile.nickname, '松果玩家 🌲');
  const updated = await client.updateProfile({
    nickname: '头像同步',
    avatarUrl: 'http://thirdwx.qlogo.cn/new/132',
  });
  assert.equal(updated.avatarUrl, 'https://thirdwx.qlogo.cn/new/132');
  const reopened = new OnlineClient(baseURL, runtime.storage);
  assert.deepEqual(await reopened.getProfile(), updated);
  assert.equal(
    runtime.values.size,
    0,
    'profile requests must not create persistent gameplay events or draft records',
  );
  assert.equal(client.pending, false);
});

test('failed, invalid and unauthorized profile updates preserve confirmed details', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  runtime.setInterceptor((options) => {
    options.fail();
    return true;
  });
  await assert.rejects(client.updateProfile({ nickname: '未保存' }), {
    message: '网络连接中断，资料尚未保存，请重试',
  });
  assert.deepEqual(client.profile, original);
  await assert.rejects(client.getProfile(), { message: '暂时无法读取资料，请稍后重试' });
  assert.deepEqual(client.profile, original);
  const before = runtime.calls.length;
  for (const nickname of ['', '   ', '🌲'.repeat(33)])
    await assert.rejects(client.updateProfile({ nickname }));
  await assert.rejects(
    client.updateProfile({ nickname: '玩家', avatarUrl: 'https://evil.example/avatar' }),
  );
  assert.equal(runtime.calls.length, before, 'invalid drafts are rejected before requests');
  runtime.setInterceptor((options) => {
    options.success({ statusCode: 200, data: { id: original.id } });
    return true;
  });
  await assert.rejects(client.getProfile(), /资料/);
  assert.deepEqual(client.profile, original);
  runtime.setInterceptor((options) => {
    options.success({ statusCode: 401, data: {} });
    return true;
  });
  await assert.rejects(
    client.updateProfile({ nickname: '未授权' }),
    (error) => error instanceof OnlineError && error.status === 401,
  );
  assert.equal(runtime.logins, 2, 'a profile operation retries expired authentication only once');
  assert.deepEqual(client.profile, original);
});

test('in-flight drafts stay separate from confirmed data and cannot replay queued game actions', async () => {
  const runtime = accountRuntime();
  const queueKey = 'happy-pet-api:' + encodeURIComponent(baseURL) + ':happy-pet-upload-v1';
  const queue = JSON.stringify([
    {
      userId: original.id,
      sessionId: 'unfinished',
      events: [{ seq: 1, type: 'pick', tileId: 7, at: 1 }],
    },
  ]);
  runtime.values.set(queueKey, queue);
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.getProfile();
  let pending;
  runtime.setInterceptor((options) => {
    pending = options;
    return true;
  });
  const draft = { nickname: '🌲'.repeat(32) };
  const saving = client.updateProfile(draft);
  draft.nickname = 'changed after clicking save';
  await new Promise(setImmediate);
  assert.deepEqual(client.profile, original);
  assert.equal(pending.data.nickname, '🌲'.repeat(32));
  pending.success({ statusCode: 200, data: { ...original, nickname: pending.data.nickname } });
  const saved = await saving;
  assert.equal(saved.nickname, '🌲'.repeat(32));
  assert.deepEqual(client.profile, saved);
  assert.equal(runtime.values.get(queueKey), queue);
  assert.equal(client.pending, true);
  assert(!runtime.calls.some((call) => call.url.includes('/events')));
});

test('profile login and renewal transport failures never claim an unsaved draft was stored', async () => {
  for (const write of [false, true]) {
    const expected = write ? '网络连接中断，资料尚未保存，请重试' : '暂时无法读取资料，请稍后重试';
    const invoke = (client) =>
      write ? client.updateProfile({ nickname: '未保存' }) : client.getProfile();
    let runtime = accountRuntime();
    let client = new OnlineClient(baseURL, runtime.storage);
    const initialRequest = global.wx.request;
    global.wx.request = (options) =>
      options.url.endsWith('/auth/wechat') ? options.fail() : initialRequest(options);
    await assert.rejects(invoke(client), { message: expected });
    assert.equal(client.profile, null);

    runtime = accountRuntime();
    client = new OnlineClient(baseURL, runtime.storage);
    await client.login();
    runtime.setInterceptor((options) => {
      options.success({ statusCode: 401, data: {} });
      return true;
    });
    const renewalRequest = global.wx.request;
    global.wx.request = (options) =>
      options.url.endsWith('/auth/wechat') ? options.fail() : renewalRequest(options);
    await assert.rejects(invoke(client), { message: expected });
    assert.deepEqual(client.profile, original);
  }
});

test('one expired token is renewed through normal login before retrying the same profile write', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  let rejected = false;
  runtime.setInterceptor((options) => {
    if (rejected) return false;
    rejected = true;
    options.success({ statusCode: 401, data: {} });
    return true;
  });
  assert.equal((await client.updateProfile({ nickname: '续期成功' })).nickname, '续期成功');
  const writes = runtime.calls.filter((call) => call.method === 'PUT');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].header.Authorization, 'Bearer token-1');
  assert.equal(writes[1].header.Authorization, 'Bearer token-2');
  assert.deepEqual(writes[0].data, writes[1].data);
});

test('concurrent expired profile reads share one login renewal and a failed renewal preserves the cache', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  runtime.setInterceptor((options) => {
    if (options.header.Authorization !== 'Bearer token-1') return false;
    options.success({ statusCode: 401, data: {} });
    return true;
  });
  const profiles = await Promise.all([client.getProfile(), client.getProfile()]);
  assert.deepEqual(profiles, [original, original]);
  assert.equal(runtime.logins, 2);
  runtime.setInterceptor((options) => {
    options.success({ statusCode: 401, data: {} });
    return true;
  });
  global.wx.login = ({ fail }) => fail();
  await assert.rejects(client.updateProfile({ nickname: '未保存' }), /登录失败/);
  assert.deepEqual(client.profile, original);
});

test('a refreshed login for another account cannot receive the previous account draft', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  runtime.setUser(other.id);
  runtime.setInterceptor((options) => {
    options.success({ statusCode: 401, data: {} });
    return true;
  });
  await assert.rejects(
    client.updateProfile({ nickname: 'belongs to player a' }),
    (error) => error.code === 'PROFILE_ACCOUNT_CHANGED',
  );
  assert.equal(runtime.calls.filter((call) => call.method === 'PUT').length, 1);
  assert.deepEqual(runtime.profiles.get(other.id), other);
  assert.deepEqual(client.profile, other);
});

test('account changes during an active login block a draft before any profile write', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  let finishLogin;
  global.wx.login = ({ success }) => {
    finishLogin = success;
  };
  runtime.setUser(other.id);
  const loggingIn = client.login();
  const saving = client.updateProfile({ nickname: 'belongs to player a' });
  finishLogin({ code: 'different-account-code' });
  await loggingIn;
  await assert.rejects(saving, (error) => error.code === 'PROFILE_ACCOUNT_CHANGED');
  assert.equal(runtime.calls.filter((call) => call.method === 'PUT').length, 0);
  assert.deepEqual(client.profile, other);
});

test('a late old-account profile response cannot replace the new account cache', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  let pending;
  runtime.setInterceptor((options) => {
    pending = options;
    return true;
  });
  const oldRead = client.getProfile();
  await new Promise(setImmediate);
  runtime.setUser(other.id);
  await client.login();
  pending.success({ statusCode: 200, data: original });
  await assert.rejects(oldRead, (error) => error.code === 'PROFILE_ACCOUNT_CHANGED');
  assert.deepEqual(client.profile, other);
});

test('legacy id-only login responses remain compatible and clear a different account cache', async () => {
  const runtime = accountRuntime();
  const client = new OnlineClient(baseURL, runtime.storage);
  await client.login();
  runtime.profiles.set(original.id, { id: original.id });
  await client.login();
  assert.deepEqual(client.profile, original);
  runtime.setUser(other.id);
  runtime.profiles.set(other.id, { id: other.id });
  await client.login();
  assert.equal(client.profile, null);
});

function nativeButtons() {
  const buttons = [];
  global.wx = {
    createUserInfoButton: (options) => {
      const button = {
        options,
        listeners: [],
        removed: [],
        shows: 0,
        hides: 0,
        destroys: 0,
        onTap(listener) {
          this.listeners.push(listener);
        },
        offTap(listener) {
          this.removed.push(listener);
        },
        show() {
          this.shows++;
        },
        hide() {
          this.hides++;
        },
        destroy() {
          this.destroys++;
        },
      };
      buttons.push(button);
      return button;
    },
  };
  return buttons;
}

test('avatar normalization accepts WeChat image hosts and rejects unsafe or missing values without URL globals', () => {
  const { normalizeWechatAvatarUrl } = load('WechatProfile');
  const savedURL = global.URL;
  global.URL = undefined;
  try {
    assert.equal(
      normalizeWechatAvatarUrl('http://ThirdWx.Qlogo.cn/a/132?x=1'),
      'https://thirdwx.qlogo.cn/a/132?x=1',
    );
    for (const host of ['qlogo.cn', 'qpic.cn', 'wx.qlogo.cn', 'a.b.qpic.cn'])
      assert.equal(normalizeWechatAvatarUrl(`https://${host}/1`), `https://${host}/1`);
    const prefix = 'https://qlogo.cn/';
    const maximum = prefix + 'a'.repeat(2048 - prefix.length);
    assert.equal(normalizeWechatAvatarUrl(maximum), maximum);
    assert.equal(normalizeWechatAvatarUrl('https://qlogo.cn/a?x=a+b'), 'https://qlogo.cn/a?x=a+b');
    assert.equal(
      normalizeWechatAvatarUrl('https://qlogo.cn/森林/132'),
      'https://qlogo.cn/%E6%A3%AE%E6%9E%97/132',
    );
    for (const value of [
      '',
      'https://qlogo.cn.evil.example/x',
      'https://evilqlogo.cn/x',
      'https://u:p@qlogo.cn/x',
      'https://qlogo.cn:443/x',
      'https://qlogo.cn/x#fragment',
      'https://qlogo.cn/x#',
      'https://qlogo.cn/\nx',
      'https://qlogo.cn/%0ax',
      'https://qlogo.cn/%20x',
      'https://qlogo.cn/x?name=%20',
      'https://qlogo.cn/%5cx',
      'https://qlogo.cn/x?name=%5C',
      'https://qlogo.cn/%C2%85x',
      'https://qlogo.cn/%C2%A0x',
      'https://qlogo.cn/%E3%80%80x',
      'https://qlogo.cn/\u0085x',
      'https://qlogo.cn/\u009fx',
      'https://qlogo.cn/%ff',
      maximum + 'a',
      'http://qlogo.cn/' + 'a'.repeat(2048 - 'http://qlogo.cn/'.length),
      prefix + '林'.repeat(300),
      prefix + '?x=' + '林'.repeat(700),
      'https://qlogo.cn\\evil.example/x',
      'ftp://qlogo.cn/x',
      'https://-a.qlogo.cn/x',
      'https://qlogo.cn./x',
    ])
      assert.throws(() => normalizeWechatAvatarUrl(value), undefined, value);
  } finally {
    global.URL = savedURL;
  }
});

test('SHOW_ALL conversion includes landscape and portrait letterboxing; window lookup safely falls back', () => {
  const { designRectToScreen, readWechatWindowSize } = load('WechatProfile');
  const rect = { left: 120, top: 900, width: 480, height: 96 };
  assert.deepEqual(designRectToScreen(rect, 360, 780), {
    left: 60,
    top: 450,
    width: 240,
    height: 48,
  });
  assert.deepEqual(designRectToScreen(rect, 800, 780), {
    left: 280,
    top: 450,
    width: 240,
    height: 48,
  });
  assert.deepEqual(designRectToScreen(rect, 360, 900), {
    left: 60,
    top: 510,
    width: 240,
    height: 48,
  });
  delete global.wx;
  assert.equal(readWechatWindowSize(), null);
  global.wx = { getWindowInfo: () => ({ windowWidth: 390, windowHeight: 844 }) };
  assert.deepEqual(readWechatWindowSize(), { width: 390, height: 844 });
  global.wx = {
    getWindowInfo: () => {
      throw new Error('old SDK');
    },
    getSystemInfoSync: () => ({ windowWidth: 360, windowHeight: 800 }),
  };
  assert.deepEqual(readWechatWindowSize(), { width: 360, height: 800 });
  global.wx.getWindowInfo = () => ({ windowWidth: NaN, windowHeight: 0 });
  assert.deepEqual(readWechatWindowSize(), { width: 360, height: 800 });
  global.wx.getSystemInfoSync = () => ({ windowWidth: 0, windowHeight: -1 });
  assert.equal(readWechatWindowSize(), null);
});

test('native button requests no data before a tap and only valid authorized avatars reach the draft', () => {
  const { WechatAvatarButton } = load('WechatProfile');
  const buttons = nativeButtons();
  const results = [],
    failures = [];
  const bridge = new WechatAvatarButton(
    (profile) => results.push(profile),
    (message) => failures.push(message),
  );
  assert.equal(bridge.supported, true);
  assert.equal(buttons.length, 0);
  const rect = { left: 10, top: 20, width: 200, height: 44 };
  bridge.mount(rect);
  const button = buttons[0];
  assert.equal(button.options.type, 'text');
  assert.equal(button.options.text, '');
  assert.equal(button.options.withCredentials, false);
  assert.equal(button.options.lang, 'zh_CN');
  assert.equal(button.options.style.backgroundColor, 'rgba(0,0,0,0)');
  for (const key of Object.keys(rect)) assert.equal(button.options.style[key], rect[key]);
  assert.equal(results.length, 0);
  const callback = button.listeners[0];
  callback({
    errMsg: 'getUserInfo:ok',
    userInfo: { avatarUrl: 'http://wx.qlogo.cn/a/132', nickName: '微信昵称' },
  });
  assert.deepEqual(results, [{ avatarUrl: 'https://wx.qlogo.cn/a/132', nickName: '微信昵称' }]);
  for (const payload of [
    { errMsg: 'getUserInfo:fail auth deny' },
    { errMsg: 'getUserInfo:cancel' },
    { userInfo: { avatarUrl: '', nickName: 'missing' } },
    { userInfo: { avatarUrl: 'https://evil.example/x' } },
  ])
    callback(payload);
  assert.equal(results.length, 1);
  assert.equal(failures.length, 4);
  assert(failures.every((message) => typeof message === 'string' && message.length > 0));
  bridge.destroy();
});

test('hidden, replaced and destroyed native buttons ignore late callbacks, including after re-show', () => {
  const { WechatAvatarButton } = load('WechatProfile');
  const buttons = nativeButtons();
  const results = [],
    failures = [];
  const bridge = new WechatAvatarButton(
    (profile) => results.push(profile),
    (message) => failures.push(message),
  );
  const rect = { left: 10, top: 20, width: 200, height: 44 };
  const payload = { userInfo: { avatarUrl: 'https://wx.qlogo.cn/a/132', nickName: 'live' } };
  bridge.mount(rect);
  const first = buttons[0],
    late = first.listeners[0];
  bridge.setVisible(false);
  late(payload);
  assert.equal(results.length, 0);
  assert(first.removed.includes(late));
  assert.equal(first.destroys, 1);
  bridge.setVisible(true);
  const second = buttons[1];
  assert(second, 'show creates a fresh native control so pending old authorizations stay invalid');
  bridge.setVisible(true);
  assert.equal(buttons.length, 2);
  late(payload);
  assert.equal(results.length, 0);
  second.listeners[0](payload);
  assert.equal(results.length, 1);
  bridge.mount({ ...rect, left: 50 });
  assert.equal(second.destroys, 1);
  second.listeners[0](payload);
  const third = buttons[2];
  bridge.destroy();
  bridge.destroy();
  third.listeners[0](payload);
  assert.equal(third.destroys, 1);
  assert.equal(results.length, 1);
  assert.equal(failures.length, 0);
});

test('native privacy restrictions remain distinct from denial and preserve diagnostics without profile data', () => {
  const { WechatAvatarButton } = load('WechatProfile');
  const buttons = nativeButtons();
  const results = [],
    failures = [],
    warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  const bridge = new WechatAvatarButton(
    (profile) => results.push(profile),
    (message) => failures.push(message),
  );
  try {
    bridge.mount({ left: 10, top: 20, width: 200, height: 44 });
    const callback = buttons[0].listeners[0];
    for (const payload of [
      { errMsg: 'getUserInfo:fail please go to mp to announce your privacy usage', errno: 1026 },
      { errno: 1026 },
      { errCode: 112 },
      { errMsg: 'getUserInfo:fail please go to mp to announce your privacy usage' },
    ]) {
      callback({
        ...payload,
        userInfo: { nickName: 'PRIVATE-NAME', avatarUrl: 'https://wx.qlogo.cn/private/132' },
      });
      assert.equal(failures.at(-1), '微信资料授权暂不可用，请稍后再试');
    }
    assert.equal(results.length, 0, 'a nonzero error code must override any included profile');
    const diagnostic = JSON.stringify(warnings);
    assert.match(diagnostic, /1026/);
    assert.match(diagnostic, /announce your privacy usage/);
    assert.match(diagnostic, /用户隐私保护指引/);
    assert(!diagnostic.includes('PRIVATE-NAME'));
    assert(!diagnostic.includes('qlogo.cn'));
    callback({ errMsg: 'getUserInfo:fail auth deny' });
    assert.match(failures.at(-1), /未授权/);
    callback({ errMsg: 'getUserInfo:fail network error' });
    assert.match(failures.at(-1), /暂时无法获取/);
    callback({
      errMsg: 'getUserInfo:ok',
      errno: 0,
      userInfo: { nickName: '微信昵称', avatarUrl: original.avatarUrl },
    });
    assert.equal(results.length, 1, 'a later successful authorization must still work');
  } finally {
    bridge.destroy();
    console.warn = warn;
  }
});

test('unsupported or failing native APIs produce a friendly failure and do not crash', () => {
  const { WechatAvatarButton } = load('WechatProfile');
  delete global.wx;
  const failures = [];
  const bridge = new WechatAvatarButton(
    () => assert.fail('unexpected authorization'),
    (message) => failures.push(message),
  );
  assert.equal(bridge.supported, false);
  bridge.mount({ left: 1, top: 1, width: 100, height: 40 });
  assert.equal(failures.length, 1);
  global.wx = {
    createUserInfoButton: () => {
      throw new Error('unsupported platform');
    },
  };
  bridge.mount({ left: 1, top: 1, width: 100, height: 40 });
  assert.equal(failures.length, 2);
  bridge.destroy();
});

(async () => {
  for (const { name, run } of tests) {
    await run();
    console.log('PASS — ' + name);
  }
  console.log(`PASS — ${tests.length} player-profile tests.`);
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    delete global.wx;
  });
