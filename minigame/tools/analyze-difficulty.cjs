// Read-only, reproducible difficulty audit of the actual MatchGame rules.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  Module = require('node:module'),
  assert = require('node:assert/strict');
const ts = require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
const source = path.resolve(__dirname, '../assets/scripts/core/MatchGame.ts'),
  code = fs.readFileSync(source, 'utf8'),
  mod = new Module(source);
mod._compile(
  ts.transpileModule(code + '\nexport const partitionForAudit = groupsForCounts;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText,
  source,
);
const {
  MatchGame,
  MODES,
  CAPACITY,
  TILE_W,
  TILE_H,
  matchIndices,
  randomSource,
  partitionForAudit,
} = mod.exports;
const getArg = (key, fallback) => {
  const i = process.argv.indexOf(key);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
};
const runs = getArg('--runs', 1000),
  ablationRuns = Math.min(runs, getArg('--ablation-runs', 500));
assert.ok(Number.isInteger(runs) && runs > 0 && Number.isInteger(ablationRuns) && ablationRuns > 0);
const out = path.resolve(__dirname, '../output/difficulty');
fs.mkdirSync(out, { recursive: true });
const policies = [
  { id: 'random', name: '随机合法选牌' },
  { id: 'greedy', name: '优先立即消除、凑槽中同类' },
  { id: 'planner', name: '明牌局部规划' },
  { id: 'tools', name: '明牌规划＋每局免费道具', tools: ['undo', 'shovel', 'hint', 'shuffle'] },
];
const allTools = ['undo', 'shovel', 'hint', 'shuffle'];
function preview(g, t) {
  const held = g.tray.map((id) => g.tiles[id].kind),
    all = [...held, t.kind],
    match = matchIndices(all, g.mode.id),
    size = all.length - match.length;
  return {
    match: match.length,
    held: held.filter((k) => k === t.kind).length,
    size,
    safe: size < CAPACITY && !(g.remaining === 1 && size > 0),
  };
}
function visibleGroupPossible(g, open, kind) {
  const held = Array(g.level.kinds).fill(0),
    pool = held.slice();
  g.tray.forEach((id) => held[g.tiles[id].kind]++);
  held.forEach((n, k) => (pool[k] = n));
  open.forEach((t) => pool[t.kind]++);
  if (pool[kind] >= g.mode.matchSize && g.tray.length + g.mode.matchSize - held[kind] <= CAPACITY)
    return true;
  if (g.mode.id === 'fun' && pool[kind] >= 2)
    for (let k = 0; k < pool.length; k++)
      if (
        k !== kind &&
        pool[k] >= 2 &&
        g.tray.length + Math.max(0, 2 - held[kind]) + Math.max(0, 2 - held[k]) <= CAPACITY
      )
        return true;
  return false;
}
function overlaps(a, b) {
  return b.layer > a.layer && Math.abs(a.x - b.x) < TILE_W - 4 && Math.abs(a.y - b.y) < TILE_H - 4;
}
function choose(g, open, rng, policy, ban) {
  let choices = open.filter((t) => t.id !== ban);
  if (!choices.length) choices = open;
  if (policy.id === 'random') return choices[Math.floor(rng() * choices.length)];
  const scored = choices.map((t) => {
    const p = preview(g, t);
    let value = p.match * 100 + (p.held || 0) * 10;
    if (policy.id !== 'greedy') {
      value =
        p.match * 1000 +
        p.held * 20 +
        (visibleGroupPossible(g, open, t.kind) ? 120 : 0) +
        open.filter((a) => a.kind === t.kind).length;
      // Geometry is observable; do not inspect the kinds of newly revealed cards.
      const uncovered = g.reserve.includes(t.id)
        ? 0
        : g.tiles.filter(
            (a) =>
              !a.removed &&
              overlaps(a, t) &&
              !g.tiles.some((b) => !b.removed && b.id !== t.id && overlaps(a, b)),
          ).length;
      value += uncovered * 0.1;
      if (!p.safe) value -= 10000;
    }
    return { t, value };
  });
  const best = Math.max(...scored.map((x) => x.value)),
    ties = scored.filter((x) => x.value === best);
  return ties[Math.floor(rng() * ties.length)].t;
}
function run(level, seed, mode, policy, onStep) {
  const g = new MatchGame(level, seed, mode),
    rng = randomSource(seed ^ 0x3f97c251),
    allowed = policy.tools || [];
  let picks = 0,
    firstMatch = 0,
    danger = 0,
    slotSum = 0,
    peak = 0,
    branchSum = 0,
    safeRatioSum = 0,
    hintQueue = [],
    last = -1,
    ban = -1,
    guard = 0;
  const used = { undo: 0, shovel: 0, hint: 0, shuffle: 0 };
  while (g.status === 'playing' && guard++ < g.level.total * 5 + 50) {
    const open = g.availableTiles();
    assert.ok(open.length > 0, 'playing state must have a legal choice');
    const safe = open.filter((t) => preview(g, t).safe);
    if (!safe.length && allowed.length) {
      if (allowed.includes('undo') && g.canUndo) {
        ban = last;
        if (g.undo()) {
          used.undo++;
          hintQueue = [];
          continue;
        }
      }
      if (allowed.includes('shovel') && g.shovel()) {
        used.shovel++;
        hintQueue = [];
        continue;
      }
      if (allowed.includes('shuffle') && g.reshuffle()) {
        used.shuffle++;
        hintQueue = [];
        ban = -1;
        continue;
      }
    }
    hintQueue = hintQueue.filter((id) => g.isAvailable(id));
    if (!hintQueue.length && g.tray.length >= 4 && allowed.includes('hint') && g.hintLeft > 0) {
      const before = g.hintLeft;
      hintQueue = g.hint();
      used.hint += before - g.hintLeft;
    }
    let t = hintQueue.length ? g.tiles[hintQueue.shift()] : choose(g, open, rng, policy, ban);
    ban = -1;
    branchSum += open.length;
    safeRatioSum += safe.length / open.length;
    const result = g.pick(t.id);
    assert.ok(result, 'chosen card remains available');
    last = t.id;
    picks++;
    if (onStep) onStep(g, { picks, result });
    if (result.matched.length && !firstMatch) firstMatch = picks;
    if (g.tray.length >= 5) danger++;
    slotSum += g.tray.length;
    peak = Math.max(peak, result.displayTray.length);
  }
  assert.notEqual(g.status, 'playing', 'policy terminated within action bound');
  return {
    mode,
    level,
    seed,
    policy: policy.id,
    won: g.status === 'won',
    reason: g.status === 'won' ? 'won' : g.stranded ? 'leftovers' : 'full',
    picks,
    cleared: g.cleared,
    clearPct: (g.cleared / g.level.total) * 100,
    firstMatch,
    hadMatch: firstMatch > 0,
    dangerRate: danger / picks,
    meanSlots: slotSum / picks,
    peak,
    meanChoices: branchSum / picks,
    immediateSafeRate: safeRatioSum / picks,
    ...Object.fromEntries(allTools.map((k) => [k, used[k]])),
  };
}
function quantile(a, p) {
  const s = a.slice().sort((a, b) => a - b),
    x = (s.length - 1) * p,
    l = Math.floor(x),
    h = Math.ceil(x);
  return s[l] + (s[h] - s[l]) * (x - l);
}
function mean(a) {
  return a.reduce((a, b) => a + b, 0) / a.length;
}
function wilson(w, n) {
  const z = 1.95996398454,
    p = w / n,
    d = 1 + (z * z) / n,
    c = (p + (z * z) / (2 * n)) / d,
    h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h) * 100, Math.min(1, c + h) * 100];
}
function summarize(rows) {
  const wins = rows.filter((r) => r.won).length;
  return {
    n: rows.length,
    wins,
    winRate: (wins / rows.length) * 100,
    win95: wilson(wins, rows.length),
    zeroWinOneSided95Upper: wins === 0 ? (1 - Math.pow(0.05, 1 / rows.length)) * 100 : null,
    meanPicks: mean(rows.map((r) => r.picks)),
    medianPicks: quantile(
      rows.map((r) => r.picks),
      0.5,
    ),
    picksIQR: [
      quantile(
        rows.map((r) => r.picks),
        0.25,
      ),
      quantile(
        rows.map((r) => r.picks),
        0.75,
      ),
    ],
    meanClearedPct: mean(rows.map((r) => r.clearPct)),
    meanDangerPct: mean(rows.map((r) => r.dangerRate)) * 100,
    meanSlots: mean(rows.map((r) => r.meanSlots)),
    firstMatchRate: (rows.filter((r) => r.hadMatch).length / rows.length) * 100,
    meanFirstMatchPicks: rows.some((r) => r.hadMatch)
      ? mean(rows.filter((r) => r.hadMatch).map((r) => r.firstMatch))
      : null,
    leftoverLosses: rows.filter((r) => r.reason === 'leftovers').length,
    meanImmediateSafePct: mean(rows.map((r) => r.immediateSafeRate)) * 100,
    meanChoices: mean(rows.map((r) => r.meanChoices)),
    toolUse: Object.fromEntries(
      allTools.map((k) => [
        k,
        {
          rate: (rows.filter((r) => r[k] > 0).length / rows.length) * 100,
          mean: mean(rows.map((r) => r[k])),
        },
      ]),
    ),
  };
}
function initialInfo(g) {
  const open = g.availableTiles(),
    counts = Array(g.level.kinds).fill(0);
  open.forEach((t) => counts[t.kind]++);
  const blocked = g.tiles.filter((t) => !g.isAvailable(t.id));
  return {
    tiles: g.tiles.length,
    kinds: g.level.kinds,
    layers: 1 + Math.max(...g.tiles.map((t) => t.layer)),
    openingChoices: open.length,
    openingDistinctKinds: new Set(open.map((t) => t.kind)).size,
    blockedPct: (blocked.length / g.tiles.length) * 100,
    meanCoverers: blocked.length
      ? mean(blocked.map((t) => g.tiles.filter((over) => overlaps(t, over)).length))
      : 0,
    openingMatch:
      matchIndices(
        open.map((t) => t.kind),
        g.mode.id,
      ).length > 0,
  };
}
module.exports = { run, MatchGame, partitionForAudit };
if (require.main === module) {
  const rows = [],
    results = [],
    structures = [],
    ablations = [];
  for (const mode of MODES)
    for (const level of [1, 2]) {
      const initial = [],
        peaks = [];
      let witnesses = 0;
      for (let seed = 1; seed <= runs; seed++) {
        const g = new MatchGame(level, seed, mode.id);
        initial.push(initialInfo(g));
        let peak = 0;
        for (const id of g.solution.slice()) {
          const r = g.pick(id);
          assert.ok(r);
          peak = Math.max(peak, r.displayTray.length);
        }
        assert.equal(g.status, 'won');
        witnesses++;
        peaks.push(peak);
        for (const policy of policies) rows.push(run(level, seed, mode.id, policy));
      }
      structures.push({
        mode: mode.id,
        level,
        ...initial[0],
        openingMatchRate: mean(initial.map((x) => Number(x.openingMatch))) * 100,
        meanOpeningDistinctKinds: mean(initial.map((x) => x.openingDistinctKinds)),
        verifiedWitnesses: witnesses,
        meanWitnessPeak: mean(peaks),
        maxWitnessPeak: Math.max(...peaks),
      });
      for (const policy of policies)
        results.push({
          mode: mode.id,
          level,
          policy: policy.id,
          ...summarize(
            rows.filter((r) => r.mode === mode.id && r.level === level && r.policy === policy.id),
          ),
        });
      console.log(
        `${mode.title} stage ${level}: ${runs} boards × ${policies.length} strategies complete`,
      );
    }
  for (const mode of MODES) {
    const baseline = rows.filter(
        (r) =>
          r.mode === mode.id && r.level === 2 && r.policy === 'tools' && r.seed <= ablationRuns,
      ),
      base = summarize(baseline);
    for (const removed of allTools) {
      const subset = [];
      for (let seed = 1; seed <= ablationRuns; seed++)
        subset.push(
          run(2, seed, mode.id, {
            id: 'without-' + removed,
            tools: allTools.filter((t) => t !== removed),
          }),
        );
      const summary = summarize(subset);
      ablations.push({
        mode: mode.id,
        removed,
        ...summary,
        baselineAllTools: base,
        winRateDifference: base.winRate - summary.winRate,
        clearPctDifference: base.meanClearedPct - summary.meanClearedPct,
      });
      rows.push(...subset);
    }
    console.log(`${mode.title} tool ablations: ${ablationRuns} paired boards complete`);
  }
  // Exactly enumerate the 210 equally likely type sequences of the flat tutorial.
  let exactTotal = 0,
    exactWins = 0;
  function enumerate(counts, held) {
    if (counts.every((n) => n === 0)) {
      exactTotal++;
      if (!held.length) exactWins++;
      return;
    }
    for (let k = 0; k < counts.length; k++)
      if (counts[k]) {
        const next = [...held, k],
          matched = matchIndices(next, 'fun'),
          rest = next.filter((_, i) => !matched.includes(i));
        counts[k]--;
        enumerate(counts, rest);
        counts[k]++;
      }
  }
  enumerate([3, 2, 2], []);
  const report = {
    source: 'assets/scripts/core/MatchGame.ts',
    sha256: crypto.createHash('sha256').update(code).digest('hex'),
    runsPerCell: runs,
    ablationRuns,
    rollouts: rows.length,
    seedRange: [1, runs],
    policies,
    assumptions: [
      'Bots are not human players.',
      'No bot reads the stored solution; solution is used only for solvability checks.',
      'Planner uses currently available animal types and occlusion geometry, not hidden animal types.',
      'Tools policy uses only per-round free charges, no backpack stock.',
      'Ablation changes one allowed tool at a time on the same seeds; effects depend on this policy.',
      'Easy fun has a fixed board; seeds vary only selection tie-breaks.',
      'Hard generator deliberately rejects easy greedy wins, so these bot results are not an independent human-difficulty calibration.',
    ],
    results,
    structures,
    ablations,
    funTutorialExact: { total: exactTotal, wins: exactWins, rate: (exactWins / exactTotal) * 100 },
  };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2));
  const columns = Object.keys(rows[0]);
  fs.writeFileSync(
    path.join(out, 'rollouts.csv'),
    '\uFEFF' +
      columns.join(',') +
      '\n' +
      rows.map((r) => columns.map((k) => r[k]).join(',')).join('\n'),
  );
  console.log(
    JSON.stringify(
      {
        rollouts: rows.length,
        funTutorialExact: report.funTutorialExact,
        results: results.map((r) => ({
          mode: r.mode,
          level: r.level,
          policy: r.policy,
          wins: r.wins,
          n: r.n,
          picks: +r.meanPicks.toFixed(2),
          cleared: +r.meanClearedPct.toFixed(2),
        })),
      },
      null,
      2,
    ),
  );
}
