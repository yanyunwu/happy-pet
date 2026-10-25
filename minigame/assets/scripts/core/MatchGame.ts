/** Pure rules shared by all three modes. No engine or platform dependencies. */
import type { CloudState, CloudSession } from './OnlineClient';
export type GameStatus = 'playing' | 'won' | 'lost';
export type ModeId = 'classic' | 'quartet' | 'fun';
export interface Mode {
  id: ModeId;
  title: string;
  rule: string;
  shortRule: string;
  matchSize: number;
}
export const MODES: Mode[] = [
  {
    id: 'classic',
    title: '经典三消',
    rule: '三个相同萌宠自动消除',
    shortRule: '三个相同就消除',
    matchSize: 3,
  },
  {
    id: 'quartet',
    title: '极限四消',
    rule: '四个相同萌宠才能消除',
    shortRule: '四个相同才消除',
    matchSize: 4,
  },
  {
    id: 'fun',
    title: '趣味规则消',
    rule: '三个相同，或两种萌宠各两个',
    shortRule: '三个相同 / 两对不同',
    matchSize: 3,
  },
];
export const defaultRules = (mode: ModeId): number[][] =>
  mode === 'quartet' ? [[4]] : mode === 'fun' ? [[3], [2, 2]] : [[3]];
export function canonicalRules(rules: number[][]): number[][] {
  if (!Array.isArray(rules) || rules.length < 1 || rules.length > 6)
    throw new Error('关卡需要 1–6 条消除规则');
  const seen = new Set<string>();
  return rules.map((pattern) => {
    if (
      !Array.isArray(pattern) ||
      !pattern.length ||
      pattern.some((n) => !Number.isInteger(n) || n < 1 || n > 7)
    )
      throw new Error('消除规则需要正整数');
    const total = pattern.reduce((sum, n) => sum + n, 0);
    if (total < 2 || total > CAPACITY) throw new Error('每条消除规则合计 2–7 个萌宠');
    const next = pattern.slice().sort((a, b) => b - a),
      key = next.join('+');
    if (seen.has(key)) throw new Error('消除规则不可重复');
    seen.add(key);
    return next;
  });
}
function presetRuleMode(rules: number[][]): ModeId | null {
  return (
    MODES.find((mode) => JSON.stringify(defaultRules(mode.id)) === JSON.stringify(rules))?.id ||
    null
  );
}
export function ruleDescription(pattern: number[]): string {
  if (pattern.length === 1) return `${pattern[0]} 个相同萌宠`;
  if (pattern.every((n) => n === pattern[0])) return `${pattern.length} 种萌宠各 ${pattern[0]} 个`;
  return `${pattern.join(' + ')} · 每组是不同种类`;
}
export interface Tile {
  id: number;
  kind: number;
  x: number;
  y: number;
  layer: number;
  removed: boolean;
}
export interface Level {
  id: number;
  title: string;
  subtitle: string;
  kinds: number;
  total: number;
}
export const LEVELS: Level[] = [
  { id: 1, title: '新手乐园', subtitle: '轻松认识小伙伴', kinds: 3, total: 18 },
  { id: 2, title: '高手挑战', subtitle: '先看下层，再做选择', kinds: 15, total: 108 },
];
export const CAPACITY = 7,
  RESERVE_CAPACITY = 7,
  TILE_W = 94,
  TILE_H = 98;
// Kind IDs follow the twelve zodiac animals, then cat, panda and lion.
export const KIND_NAMES = [
  '鼠',
  '牛',
  '虎',
  '兔',
  '龙',
  '蛇',
  '马',
  '羊',
  '猴',
  '鸡',
  '狗',
  '猪',
  '猫',
  '熊猫',
  '狮子',
];
export interface PickResult {
  tile: Tile;
  displayTray: number[];
  matched: number[];
  insertion: number;
  source: 'board' | 'reserve';
}
interface Snapshot {
  tiles: Tile[];
  tray: number[];
  reserve: number[];
  matches: number;
  cleared: number;
  moves: number;
  status: GameStatus;
}
export function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled<T>(items: T[], rng: () => number): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function overlaps(under: Tile, over: Tile): boolean {
  return (
    over.layer > under.layer &&
    Math.abs(under.x - over.x) < TILE_W - 4 &&
    Math.abs(under.y - over.y) < TILE_H - 4
  );
}
function available(tiles: Tile[]): Tile[] {
  return tiles.filter(
    (t) => !t.removed && !tiles.some((over) => !over.removed && overlaps(t, over)),
  );
}
function removalOrder(tiles: Tile[], rng: () => number): number[] {
  const copy = tiles.map((t) => ({ ...t })),
    result: number[] = [];
  while (copy.some((t) => !t.removed)) {
    const candidates = available(copy),
      tile = candidates[Math.floor(rng() * candidates.length)];
    if (!tile) throw new Error('Invalid board geometry');
    result.push(tile.id);
    tile.removed = true;
  }
  return result;
}
/** The same matcher drives real picks, dealing, hints and difficulty simulation. */
export function matchIndices(kinds: number[], rule: ModeId | number[][]): number[] {
  const groups = new Map<number, number[]>();
  kinds.forEach((kind, index) => groups.set(kind, [...(groups.get(kind) || []), index]));
  const rules = typeof rule === 'string' ? defaultRules(rule) : rule;
  const buckets = Array.from(groups.values());
  for (const pattern of rules) {
    const used = new Set<number>(),
      matched: number[] = [];
    const assign = (slot: number): boolean => {
      if (slot === pattern.length) return true;
      for (let kind = 0; kind < buckets.length; kind++) {
        if (used.has(kind) || buckets[kind].length < pattern[slot]) continue;
        used.add(kind);
        const length = matched.length;
        matched.push(...buckets[kind].slice(0, pattern[slot]));
        if (assign(slot + 1)) return true;
        matched.length = length;
        used.delete(kind);
      }
      return false;
    };
    if (assign(0)) return matched.sort((a, b) => a - b);
  }
  return [];
}
function afterPick(held: number[], kind: number, mode: ModeId | number[][]): number[] {
  const all = [...held, kind],
    matched = matchIndices(all, mode);
  return all.filter((_, i) => !matched.includes(i));
}
/** Partition into valid groups. In fun mode AAA + BBB can become AABB + AB;
 * that remainder cannot be repaired by permuting cards. Never invent/discard it. */
function groupsForCounts(
  counts: number[],
  rule: ModeId | number[][],
  rng?: () => number,
): number[][] | null {
  const rules = typeof rule === 'string' ? defaultRules(rule) : rule;
  const mode = presetRuleMode(rules);
  if (!mode) return customGroups(counts, rules);
  const size = mode === 'quartet' ? 4 : 3,
    result: number[][] = [];
  if (mode !== 'fun') {
    if (counts.some((n) => n % size !== 0)) return null;
    counts.forEach((n, k) => {
      for (let i = 0; i < n; i += size) result.push(Array(size).fill(k));
    });
    return result;
  }
  const pairs: number[] = [];
  const find = (k: number): boolean => {
    if (k === counts.length) {
      const total = pairs.reduce((a, b) => a + b, 0);
      return total % 2 === 0 && Math.max(0, ...pairs) * 2 <= total;
    }
    const choices: number[] = [];
    for (let n = 0; n * 2 <= counts[k]; n++) if ((counts[k] - n * 2) % 3 === 0) choices.push(n);
    for (const n of rng ? shuffled(choices, rng) : choices) {
      pairs[k] = n;
      if (find(k + 1)) return true;
    }
    return false;
  };
  if (!find(0)) return null;
  counts.forEach((n, k) => {
    for (let i = 0; i < n - pairs[k] * 2; i += 3) result.push([k, k, k]);
  });
  while (pairs.some((n) => n > 0)) {
    const largest = pairs
        .map((n, k) => ({ n, k }))
        .filter((p) => p.n > 0)
        .sort((a, b) => b.n - a.n),
      a = largest[0].k,
      b = largest[1].k;
    result.push([a, a, b, b]);
    pairs[a]--;
    pairs[b]--;
  }
  return result;
}

function triggerablePatterns(rules: number[][]): { pattern: number[]; order: number[] }[] {
  return rules.flatMap((pattern) => {
    const used = pattern.map(() => 0),
      order: number[] = [],
      bad = new Set<string>();
    const total = pattern.reduce((sum, n) => sum + n, 0);
    const search = (): boolean => {
      const matched = matchIndices(order, rules);
      if (order.length === total) return matched.length === total;
      if (matched.length) return false;
      const key = used.join(',');
      if (bad.has(key)) return false;
      for (let kind = 0; kind < pattern.length; kind++) {
        if (used[kind] >= pattern[kind]) continue;
        used[kind]++;
        order.push(kind);
        if (search()) return true;
        order.pop();
        used[kind]--;
      }
      bad.add(key);
      return false;
    };
    return search() ? [{ pattern, order }] : [];
  });
}

/** Each decomposed group uses a real triggering order, including rule priority. */
function customGroups(counts: number[], rules: number[][], budget = 50000): number[][] | null {
  const plans = triggerablePatterns(rules);
  const remaining = counts.slice(),
    bad = new Set<string>(),
    result: number[][] = [];
  const search = (): boolean => {
    if (--budget < 0) return false;
    const anchor = remaining.findIndex((n) => n > 0);
    if (anchor < 0) return true;
    const key = remaining
      .slice()
      .sort((a, b) => a - b)
      .join(',');
    if (bad.has(key)) return false;
    for (const { pattern, order } of plans) {
      const seenAnchor = new Set<number>();
      for (let anchorSlot = 0; anchorSlot < pattern.length; anchorSlot++) {
        const amount = pattern[anchorSlot];
        if (seenAnchor.has(amount) || remaining[anchor] < amount) continue;
        seenAnchor.add(amount);
        const chosen = Array<number>(pattern.length).fill(-1),
          used = new Set([anchor]);
        chosen[anchorSlot] = anchor;
        const assign = (slot: number): boolean => {
          if (--budget < 0) return false;
          if (slot === pattern.length) {
            chosen.forEach((kind, i) => {
              remaining[kind] -= pattern[i];
            });
            result.push(order.map((slot) => chosen[slot]));
            if (search()) return true;
            result.pop();
            chosen.forEach((kind, i) => {
              remaining[kind] += pattern[i];
            });
            return false;
          }
          if (slot === anchorSlot) return assign(slot + 1);
          const seenCounts = new Set<number>();
          for (let kind = 0; kind < remaining.length; kind++) {
            const amount = remaining[kind];
            if (used.has(kind) || amount < pattern[slot] || seenCounts.has(amount)) continue;
            seenCounts.add(amount);
            used.add(kind);
            chosen[slot] = kind;
            if (assign(slot + 1)) return true;
            used.delete(kind);
            if (budget < 0) return false;
          }
          return false;
        };
        if (assign(0)) return true;
        if (budget < 0) return false;
      }
    }
    bad.add(key);
    return false;
  };
  return search() ? result : null;
}
export class MatchGame {
  readonly level: Level;
  readonly mode: Mode;
  rules: number[][] = [[3]];
  readonly seed: number;
  tiles: Tile[] = [];
  tray: number[] = [];
  reserve: number[] = [];
  status: GameStatus = 'playing';
  capacity = CAPACITY;
  matches = 0;
  moves = 0;
  undoLeft = 1;
  shovelLeft = 1;
  shuffleLeft = 1;
  hintLeft = 3;
  /** A complete legal solution for reproducible QA, never shown to players. */
  solution: number[] = [];
  static fromCloud(session: CloudSession): MatchGame {
    const g = Object.create(MatchGame.prototype) as MatchGame;
    Object.assign(g, {
      level: {
        id: session.ordinal,
        title: session.title,
        subtitle: '闯关冒险',
        kinds: 15,
        total: session.state.tiles.length,
      },
      mode: MODES.find((m) => m.id === session.state.mode)!,
      seed: session.seed,
      solution: [],
      history: [],
      rng: randomSource(session.seed),
    });
    g.applyCloud(session.state);
    return g;
  }
  applyCloud(state: CloudState): void {
    if (
      !['pet-rules-1', 'pet-rules-2'].includes(state.rulesVersion) ||
      ![CAPACITY, CAPACITY + 1].includes(state.capacity)
    )
      throw new Error('当前版本不支持该关卡规则');
    const rules = canonicalRules(
      state.rules || (state.rulesVersion === 'pet-rules-1' ? defaultRules(state.mode) : []),
    );
    if (
      state.rulesVersion === 'pet-rules-1' &&
      JSON.stringify(rules) !== JSON.stringify(defaultRules(state.mode))
    )
      throw new Error('旧版本不支持自定义消除规则');
    this.rules = rules;
    this.capacity = state.capacity;
    this.tiles = state.tiles.map((t) => ({ ...t }));
    this.tray = state.tray.slice();
    this.reserve = state.reserve.slice();
    this.status = state.status;
    this.matches = state.matches;
    this.moves = state.moves;
    this.clearedCount = state.cleared;
    this.history = (state.history || []).map((f) => ({
      ...f,
      tiles: f.tiles.map((t) => ({ ...t })),
      tray: f.tray.slice(),
      reserve: f.reserve.slice(),
    }));
    this.undoLeft = state.tools.undo;
    this.shovelLeft = state.tools.shovel;
    this.hintLeft = state.tools.hint;
    this.shuffleLeft = state.tools.shuffle;
  }
  private clearedCount = 0;
  private history: Snapshot[] = [];
  private rng: () => number;
  constructor(levelId: number, seed: number = Date.now(), modeId: ModeId = 'classic') {
    this.mode = MODES.find((m) => m.id === modeId) || MODES[0];
    this.rules = defaultRules(this.mode.id);
    this.level = { ...(LEVELS[levelId - 1] || LEVELS[0]) };
    this.seed = seed >>> 0;
    this.rng = randomSource(this.seed);
    if (this.level.id === 1 && this.mode.id === 'fun') {
      this.level.kinds = 3;
      this.level.total = 7;
      [0, 1, 2].forEach((i) => this.addTile((i - 1) * 146, -130, 0));
      [0, 1, 2, 3].forEach((i) => this.addTile((i - 1.5) * 130, 110, 0));
    } else if (this.level.id === 1) {
      const cols = this.mode.id === 'quartet' ? 4 : 3,
        rows = this.mode.id === 'quartet' ? 2 : 3;
      if (this.mode.id === 'quartet') {
        this.level.kinds = 2;
        this.level.total = 16;
      }
      for (let layer = 0; layer < 2; layer++)
        for (let row = 0; row < rows; row++)
          for (let col = 0; col < cols; col++) {
            this.addTile(
              (col - (cols - 1) / 2) * (cols === 4 ? 144 : 176),
              (row - (rows - 1) / 2) * 210 + (layer ? 24 : -22),
              layer,
            );
          }
    } else {
      const layers = [
        [6, 8, 94, 0],
        [5, 7, 94, 0],
        [4, 4, 141, 0],
        [3, 2, 282, 0],
        [3, 1, 94, 188],
      ];
      layers.forEach(([cols, rows, stepY, offsetY], layer) => {
        for (let row = 0; row < rows; row++)
          for (let col = 0; col < cols; col++)
            this.addTile(
              (col - (cols - 1) / 2) * 96,
              (row - (rows - 1) / 2) * stepY + offsetY,
              layer,
            );
      });
    }
    this.deal();
    if (this.level.id === 2) {
      let bestScore = 7,
        bestKinds = this.tiles.map((t) => t.kind),
        bestSolution = this.solution.slice();
      for (let attempt = 0; attempt < 24; attempt++) {
        const score = this.greedyWins();
        if (score < bestScore) {
          bestScore = score;
          bestKinds = this.tiles.map((t) => t.kind);
          bestSolution = this.solution.slice();
        }
        if (score === 0) break;
        this.deal();
      }
      this.tiles.forEach((tile, index) => (tile.kind = bestKinds[index]));
      this.solution = bestSolution;
    }
  }
  private deal(): void {
    if (this.level.id === 1 && this.mode.id === 'fun') {
      [0, 0, 0, 1, 1, 2, 2].forEach((kind, id) => (this.tiles[id].kind = kind));
      this.solution = this.tiles.map((t) => t.id);
      return;
    }
    this.solution = removalOrder(this.tiles, this.rng);
    // Allocate whole matching groups: 108 is not divisible by 15 species.
    // Every species appears and every starting count remains eliminable.
    const size = this.mode.matchSize,
      groupsTotal = this.level.total / size;
    const counts = Array(this.level.kinds).fill(
      Math.floor(groupsTotal / this.level.kinds) * size,
    ) as number[];
    shuffled(
      counts.map((_, kind) => kind),
      this.rng,
    )
      .slice(0, groupsTotal % this.level.kinds)
      .forEach((kind) => (counts[kind] += size));
    if (this.mode.id === 'fun') {
      const groups = shuffled(groupsForCounts(counts, 'fun', this.rng)!, this.rng),
        sequence: number[] = [];
      for (let i = 0; i < groups.length; i += 2) {
        let chunk = [...groups[i], ...(groups[i + 1] || [])];
        for (let attempt = 0; attempt < 12; attempt++) {
          const trial = shuffled(chunk, this.rng);
          let held: number[] = [],
            safe = true;
          for (const kind of trial) {
            held = afterPick(held, kind, 'fun');
            if (held.length >= CAPACITY) {
              safe = false;
              break;
            }
          }
          if (safe && held.length === 0) {
            chunk = trial;
            break;
          }
        }
        sequence.push(...chunk);
      }
      this.solution.forEach((id, index) => (this.tiles[id].kind = sequence[index]));
      return;
    }
    let held: number[] = [];
    for (const id of this.solution) {
      const choices = counts
        .map((_, kind) => kind)
        .filter((kind) => {
          if (!counts[kind]) return false;
          const next = afterPick(held, kind, this.mode.id),
            largest = Math.max(0, ...counts.map((_, k) => next.filter((n) => n === k).length));
          return next.length === 0 || next.length + this.mode.matchSize - largest <= CAPACITY;
        });
      if (!choices.length) throw new Error('No solvable deal continuation');
      const kind = choices[Math.floor(this.rng() * choices.length)];
      this.tiles[id].kind = kind;
      counts[kind]--;
      held = afterPick(held, kind, this.mode.id);
    }
  }
  private greedyWins(): number {
    const covers = this.tiles.map((tile) =>
      this.tiles.filter((other) => overlaps(tile, other)).map((t) => t.id),
    );
    let wins = 0;
    for (let trial = 0; trial < 6; trial++) {
      const rng = randomSource(this.seed ^ ((trial + 1) * 2654435761)),
        removed = this.tiles.map(() => false);
      let picked = 0,
        held: number[] = [];
      while (held.length < CAPACITY && picked < this.tiles.length) {
        const open = this.tiles.filter(
          (t) => !removed[t.id] && covers[t.id].every((id) => removed[id]),
        );
        const rank = (t: Tile) =>
          (afterPick(held, t.kind, this.mode.id).length < held.length ? 100 : 0) +
          held.filter((k) => k === t.kind).length;
        const best = Math.max(...open.map(rank)),
          choices = open.filter((t) => rank(t) === best),
          choice = choices[Math.floor(rng() * choices.length)];
        removed[choice.id] = true;
        picked++;
        held = afterPick(held, choice.kind, this.mode.id);
      }
      if (picked === this.tiles.length && held.length === 0) wins++;
    }
    return wins;
  }
  private addTile(x: number, y: number, layer: number): void {
    this.tiles.push({ id: this.tiles.length, kind: 0, x, y, layer, removed: false });
  }
  get remaining(): number {
    return this.tiles.filter((t) => !t.removed).length + this.reserve.length;
  }
  get cleared(): number {
    return this.clearedCount;
  }
  get score(): number {
    return this.matches * 100;
  }
  get extraSlotUnlocked(): boolean {
    return this.capacity === CAPACITY + 1;
  }
  unlockExtraSlot(): boolean {
    if (this.status !== 'playing' || this.capacity !== CAPACITY) return false;
    this.capacity = CAPACITY + 1;
    return true;
  }
  get canUndo(): boolean {
    return this.undoLeft > 0 && this.hasUndo;
  }
  get hasUndo(): boolean {
    return this.history.length > 0 && this.status === 'playing';
  }
  get canShovel(): boolean {
    return (
      this.status === 'playing' &&
      this.tray.length > 0 &&
      this.reserve.length + this.tray.length <= RESERVE_CAPACITY
    );
  }
  get stranded(): boolean {
    return this.status === 'lost' && this.remaining === 0 && this.tray.length < this.capacity;
  }
  availableTiles(): Tile[] {
    return [...available(this.tiles), ...this.reserve.map((id) => this.tiles[id])];
  }
  isAvailable(id: number): boolean {
    const tile = this.tiles[id];
    return (
      this.reserve.includes(id) ||
      (!!tile && !tile.removed && !this.tiles.some((t) => !t.removed && overlaps(tile, t)))
    );
  }
  pick(id: number): PickResult | null {
    if (this.status !== 'playing' || !this.isAvailable(id)) return null;
    this.history.push({
      tiles: this.tiles.map((t) => ({ ...t })),
      tray: this.tray.slice(),
      reserve: this.reserve.slice(),
      matches: this.matches,
      cleared: this.clearedCount,
      moves: this.moves,
      status: this.status,
    });
    if (this.history.length > 64) this.history.shift();
    const source = this.reserve.includes(id) ? 'reserve' : 'board';
    if (source === 'reserve') this.reserve.splice(this.reserve.indexOf(id), 1);
    const tile = this.tiles[id];
    tile.removed = true;
    this.moves++;
    const lastSame = this.tray.reduce(
        (found, tid, index) => (this.tiles[tid].kind === tile.kind ? index : found),
        -1,
      ),
      insertion = lastSame < 0 ? this.tray.length : lastSame + 1;
    this.tray.splice(insertion, 0, id);
    const displayTray = this.tray.slice(),
      matched = matchIndices(
        this.tray.map((tid) => this.tiles[tid].kind),
        this.rules,
      ).map((i) => this.tray[i]);
    if (matched.length) {
      this.tray = this.tray.filter((tid) => !matched.includes(tid));
      this.matches++;
      this.clearedCount += matched.length;
    }
    // Matches resolve before capacity. Empty boards with leftover cards fail explicitly.
    if (this.remaining === 0 && this.tray.length === 0) this.status = 'won';
    else if (this.tray.length >= this.capacity || this.remaining === 0) this.status = 'lost';
    return { tile: { ...tile }, displayTray, matched, insertion, source };
  }
  undo(): boolean {
    if (!this.canUndo) return false;
    const snapshot = this.history.pop()!;
    this.tiles = snapshot.tiles.map((t) => ({ ...t }));
    this.tray = snapshot.tray.slice();
    this.reserve = snapshot.reserve.slice();
    this.matches = snapshot.matches;
    this.clearedCount = snapshot.cleared;
    this.moves = snapshot.moves;
    this.status = snapshot.status;
    this.undoLeft--;
    return true;
  }
  shovel(): boolean {
    if (!this.canShovel || this.shovelLeft < 1) return false;
    this.reserve.push(...this.tray);
    this.tray = [];
    this.history = [];
    this.shovelLeft--;
    return true;
  }
  reshuffle(): boolean {
    if (
      this.status !== 'playing' ||
      this.shuffleLeft < 1 ||
      this.remaining + this.tray.length === 0
    )
      return false;
    const unmatched = this.tiles.filter(
      (t) => !t.removed || this.tray.includes(t.id) || this.reserve.includes(t.id),
    );
    const counts = Array(this.level.kinds).fill(0) as number[];
    unmatched.forEach((t) => counts[t.kind]++);
    const groups = groupsForCounts(counts, this.rules);
    if (!groups) return false;
    unmatched.forEach((tile) => (tile.removed = false));
    this.tray = [];
    this.reserve = [];
    // Redistribute identities across the remaining legal geometry as well as
    // changing kinds; animation can now send every card to its new position.
    const positions = shuffled(
      unmatched.map((t) => ({ x: t.x, y: t.y, layer: t.layer })),
      this.rng,
    );
    unmatched.forEach((tile, index) => Object.assign(tile, positions[index]));
    const sequence = shuffled(groups, this.rng).reduce(
        (all, group) => [...all, ...group],
        [] as number[],
      ),
      order = removalOrder(this.tiles, this.rng);
    order.forEach((id, index) => (this.tiles[id].kind = sequence[index]));
    this.solution = order;
    this.history = [];
    this.shuffleLeft--;
    return true;
  }
  hint(): number[] {
    if (this.status !== 'playing' || this.hintLeft < 1) return [];
    const preset = presetRuleMode(this.rules);
    if (!preset) return this.customHint();
    const open = this.availableTiles(),
      held = this.tray.map((id) => this.tiles[id].kind),
      counts = Array(this.level.kinds).fill(0) as number[];
    this.tiles
      .filter((t) => !t.removed || this.tray.includes(t.id) || this.reserve.includes(t.id))
      .forEach((t) => counts[t.kind]++);
    const candidates: number[][] = [],
      options: number[][] = [];
    for (let k = 0; k < this.level.kinds; k++)
      candidates.push(Array(preset === 'quartet' ? 4 : 3).fill(k));
    if (preset === 'fun')
      for (let a = 0; a < this.level.kinds; a++)
        for (let b = a + 1; b < this.level.kinds; b++) candidates.push([a, a, b, b]);
    for (const group of candidates) {
      const rest = counts.slice();
      group.forEach((k) => rest[k]--);
      if (rest.some((n) => n < 0) || !groupsForCounts(rest, this.rules)) continue;
      const ids: number[] = [];
      let enough = true;
      for (const k of Array.from(new Set(group))) {
        const need = Math.max(
            0,
            group.filter((n) => n === k).length - held.filter((n) => n === k).length,
          ),
          choices = open.filter((t) => t.kind === k).slice(0, need);
        if (choices.length < need) {
          enough = false;
          break;
        }
        ids.push(...choices.map((t) => t.id));
      }
      let pending = held.slice();
      for (const id of ids) {
        pending = afterPick(pending, this.tiles[id].kind, this.rules);
        if (pending.length >= this.capacity) enough = false;
      }
      if (enough && ids.length) options.push(ids);
    }
    options.sort((a, b) => a.length - b.length);
    let ids = options[0];
    if (!ids) {
      const safe = open.filter((t) => afterPick(held, t.kind, this.rules).length < this.capacity);
      safe.sort(
        (a, b) => held.filter((k) => k === b.kind).length - held.filter((k) => k === a.kind).length,
      );
      ids = safe.length ? [safe[0].id] : [];
    }
    if (ids.length) this.hintLeft--;
    return ids;
  }
  private customHint(): number[] {
    const open = this.availableTiles(),
      held = this.tray.map((id) => this.tiles[id].kind);
    let budget = 3000;
    const options: { ids: number[]; rest: number[] }[] = [],
      seen = new Set<string>();
    const counts = Array<number>(this.level.kinds).fill(0);
    this.tiles
      .filter(
        (tile) => !tile.removed || this.tray.includes(tile.id) || this.reserve.includes(tile.id),
      )
      .forEach((tile) => counts[tile.kind]++);
    const kinds = Array.from(new Set([...held, ...open.map((tile) => tile.kind)]));
    for (const { pattern, order } of triggerablePatterns(this.rules)) {
      const used = new Set<number>();
      const chosen: number[] = [];
      const find = (slot: number): void => {
        if (--budget < 0 || options.length >= 48) return;
        if (slot === pattern.length) {
          const heldLeft = counts.map((_, kind) => held.filter((k) => k === kind).length);
          const available = new Map(
            kinds.map((kind) => [
              kind,
              open.filter((tile) => tile.kind === kind).map((tile) => tile.id),
            ]),
          );
          const ids: number[] = [];
          for (const item of order) {
            const kind = chosen[item];
            if (heldLeft[kind]) heldLeft[kind]--;
            else ids.push(available.get(kind)!.shift()!);
          }
          if (!ids.length || seen.has(ids.join(','))) return;
          seen.add(ids.join(','));
          let pending = held.slice(),
            cleared = false;
          for (const id of ids) {
            const next = afterPick(pending, this.tiles[id].kind, this.rules);
            cleared ||= next.length < pending.length + 1;
            pending = next;
            if (pending.length >= this.capacity) return;
          }
          if (cleared) {
            const rest = counts.slice();
            [...held, ...ids.map((id) => this.tiles[id].kind)].forEach((kind) => rest[kind]--);
            pending.forEach((kind) => rest[kind]++);
            options.push({ ids, rest });
          }
          return;
        }
        for (const kind of kinds) {
          if (used.has(kind)) continue;
          const needed = Math.max(0, pattern[slot] - held.filter((k) => k === kind).length);
          const choices = open.filter((tile) => tile.kind === kind).slice(0, needed);
          if (choices.length < needed) continue;
          used.add(kind);
          chosen[slot] = kind;
          find(slot + 1);
          used.delete(kind);
          if (budget < 0) return;
        }
      };
      find(0);
    }
    options.sort((a, b) => a.ids.length - b.ids.length);
    let best =
      options.find((option) => customGroups(option.rest, this.rules, 2000) !== null)?.ids || [];
    if (!best.length) {
      const safe = open.filter(
        (tile) => afterPick(held, tile.kind, this.rules).length < this.capacity,
      );
      safe.sort(
        (a, b) =>
          held.filter((kind) => kind === b.kind).length -
          held.filter((kind) => kind === a.kind).length,
      );
      best = safe.length ? [safe[0].id] : [];
    }
    if (best.length) this.hintLeft--;
    // Custom combinations can require an order; highlight only the next safe tile.
    return best.slice(0, 1);
  }
}
