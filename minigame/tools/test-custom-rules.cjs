const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const file = path.resolve(__dirname, '../assets/scripts/core/MatchGame.ts');
const moduleFile = new Module(file);
moduleFile._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  file,
);
const { MatchGame, matchIndices } = moduleFile.exports;
assert.deepEqual(matchIndices([0, 0, 0], [[4]]), []);
assert.deepEqual(matchIndices([0, 0, 0, 0], [[4]]), [0, 1, 2, 3]);
assert.deepEqual(matchIndices([0, 1, 0, 2, 1], [[2, 2]]), [0, 1, 2, 4]);
assert.deepEqual(matchIndices([0, 0, 0, 0], [[2, 2]]), []);
assert.deepEqual(matchIndices([0, 1, 0, 1, 0], [[3, 2]]), [0, 1, 2, 3, 4]);
assert.deepEqual(matchIndices([0, 1, 2, 0, 1, 2], [[2, 2, 2]]), [0, 1, 2, 3, 4, 5]);
assert.deepEqual(matchIndices([3, 1, 3], [[2, 1]]), [0, 1, 2]);
assert.deepEqual(matchIndices([0, 0, 0, 0, 1, 1], [[4], [3]]), [0, 1, 2, 3]);
assert.deepEqual(matchIndices([0, 0, 0, 0, 1, 1], [[3], [4]]), [0, 1, 2]);
const cloud = (kinds, rules, version = 'pet-rules-2') => ({
  ordinal: 3,
  title: '自定义规则验证',
  seed: 42,
  state: {
    tiles: kinds.map((kind, id) => ({
      id,
      kind,
      x: (id % 5) * 100,
      y: Math.floor(id / 5) * 100,
      layer: 0,
      removed: false,
    })),
    tray: [],
    reserve: [],
    status: 'playing',
    matches: 0,
    cleared: 0,
    moves: 0,
    tools: { undo: 2, shovel: 1, hint: 3, shuffle: 1 },
    capacity: 7,
    mode: 'classic',
    rules,
    rulesVersion: version,
  },
});
let game = MatchGame.fromCloud(cloud([0, 0, 0, 1, 1], [[3, 2], [4]]));
assert.deepEqual(game.rules, [[3, 2], [4]]);
assert(game.pick(0));
assert(game.undo());
for (const id of [0, 1, 2]) assert.equal(game.pick(id).matched.length, 0);
assert.equal(game.tray.length, 3);
game.pick(3);
assert.equal(game.pick(4).matched.length, 5);
assert.equal(game.status, 'won');
game = MatchGame.fromCloud(cloud([0, 0, 0, 0, 1, 1, 1], [[4, 3]]));
for (let i = 0; i < 7; i++) game.pick(i);
assert.equal(game.status, 'won', 'the seventh tile clears before slot overflow');
game = MatchGame.fromCloud(cloud([0, 0, 0, 1, 1, 0, 0, 0, 1, 1], [[3, 2]]));
const hinted = game.hint();
assert(hinted.length > 0 && hinted.every((id) => game.isAvailable(id)));
game.pick(0);
assert(game.shovel());
assert(game.reshuffle());
for (const id of game.solution) assert(game.pick(id));
assert.equal(game.status, 'won', 'custom shuffle has a real clearing route');
for (const rules of [
  [
    [3, 2],
    [2, 2],
  ],
  [[3, 2], [3]],
]) {
  game = MatchGame.fromCloud(cloud([0, 0, 0, 1, 1], rules));
  assert(game.reshuffle(), 'a higher priority larger group can remain reachable');
  for (const id of game.solution) assert(game.pick(id));
  assert.equal(game.status, 'won');
  game = MatchGame.fromCloud(cloud([0, 0, 0, 1, 1], rules));
  game.hintLeft = 9;
  for (let step = 0; step < 7 && game.status === 'playing'; step++) {
    const next = game.hint();
    assert.equal(next.length, 1);
    assert(game.pick(next[0]));
  }
  assert.equal(game.status, 'won', 'hint respects the order needed to trigger the larger group');
}
game = MatchGame.fromCloud(cloud([0, 0, 0], undefined, 'pet-rules-1'));
for (let i = 0; i < 3; i++) game.pick(i);
assert.equal(game.status, 'won');
assert.throws(() => MatchGame.fromCloud(cloud([0, 0, 0], undefined)), /规则/);
// Independent exhaustive play on small multisets checks the bounded generator,
// including priorities where a larger rule can fire before a smaller one.
const patterns = [];
function partitions(left, max, prefix) {
  if (!left) {
    if (prefix.length <= 3) patterns.push(prefix);
    return;
  }
  for (let n = Math.min(left, max); n >= 1; n--) partitions(left - n, n, [...prefix, n]);
}
for (let n = 2; n <= 7; n++) partitions(n, n, []);
function exhaustiveWin(counts, rules) {
  const seen = new Set();
  const visit = (remaining, held) => {
    const key = remaining.join(',') + '|' + held.join(',');
    if (seen.has(key)) return false;
    seen.add(key);
    if (remaining.every((n) => !n)) return !held.length;
    for (let kind = 0; kind < remaining.length; kind++) {
      if (!remaining[kind]) continue;
      const tray = held.slice(),
        last = tray.lastIndexOf(kind);
      tray.splice(last < 0 ? tray.length : last + 1, 0, kind);
      const match = matchIndices(tray, rules),
        next = tray.filter((_, i) => !match.includes(i));
      if (next.length >= 7) continue;
      const rest = remaining.slice();
      rest[kind]--;
      if (visit(rest, next)) return true;
    }
    return false;
  };
  return visit(counts, []);
}
let seed = 4219,
  checked = 0;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
for (let trial = 0; trial < 1200; trial++) {
  const counts = Array.from({ length: 3 }, () => Math.floor(random() * 4));
  if (counts.reduce((a, b) => a + b, 0) < 2) continue;
  const a = Math.floor(random() * patterns.length),
    b = Math.floor(random() * patterns.length);
  const rules = a === b ? [patterns[a]] : [patterns[a], patterns[b]];
  game = MatchGame.fromCloud(
    cloud(
      counts.flatMap((n, kind) => Array(n).fill(kind)),
      rules,
    ),
  );
  const shuffled = game.reshuffle();
  assert.equal(shuffled, exhaustiveWin(counts, rules), JSON.stringify({ counts, rules }));
  if (shuffled) {
    for (const id of game.solution) assert(game.pick(id));
    assert.equal(game.status, 'won');
  }
  checked++;
}
console.log(
  `PASS — custom rules, priority, hints/shuffle, legacy rules and ${checked} exhaustive-play comparisons.`,
);
