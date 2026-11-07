const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
function load(relative, dependencies = {}) {
  const file = path.resolve(__dirname, '../assets/scripts', relative);
  const mod = new Module(file);
  mod.require = (name) => dependencies[name] || {};
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
  return mod.exports;
}
const modes = ['classic', 'quartet', 'fun'].map((id) => ({ id, title: id, shortRule: id }));
const paint = {
  PALETTE: {},
  text: (modal, name, value) => {
    modal.labels[name] = value;
  },
  button: (modal, name, _text, _x, _y, _w, _h, callback) => {
    const button = { active: true, callback };
    modal.buttons[name] = button;
    return button;
  },
  sprite() {},
};
const { StarIsle } = load('StarIsle.ts', {
  cc: {
    Component: class {},
    _decorator: { ccclass: () => (type) => type, property: () => () => {} },
  },
  './core/MatchGame': { MODES: modes },
  './ui/Paint': paint,
});
const { OnlineClient } = load('core/OnlineClient.ts');
function appFor(online) {
  const app = Object.create(StarIsle.prototype);
  Object.assign(app, {
    isValid: true,
    currentScreen: 'home',
    onlineReady: true,
    online,
    frames: Array(15).fill({}),
    modals: { current: null },
    dialog() {
      const modal = { labels: {}, buttons: {} };
      this.modals.current = modal;
      return modal;
    },
    setText(modal, name, text) {
      modal.labels[name] = text;
    },
  });
  return app;
}
test('shows each mode progress and handles completed and empty catalogs', async () => {
  const app = appFor({
    campaignProgress: async () => ({
      classic: { current: 8, position: 1, total: 2, completed: 0 },
      quartet: { current: 2, position: 2, total: 2, completed: 2 },
      fun: { current: 0, position: 0, total: 0, completed: 0 },
    }),
  });
  app.showCampaign();
  const modal = app.modal;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(modal.labels['Progress-classic'], '第 8 关 · 1/2');
  assert.equal(modal.labels['Progress-quartet'], '已通关 2/2');
  assert.equal(modal.labels['Progress-fun'], '暂无关卡');
});
test('ignores a late response after closing and reloads on next opening', async () => {
  let resolve;
  let calls = 0;
  const progress = { classic: { current: 2, position: 2, total: 5, completed: 1 } };
  const app = appFor({
    campaignProgress: () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  app.showCampaign();
  const first = app.modal;
  app.modals.current = null;
  resolve(progress);
  await new Promise((done) => setImmediate(done));
  assert.equal(first.labels['Progress-classic'], '加载中…');
  app.showCampaign();
  const second = app.modal;
  resolve(progress);
  await new Promise((done) => setImmediate(done));
  assert.equal(second.labels['Progress-classic'], '第 2/5 关');
  assert.equal(calls, 2);
});
test('failed request shows a retry without presenting invented progress', async () => {
  let calls = 0;
  const app = appFor({
    campaignProgress: async () => {
      calls++;
      if (calls === 1) throw new Error('offline');
      return { classic: { current: 1, position: 1, total: 2, completed: 0 } };
    },
  });
  app.showCampaign();
  const modal = app.modal;
  await new Promise((done) => setImmediate(done));
  assert.equal(modal.labels['Progress-classic'], '获取失败');
  assert.equal(modal.buttons.ProgressRetry.active, true);
  modal.buttons.ProgressRetry.callback();
  await new Promise((done) => setImmediate(done));
  assert.equal(modal.labels['Progress-classic'], '第 1/2 关');
  assert.equal(modal.buttons.ProgressRetry.active, false);
});
test('progress fetch ignores a response belonging to a previous account', async () => {
  const client = Object.create(OnlineClient.prototype);
  let resolve;
  Object.assign(client, {
    userId: 'first',
    identityGeneration: 1,
    ready: async () => {},
    request: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = client.campaignProgress();
  await new Promise((done) => setImmediate(done));
  client.userId = 'second';
  client.identityGeneration++;
  resolve({});
  await assert.rejects(pending, (error) => error.code === 'PROFILE_ACCOUNT_CHANGED');
});
