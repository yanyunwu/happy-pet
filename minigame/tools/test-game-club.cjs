const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');

function load(name) {
  const file = path.resolve(__dirname, `../assets/scripts/core/${name}.ts`);
  assert(fs.existsSync(file), `${name} must provide the native game-club bridge`);
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

const tests = [];
const test = (name, run) => tests.push({ name, run });
const failure = { errMsg: 'gameClubButton:fail unavailable', errno: 17 };

function runtime({ width = 360, height = 780, failAt } = {}) {
  const buttons = [];
  const resizeListeners = [];
  const removedResizeListeners = [];
  const calls = [];
  let windowReads = 0;
  const api = {
    getWindowInfo() {
      windowReads++;
      return { windowWidth: width, windowHeight: height };
    },
    createGameClubButton(options) {
      calls.push('create');
      if (failAt === 'create') throw new Error('create unavailable');
      const button = {
        options,
        listeners: [],
        removed: [],
        events: [],
        onTap(listener) {
          this.listeners.push(listener);
          if (failAt === 'onTap') throw new Error('onTap unavailable');
        },
        offTap(listener) {
          this.events.push('offTap');
          this.removed.push(listener);
        },
        show() {
          this.events.push('show');
          if (failAt === 'show') throw new Error('show unavailable');
        },
        hide() {
          this.events.push('hide');
        },
        destroy() {
          this.events.push('destroy');
        },
      };
      buttons.push(button);
      return button;
    },
    onWindowResize(listener) {
      resizeListeners.push(listener);
      if (failAt === 'onWindowResize') throw new Error('resize unavailable');
    },
    offWindowResize(listener) {
      removedResizeListeners.push(listener);
    },
    authorize() {
      assert.fail('game-club entry must not request authorization');
    },
    getUserInfo() {
      assert.fail('game-club entry must not request user information');
    },
    openGameClub() {
      assert.fail('only a native user tap may open the game club');
    },
    navigateToMiniProgram() {
      assert.fail('game-club entry must not navigate to another application');
    },
  };
  global.wx = api;
  return {
    api,
    buttons,
    calls,
    resizeListeners,
    removedResizeListeners,
    get windowReads() {
      return windowReads;
    },
  };
}

function createBridge(failures = []) {
  const { WechatGameClubButton } = load('WechatGameClub');
  return new WechatGameClubButton((message) => failures.push(message));
}

function assertRect(style, expected) {
  for (const key of ['left', 'top', 'width', 'height'])
    assert(
      Math.abs(style[key] - expected[key]) < 1e-9,
      `${key}: ${style[key]} != ${expected[key]}`,
    );
}

test('the current game uses a transparent native text button and never opens automatically', () => {
  const native = runtime();
  const { HOME_GAME_CLUB_RECT } = load('WechatGameClub');
  assert.deepEqual(HOME_GAME_CLUB_RECT, { left: 533, top: 959, width: 154, height: 154 });
  const failures = [];
  const bridge = createBridge(failures);
  assert.equal(bridge.supported, true);
  assert.equal(native.buttons.length, 0);
  bridge.setVisible(true);
  const button = native.buttons[0];
  assert.deepEqual(Object.keys(button.options).sort(), ['icon', 'style', 'text', 'type']);
  assert.equal(button.options.type, 'text');
  assert.equal(button.options.icon, 'green');
  assert.equal(button.options.text, '');
  assert.equal(button.options.style.backgroundColor, 'rgba(0,0,0,0)');
  assert.equal(button.options.style.borderColor, 'rgba(0,0,0,0)');
  assert.equal(button.options.style.borderWidth, 0);
  assert.equal(button.options.style.color, '#000000');
  assert(!Object.hasOwn(button.options, 'openlink'));
  assert(!Object.hasOwn(button.options, 'appId'));
  assert.deepEqual(button.events, ['show']);
  for (const result of [undefined, {}, { errMsg: 'gameClubButton:ok', errno: 0, errCode: 0 }])
    button.listeners[0](result);
  assert.deepEqual(failures, []);
  bridge.destroy();
});

test('the native hit area follows SHOW_ALL scaling on narrow screens and both letterbox axes', () => {
  for (const { width, height, expected } of [
    { width: 360, height: 780, expected: { left: 266.5, top: 479.5, width: 77, height: 77 } },
    { width: 360, height: 900, expected: { left: 266.5, top: 539.5, width: 77, height: 77 } },
    { width: 800, height: 780, expected: { left: 486.5, top: 479.5, width: 77, height: 77 } },
    {
      width: 320,
      height: 780,
      expected: { left: 2132 / 9, top: 4226 / 9, width: 616 / 9, height: 616 / 9 },
    },
  ]) {
    const native = runtime({ width, height });
    const bridge = createBridge();
    bridge.setVisible(true);
    assertRect(native.buttons[0].options.style, expected);
    bridge.destroy();
  }
});

test('repeated visibility updates neither create more buttons nor query the window each frame', () => {
  const native = runtime();
  const bridge = createBridge();
  for (let i = 0; i < 120; i++) bridge.setVisible(true);
  assert.equal(native.buttons.length, 1);
  assert.equal(native.windowReads, 1);
  assert.equal(native.resizeListeners.length, 1);
  assert.deepEqual(native.buttons[0].events, ['show']);
  bridge.destroy();
});

test('hiding releases the button and resize subscription, and a later show creates fresh listeners', () => {
  const native = runtime();
  const failures = [];
  const bridge = createBridge(failures);
  bridge.setVisible(true);
  const first = native.buttons[0];
  const oldTap = first.listeners[0];
  const oldResize = native.resizeListeners[0];
  bridge.setVisible(false);
  bridge.setVisible(false);
  assert.deepEqual(first.events, ['show', 'hide', 'offTap', 'destroy']);
  assert.deepEqual(first.removed, [oldTap]);
  assert.deepEqual(native.removedResizeListeners, [oldResize]);
  oldTap(failure);
  oldResize({ windowWidth: 800, windowHeight: 780 });
  assert.equal(native.buttons.length, 1);
  bridge.setVisible(true);
  assert.equal(native.buttons.length, 2);
  assert.equal(native.resizeListeners.length, 2);
  oldTap(failure);
  oldResize({ windowWidth: 800, windowHeight: 780 });
  assert.equal(native.buttons.length, 2, 'a stale resize must not rebuild a newly shown button');
  assert.deepEqual(failures, []);
  native.buttons[1].listeners[0](failure);
  assert.equal(failures.length, 1);
  bridge.destroy();
});

test('a resize rebuilds at event dimensions, skips identical dimensions, and invalidates old taps', () => {
  const native = runtime();
  const failures = [];
  const bridge = createBridge(failures);
  bridge.setVisible(true);
  const first = native.buttons[0];
  const resize = native.resizeListeners[0];
  resize({ windowWidth: 800, windowHeight: 780 });
  assert.equal(native.buttons.length, 2);
  assertRect(native.buttons[1].options.style, { left: 486.5, top: 479.5, width: 77, height: 77 });
  assert.deepEqual(first.events, ['show', 'hide', 'offTap', 'destroy']);
  first.listeners[0](failure);
  assert.deepEqual(failures, []);
  resize({ windowWidth: 800, windowHeight: 780 });
  assert.equal(native.buttons.length, 2);
  assert.equal(native.windowReads, 1, 'event dimensions are newer than synchronous platform data');
  resize({ windowWidth: 360, windowHeight: 900 });
  assert.equal(native.buttons.length, 3);
  assertRect(native.buttons[2].options.style, { left: 266.5, top: 539.5, width: 77, height: 77 });
  bridge.destroy();
});

test('resize subscriptions require matching registration and removal APIs', () => {
  for (const missing of ['onWindowResize', 'offWindowResize']) {
    const native = runtime();
    delete native.api[missing];
    const bridge = createBridge();
    bridge.setVisible(true);
    assert.equal(native.buttons.length, 1);
    assert.equal(native.resizeListeners.length, 0);
    bridge.destroy();
    assert.equal(native.removedResizeListeners.length, 0);
  }
});

test('missing platform APIs stay quiet and provide a browser-specific or unavailable fallback', () => {
  delete global.wx;
  const failures = [];
  const bridge = createBridge(failures);
  assert.equal(bridge.supported, false);
  assert.match(bridge.fallbackMessage, /请在微信小游戏中打开/);
  for (let i = 0; i < 120; i++) bridge.setVisible(true);
  assert.deepEqual(failures, []);
  bridge.destroy();
  global.wx = {};
  const unsupported = createBridge(failures);
  assert.equal(unsupported.supported, false);
  assert.match(unsupported.fallbackMessage, /暂不可用/);
  unsupported.setVisible(true);
  assert.deepEqual(failures, []);
  unsupported.destroy();
});

test('partial native mount failures clean up and do not retry or show toasts each frame', () => {
  for (const failAt of ['create', 'onTap', 'show', 'onWindowResize']) {
    const native = runtime({ failAt });
    const failures = [];
    const bridge = createBridge(failures);
    for (let i = 0; i < 120; i++) bridge.setVisible(true);
    assert.equal(native.calls.length, 1, failAt);
    assert.equal(bridge.supported, true, 'API capability remains separate from mount state');
    assert.match(bridge.fallbackMessage, /暂不可用/);
    assert.deepEqual(failures, [], 'mount failure should wait for an explicit Canvas tap');
    const button = native.buttons[0];
    if (button) {
      assert.deepEqual(button.events.slice(-3), ['hide', 'offTap', 'destroy'], failAt);
      button.listeners[0](failure);
      assert.deepEqual(failures, []);
    }
    assert.deepEqual(native.removedResizeListeners, native.resizeListeners, failAt);
    bridge.destroy();
    if (button) assert.equal(button.events.filter((event) => event === 'destroy').length, 1);
  }
});

test('invalid window dimensions do not leave an invisible intercepting native button', () => {
  const native = runtime({ width: 0, height: NaN });
  const failures = [];
  const bridge = createBridge(failures);
  for (let i = 0; i < 120; i++) bridge.setVisible(true);
  assert.equal(native.buttons.length, 0);
  assert.equal(native.windowReads, 1);
  assert.equal(native.resizeListeners.length, 0);
  assert.deepEqual(failures, []);
  assert.match(bridge.fallbackMessage, /暂不可用/);
  native.api.getWindowInfo = () => ({ windowWidth: 360, windowHeight: 780 });
  bridge.setVisible(false);
  bridge.setVisible(true);
  assert.equal(native.buttons.length, 1, 'a new visibility session may retry a transient failure');
  bridge.destroy();
});

test('a failed resize removes the old button and stops retries until a new visibility session', () => {
  const native = runtime();
  const failures = [];
  const bridge = createBridge(failures);
  bridge.setVisible(true);
  const resize = native.resizeListeners[0];
  let attempts = 0;
  native.api.createGameClubButton = () => {
    attempts++;
    throw new Error('rebuild unavailable');
  };
  resize({ windowWidth: 800, windowHeight: 780 });
  resize({ windowWidth: 360, windowHeight: 900 });
  for (let i = 0; i < 120; i++) bridge.setVisible(true);
  assert.equal(attempts, 1);
  assert.deepEqual(native.buttons[0].events, ['show', 'hide', 'offTap', 'destroy']);
  assert.deepEqual(native.removedResizeListeners, [resize]);
  assert.deepEqual(failures, []);
  bridge.destroy();
});

test('native tap failures report a friendly message and log only bounded diagnostic fields', () => {
  const native = runtime();
  const failures = [];
  const bridge = createBridge(failures);
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    bridge.setVisible(true);
    const tap = native.buttons[0].listeners[0];
    for (const result of [
      { errMsg: 'gameClubButton:fail ' + 'x'.repeat(500), errno: 17, secret: 'DO-NOT-LOG' },
      { errno: 12 },
      { errCode: 8 },
      { errMsg: 'gameClubButton:ok', errno: 1 },
    ])
      tap(result);
    assert.equal(failures.length, 4);
    assert(failures.every((message) => /暂不可用/.test(message)));
    assert.equal(warnings.length, 4);
    const diagnostics = JSON.stringify(warnings);
    assert(!diagnostics.includes('DO-NOT-LOG'));
    assert(!diagnostics.includes('x'.repeat(321)));
    assert.match(diagnostics, /17/);
    tap({ errMsg: 'gameClubButton:ok', errno: 0, errCode: 0 });
    tap({ errno: NaN, errCode: Infinity });
    assert.equal(failures.length, 4);
  } finally {
    bridge.destroy();
    console.warn = warn;
  }
});

test('cleanup continues when platform release calls throw, and released callbacks remain inert', () => {
  const native = runtime();
  const failures = [];
  const bridge = createBridge(failures);
  bridge.setVisible(true);
  const button = native.buttons[0];
  for (const key of ['hide', 'offTap', 'destroy']) {
    button[key] = () => {
      button.events.push(key);
      throw new Error(`${key} already released`);
    };
  }
  native.api.offWindowResize = (listener) => {
    native.removedResizeListeners.push(listener);
    throw new Error('resize already released');
  };
  bridge.destroy();
  bridge.destroy();
  button.listeners[0](failure);
  native.resizeListeners[0]({ windowWidth: 800, windowHeight: 780 });
  assert.deepEqual(button.events, ['show', 'hide', 'offTap', 'destroy']);
  assert.equal(native.removedResizeListeners.length, 1);
  assert.deepEqual(failures, []);
});

test('destroy is final, repeatable, and cannot be undone by a late visibility update', () => {
  const native = runtime();
  const bridge = createBridge();
  bridge.setVisible(true);
  bridge.destroy();
  bridge.destroy();
  bridge.setVisible(true);
  assert.equal(native.buttons.length, 1);
  assert.deepEqual(native.buttons[0].events, ['show', 'hide', 'offTap', 'destroy']);
});

(async () => {
  let failed = 0;
  const warn = console.warn;
  for (const { name, run } of tests) {
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
      await run();
      assert(warnings.length <= 4, 'native failures must not log repeatedly on every frame');
      console.log('PASS — ' + name);
    } catch (error) {
      failed++;
      console.error('FAIL — ' + name);
      console.error(error);
    } finally {
      console.warn = warn;
      delete global.wx;
    }
  }
  assert.equal(failed, 0, `${failed} game-club tests failed`);
  console.log(`PASS — ${tests.length} game-club tests.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
