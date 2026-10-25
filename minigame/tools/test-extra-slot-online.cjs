const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const core = path.resolve(__dirname, '../assets/scripts/core');
function load(name) {
  const file = path.join(core, `${name}.ts`);
  const mod = new Module(file);
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

test('the cloud action and record contracts accept unlock_slot', () => {
  const file = path.join(core, '__extra_slot_contract__.ts');
  const source = `import { OnlineClient, CloudAction } from './OnlineClient';
const event: CloudAction = { seq: 1, type: 'unlock_slot', at: 0 };
declare const client: OnlineClient;
client.record(event.type);
client.record('unlock_slot');`;
  const options = {
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, ...args) =>
    path.resolve(name) === file
      ? ts.createSourceFile(name, source, languageVersion, true)
      : original(name, languageVersion, ...args);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
  assert.deepEqual(
    diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    [],
  );
});

test('unlock events survive a lost response and restart with their original sequence', async () => {
  const baseURL = 'https://extra-slot.test.invalid/api/v1';
  const queueKey = `happy-pet-api:${encodeURIComponent(baseURL)}:happy-pet-upload-v1`;
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
  const state = {
    tiles: [0, 0, 0].map((kind, id) => ({ id, kind, x: id * 100, y: 0, layer: 0, removed: false })),
    tray: [],
    reserve: [],
    status: 'playing',
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
    coins: 20,
    bag: { undo: 1, shovel: 1, hint: 1, shuffle: 1 },
    signInCount: 0,
    signedOn: '',
  };
  const seen = [];
  let sessionNumber = 0;
  let failResponse = true;
  const previousWx = global.wx;
  global.wx = {
    login: ({ success }) => success({ code: 'test-code' }),
    request: ({ url, data, success, fail }) => {
      if (url.endsWith('/auth/wechat'))
        return success({
          statusCode: 200,
          data: { accessToken: 'test-token', user: { id: 'player' } },
        });
      if (url.endsWith('/assets')) return success({ statusCode: 200, data: assets });
      if (url.endsWith('/sessions'))
        return success({
          statusCode: 200,
          data: {
            id: `session-${++sessionNumber}`,
            ordinal: 1,
            title: 'Test',
            seed: 42,
            lastSeq: 0,
            state,
          },
        });
      if (url.endsWith('/events')) {
        seen.push(structuredClone(data.events));
        if (failResponse) {
          failResponse = false;
          return fail();
        }
        return success({
          statusCode: 200,
          data: { state: { ...state, capacity: 8 }, lastSeq: data.events.at(-1).seq, assets },
        });
      }
      throw new Error(url);
    },
  };
  try {
    const client = new OnlineClient(baseURL, storage);
    await client.start('classic');
    client.record('pick', 0);
    client.record('unlock_slot');
    client.record('pick', 1);
    await assert.rejects(client.flush(), /网络连接中断/);
    const pending = JSON.parse(data.get(queueKey))[0];
    assert.equal(pending.sessionId, 'session-1');
    assert.deepEqual(
      pending.events.map(({ seq, type }) => ({ seq, type })),
      [
        { seq: 1, type: 'pick' },
        { seq: 2, type: 'unlock_slot' },
        { seq: 3, type: 'pick' },
      ],
    );
    assert.equal(Object.hasOwn(pending.events[1], 'tileId'), false);
    const recovered = new OnlineClient(baseURL, storage);
    await recovered.recover();
    assert.deepEqual(seen[1], seen[0], 'retry keeps every action and timestamp unchanged');
    assert.equal(recovered.pending, false);
    assert.deepEqual(JSON.parse(data.get(queueKey)), []);
    const next = await recovered.start('classic');
    assert.equal(MatchGame.fromCloud(next).capacity, 7);
    recovered.record('unlock_slot');
    const confirmed = await recovered.syncState();
    assert.equal(confirmed.capacity, 8);
    assert.equal(MatchGame.fromCloud({ ...next, state: confirmed }).extraSlotUnlocked, true);
    assert.equal(seen[2][0].seq, 1, 'a fresh session starts a fresh event sequence');
    assert.equal(recovered.pending, false);
  } finally {
    if (previousWx === undefined) delete global.wx;
    else global.wx = previousWx;
  }
});
