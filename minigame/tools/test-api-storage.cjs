const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const file = path.resolve(__dirname, '../assets/scripts/core/OnlineClient.ts');
const mod = new Module(file);
mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  file,
);
const { OnlineClient } = mod.exports;
const local = 'http://127.0.0.1:8080/api/v1',
  remote = 'https://game.example.com/api/v1';
const memory = (missing = 'null') => {
  const values = new Map();
  return {
    getItem: (key) =>
      values.has(key)
        ? values.get(key)
        : missing === 'empty'
          ? ''
          : missing === 'undefined'
            ? undefined
            : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
const assets = {
  coins: 0,
  bag: { undo: 0, shovel: 0, hint: 0, shuffle: 0 },
  signInCount: 0,
  signedOn: '',
};
const calls = [],
  failStart = new Set();
global.wx = {
  login: ({ success }) => success({ code: 'unit-test-code' }),
  request: (options) => {
    calls.push({ url: options.url, data: options.data });
    let data;
    if (options.url.endsWith('/auth/wechat'))
      data = { accessToken: 'unit-token', user: { id: 'shared-user' } };
    else if (options.url.endsWith('/assets')) data = assets;
    else if (options.url.endsWith('/sessions')) {
      if (failStart.delete(options.url)) return options.fail();
      data = {
        id: options.url.startsWith(local) ? 'local-session' : 'remote-session',
        lastSeq: 0,
        state: {},
      };
    } else if (options.url.endsWith('/events'))
      data = { state: {}, lastSeq: options.data.events.at(-1).seq, assets };
    else throw new Error('Unexpected request ' + options.url);
    options.success({ statusCode: 200, data });
  },
};
(async () => {
  const store = memory();
  const localClient = new OnlineClient(local, store);
  await localClient.start('classic');
  localClient.record('pick', 0);
  const remoteClient = new OnlineClient(remote, store);
  await remoteClient.recover();
  assert(
    !calls.some((call) => call.url === remote + '/user/sessions/local-session/events'),
    'local events must never be uploaded to another API',
  );
  assert(localClient.pending);
  await new OnlineClient(local + '/', store).recover();
  assert(calls.some((call) => call.url === local + '/user/sessions/local-session/events'));

  const legacy = memory();
  legacy.setItem(
    'happy-pet-upload-v1',
    JSON.stringify([
      {
        userId: 'shared-user',
        sessionId: 'legacy-local',
        events: [{ seq: 1, type: 'pick', tileId: 0, at: 1 }],
      },
    ]),
  );
  await new OnlineClient(remote, legacy).recover();
  assert(
    legacy.getItem('happy-pet-upload-v1'),
    'unknown-origin old data stays intact on a new endpoint',
  );
  assert(!calls.some((call) => call.url === remote + '/user/sessions/legacy-local/events'));
  await new OnlineClient(local, legacy).recover();
  assert.equal(legacy.getItem('happy-pet-upload-v1'), null);
  assert(calls.some((call) => call.url === local + '/user/sessions/legacy-local/events'));

  const retries = memory();
  failStart.add(local + '/user/sessions');
  await assert.rejects(new OnlineClient(local, retries).start('classic'));
  const first = calls.filter((call) => call.url === local + '/user/sessions').at(-1).data.requestId;
  failStart.add(remote + '/user/sessions');
  await assert.rejects(new OnlineClient(remote, retries).start('classic'));
  const other = calls.filter((call) => call.url === remote + '/user/sessions').at(-1)
    .data.requestId;
  assert.notEqual(first, other, 'different APIs have independent start request IDs');
  await new OnlineClient(local + '/', retries).start('classic');
  assert.equal(
    calls.filter((call) => call.url === local + '/user/sessions').at(-1).data.requestId,
    first,
  );
  const oldStart = memory();
  oldStart.setItem('happy-pet-start-shared-user-campaign-classic-', 'legacy-start-request-id');
  await new OnlineClient(local, oldStart).start('classic');
  assert.equal(
    calls.filter((call) => call.url === local + '/user/sessions').at(-1).data.requestId,
    'legacy-start-request-id',
  );
  for (const missing of ['empty', 'undefined']) {
    const native = memory(missing);
    const sessionId = 'native-legacy-' + missing;
    native.setItem(
      'happy-pet-upload-v1',
      JSON.stringify([
        { userId: 'shared-user', sessionId, events: [{ seq: 1, type: 'pick', tileId: 0, at: 1 }] },
      ]),
    );
    native.setItem('happy-pet-start-shared-user-campaign-classic-', 'native-start-' + missing);
    const client = new OnlineClient(local, native);
    await client.recover();
    assert(
      calls.some((call) => call.url === local + '/user/sessions/' + sessionId + '/events'),
      'WeChat missing value ' + missing + ' must still migrate the queue',
    );
    await client.start('classic');
    assert.equal(
      calls.filter((call) => call.url === local + '/user/sessions').at(-1).data.requestId,
      'native-start-' + missing,
    );
  }
  delete global.wx;
  console.log('PASS — API-scoped queues, independent retry IDs and known-local legacy migration.');
})().catch((error) => {
  delete global.wx;
  console.error(error);
  process.exitCode = 1;
});
