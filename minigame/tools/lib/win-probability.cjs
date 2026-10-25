/**
 * Exact DP / Monte Carlo for uniformly random drawing WITHOUT replacement.
 * All remaining tiles are selectable; no cover geometry, tools or player skill.
 * A rule such as [2,2] may use the same kind in both groups. Rules retain priority.
 * Generic custom ties use input-kind order (largest multiplicity assigned first).
 */
const PRESETS = { classic: [[3]], quartet: [[4]], fun: [[2, 2]] };
class StateBudgetExceeded extends Error {}
function expandedPatterns(rules) {
  const result = [],
    seen = new Set();
  for (const rule of rules) {
    const groups = [];
    function visit(slot) {
      if (slot === rule.length) {
        const pattern = groups.slice().sort((a, b) => b - a),
          key = pattern.join(',');
        if (!seen.has(key)) {
          seen.add(key);
          result.push(pattern);
        }
        return;
      }
      groups.push(rule[slot]);
      visit(slot + 1);
      groups.pop();
      const sums = new Set();
      for (let group = 0; group < groups.length; group++) {
        if (sums.has(groups[group])) continue;
        sums.add(groups[group]);
        groups[group] += rule[slot];
        visit(slot + 1);
        groups[group] -= rule[slot];
      }
    }
    visit(0);
  }
  return result;
}
function normalize(spec) {
  const entries = Array.isArray(spec.counts)
    ? spec.counts.map((n, i) => ['type' + (i + 1), n])
    : Object.entries(spec.counts || {});
  if (!entries.length || entries.some(([name, n]) => !name || !Number.isSafeInteger(n) || n < 0))
    throw new Error('counts must contain nonnegative integer counts.');
  const active = entries.filter(([, n]) => n > 0),
    total = active.reduce((n, [, v]) => n + v, 0);
  if (!total || total > 10000) throw new Error('Total tile count must be between 1 and 10000.');
  const capacity = spec.capacity ?? 7;
  if (!Number.isSafeInteger(capacity) || capacity < 1)
    throw new Error('capacity must be a positive integer.');
  const raw = spec.rules || PRESETS[spec.mode || 'classic'];
  if (
    !Array.isArray(raw) ||
    !raw.length ||
    raw.some(
      (p) => !Array.isArray(p) || !p.length || p.some((n) => !Number.isSafeInteger(n) || n < 1),
    )
  )
    throw new Error(
      'rules must be positive-integer multiplicity patterns, for example [[3],[2,2]].',
    );
  const rules = raw.map((pattern) => pattern.slice().sort((a, b) => b - a));
  if (
    rules.some((pattern) => {
      const total = pattern.reduce((sum, count) => sum + count, 0);
      return total < 2 || total > 7;
    })
  )
    throw new Error('Each rule must total 2–7 tiles, matching the game rules.');
  // These families have an unambiguous matching kind/group in every reachable
  // stable tray. Only then may interchangeable kind states be canonicalized.
  const symmetric =
    (rules.length === 1 && rules[0].length === 1) ||
    (rules.length === 2 &&
      rules[0].length === 1 &&
      rules[0][0] >= 3 &&
      rules[1].join(',') === '2,2');
  return {
    names: active.map((e) => e[0]),
    counts: active.map((e) => e[1]),
    total,
    capacity,
    rules,
    effectiveRules: expandedPatterns(rules),
    symmetric,
    minContribution: Math.min(...rules.flat()),
  };
}
function settle(held, rules) {
  return settlePatterns(held, expandedPatterns(rules));
}
function settlePatterns(held, rules) {
  for (;;) {
    let matched = false;
    for (const pattern of rules) {
      const used = Array(held.length).fill(false),
        chosen = [];
      function assign(p) {
        if (p === pattern.length) return true;
        const start = p > 0 && pattern[p] === pattern[p - 1] ? chosen[p - 1] + 1 : 0;
        for (let kind = start; kind < held.length; kind++)
          if (!used[kind] && held[kind] >= pattern[p]) {
            used[kind] = true;
            chosen[p] = kind;
            if (assign(p + 1)) return true;
            used[kind] = false;
          }
        return false;
      }
      if (assign(0)) {
        pattern.forEach((n, i) => (held[chosen[i]] -= n));
        matched = true;
        break;
      }
    }
    if (!matched) return held;
  }
}
const sum = (a) => a.reduce((a, b) => a + b, 0);
function factorial(n) {
  let x = 1n;
  for (let i = 2; i <= n; i++) x *= BigInt(i);
  return x;
}
function gcd(a, b) {
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return a;
}
function ratio(a, b) {
  if (a === 0n)
    return {
      probability: 0,
      log10Probability: null,
      probabilityScientific: '0',
      numericUnderflow: false,
    };
  const x = String(a),
    y = String(b),
    mx = Number(x.slice(0, 16)) / 10 ** (Math.min(16, x.length) - 1),
    my = Number(y.slice(0, 16)) / 10 ** (Math.min(16, y.length) - 1);
  const log10Probability = Math.log10(mx / my) + x.length - y.length;
  const probability = Math.min(1, 10 ** log10Probability),
    exponent = Math.floor(log10Probability);
  return {
    probability,
    log10Probability,
    probabilityScientific: (10 ** (log10Probability - exponent)).toPrecision(8) + 'e' + exponent,
    numericUnderflow: probability === 0,
  };
}
function exact(model, { maxStates = 250000, maxMs = 3000 } = {}) {
  const started = Date.now(),
    memo = new Map();
  let visited = 0;
  if (model.total > 500) throw new StateBudgetExceeded('Exact recursion depth budget exceeded.');
  function visit(remaining, held) {
    if (sum(held) >= model.capacity) return 0n;
    const left = sum(remaining);
    if (!left) return sum(held) === 0 ? 1n : 0n;
    // No future action can remove a positive per-kind remainder smaller than
    // every contribution that this kind may make to any permitted pattern.
    if (remaining.some((r, i) => r + held[i] > 0 && r + held[i] < model.minContribution)) return 0n;
    if (model.symmetric) {
      const pairs = remaining
        .map((r, i) => [r, held[i]])
        .filter(([r, h]) => r || h)
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      remaining = pairs.map((p) => p[0]);
      held = pairs.map((p) => p[1]);
    }
    const key = remaining.map((n, i) => n + ':' + held[i]).join('|');
    if (memo.has(key)) return memo.get(key);
    if (++visited > maxStates || (visited % 128 === 0 && Date.now() - started > maxMs))
      throw new StateBudgetExceeded('Exact state/time budget exceeded.');
    let winningOrders = 0n;
    for (let i = 0; i < remaining.length;) {
      let multiplicity = 1;
      if (model.symmetric)
        while (
          i + multiplicity < remaining.length &&
          remaining[i + multiplicity] === remaining[i] &&
          held[i + multiplicity] === held[i]
        )
          multiplicity++;
      if (remaining[i]) {
        const r = remaining.slice(),
          h = held.slice();
        r[i]--;
        h[i]++;
        settlePatterns(h, model.effectiveRules);
        winningOrders += BigInt(remaining[i] * multiplicity) * visit(r, h);
      }
      i += multiplicity;
    }
    memo.set(key, winningOrders);
    return winningOrders;
  }
  const numerator = visit(model.counts.slice(), Array(model.counts.length).fill(0)),
    denominator = factorial(model.total),
    divisor = gcd(numerator, denominator);
  return {
    method: 'exact-dp',
    ...ratio(numerator, denominator),
    fraction: {
      numerator: String(numerator / divisor),
      denominator: String(denominator / divisor),
    },
    states: visited,
    elapsedMs: Date.now() - started,
  };
}
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function monteCarlo(model, { trials = 100000, seed = 20261025 } = {}) {
  if (!Number.isSafeInteger(trials) || trials < 1)
    throw new Error('trials must be a positive integer.');
  const rng = random(seed),
    started = Date.now();
  let wins = 0;
  for (let trial = 0; trial < trials; trial++) {
    const r = model.counts.slice(),
      h = Array(r.length).fill(0);
    let left = model.total,
      used = 0;
    while (left && used < model.capacity) {
      let x = Math.floor(rng() * left),
        i = 0;
      while (x >= r[i]) {
        x -= r[i];
        i++;
      }
      r[i]--;
      left--;
      h[i]++;
      settlePatterns(h, model.effectiveRules);
      used = sum(h);
    }
    if (!left && !used) wins++;
  }
  const p = wins / trials,
    z = 1.95996398454,
    d = 1 + (z * z) / trials,
    c = (p + (z * z) / (2 * trials)) / d,
    h = (z * Math.sqrt((p * (1 - p)) / trials + (z * z) / (4 * trials * trials))) / d;
  return {
    method: 'monte-carlo',
    probability: p,
    wins,
    trials,
    seed,
    confidence95: [Math.max(0, c - h), Math.min(1, c + h)],
    zeroWinUpper95: wins === 0 ? 1 - Math.pow(0.05, 1 / trials) : null,
    elapsedMs: Date.now() - started,
  };
}
function calculate(spec, options = {}) {
  const model = normalize(spec),
    method = options.method || 'auto';
  if (!['auto', 'exact', 'monte-carlo'].includes(method))
    throw new Error('method must be auto, exact or monte-carlo.');
  const assumptions = [
    'Uniformly random selection among all remaining individual tiles, without replacement.',
    'All remaining tiles selectable; no cover geometry or tools.',
    'Matching happens before checking whether the tray is full.',
    'Winning requires every tile to be removed and the tray to be empty.',
    'Each group uses identical tiles; groups may share a kind. Original distinct-kind patterns are tried before merged groups, with input-kind order breaking ties.',
  ];
  let result;
  if (
    model.rules.length === 1 &&
    model.rules[0].length === 1 &&
    model.counts.some((n) => n % model.rules[0][0] !== 0)
  )
    result = {
      method: 'exact-impossibility',
      probability: 0,
      fraction: { numerator: '0', denominator: '1' },
      reason: 'At least one kind count is not divisible by the sole matching threshold.',
    };
  else if (model.rules.every((p) => sum(p) > model.capacity))
    result = {
      method: 'exact-impossibility',
      probability: 0,
      fraction: { numerator: '0', denominator: '1' },
      reason: 'Every matching pattern needs more slots than the tray capacity.',
    };
  else if (method === 'monte-carlo') result = monteCarlo(model, options);
  else {
    try {
      result = exact(model, options);
    } catch (error) {
      if (!(error instanceof StateBudgetExceeded) || method === 'exact') throw error;
      result = { ...monteCarlo(model, options), fallbackReason: error.message };
    }
  }
  return {
    model: 'random-draw-without-replacement',
    counts: Object.fromEntries(model.names.map((n, i) => [n, model.counts[i]])),
    total: model.total,
    capacity: model.capacity,
    rules: model.rules,
    assumptions,
    ...result,
  };
}
module.exports = { calculate, normalize, settle };
