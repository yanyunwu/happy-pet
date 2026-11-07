const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
function load(relative, dependencies = {}) {
  const file = path.resolve(__dirname, '../assets/scripts', relative);
  const mod = new Module(file);
  mod.require = (name) => {
    if (name in dependencies) return dependencies[name];
    assert(name.startsWith('./'), `unexpected dependency ${name}`);
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
  return mod.exports;
}
const { MatchGame } = load('core/MatchGame.ts');
const onlineModule = load('core/OnlineClient.ts');
const { OnlineClient } = onlineModule;
const shareImages = load('core/WechatShareImages.ts');
const paint = {
  PALETTE: {},
  opacity: (node, opacity) => {
    node.opacity = opacity;
  },
  text() {},
  button: (modal, name, _text, _x, _y, _w, _h, callback) => {
    modal.buttons[name] = callback;
    return { getComponent: () => ({}) };
  },
};
const { StarIsle } = load('StarIsle.ts', {
  './core/ToolPolicy': load('core/ToolPolicy.ts'),
  './core/WechatShareImages': shareImages,
  './core/OnlineClient': onlineModule,
  cc: {
    Component: class {},
    _decorator: { ccclass: () => (type) => type, property: () => () => {} },
  },
  './ui/Paint': paint,
});
const tools = ['undo', 'shovel', 'hint', 'shuffle'];
const methods = { undo: 'undo', shovel: 'shovel', hint: 'hint', shuffle: 'reshuffle' };
function harness(entry, mode = 'classic', free = 0, inventory = 3) {
  const app = Object.create(StarIsle.prototype);
  const game = new MatchGame(1, 42, mode);
  const bag = Object.fromEntries(tools.map((tool) => [tool, inventory]));
  tools.forEach((tool) => {
    game[`${tool}Left`] = free;
  });
  const buttons = Object.fromEntries(
    tools.map((tool) => [
      tool,
      {
        icon: {},
        button: {},
        count: '',
        getComponent() {
          return this.button;
        },
      },
    ]),
  );
  const records = [];
  Object.assign(app, {
    game,
    save: { bag },
    selectedEntry: entry,
    practice: true,
    extraSlot: { update() {} },
    recordAction: (tool) => records.push(tool),
    play() {},
    persist() {},
    setText: (node, _name, value) => {
      node.count = value;
    },
    at: (node, key) => (key === 'Icon' ? node.icon : buttons[key.replace('Toolbar/Tool-', '')]),
    animateShuffle() {},
    connectionError() {},
  });
  return { app, game, bag, buttons, records };
}
function prepare(game, tool) {
  if (tool === 'undo' || tool === 'shovel') {
    const tile = game.availableTiles().find((tile) => !tile.removed);
    assert(tile && game.pick(tile.id));
  }
}
function use(app, tool) {
  prepare(app.game, tool);
  return app.useTool(tool, () => {
    const result = app.game[methods[tool]]();
    return Array.isArray(result) ? result.length > 0 : result;
  });
}

test('every challenge mode rejects all four bag tools after its free quota', () => {
  for (const mode of ['classic', 'quartet', 'fun'])
    for (const tool of tools) {
      const h = harness('standard', mode);
      prepare(h.game, tool);
      const before = JSON.stringify(h.game);
      let called = false;
      const used = h.app.useTool(tool, () => {
        called = true;
        return true;
      });
      assert.equal(used, false, `${mode}/${tool} cannot use inventory`);
      assert.equal(called, false);
      assert.equal(JSON.stringify(h.game), before);
      assert.equal(h.bag[tool], 3);
      assert.deepEqual(h.records, []);
    }
});

test('challenge free uses still work and never subtract stock', () => {
  for (const tool of tools) {
    const h = harness('standard', 'classic', 1);
    assert.equal(use(h.app, tool), true);
    assert.equal(h.game[`${tool}Left`], 0);
    assert.equal(h.bag[tool], 3);
    assert.equal(use(h.app, tool), false);
    assert.equal(h.bag[tool], 3);
    assert.deepEqual(h.records, [tool]);
  }
});

test('campaign uses free quota first, then at most one inventory item per tool', () => {
  for (const tool of tools) {
    const h = harness('campaign', 'classic', 1, 3);
    assert.equal(use(h.app, tool), true);
    assert.equal(h.bag[tool], 3);
    assert.equal(use(h.app, tool), true, `${tool} allows one bag use`);
    assert.equal(h.bag[tool], 2);
    assert.equal(h.game[`${tool}Left`], 0);
    assert.equal(use(h.app, tool), false);
    assert.equal(h.bag[tool], 2);
    assert.deepEqual(h.records, [tool, tool]);
  }
});

test('an invalid campaign action does not consume bag stock or manufacture a free use', () => {
  for (const tool of tools) {
    const h = harness('campaign');
    assert.equal(
      h.app.useTool(tool, () => false),
      false,
    );
    assert.equal(h.game[`${tool}Left`], 0);
    assert.equal(h.bag[tool], 3);
    assert.deepEqual(h.records, []);
  }
});

test('a share allowance is consumed once and cannot return to inventory', () => {
  for (const tool of tools) {
    const h = harness('campaign');
    h.game.sharedTools[tool] = true;
    h.game.shareUses[tool] = 1;
    assert.equal(use(h.app, tool), true);
    assert.equal(h.game.shareUses[tool], 0);
    assert.equal(h.bag[tool], 3);
    assert.equal(use(h.app, tool), false);
    assert.equal(h.bag[tool], 3);
  }
});

test('cloud restoration preserves each tool stage', () => {
  const h = harness('campaign');
  const state = {
    rulesVersion: 'pet-rules-2',
    rules: [[3]],
    capacity: 7,
    tiles: h.game.tiles,
    tray: [],
    reserve: [],
    status: 'playing',
    matches: 0,
    moves: 0,
    cleared: 0,
    tools: { undo: 0, shovel: 0, hint: 0, shuffle: 0 },
    bagUsed: { undo: true },
    sharedTools: { hint: true },
    shareUses: { hint: 1 },
  };
  h.game.applyCloud(state);
  assert.equal(h.app.toolUses('undo'), 0);
  assert.equal(h.app.toolUses('shovel'), 1);
  assert.equal(h.app.toolUses('hint'), 1);
  assert.equal(use(h.app, 'hint'), true);
  assert.equal(h.app.toolUses('hint'), 0);
});

test('toolbar counts and enabled states follow the current entry on every refresh', () => {
  const h = harness('standard');
  prepare(h.game, 'undo');
  h.app.updateControls();
  for (const tool of tools) {
    assert.equal(h.buttons[tool].count, '0');
    assert.equal(h.buttons[tool].button.interactable, false);
  }
  h.app.selectedEntry = 'campaign';
  h.app.updateControls();
  for (const tool of tools) {
    assert.equal(h.buttons[tool].count, '1');
    assert.equal(h.buttons[tool].button.interactable, true);
  }
  h.game.hintLeft = 2;
  h.app.updateControls();
  assert.equal(h.buttons.hint.count, '3');
  h.app.selectedEntry = 'standard';
  h.app.updateControls();
  assert.equal(h.buttons.hint.count, '2');
  assert.equal(h.buttons.hint.button.interactable, true);
  assert.equal(h.buttons.shuffle.count, '0');
});

test('online shuffle cannot bypass the challenge allowance, while campaign still sends it', async () => {
  for (const entry of ['standard', 'campaign']) {
    const h = harness(entry);
    let calls = 0;
    h.app.practice = false;
    h.app.online = {
      shuffle: async () => {
        calls++;
        return {};
      },
    };
    h.game.applyCloud = () => {};
    h.app.reshuffle();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, entry === 'campaign' ? 1 : 0);
    assert.equal(h.bag.shuffle, 3, 'online inventory is settled by the server');
  }
});

test('sharing selects the approved image for the current game mode', async () => {
  for (const mode of ['classic', 'quartet', 'fun']) {
    const h = harness('standard', mode);
    let modal, options;
    Object.assign(h.app, {
      isValid: true,
      currentScreen: 'game',
      practice: false,
      networkBusy: false,
      modals: { current: null },
      dialog: () => (h.app.modals.current = modal = { buttons: {}, getChildByName: () => ({}) }),
      closeModal() {},
      toast() {},
      updateControls() {},
      online: {
        active: { id: 'round' },
        record() {},
        syncState: async () => ({ sharedTools: { hint: true }, shareUses: { hint: 1 } }),
      },
    });
    global.wx = {
      shareAppMessage(value) {
        options = value;
      },
    };
    h.app.showToolShare('hint');
    modal.buttons.ShareStart();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      { imageUrlId: options.imageUrlId, imageUrl: options.imageUrl },
      shareImages.shareImageForMode(mode),
    );
  }
  delete global.wx;
});

test('starting share automatically grants once and closes the dialog', async () => {
  const h = harness('standard');
  const records = [];
  let modal,
    closed = 0;
  Object.assign(h.app, {
    isValid: true,
    currentScreen: 'game',
    practice: false,
    networkBusy: false,
    modals: { current: null },
    dialog: () => (h.app.modals.current = modal = { buttons: {}, getChildByName: () => ({}) }),
    closeModal() {
      closed++;
      h.app.modals.current = null;
    },
    toast() {},
    updateControls() {},
    online: {
      active: { id: 'round' },
      record: (...args) => records.push(args),
      syncState: async () => ({ sharedTools: { hint: true }, shareUses: { hint: 1 } }),
    },
  });
  global.wx = { shareAppMessage() {} };
  h.app.showToolShare('hint');
  modal.buttons.ShareStart();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(records, [['share_tool', undefined, 'hint']]);
  assert.equal(h.game.shareUses.hint, 1);
  assert.equal(closed, 1);
  delete global.wx;
});

test('automatic share claim preserves undo history', async () => {
  const h = harness('standard');
  h.game.undoLeft = 1;
  h.game.pick(h.game.availableTiles()[0].id);
  const records = [];
  let modal;
  Object.assign(h.app, {
    isValid: true,
    currentScreen: 'game',
    practice: false,
    networkBusy: false,
    modals: { current: null },
    dialog: () => (h.app.modals.current = modal = { buttons: {}, getChildByName: () => ({}) }),
    closeModal() {},
    toast() {},
    updateControls() {},
    online: {
      active: { id: 'round' },
      record: (...args) => records.push(args),
      syncState: async () => ({ bagUsed: {}, sharedTools: { hint: true }, shareUses: { hint: 1 } }),
    },
  });
  global.wx = { shareAppMessage: () => {} };
  h.app.showToolShare('hint');
  modal.buttons.ShareStart();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(records, [['share_tool', undefined, 'hint']]);
  assert.equal(h.game.shareUses.hint, 1);
  assert.equal(h.game.hasUndo, true);
  assert.equal(h.game.undo(), true);
  delete global.wx;
});

test('missing or throwing WeChat share cannot grant a use', () => {
  for (const wx of [
    {},
    {
      shareAppMessage() {
        throw Error('failed');
      },
    },
  ]) {
    const h = harness('standard');
    let modal;
    Object.assign(h.app, {
      isValid: true,
      currentScreen: 'game',
      practice: false,
      online: { active: { id: 'round' } },
      modals: { current: null },
      dialog: () => (h.app.modals.current = modal = { buttons: {} }),
      closeModal() {},
      toast() {},
      updateControls() {},
    });
    global.wx = wx;
    h.app.showToolShare('hint');
    if (modal?.buttons.ShareStart) modal.buttons.ShareStart();
    assert.equal(modal?.buttons.ShareClaim, undefined);
    assert.equal(h.game.shareUses.hint, 0);
    delete global.wx;
  }
});

test('a delayed share claim cannot grant a new round or submit twice', async () => {
  const h = harness('standard');
  let modal, finish;
  const records = [];
  Object.assign(h.app, {
    isValid: true,
    currentScreen: 'game',
    practice: false,
    networkBusy: false,
    modals: { current: null },
    dialog: () => (h.app.modals.current = modal = { buttons: {}, getChildByName: () => ({}) }),
    closeModal() {},
    toast() {},
    updateControls() {},
    online: {
      active: { id: 'old' },
      record: (...args) => records.push(args),
      syncState: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    },
  });
  global.wx = { shareAppMessage() {} };
  h.app.showToolShare('hint');
  modal.buttons.ShareStart();
  modal.buttons.ShareStart();
  const next = new MatchGame(1, 4, 'classic');
  h.app.game = next;
  h.app.online.active = { id: 'new' };
  finish({ bagUsed: {}, sharedTools: { hint: true }, shareUses: { hint: 1 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(records.length, 1);
  assert.equal(next.shareUses.hint, 0);
  assert.equal(next.sharedTools.hint, false);
  delete global.wx;
});

test('retrying a failed share sync reuses the recorded event', async () => {
  const h = harness('standard');
  let modal,
    retry,
    calls = 0;
  const records = [];
  Object.assign(h.app, {
    isValid: true,
    currentScreen: 'game',
    practice: false,
    networkBusy: false,
    modals: { current: null },
    dialog: () => (h.app.modals.current = modal = { buttons: {}, getChildByName: () => ({}) }),
    closeModal() {},
    toast() {},
    updateControls() {},
    connectionError: (_error, fn) => {
      retry = fn;
      h.app.modals.current = { name: 'NetworkRetry' };
    },
    online: {
      active: { id: 'round' },
      record: (...args) => records.push(args),
      syncState: async () => {
        if (!calls++) throw Error('offline');
        return { sharedTools: { hint: true }, shareUses: { hint: 1 } };
      },
    },
  });
  global.wx = { shareAppMessage() {} };
  h.app.showToolShare('hint');
  modal.buttons.ShareStart();
  await new Promise((resolve) => setImmediate(resolve));
  await retry();
  assert.equal(records.length, 1);
  assert.equal(h.game.shareUses.hint, 1);
  delete global.wx;
});

test('share claims join the persisted ordered action queue with their tool', () => {
  const saved = new Map();
  const storage = {
    getItem: (k) => saved.get(k),
    setItem: (k, v) => saved.set(k, v),
    removeItem: (k) => saved.delete(k),
  };
  const client = new OnlineClient('https://example.invalid', storage);
  client.userId = 'user';
  client.session = { id: 'round' };
  client.startedAt = Date.now();
  client.record('pick', 4);
  client.record('share_tool', undefined, 'hint');
  const queue = JSON.parse([...saved.values()][0]);
  assert.deepEqual(
    queue[0].events.map(({ seq, type, tileId, tool }) => ({ seq, type, tileId, tool })),
    [
      { seq: 1, type: 'pick', tileId: 4, tool: undefined },
      { seq: 2, type: 'share_tool', tileId: undefined, tool: 'hint' },
    ],
  );
});

test('a storage error does not leave an unpersisted duplicate claim in the queue', () => {
  let fail = true;
  const storage = {
    getItem: () => null,
    setItem: () => {
      if (fail) throw Error('storage');
    },
    removeItem() {},
  };
  const client = new OnlineClient('https://example.invalid', storage);
  client.userId = 'user';
  client.session = { id: 'round' };
  client.startedAt = Date.now();
  assert.throws(() => client.record('share_tool', undefined, 'hint'));
  fail = false;
  client.record('share_tool', undefined, 'hint');
  assert.deepEqual(
    client.queue[0].events.map((event) => event.seq),
    [1],
  );
});
