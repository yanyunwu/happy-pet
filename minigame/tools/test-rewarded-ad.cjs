const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test, afterEach } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');

function load() {
  const file = path.resolve(__dirname, '../assets/scripts/core/WechatRewardedAd.ts');
  const mod = new Module(file);
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    file,
  );
  return mod.exports.WechatRewardedAd;
}

const originalWx = global.wx;
afterEach(() => {
  if (originalWx === undefined) delete global.wx;
  else global.wx = originalWx;
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function runtime({ show, load: onLoad } = {}) {
  const calls = [];
  const ads = [];
  global.wx = {
    createRewardedVideoAd(options) {
      calls.push(options);
      const close = new Set();
      const errors = new Set();
      const ad = {
        close,
        errors,
        shows: 0,
        loads: 0,
        destroyed: 0,
        onClose: (fn) => close.add(fn),
        offClose: (fn) => close.delete(fn),
        onError: (fn) => errors.add(fn),
        offError: (fn) => errors.delete(fn),
        show() {
          this.shows++;
          return show ? show(this) : Promise.resolve();
        },
        load() {
          this.loads++;
          return onLoad ? onLoad(this) : Promise.resolve();
        },
        destroy() {
          this.destroyed++;
        },
        finish(value) {
          [...close].forEach((fn) => fn(value));
        },
        fail(value) {
          [...errors].forEach((fn) => fn(value));
        },
      };
      ads.push(ad);
      return ad;
    },
  };
  return { calls, ads };
}

test('only a confirmed complete video earns the slot, and native listeners are removed', async () => {
  const { calls, ads } = runtime();
  const bridge = new (load())();
  const result = bridge.watch('adunit-slot');
  await tick();
  assert.deepEqual(calls, [
    { adUnitId: 'adunit-slot', multiton: true, disableFallbackSharePage: true },
  ]);
  ads[0].finish({ isEnded: true });
  assert.equal(await result, true);
  assert.equal(ads[0].close.size, 0);
  assert.equal(ads[0].errors.size, 0);
  assert.equal(ads[0].destroyed, 1);
});

test('early closing and missing completion results never grant a reward', async () => {
  for (const value of [{ isEnded: false }, {}, undefined]) {
    const { ads } = runtime();
    const result = new (load())().watch('adunit-slot');
    await tick();
    ads[0].finish(value);
    assert.equal(await result, false);
  }
});

test('duplicate taps share one pending video without creating another instance', async () => {
  const { ads } = runtime();
  const bridge = new (load())();
  const first = bridge.watch('adunit-slot');
  const second = bridge.watch('adunit-slot');
  assert.equal(first, second);
  await tick();
  assert.equal(ads.length, 1);
  ads[0].finish({ isEnded: true });
  assert.equal(await first, true);
});

test('a cache miss loads and retries showing once', async () => {
  const { ads } = runtime({
    show: (ad) => (ad.shows === 1 ? Promise.reject(new Error('not loaded')) : Promise.resolve()),
  });
  const result = new (load())().watch('adunit-slot');
  await tick();
  assert.equal(ads[0].loads, 1);
  assert.equal(ads[0].shows, 2);
  ads[0].finish({ isEnded: true });
  assert.equal(await result, true);
});

test('native errors and failed retries reject without granting a reward', async () => {
  for (const kind of ['native', 'load', 'show']) {
    const { ads } = runtime({
      show: () => (kind === 'native' ? Promise.resolve() : Promise.reject(new Error('failed'))),
      load: () => (kind === 'load' ? Promise.reject(new Error('no fill')) : Promise.resolve()),
    });
    const result = new (load())().watch('adunit-slot');
    const rejected = assert.rejects(result, /广告暂不可用/);
    if (kind === 'native') ads[0].fail({ errCode: 1004 });
    await rejected;
    assert.equal(ads[0].destroyed, 1);
  }
});

test('destroy ignores late completion and pending load cannot show a retired ad', async () => {
  let resolveLoad;
  const { ads } = runtime({
    show: () => Promise.reject(new Error('not loaded')),
    load: () => new Promise((resolve) => (resolveLoad = resolve)),
  });
  const bridge = new (load())();
  const result = bridge.watch('adunit-slot');
  await tick();
  const late = [...ads[0].close][0];
  bridge.destroy();
  assert.equal(await result, false);
  late({ isEnded: true });
  resolveLoad();
  await tick();
  assert.equal(ads[0].shows, 1);
  assert.equal(ads[0].destroyed, 1);
});

test('empty configuration, unsupported runtimes and create failures cannot grant', async () => {
  const { calls } = runtime();
  await assert.rejects(new (load())().watch(''), /广告暂不可用/);
  assert.equal(calls.length, 0);
  delete global.wx;
  await assert.rejects(new (load())().watch('adunit-slot'), /微信小游戏/);
  global.wx = {
    createRewardedVideoAd() {
      throw new Error('unavailable');
    },
  };
  await assert.rejects(new (load())().watch('adunit-slot'), /广告暂不可用/);
});
