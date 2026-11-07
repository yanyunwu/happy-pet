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

test('draw selects a covered tile, places it in the tray, and can be undone', () => {
  const game = new MatchGame(1, 42, 'classic');
  const covered = game.tiles.filter((tile) => !tile.removed && !game.isAvailable(tile.id));
  assert(covered.length > 0);
  assert.equal(game.pick(covered[0].id), null);
  const initial = game.hintLeft;
  const result = game.draw();
  assert(result);
  assert(covered.some((tile) => tile.id === result.tile.id));
  assert(game.tray.includes(result.tile.id));
  assert.equal(game.hintLeft, initial - 1);
  assert(game.undo());
  assert.equal(game.tiles[result.tile.id].removed, false);
  assert.equal(game.hintLeft, initial - 1);
});

test('draw does not consume a charge when no covered tiles remain', () => {
  const game = new MatchGame(1, 42, 'classic');
  for (const tile of game.tiles) if (!game.isAvailable(tile.id)) tile.removed = true;
  const initial = game.hintLeft;
  assert.equal(game.draw(), null);
  assert.equal(game.hintLeft, initial);
});
