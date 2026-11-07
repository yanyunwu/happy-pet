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
  if (name === './core/OnlineClient') return { OnlineError: class extends Error {} };
  if (name === './core/MatchGame') return { MODES: [], RESERVE_CAPACITY: 7 };
  if (name === './ui/Paint') return { pop() {} };
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
  let resolve, reject;
  const calls = [];
  const game = {
    status: 'lost',
    reviveUsed: false,
    tray: [1, 2, 3],
    reserve: [],
    revive() {
      this.reviveUsed = true;
      this.status = 'playing';
      return true;
    },
  };
  Object.assign(app, {
    isValid: true,
    currentScreen: 'game',
    game,
    practice: true,
    online: null,
    slotAdEpoch: 0,
    slotAdPending: false,
    slotAdUnitId: 'adunit-test',
    networkBusy: false,
    soundscape: { suspendForAd: () => () => {} },
    slotAd: {
      watch: () => {
        calls.push('watch');
        return new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        });
      },
    },
    closeModal() {},
    mountLevel() {},
    updateControls() {},
    toast() {},
    playTime: 20,
  });
  return {
    app,
    game,
    calls,
    finish: (value) => resolve(value),
    fail: () => reject(new Error('广告不可用')),
  };
}
test('completed ad revives once and duplicate taps cannot play another ad', async () => {
  const h = harness();
  const pending = h.app.watchReviveAd();
  await h.app.watchReviveAd();
  assert.deepEqual(h.calls, ['watch']);
  h.finish(true);
  await pending;
  assert.equal(h.game.status, 'playing');
  assert.equal(h.game.reviveUsed, true);
  await h.app.watchReviveAd();
  assert.deepEqual(h.calls, ['watch']);
});
test('cancelled ad and callbacks after leaving do not revive', async () => {
  for (const leave of [false, true]) {
    const h = harness();
    const pending = h.app.watchReviveAd();
    if (leave) h.app.currentScreen = 'home';
    h.finish(leave);
    await pending;
    assert.equal(h.game.status, 'lost');
    assert.equal(h.game.reviveUsed, false);
  }
});
test('ad load failures release the lock without consuming the revive', async () => {
  const h = harness();
  const pending = h.app.watchReviveAd();
  h.fail();
  await pending;
  assert.equal(h.app.slotAdPending, false);
  assert.equal(h.game.status, 'lost');
  assert.equal(h.game.reviveUsed, false);
});
test('online connection retry reuses the one recorded action after a complete ad', async () => {
  const h = harness();
  const actions = [];
  let syncs = 0,
    retry;
  h.app.practice = false;
  h.game.applyCloud = (state) => Object.assign(h.game, state);
  h.app.online = {
    active: { id: 's' },
    recover: async () => {},
    record: (type) => actions.push(type),
    syncState: async () => {
      if (++syncs === 1) throw new Error('断网');
      return { status: 'playing', reviveUsed: true };
    },
  };
  h.app.connectionError = (_error, callback) => {
    retry = callback;
  };
  const pending = h.app.watchReviveAd();
  h.finish(true);
  await pending;
  assert.equal(h.game.status, 'lost');
  assert.deepEqual(actions, ['revive']);
  await retry();
  assert.equal(h.game.status, 'playing');
  assert.equal(h.game.reviveUsed, true);
  assert.deepEqual(actions, ['revive']);
  assert.deepEqual(h.calls, ['watch']);
});
test('leaving during a queued revive also queues abandonment after that event', () => {
  const h = harness(),
    outcomes = [];
  h.app.practice = false;
  h.app.revivePending = true;
  h.app.online = {
    active: { id: 's' },
    finish: (outcome) => {
      outcomes.push(outcome);
      return Promise.resolve();
    },
    detach() {},
  };
  h.app.levelTransition = { active: false };
  h.app.soundscape.setMode = () => {};
  h.app.clearScreen = () => {};
  h.app.refreshHome = () => {};
  h.app.at = () => ({});
  h.app.home();
  assert.deepEqual(outcomes, ['abandoned']);
});
