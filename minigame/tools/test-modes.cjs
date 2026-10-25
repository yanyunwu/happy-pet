const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), Module = require('node:module');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
function load(name) {
  const file = path.resolve(__dirname, `../assets/scripts/core/${name}.ts`), mod = new Module(file);
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, file); return mod.exports;
}
const { MatchGame, MODES, randomSource, matchIndices } = load('MatchGame');
const { normalizeSave, claimSignIn, SIGN_IN_REWARDS } = load('Profile');
let checks = 0; const check = (condition, message) => { checks++; assert.ok(condition, message); };
function solve(g) { for (const id of g.solution.slice()) { check(g.pick(id), `${g.mode.id} legal witness move`); check(g.status !== 'lost', `${g.mode.id} witness remains safe`); } check(g.status === 'won' && g.tray.length === 0, 'witness clears both board and tray'); }
function fixture(kinds, mode) { const g = new MatchGame(2, 42, mode); g.tiles = kinds.map((kind, id) => ({ id, kind, layer: 0, x: id * 100, y: 0, removed: false })); return g; }
const difficulty = {};
for (const mode of MODES) {
  let greedyWins = 0;
  for (let seed = 1; seed <= 150; seed++) {
    for (const level of [1, 2]) {
      const g = new MatchGame(level, seed, mode.id), counts = {};
      g.tiles.forEach(t => counts[t.kind] = (counts[t.kind] || 0) + 1);
      check(g.tiles.length === (level === 2 ? 108 : { classic: 18, quartet: 16, fun: 7 }[mode.id]), 'mode board size');
      if (level === 2) check(Object.keys(counts).length === 15, 'hard boards contain all 15 animals');
      if (mode.id !== 'fun') check(Object.values(counts).every(n => n % mode.matchSize === 0), 'per-kind counts support match size');
      solve(g); check(g.cleared === g.tiles.length, 'progress counts exact cleared cards');
    }
    const shuffle = new MatchGame(2, seed, mode.id);
    shuffle.solution.slice(0, 11).forEach(id => shuffle.pick(id));
    const counts = () => shuffle.tiles.filter(t => !t.removed || shuffle.tray.includes(t.id)).map(t => t.kind).sort().join(',');
    const before = counts(); check(shuffle.reshuffle(), 'witness state remains reshufflable'); check(counts() === before, 'shuffle preserves all unmatched kinds'); solve(shuffle);
    if (mode.id !== 'fun') {
      const easy = new MatchGame(1, seed, mode.id), rng = randomSource(seed);
      while (easy.status === 'playing') { const open = easy.availableTiles(); easy.pick(open[Math.floor(rng() * open.length)].id); }
      check(easy.status === 'won', 'classic and quartet tutorials forgive random choices');
    }
    if (seed <= 100) {
      const g = new MatchGame(2, seed, mode.id), rng = randomSource(seed + 913);
      while (g.status === 'playing') {
        const held = g.tray.map(id => g.tiles[id].kind), rank = t => (matchIndices([...held, t.kind], mode.id).length ? 100 : 0) + held.filter(k => k === t.kind).length;
        let open = g.availableTiles(); const best = Math.max(...open.map(rank)); open = open.filter(t => rank(t) === best); g.pick(open[Math.floor(rng() * open.length)].id);
      }
      if (g.status === 'won') greedyWins++;
    }
  }
  difficulty[mode.id] = `${greedyWins}/100`;
  check(greedyWins < 35, 'hard board resists naive match-first choices');
}
const four = fixture([0, 0, 0, 1, 2, 3, 0, 1], 'quartet');
[0, 1, 2].forEach(id => four.pick(id)); check(four.matches === 0 && four.tray.length === 3, 'quartet never clears triples');
[3, 4, 5, 6].forEach(id => four.pick(id)); check(four.matches === 1 && four.cleared === 4 && four.tray.length === 3 && four.status === 'playing', 'quartet clears at slot seven before overflow');
check(four.undo() && four.tray.length === 6 && four.cleared === 0 && four.matches === 0, 'undo restores all four cards and exact progress');
const pair = fixture([0, 0, 1, 2, 3, 4, 1, 2], 'fun'); [0, 1, 2, 3, 4, 5, 6].forEach(id => pair.pick(id));
check(pair.cleared === 4 && pair.matches === 1 && pair.tray.length === 3 && pair.status === 'playing', 'AABB clears nonadjacent pairs at slot seven');
check(pair.undo() && pair.cleared === 0 && pair.tray.length === 6, 'undo pair clear');
const triple = fixture([0, 0, 0, 1], 'fun'); [0, 1, 2].forEach(id => triple.pick(id)); check(triple.cleared === 3 && triple.tray.length === 0, 'fun retains triples');
check(matchIndices([0, 0, 0, 1, 1], 'fun').length === 3, 'triple priority is deterministic');
check(matchIndices([0, 0, 1, 2], 'fun').length === 0, 'a single pair never clears');
const stranded = fixture([0, 0, 1, 1, 0, 1], 'fun'); [0, 1, 2, 3].forEach(id => stranded.pick(id));
const before = JSON.stringify(stranded.tiles); check(!stranded.reshuffle() && stranded.shuffleLeft === 1 && JSON.stringify(stranded.tiles) === before, 'unpairable remainder cannot silently change kinds or consume shuffle');
[4, 5].forEach(id => stranded.pick(id)); check(stranded.stranded && stranded.status === 'lost', 'empty board leftovers end rather than soft-lock'); check(!stranded.undo() && !stranded.shovel(), 'failed round rejects recovery tools');
const tutorial = new MatchGame(1, 42, 'fun'); check(tutorial.hint().length === 3, 'fun tutorial begins with triple example');
[0, 1, 2].forEach(id => tutorial.pick(id)); const pairHint = tutorial.hint(); check(pairHint.length === 4, 'fun hint understands two pairs'); pairHint.forEach(id => tutorial.pick(id)); check(tutorial.status === 'won', 'tutorial demonstrates both matching rules');
// Shoveling is a location transfer, never a deletion or automatic match.
for (const mode of MODES) {
  const g = fixture([0, 1, 2, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3], mode.id);
  [0, 1, 2].forEach(id => g.pick(id)); const moves = g.moves, remaining = g.remaining;
  check(g.shovel(), 'shovel moves the complete tray');
  check(g.reserve.join(',') === '0,1,2' && g.tray.length === 0 && g.cleared === 0 && g.moves === moves, 'shovel does not match, delete or count a pick');
  check(g.remaining === remaining + 3 && g.shovelLeft === 0 && !g.canUndo, 'reserve remains in completion accounting, charge used, stale undo cleared');
  check(!g.shovel(), 'empty tray cannot spend a shovel');
  check(g.availableTiles().some(t => t.id === 0), 'parked card is selectable');
  const result = g.pick(0); check(result.source === 'reserve' && !g.reserve.includes(0) && g.tray.includes(0), 'reserve returns to tray without duplicating');
  check(g.undo() && g.reserve.includes(0) && !g.tray.includes(0), 'undo restores exact reserve location');
  const counts = g.tiles.filter(t => !t.removed || g.reserve.includes(t.id)).map(t => t.kind).sort().join(',');
  // Use a mode-valid real deal for shuffle rather than the arbitrary fixture above.
  const real = new MatchGame(2, 91, mode.id); real.solution.slice(0, 2).forEach(id => real.pick(id)); real.shovel();
  const before = real.tiles.filter(t => !t.removed || real.reserve.includes(t.id)).map(t => t.kind).sort().join(',');
  check(real.reshuffle() && real.reserve.length === 0 && real.tray.length === 0, 'shuffle includes reserve');
  check(real.tiles.filter(t => !t.removed).map(t => t.kind).sort().join(',') === before, 'shuffle preserves the reserve multiset'); solve(real);
}
const reserveFinish = fixture([0, 0, 0], 'classic'); reserveFinish.pick(0); reserveFinish.shovel(); reserveFinish.pick(1); reserveFinish.pick(2);
check(reserveFinish.status === 'playing' && reserveFinish.remaining === 1, 'empty board with reserved card is still playable');
reserveFinish.pick(0); check(reserveFinish.status === 'won' && reserveFinish.cleared === 3, 'taking final reserved card can win');
const reserveCapacity = fixture([0,1,2,3,4,5,6,7,8], 'classic'); [0,1,2,3,4,5].forEach(id=>reserveCapacity.pick(id)); reserveCapacity.shovel();
reserveCapacity.pick(6); reserveCapacity.pick(7); reserveCapacity.shovelLeft=1;
check(!reserveCapacity.shovel() && reserveCapacity.shovelLeft === 1 && reserveCapacity.reserve.length === 6, 'full temporary row rejects all-or-nothing transfer without charging');
const save = normalizeSave({ unlocked: 2, completed: true, stars: 48, sound: false, best: 3600 });
check(save.coins === 48 && save.modes.classic.completed && save.modes.quartet.unlocked === 1 && save.modes.fun.unlocked === 1 && !save.sound, 'legacy progress and stars migrate only to classic');
check(save.bag.shovel === 0, 'old profiles gain an empty shovel inventory');
for (let day = 1; day <= 8; day++) {
  const date = `2026-10-${String(day).padStart(2, '0')}`, previous = save.coins;
  check(claimSignIn(save, date), 'new day can claim'); check(save.coins === previous + SIGN_IN_REWARDS[(day - 1) % 7].coins, 'correct daily reward');
  const snapshot = JSON.stringify(save); check(!claimSignIn(save, date) && JSON.stringify(save) === snapshot, 'same day cannot claim twice');
  const loaded = normalizeSave(JSON.parse(snapshot)); check(!claimSignIn(loaded, date), 'reload cannot claim again');
}
check(save.signInCount === 8 && !claimSignIn(save, '2026-10-01'), 'seven-day cycle wraps and clock rollback cannot claim');
check(normalizeSave(null).coins === 0 && normalizeSave({ coins: -42 }).coins === 0, 'malformed save remains usable');
console.log(`PASS — ${checks} assertions; 900 initial boards + 450 reshuffle solutions; quartet, AABB, hints, reserve, terminal states and profile migration.`);
console.log('Hard level match-first bot diagnostic (not human win rates):', difficulty);
