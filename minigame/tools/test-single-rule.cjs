const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const file = path.resolve(__dirname, '../assets/scripts/core/MatchGame.ts');
const mod = new Module(file);
mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  file,
);
const { MatchGame, defaultRules, matchIndices } = mod.exports;

function cloud(kinds, rules, version = 'pet-rules-2') {
  return {
    ordinal: 1,
    title: '规则验证',
    seed: 42,
    state: {
      rulesVersion: version,
      rules,
      mode: 'fun',
      capacity: 7,
      tiles: kinds.map((kind, id) => ({ id, kind, x: id * 100, y: 0, layer: 0, removed: false })),
      tray: [],
      reserve: [],
      status: 'playing',
      matches: 0,
      moves: 0,
      cleared: 0,
      tools: { undo: 2, shovel: 1, hint: 3, shuffle: 1 },
    },
  };
}

test('fun levels accept two pairs of different or identical pets, but not three plus one', () => {
  assert.deepEqual(defaultRules('fun'), [[2, 2]]);
  assert.deepEqual(matchIndices([0, 0, 0], 'fun'), []);
  assert.deepEqual(matchIndices([0, 0, 0, 0], 'fun'), [0, 1, 2, 3]);
  assert.deepEqual(matchIndices([0, 0, 0, 1], 'fun'), []);
  assert.deepEqual(matchIndices([0, 1, 0, 1], 'fun'), [0, 1, 2, 3]);
});

test('fun tutorial is eight tiles and every match clears exactly two pairs', () => {
  const g = new MatchGame(1, 42, 'fun');
  assert.equal(g.tiles.length, 8);
  assert.deepEqual(
    g.tiles.reduce((counts, tile) => {
      counts[tile.kind] = (counts[tile.kind] || 0) + 1;
      return counts;
    }, {}),
    { 0: 4, 1: 2, 2: 2 },
  );
  for (const id of g.solution.slice()) {
    const result = g.pick(id);
    assert(result);
    assert([0, 4].includes(result.matched.length));
  }
  assert.equal(g.status, 'won');
  assert.equal(g.matches, 2);
});

test('108-tile fun boards and reshuffles remain solvable with even quantities for all fifteen pets', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = new MatchGame(2, seed, 'fun');
    const counts = Array(15).fill(0);
    g.tiles.forEach((tile) => counts[tile.kind]++);
    assert.equal(g.tiles.length, 108);
    assert(counts.every((count) => count > 0 && count % 2 === 0));
    g.solution.slice(0, 5).forEach((id) => assert(g.pick(id)));
    const remaining = () =>
      g.tiles
        .filter((tile) => !tile.removed || g.tray.includes(tile.id) || g.reserve.includes(tile.id))
        .map((tile) => tile.kind)
        .sort();
    const before = remaining();
    assert(g.shovel());
    assert(g.reshuffle());
    assert.deepEqual(remaining(), before);
    for (const id of g.solution.slice()) {
      const result = g.pick(id);
      assert(result);
      assert([0, 4].includes(result.matched.length));
    }
    assert.equal(g.status, 'won');
  }
});

test('pure-pair hints clear two different pairs and preserve a solvable remainder', () => {
  const g = MatchGame.fromCloud(cloud([0, 0, 0, 0, 1, 1, 2, 2], [[2, 2]]));
  assert(g.pick(0));
  const hint = g.hint();
  assert(hint.length > 0);
  for (const id of hint) assert(g.pick(id));
  assert.equal(g.cleared, 4);
  assert(g.reshuffle());
  for (const id of g.solution.slice()) assert(g.pick(id));
  assert.equal(g.status, 'won');
});

test('legacy fun snapshots retain their original triple-or-pairs behavior', () => {
  for (const [rules, version] of [
    [undefined, 'pet-rules-1'],
    [[[3], [2, 2]], 'pet-rules-1'],
    [[[3], [2, 2]], 'pet-rules-2'],
  ]) {
    const g = MatchGame.fromCloud(cloud([0, 0, 0, 1, 1, 2, 2], rules, version));
    assert.deepEqual(g.rules, [[3], [2, 2]]);
    assert(g.pick(0));
    assert(g.pick(1));
    assert.equal(g.pick(2).matched.length, 3);
    assert(g.reshuffle());
    for (const id of g.solution.slice()) assert(g.pick(id));
    assert.equal(g.status, 'won');
  }
});

test('pair hints can finish visible pairs and then clear four identical remaining pets', () => {
  const session = cloud([1, 1, 2, 2, 0, 0, 0, 0], [[2, 2]]);
  const positions = [
    [0, 0],
    [100, 0],
    [300, 2],
    [500, 2],
    [300, 1],
    [300, 0],
    [500, 1],
    [500, 0],
  ];
  session.state.tiles.forEach((tile, id) => {
    [tile.x, tile.layer] = positions[id];
  });
  const g = MatchGame.fromCloud(session);
  [0, 1, 2].forEach((id) => assert(g.pick(id)));
  assert.deepEqual(g.hint(), [3], 'four remaining identical pets are now a valid group');
  [3, 4, 5, 6, 7].forEach((id) => assert(g.pick(id)));
  assert.equal(g.status, 'won');
});
