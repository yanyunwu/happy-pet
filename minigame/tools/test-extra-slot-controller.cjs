const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const file = path.resolve(__dirname, '../assets/scripts/StarIsle.ts');
const mod = new Module(file);
mod.require = (name) => {
  if (name === 'cc')
    return {
      Component: class {},
      _decorator: { ccclass: () => (type) => type, property: () => () => {} },
    };
  assert(name.startsWith('./'));
  return {};
};
mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      experimentalDecorators: true,
    },
  }).outputText,
  file,
);
function harness() {
  const app = Object.create(mod.exports.StarIsle.prototype);
  let resolve;
  let reject;
  const calls = [];
  const events = [];
  const messages = [];
  Object.assign(app, {
    isValid: true,
    currentScreen: 'game',
    slotAdEpoch: 0,
    slotAdPending: false,
    slotAdUnitId: 'adunit-slot',
    levelTransition: { active: false },
    game: {
      status: 'playing',
      extraSlotUnlocked: false,
      unlockExtraSlot() {
        if (this.status !== 'playing' || this.extraSlotUnlocked) return false;
        this.extraSlotUnlocked = true;
        return true;
      },
    },
    slotAd: {
      watch(id) {
        calls.push(id);
        return new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        });
      },
    },
    updateControls() {},
    updateHud() {},
    play() {},
    toast: (message) => messages.push(message),
    recordAction: (event) => events.push(event),
  });
  return {
    app,
    calls,
    events,
    messages,
    finish: (value) => resolve(value),
    fail: () => reject(new Error('广告暂不可用')),
  };
}

test('complete viewing unlocks once, and double taps cannot start another video', async () => {
  const h = harness();
  const first = h.app.watchExtraSlotAd();
  h.app.watchExtraSlotAd();
  assert.equal(h.app.slotAdPending, true);
  assert.deepEqual(h.calls, ['adunit-slot']);
  h.finish(true);
  await first;
  assert.equal(h.app.game.extraSlotUnlocked, true);
  assert.equal(h.app.slotAdPending, false);
  assert.deepEqual(h.events, ['unlock_slot']);
  await h.app.watchExtraSlotAd();
  assert.equal(h.calls.length, 1);
});

test('cancelled viewing is silent and an error releases input without a reward', async () => {
  for (const failed of [false, true]) {
    const h = harness();
    const request = h.app.watchExtraSlotAd();
    if (failed) h.fail();
    else h.finish(false);
    await request;
    assert.equal(h.app.game.extraSlotUnlocked, false);
    assert.equal(h.app.slotAdPending, false);
    assert.deepEqual(h.events, []);
    assert.equal(h.messages.length, failed ? 1 : 0);
  }
});

test('late callbacks cannot unlock a different round or a closed screen', async () => {
  for (const retire of [
    (app) => {
      app.game = { ...app.game };
    },
    (app) => {
      app.currentScreen = 'home';
    },
    (app) => {
      app.slotAdEpoch++;
    },
    (app) => {
      app.isValid = false;
    },
    (app) => {
      app.game.status = 'lost';
    },
  ]) {
    const h = harness();
    const request = h.app.watchExtraSlotAd();
    retire(h.app);
    h.finish(true);
    await request;
    assert.deepEqual(h.events, []);
    assert.equal(h.app.game.extraSlotUnlocked, false);
  }
});

test('modal, animation, network, transition and terminal states cannot start advertising', async () => {
  for (const lock of [
    { modals: { current: {} } },
    { busy: true },
    { boardTransition: true },
    { networkBusy: true },
    { levelTransition: { active: true } },
    { currentScreen: 'home' },
    { game: { status: 'lost' } },
  ]) {
    const h = harness();
    Object.assign(h.app, lock);
    await h.app.watchExtraSlotAd();
    assert.deepEqual(h.calls, []);
  }
});
