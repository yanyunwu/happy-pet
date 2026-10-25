const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
function load(name) {
  const file = path.resolve(__dirname, `../assets/scripts/core/${name}.ts`);
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
const { OnlineClient } = load('OnlineClient');
const client = new OnlineClient('https://game.example/api/v1', {
  getItem: () => null,
  setItem() {},
  removeItem() {},
});
const calls = [];
let reply = {
  content: '森林来信\n\n欢迎小伙伴 🐾\n<b>只是文字</b>',
  updatedAt: '2026-10-25T01:00:00Z',
};
let status = 200;
let offline = false;
global.wx = {
  login: () => assert.fail('public announcements never require a player login'),
  request(options) {
    calls.push(options);
    if (offline) options.fail();
    else options.success({ statusCode: status, data: reply });
  },
};
(async () => {
  assert.equal(
    typeof client.announcement,
    'function',
    'client must expose managed announcement reading',
  );
  assert.equal(await client.announcement(), reply.content);
  assert.equal(calls[0].url, 'https://game.example/api/v1/settings/announcement');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].header.Authorization, undefined);
  reply = { content: '后台刚保存的新公告', updatedAt: '2026-10-25T02:00:00Z' };
  assert.equal(
    await client.announcement(),
    reply.content,
    'each opening fetches the latest announcement',
  );
  reply = { content: '', updatedAt: '2026-10-25T02:00:00Z' };
  assert.equal(await client.announcement(), '', 'empty text must not restore hardcoded old copy');
  for (const bad of [null, {}, { content: 1 }, { content: ['unexpected'] }]) {
    reply = bad;
    await assert.rejects(client.announcement(), /公告/);
  }
  status = 503;
  await assert.rejects(client.announcement());
  status = 200;
  offline = true;
  await assert.rejects(client.announcement());
  assert.equal(client.active, null, 'reading news cannot start or change a game');
  console.log(
    'PASS — public announcement refresh, plain text, empty content and request failures.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
