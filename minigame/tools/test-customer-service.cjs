const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { afterEach, test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');

// Load the actual controller without starting Cocos or constructing a scene.
const file = path.resolve(__dirname, '../assets/scripts/StarIsle.ts');
const mod = new Module(file);
mod.require = (request) => {
  if (request === 'cc')
    return {
      Component: class {},
      _decorator: { ccclass: () => (type) => type, property: () => () => {} },
    };
  assert(request.startsWith('./'), `unexpected dependency: ${request}`);
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
const { StarIsle } = mod.exports;
const originalWx = global.wx;
afterEach(() => {
  if (originalWx === undefined) delete global.wx;
  else global.wx = originalWx;
});

function harness(api) {
  global.wx = api;
  const controller = Object.create(StarIsle.prototype);
  const popups = [];
  controller.customerServiceFallback = (unavailable) => popups.push(unavailable);
  return { controller, popups };
}

test('cancelling the native customer-service dialog is silent', () => {
  for (const message of [
    'openCustomerServiceConversation:fail cancel',
    'openCustomerServiceConversation:fail user cancel',
    'openCustomerServiceConversation:cancel',
    'openCustomerServiceConversation:fail user canceled',
    'openCustomerServiceConversation:fail USER CANCELLED',
  ]) {
    const { controller, popups } = harness({
      openCustomerServiceConversation: ({ fail }) => fail({ errMsg: message }),
    });
    controller.showCustomerService();
    assert.deepEqual(popups, [], message);
  }
});

test('genuine failures and missing error details still show the failure popup', () => {
  for (const result of [
    { errMsg: 'openCustomerServiceConversation:fail network error' },
    { errMsg: 'openCustomerServiceConversation:fail permission denied' },
    { errMsg: 'openCustomerServiceConversation:fail unavailable' },
    {},
    undefined,
  ]) {
    const { controller, popups } = harness({
      openCustomerServiceConversation: ({ fail }) => fail(result),
    });
    controller.showCustomerService();
    assert.deepEqual(popups, [true]);
  }
});

test('a synchronous native API error still shows the failure popup', () => {
  const { controller, popups } = harness({
    openCustomerServiceConversation() {
      throw new Error('native API unavailable');
    },
  });
  controller.showCustomerService();
  assert.deepEqual(popups, [true]);
});

test('opening customer service does not send a message or show a fallback', () => {
  let options;
  const { controller, popups } = harness({
    openCustomerServiceConversation: (value) => (options = value),
  });
  controller.showCustomerService();
  assert.equal(options.sessionFrom, 'home-menu');
  assert.equal(options.showMessageCard, false);
  assert.deepEqual(popups, []);
});

test('browser and unsupported WeChat clients keep the platform guidance', () => {
  for (const api of [undefined, {}]) {
    const { controller, popups } = harness(api);
    controller.showCustomerService();
    assert.deepEqual(popups, [false]);
  }
});

test('the menu closes before opening customer service, and cancellation stays silent', () => {
  let calls = 0;
  let afterClose;
  const { controller, popups } = harness({
    openCustomerServiceConversation({ fail }) {
      calls++;
      fail({ errMsg: 'openCustomerServiceConversation:fail cancel' });
    },
  });
  controller.modals = { current: {} };
  controller.closeModal = (done) => (afterClose = done);
  controller.showCustomerService();
  assert.equal(calls, 0);
  assert.equal(typeof afterClose, 'function');
  controller.modals.current = null;
  afterClose();
  assert.equal(calls, 1);
  assert.deepEqual(popups, []);
});
