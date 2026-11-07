const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const core = path.resolve(__dirname, '../assets/scripts/core');
function load(name) {
  const file = path.join(core, `${name}.ts`),
    mod = new Module(file);
  mod.require = (request) => (request.startsWith('./') ? load(request.slice(2)) : require(request));
  mod._compile(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText,
    file,
  );
  return mod.exports;
}
const { OnlineClient } = load('OnlineClient');
const { MatchGame } = load('MatchGame');

test('revive survives a lost server response and retries its original event', async () => {
  const base = 'https://revive.test.invalid/api/v1',
    data = new Map();
  const storage = {
    getItem: (k) => data.get(k) || null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
  };
  const state = {
    tiles: [0, 0, 0].map((kind, id) => ({ id, kind, x: id * 100, y: 0, layer: 0, removed: false })),
    tray: [],
    reserve: [],
    status: 'lost',
    matches: 0,
    cleared: 0,
    moves: 0,
    tools: { undo: 1, shovel: 1, hint: 3, shuffle: 1 },
    capacity: 7,
    mode: 'classic',
    rules: [[3]],
    rulesVersion: 'pet-rules-2',
  };
  const assets = {
    coins: 0,
    bag: { undo: 0, shovel: 0, hint: 0, shuffle: 0 },
    signInCount: 0,
    signedOn: '',
  };
  const seen = [];
  let dropped = true;
  const previous = global.wx;
  global.wx = {
    login: ({ success }) => success({ code: 'test' }),
    request: ({ url, data: body, success, fail }) => {
      if (url.endsWith('/auth/wechat'))
        return success({ statusCode: 200, data: { accessToken: 'test', user: { id: 'player' } } });
      if (url.endsWith('/assets')) return success({ statusCode: 200, data: assets });
      if (url.endsWith('/sessions'))
        return success({
          statusCode: 200,
          data: { id: 's', ordinal: 1, title: 'test', seed: 1, lastSeq: 3, state },
        });
      if (url.endsWith('/events')) {
        seen.push(structuredClone(body.events));
        if (dropped) {
          dropped = false;
          return fail();
        }
        return success({
          statusCode: 200,
          data: {
            state: { ...state, status: 'playing', reviveUsed: true, reviveOutcome: 'move' },
            lastSeq: 4,
            assets,
          },
        });
      }
      throw new Error(url);
    },
  };
  try {
    const client = new OnlineClient(base, storage),
      session = await client.start('classic');
    client.record('revive');
    await assert.rejects(client.syncState(), /网络/);
    const resumed = await client.syncState();
    assert.deepEqual(seen[1], seen[0]);
    assert.deepEqual(
      seen[0].map(({ seq, type }) => ({ seq, type })),
      [{ seq: 4, type: 'revive' }],
    );
    assert.equal(client.pending, false);
    const restored = MatchGame.fromCloud({ ...session, state: resumed });
    assert.equal(restored.reviveUsed, true);
    assert.equal(restored.reviveOutcome, 'move');
  } finally {
    if (previous === undefined) delete global.wx;
    else global.wx = previous;
  }
});
