const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const file = path.resolve(__dirname, '../assets/scripts/core/MatchGame.ts');
const moduleFile = new Module(file);
moduleFile._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  file,
);
const { MatchGame, CAPACITY, RESERVE_CAPACITY } = moduleFile.exports;
function cloud(kinds, capacity = 7, rules = [[3]]) {
  return {
    id: 'extra-slot-test',
    ordinal: 1,
    title: 'Extra slot test',
    seed: 42,
    state: {
      tiles: kinds.map((kind, id) => ({ id, kind, x: id * 100, y: 0, layer: 0, removed: false })),
      tray: [],
      reserve: [],
      status: 'playing',
      matches: 0,
      cleared: 0,
      moves: 0,
      tools: { undo: 1, shovel: 1, hint: 3, shuffle: 1 },
      capacity,
      mode: 'classic',
      rulesVersion: 'pet-rules-2',
      rules,
    },
  };
}
function pick(game, ...ids) {
  for (const id of ids) assert(game.pick(id), `tile ${id} is playable`);
}

test('a fresh level has seven slots and allows only one unlock', () => {
  const game = new MatchGame(1, 42);
  assert.equal(CAPACITY, 7);
  assert.equal(RESERVE_CAPACITY, 7);
  assert.equal(game.capacity, 7);
  assert.equal(game.extraSlotUnlocked, false);
  assert.equal(game.unlockExtraSlot(), true);
  assert.equal(game.capacity, 8);
  assert.equal(game.extraSlotUnlocked, true);
  assert.equal(game.unlockExtraSlot(), false);
  assert.equal(game.capacity, 8);
  assert.equal(game.moves, 0);
  assert.equal(game.canUndo, false, 'the reward is not an undoable pick');
  assert.equal(new MatchGame(1, 42).capacity, 7, 'restarting resets the reward');
  assert.equal(new MatchGame(2, 42).extraSlotUnlocked, false, 'next level starts locked');
});

test('finished levels reject an unused unlock', () => {
  for (const status of ['won', 'lost']) {
    const session = cloud([0, 0, 0]);
    session.state.status = status;
    const game = MatchGame.fromCloud(session);
    assert.equal(game.unlockExtraSlot(), false, status);
    assert.equal(game.capacity, 7);
    assert.equal(game.extraSlotUnlocked, false);
  }
});

test('seven unmatched cards stay playable after unlock and the eighth loses', () => {
  const game = MatchGame.fromCloud(cloud([0, 1, 2, 3, 4, 5, 6, 7, 8]));
  assert(game.unlockExtraSlot());
  pick(game, 0, 1, 2, 3, 4, 5, 6);
  assert.equal(game.tray.length, 7);
  assert.equal(game.status, 'playing');
  pick(game, 7);
  assert.equal(game.tray.length, 8);
  assert.equal(game.status, 'lost');
  assert.equal(game.stranded, false);
  assert.equal(game.unlockExtraSlot(), false);
});

test('matching resolves before failure in the seventh and eighth slots', () => {
  for (const capacity of [7, 8]) {
    const kinds = capacity === 7 ? [0, 0, 1, 2, 3, 4, 0, 5] : [0, 0, 1, 2, 3, 4, 5, 0, 6];
    const game = MatchGame.fromCloud(cloud(kinds, capacity));
    pick(game, ...Array.from({ length: capacity }, (_, id) => id));
    assert.equal(game.status, 'playing');
    assert.equal(game.tray.length, capacity - 3);
    assert.equal(game.cleared, 3);
  }
});

test('undo, shovel and shuffle keep the reward, including picks made before unlocking', () => {
  const game = MatchGame.fromCloud(cloud([0, 0, 0, 1, 1, 1, 2, 2, 2]));
  pick(game, 0);
  assert(game.unlockExtraSlot());
  assert(game.undo());
  assert.equal(game.capacity, 8);
  pick(game, 0);
  assert(game.shovel());
  assert.equal(game.capacity, 8);
  assert.deepEqual(game.reserve, [0]);
  assert(game.reshuffle());
  assert.equal(game.capacity, 8);
  assert.equal(game.extraSlotUnlocked, true);
  assert.equal(game.unlockExtraSlot(), false);
  pick(game, ...game.solution);
  assert.equal(game.status, 'won');
});

test('cloud restore accepts only seven or eight slots and retains the reward through undo', () => {
  const session = cloud([0, 0, 0, 1, 1, 1], 8);
  const before = structuredClone(session.state);
  session.state.tiles[0].removed = true;
  session.state.tray = [0];
  session.state.moves = 1;
  session.state.history = [before];
  const game = MatchGame.fromCloud(session);
  assert.equal(game.extraSlotUnlocked, true);
  assert.equal(game.unlockExtraSlot(), false);
  assert(game.undo());
  assert.equal(game.capacity, 8);
  assert.equal(game.moves, 0);
  for (const capacity of [0, 6, 9, 7.5, undefined]) {
    assert.throws(() => game.applyCloud({ ...before, capacity }), /规则/);
    assert.equal(game.capacity, 8, 'invalid cloud data must not partially apply');
  }
  game.applyCloud({ ...before, capacity: 7 });
  assert.equal(game.capacity, 7);
  assert.equal(game.extraSlotUnlocked, false);
});

test('an exhausted board with seven unmatched cards is stranded at capacity eight', () => {
  const game = MatchGame.fromCloud(cloud([0, 1, 2, 3, 4, 5, 6], 8));
  pick(game, 0, 1, 2, 3, 4, 5, 6);
  assert.equal(game.status, 'lost');
  assert.equal(game.stranded, true);
});

test('preset hints can plan through the seventh card to a match in the eighth slot', () => {
  const kinds = [0, 1, 2, 3, 4, 5, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
  const game = MatchGame.fromCloud(cloud(kinds));
  pick(game, 0, 1, 2, 3, 4, 5);
  assert.deepEqual(game.hint(), []);
  assert(game.unlockExtraSlot());
  assert.deepEqual(game.hint(), [6, 7]);
  pick(game, 6);
  assert.deepEqual(game.hint(), [7]);
  pick(game, 7);
  assert.equal(game.status, 'playing');
  assert.equal(game.tray.length, 5);
});

test('custom hints use the eighth slot for a three-pair match', () => {
  const game = MatchGame.fromCloud(cloud([0, 0, 1, 2, 3, 4, 1, 2, 3, 4, 5, 5], 7, [[2, 2, 2]]));
  pick(game, 0, 1, 2, 3, 4, 5);
  assert.deepEqual(game.hint(), []);
  assert(game.unlockExtraSlot());
  assert.deepEqual(game.hint(), [6]);
  pick(game, 6);
  assert.deepEqual(game.hint(), [7]);
  pick(game, 7);
  assert.equal(game.status, 'playing');
  assert.equal(game.tray.length, 2);
});

test('fallback hints accept a safe seventh card for preset and custom rules', () => {
  for (const rules of [[[3]], [[4, 3]]]) {
    const game = MatchGame.fromCloud(cloud([0, 1, 2, 3, 4, 5, 6, 7, 8], 7, rules));
    pick(game, 0, 1, 2, 3, 4, 5);
    assert.deepEqual(game.hint(), []);
    assert(game.unlockExtraSlot());
    assert.deepEqual(game.hint(), [6]);
  }
});
