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
const { StarIsle } = load('StarIsle.ts', {
  cc: {
    Component: class {},
    _decorator: { ccclass: () => (type) => type, property: () => () => {} },
  },
  './ui/Paint': {
    opacity: (node, opacity) => {
      node.opacity = opacity;
    },
  },
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

test('campaign uses free quota first, then all inventory without an extra per-round cap', () => {
  for (const tool of tools) {
    const h = harness('campaign', 'classic', 1, 3);
    assert.equal(use(h.app, tool), true);
    assert.equal(h.bag[tool], 3);
    for (const remaining of [2, 1, 0]) {
      assert.equal(use(h.app, tool), true, `${tool} allows another valid bag use`);
      assert.equal(h.bag[tool], remaining);
      assert.equal(h.game[`${tool}Left`], 0);
    }
    assert.equal(use(h.app, tool), false);
    assert.deepEqual(h.records, [tool, tool, tool, tool]);
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
    assert.equal(h.buttons[tool].count, '3');
    assert.equal(h.buttons[tool].button.interactable, true);
  }
  h.game.hintLeft = 2;
  h.app.updateControls();
  assert.equal(h.buttons.hint.count, '5');
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
