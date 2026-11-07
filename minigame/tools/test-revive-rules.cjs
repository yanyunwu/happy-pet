const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const file = path.resolve(__dirname, '../assets/scripts/core/MatchGame.ts');
const mod = new Module(file);
mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  file,
);
const { MatchGame } = mod.exports;

test('revive moves three tray cards to reserve without consuming a tool, once per round', () => {
  const g = new MatchGame(1, 42);
  for (let i = 0; i < 7; i++) g.tiles[i].removed = true;
  g.tray = [0, 1, 2, 3, 4, 5, 6];
  g.status = 'lost';
  g.shuffleLeft = 0;
  assert.equal(g.revive(), true);
  assert.deepEqual(g.tray, [3, 4, 5, 6]);
  assert.deepEqual(g.reserve, [0, 1, 2]);
  assert.equal(g.status, 'playing');
  assert.equal(g.shuffleLeft, 0);
  assert.equal(g.reviveUsed, true);
  g.status = 'lost';
  assert.equal(g.revive(), false);
});

test('full reserve returns only the necessary reserve cards to the board, preserving progress', () => {
  const g = new MatchGame(1, 42);
  g.tiles.forEach((tile) => {
    tile.removed = tile.id < 14;
  });
  g.reserve = [0, 1, 2, 3, 4, 5, 6];
  g.tray = [7, 8, 9, 10, 11, 12, 13];
  g.status = 'lost';
  g.shuffleLeft = 0;
  g.matches = 2;
  const before = g.remaining + g.tray.length;
  assert.equal(g.revive(), true);
  assert.equal(g.status, 'playing');
  assert.deepEqual(g.tray, [10, 11, 12, 13]);
  assert.deepEqual(g.reserve, [3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(
    g.tiles.slice(0, 3).map((tile) => tile.removed),
    [false, false, false],
  );
  assert.equal(g.remaining + g.tray.length, before);
  assert.equal(g.matches, 2);
  assert.equal(g.shuffleLeft, 0);
});
