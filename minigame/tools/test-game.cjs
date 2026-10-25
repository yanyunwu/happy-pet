const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
let ts;
for (const candidate of [
  'typescript',
  process.env.TYPESCRIPT_PATH,
  'C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript',
].filter(Boolean)) {
  try {
    ts = require(candidate);
    break;
  } catch {}
}
if (!ts)
  throw new Error(
    'Install TypeScript or set TYPESCRIPT_PATH to the Creator bundled TypeScript directory.',
  );
const file = path.resolve(__dirname, '../assets/scripts/core/MatchGame.ts');
const mod = new Module(file);
mod._compile(
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  file,
);
const { MatchGame, randomSource } = mod.exports;
let assertions = 0;
const check = (condition, message) => {
  assertions++;
  assert.ok(condition, message);
};
function complete(game) {
  for (const id of game.solution.slice()) {
    check(game.pick(id), `solution move ${id} valid`);
    check(game.status !== 'lost', 'solution never overflows');
  }
  check(game.status === 'won', 'solution clears every tile');
}
for (let seed = 1; seed <= 200; seed++) {
  for (const id of [1, 2]) {
    const game = new MatchGame(id, seed);
    check(game.tiles.length === (id === 1 ? 18 : 108), 'level size');
    const kinds = {};
    game.tiles.forEach((t) => (kinds[t.kind] = (kinds[t.kind] || 0) + 1));
    check(
      Object.values(kinds).every((count) => count % 3 === 0),
      'every kind divisible by three',
    );
    complete(game);
    check(game.tray.length === 0, 'won with empty tray');
    check(
      game.pick(0) === null && !game.undo() && !game.reshuffle(),
      'won state rejects mutations',
    );
  }
  const easy = new MatchGame(1, seed),
    rng = randomSource(seed + 919);
  while (easy.status === 'playing') {
    const open = easy.availableTiles();
    easy.pick(open[Math.floor(rng() * open.length)].id);
  }
  check(easy.status === 'won', 'tutorial forgives arbitrary choices');
  const hard = new MatchGame(2, seed);
  const blocked = hard.tiles.find((t) => !hard.isAvailable(t.id));
  check(hard.pick(blocked.id) === null, 'covered cards cannot be picked');
  const route = hard.solution.slice();
  route.slice(0, 11).forEach((id) => hard.pick(id));
  const trayBefore = hard.tray.slice(),
    remaining = hard.remaining;
  const countsBefore = hard.tiles
    .filter((t) => !t.removed || trayBefore.includes(t.id))
    .map((t) => t.kind)
    .sort()
    .join(',');
  check(hard.reshuffle(), 'reshuffle succeeds');
  check(
    hard.tray.length === 0 && hard.remaining === remaining + trayBefore.length,
    'reshuffle returns unmatched tray cards without losing any',
  );
  check(
    hard.tiles
      .filter((t) => !t.removed)
      .map((t) => t.kind)
      .sort()
      .join(',') === countsBefore,
    'reshuffle preserves multiset',
  );
  check(!hard.canUndo && !hard.reshuffle(), 'reshuffle clears stale undo and consumes its charge');
  complete(hard);
}
const undo = new MatchGame(1, 42);
const original = JSON.stringify(undo.tiles);
const first = undo.availableTiles()[0].id;
undo.pick(first);
check(undo.undo(), 'undo succeeds');
check(
  JSON.stringify(undo.tiles) === original && undo.tray.length === 0,
  'undo restores exact board',
);
check(!undo.undo(), 'undo is limited');
function fixture(kinds) {
  const g = new MatchGame(2, 42);
  g.tiles = kinds.map((kind, id) => ({ id, kind, layer: 0, x: id * 90, y: 0, removed: false }));
  return g;
}
const lastSlot = fixture([0, 0, 1, 2, 3, 4, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
for (let i = 0; i < 7; i++) lastSlot.pick(i);
check(
  lastSlot.status === 'playing' && lastSlot.tray.length === 4,
  'seventh tile resolves triple before overflow',
);
check(
  lastSlot.undo() &&
    lastSlot.tray.length === 6 &&
    lastSlot.matches === 0 &&
    !lastSlot.tiles[6].removed,
  'undo restores a completed triple',
);
const loss = fixture([0, 1, 2, 3, 4, 5, 6]);
for (let i = 0; i < 7; i++) loss.pick(i);
check(loss.status === 'lost', 'seven distinct cards cause loss');
check(
  loss.pick(0) === null && !loss.reshuffle() && !loss.hint().length,
  'lost state rejects moves',
);
check(!loss.undo() && loss.status === 'lost', 'loss cannot be undone');
const hint = new MatchGame(2, 12);
for (let i = 0; i < 3; i++)
  check(
    hint.hint().every((id) => hint.isAvailable(id)),
    'hints only point to exposed cards',
  );
check(hint.hint().length === 0, 'hint charges enforced');
const a = new MatchGame(2, 42),
  b = new MatchGame(2, 42);
check(JSON.stringify(a.tiles) === JSON.stringify(b.tiles), 'same seed reproduces same board');
for (let seed = 1; seed <= 50; seed++) {
  const recovery = new MatchGame(2, seed);
  while (recovery.status === 'playing' && recovery.tray.length < 6) {
    const count = (k) => recovery.tray.filter((id) => recovery.tiles[id].kind === k).length;
    const open = recovery.availableTiles().sort((a, b) => count(a.kind) - count(b.kind));
    recovery.pick(open[0].id);
  }
  check(recovery.status === 'playing', 'tool recovery happens before failure');
  check(recovery.reshuffle(), 'reshuffle recovers a six-card dead end');
  complete(recovery);
}
let randomWins = 0,
  greedyWins = 0;
for (let seed = 1; seed <= 100; seed++)
  for (let strategy = 0; strategy < 2; strategy++) {
    const g = new MatchGame(2, seed),
      rng = randomSource(seed + 519);
    while (g.status === 'playing') {
      let open = g.availableTiles();
      if (strategy) {
        const count = (k) => g.tray.filter((id) => g.tiles[id].kind === k).length;
        const best = Math.max(...open.map((t) => count(t.kind)));
        open = open.filter((t) => count(t.kind) === best);
      }
      g.pick(open[Math.floor(rng() * open.length)].id);
    }
    if (g.status === 'won') {
      if (strategy) greedyWins++;
      else randomWins++;
    }
  }
console.log(
  `PASS — ${assertions} assertions; 400 seeded initial solutions + 200 shuffle recoveries + 50 six-card dead-end recoveries verified.`,
);
console.log(
  `Difficulty diagnostic (100 seeds, no tools): random ${randomWins}/100, tray-first greedy ${greedyWins}/100. This is a bot diagnostic, not a human win-rate estimate.`,
);
