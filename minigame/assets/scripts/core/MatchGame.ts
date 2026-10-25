/** Pure rules shared by all three modes. No engine or platform dependencies. */
import type { CloudState, CloudSession } from './OnlineClient';
export type GameStatus = 'playing' | 'won' | 'lost';
export type ModeId = 'classic' | 'quartet' | 'fun';
export interface Mode { id: ModeId; title: string; rule: string; shortRule: string; matchSize: number; }
export const MODES: Mode[] = [
    { id: 'classic', title: '经典三消', rule: '三个相同萌宠自动消除', shortRule: '三个相同就消除', matchSize: 3 },
    { id: 'quartet', title: '极限四消', rule: '四个相同萌宠才能消除', shortRule: '四个相同才消除', matchSize: 4 },
    { id: 'fun', title: '趣味规则消', rule: '三个相同，或两种萌宠各两个', shortRule: '三个相同 / 两对不同', matchSize: 3 },
];
export interface Tile { id: number; kind: number; x: number; y: number; layer: number; removed: boolean; }
export interface Level { id: number; title: string; subtitle: string; kinds: number; total: number; }
export const LEVELS: Level[] = [
    { id: 1, title: '新手乐园', subtitle: '轻松认识小伙伴', kinds: 3, total: 18 },
    { id: 2, title: '高手挑战', subtitle: '先看下层，再做选择', kinds: 15, total: 108 },
];
export const CAPACITY = 7, RESERVE_CAPACITY = 7, TILE_W = 94, TILE_H = 98;
export const KIND_NAMES = ['小黄啾', '蓝莓喵', '奶糖汪', '棉花兔', '青团蛙', '桃桃猪', '葡萄鸮', '团团熊', '小狮宝', '蜜橘狐', '棉花羊', '豆豆企鹅', '布丁鼠', '抱抱考拉', '紫芋象'];
export interface PickResult { tile: Tile; displayTray: number[]; matched: number[]; insertion: number; source: 'board' | 'reserve'; }
interface Snapshot { tiles: Tile[]; tray: number[]; reserve: number[]; matches: number; cleared: number; moves: number; status: GameStatus; }
export function randomSource(seed: number): () => number {
    let state = seed >>> 0;
    return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function shuffled<T>(items: T[], rng: () => number): T[] {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
    return result;
}
function overlaps(under: Tile, over: Tile): boolean { return over.layer > under.layer && Math.abs(under.x - over.x) < TILE_W - 4 && Math.abs(under.y - over.y) < TILE_H - 4; }
function available(tiles: Tile[]): Tile[] { return tiles.filter(t => !t.removed && !tiles.some(over => !over.removed && overlaps(t, over))); }
function removalOrder(tiles: Tile[], rng: () => number): number[] {
    const copy = tiles.map(t => ({ ...t })), result: number[] = [];
    while (copy.some(t => !t.removed)) {
        const candidates = available(copy), tile = candidates[Math.floor(rng() * candidates.length)];
        if (!tile) throw new Error('Invalid board geometry'); result.push(tile.id); tile.removed = true;
    }
    return result;
}
/** The same matcher drives real picks, dealing, hints and difficulty simulation. */
export function matchIndices(kinds: number[], mode: ModeId): number[] {
    const groups = new Map<number, number[]>();
    kinds.forEach((kind, index) => groups.set(kind, [...(groups.get(kind) || []), index]));
    const size = mode === 'quartet' ? 4 : 3;
    for (const indices of groups.values()) if (indices.length >= size) return indices.slice(0, size);
    // Creator's loose Babel transform assumes spread operands are arrays.
    // Explicitly materialize iterators so both web and WeChat exports agree.
    if (mode === 'fun') { const pairs = Array.from(groups.values()).filter(indices => indices.length >= 2); if (pairs.length >= 2) return [...pairs[0].slice(0, 2), ...pairs[1].slice(0, 2)]; }
    return [];
}
function afterPick(held: number[], kind: number, mode: ModeId): number[] {
    const all = [...held, kind], matched = matchIndices(all, mode); return all.filter((_, i) => !matched.includes(i));
}
/** Partition into valid groups. In fun mode AAA + BBB can become AABB + AB;
 * that remainder cannot be repaired by permuting cards. Never invent/discard it. */
function groupsForCounts(counts: number[], mode: ModeId, rng?: () => number): number[][] | null {
    const size = mode === 'quartet' ? 4 : 3, result: number[][] = [];
    if (mode !== 'fun') {
        if (counts.some(n => n % size !== 0)) return null;
        counts.forEach((n, k) => { for (let i = 0; i < n; i += size) result.push(Array(size).fill(k)); }); return result;
    }
    const pairs: number[] = [];
    const find = (k: number): boolean => {
        if (k === counts.length) { const total = pairs.reduce((a, b) => a + b, 0); return total % 2 === 0 && Math.max(0, ...pairs) * 2 <= total; }
        const choices: number[] = [];
        for (let n = 0; n * 2 <= counts[k]; n++) if ((counts[k] - n * 2) % 3 === 0) choices.push(n);
        for (const n of rng ? shuffled(choices, rng) : choices) { pairs[k] = n; if (find(k + 1)) return true; } return false;
    };
    if (!find(0)) return null;
    counts.forEach((n, k) => { for (let i = 0; i < n - pairs[k] * 2; i += 3) result.push([k, k, k]); });
    while (pairs.some(n => n > 0)) {
        const largest = pairs.map((n, k) => ({ n, k })).filter(p => p.n > 0).sort((a, b) => b.n - a.n), a = largest[0].k, b = largest[1].k;
        result.push([a, a, b, b]); pairs[a]--; pairs[b]--;
    }
    return result;
}
export class MatchGame {
    readonly level: Level; readonly mode: Mode; readonly seed: number;
    tiles: Tile[] = []; tray: number[] = []; reserve: number[] = []; status: GameStatus = 'playing';
    matches = 0; moves = 0; undoLeft = 1; shovelLeft = 1; shuffleLeft = 1; hintLeft = 3;
    /** A complete legal solution for reproducible QA, never shown to players. */
    solution: number[] = [];
    static fromCloud(session: CloudSession): MatchGame {
        const g = Object.create(MatchGame.prototype) as MatchGame;
        Object.assign(g, { level: { id: session.ordinal, title: session.title, subtitle: '闯关冒险', kinds: 15, total: session.state.tiles.length }, mode: MODES.find(m => m.id === session.state.mode)!, seed: session.seed, solution: [], history: [], rng: randomSource(session.seed) });
        g.applyCloud(session.state); return g;
    }
    applyCloud(state: CloudState): void {
        if (state.rulesVersion !== 'pet-rules-1' || state.capacity !== CAPACITY) throw new Error('当前版本不支持该关卡规则');
        this.tiles = state.tiles.map(t => ({ ...t })); this.tray = state.tray.slice(); this.reserve = state.reserve.slice();
        this.status = state.status; this.matches = state.matches; this.moves = state.moves; this.clearedCount = state.cleared;
        this.history = (state.history || []).map(f => ({ ...f, tiles: f.tiles.map(t => ({ ...t })), tray: f.tray.slice(), reserve: f.reserve.slice() }));
        this.undoLeft = state.tools.undo; this.shovelLeft = state.tools.shovel; this.hintLeft = state.tools.hint; this.shuffleLeft = state.tools.shuffle;
    }
    private clearedCount = 0; private history: Snapshot[] = []; private rng: () => number;
    constructor(levelId: number, seed: number = Date.now(), modeId: ModeId = 'classic') {
        this.mode = MODES.find(m => m.id === modeId) || MODES[0]; this.level = { ...(LEVELS[levelId - 1] || LEVELS[0]) };
        this.seed = seed >>> 0; this.rng = randomSource(this.seed);
        if (this.level.id === 1 && this.mode.id === 'fun') {
            this.level.kinds = 3; this.level.total = 7;
            [0, 1, 2].forEach(i => this.addTile((i - 1) * 146, -130, 0));
            [0, 1, 2, 3].forEach(i => this.addTile((i - 1.5) * 130, 110, 0));
        } else if (this.level.id === 1) {
            const cols = this.mode.id === 'quartet' ? 4 : 3, rows = this.mode.id === 'quartet' ? 2 : 3;
            if (this.mode.id === 'quartet') { this.level.kinds = 2; this.level.total = 16; }
            for (let layer = 0; layer < 2; layer++) for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
                this.addTile((col - (cols - 1) / 2) * (cols === 4 ? 144 : 176), (row - (rows - 1) / 2) * 210 + (layer ? 24 : -22), layer);
            }
        } else {
            const layers = [[6, 8, 94, 0], [5, 7, 94, 0], [4, 4, 141, 0], [3, 2, 282, 0], [3, 1, 94, 188]];
            layers.forEach(([cols, rows, stepY, offsetY], layer) => {
                for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) this.addTile((col - (cols - 1) / 2) * 96, (row - (rows - 1) / 2) * stepY + offsetY, layer);
            });
        }
        this.deal();
        if (this.level.id === 2) {
            let bestScore = 7, bestKinds = this.tiles.map(t => t.kind), bestSolution = this.solution.slice();
            for (let attempt = 0; attempt < 24; attempt++) {
                const score = this.greedyWins();
                if (score < bestScore) { bestScore = score; bestKinds = this.tiles.map(t => t.kind); bestSolution = this.solution.slice(); }
                if (score === 0) break; this.deal();
            }
            this.tiles.forEach((tile, index) => tile.kind = bestKinds[index]); this.solution = bestSolution;
        }
    }
    private deal(): void {
        if (this.level.id === 1 && this.mode.id === 'fun') { [0, 0, 0, 1, 1, 2, 2].forEach((kind, id) => this.tiles[id].kind = kind); this.solution = this.tiles.map(t => t.id); return; }
        this.solution = removalOrder(this.tiles, this.rng);
        // Allocate whole matching groups: 108 is not divisible by 15 species.
        // Every species appears and every starting count remains eliminable.
        const size = this.mode.matchSize, groupsTotal = this.level.total / size;
        const counts = Array(this.level.kinds).fill(Math.floor(groupsTotal / this.level.kinds) * size) as number[];
        shuffled(counts.map((_, kind) => kind), this.rng).slice(0, groupsTotal % this.level.kinds).forEach(kind => counts[kind] += size);
        if (this.mode.id === 'fun') {
            const groups = shuffled(groupsForCounts(counts, 'fun', this.rng)!, this.rng), sequence: number[] = [];
            for (let i = 0; i < groups.length; i += 2) {
                let chunk = [...groups[i], ...(groups[i + 1] || [])];
                for (let attempt = 0; attempt < 12; attempt++) {
                    const trial = shuffled(chunk, this.rng); let held: number[] = [], safe = true;
                    for (const kind of trial) { held = afterPick(held, kind, 'fun'); if (held.length >= CAPACITY) { safe = false; break; } }
                    if (safe && held.length === 0) { chunk = trial; break; }
                }
                sequence.push(...chunk);
            }
            this.solution.forEach((id, index) => this.tiles[id].kind = sequence[index]); return;
        }
        let held: number[] = [];
        for (const id of this.solution) {
            const choices = counts.map((_, kind) => kind).filter(kind => {
                if (!counts[kind]) return false;
                const next = afterPick(held, kind, this.mode.id), largest = Math.max(0, ...counts.map((_, k) => next.filter(n => n === k).length));
                return next.length === 0 || next.length + this.mode.matchSize - largest <= CAPACITY;
            });
            if (!choices.length) throw new Error('No solvable deal continuation');
            const kind = choices[Math.floor(this.rng() * choices.length)]; this.tiles[id].kind = kind; counts[kind]--; held = afterPick(held, kind, this.mode.id);
        }
    }
    private greedyWins(): number {
        const covers = this.tiles.map(tile => this.tiles.filter(other => overlaps(tile, other)).map(t => t.id)); let wins = 0;
        for (let trial = 0; trial < 6; trial++) {
            const rng = randomSource(this.seed ^ ((trial + 1) * 2654435761)), removed = this.tiles.map(() => false); let picked = 0, held: number[] = [];
            while (held.length < CAPACITY && picked < this.tiles.length) {
                const open = this.tiles.filter(t => !removed[t.id] && covers[t.id].every(id => removed[id]));
                const rank = (t: Tile) => (afterPick(held, t.kind, this.mode.id).length < held.length ? 100 : 0) + held.filter(k => k === t.kind).length;
                const best = Math.max(...open.map(rank)), choices = open.filter(t => rank(t) === best), choice = choices[Math.floor(rng() * choices.length)];
                removed[choice.id] = true; picked++; held = afterPick(held, choice.kind, this.mode.id);
            }
            if (picked === this.tiles.length && held.length === 0) wins++;
        } return wins;
    }
    private addTile(x: number, y: number, layer: number): void { this.tiles.push({ id: this.tiles.length, kind: 0, x, y, layer, removed: false }); }
    get remaining(): number { return this.tiles.filter(t => !t.removed).length + this.reserve.length; }
    get cleared(): number { return this.clearedCount; }
    get score(): number { return this.matches * 100; }
    get canUndo(): boolean { return this.undoLeft > 0 && this.hasUndo; }
    get hasUndo(): boolean { return this.history.length > 0 && this.status === 'playing'; }
    get canShovel(): boolean { return this.status === 'playing' && this.tray.length > 0 && this.reserve.length + this.tray.length <= RESERVE_CAPACITY; }
    get stranded(): boolean { return this.status === 'lost' && this.remaining === 0 && this.tray.length < CAPACITY; }
    availableTiles(): Tile[] { return [...available(this.tiles), ...this.reserve.map(id => this.tiles[id])]; }
    isAvailable(id: number): boolean { const tile = this.tiles[id]; return this.reserve.includes(id) || (!!tile && !tile.removed && !this.tiles.some(t => !t.removed && overlaps(tile, t))); }
    pick(id: number): PickResult | null {
        if (this.status !== 'playing' || !this.isAvailable(id)) return null;
        this.history.push({ tiles: this.tiles.map(t => ({ ...t })), tray: this.tray.slice(), reserve: this.reserve.slice(), matches: this.matches, cleared: this.clearedCount, moves: this.moves, status: this.status });
        if (this.history.length > 64) this.history.shift();
        const source = this.reserve.includes(id) ? 'reserve' : 'board';
        if (source === 'reserve') this.reserve.splice(this.reserve.indexOf(id), 1);
        const tile = this.tiles[id]; tile.removed = true; this.moves++;
        const lastSame = this.tray.reduce((found, tid, index) => this.tiles[tid].kind === tile.kind ? index : found, -1), insertion = lastSame < 0 ? this.tray.length : lastSame + 1;
        this.tray.splice(insertion, 0, id);
        const displayTray = this.tray.slice(), matched = matchIndices(this.tray.map(tid => this.tiles[tid].kind), this.mode.id).map(i => this.tray[i]);
        if (matched.length) { this.tray = this.tray.filter(tid => !matched.includes(tid)); this.matches++; this.clearedCount += matched.length; }
        // Matches resolve before capacity. Empty boards with leftover cards fail explicitly.
        if (this.remaining === 0 && this.tray.length === 0) this.status = 'won';
        else if (this.tray.length >= CAPACITY || this.remaining === 0) this.status = 'lost';
        return { tile: { ...tile }, displayTray, matched, insertion, source };
    }
    undo(): boolean {
        if (!this.canUndo) return false;
        const snapshot = this.history.pop()!; this.tiles = snapshot.tiles.map(t => ({ ...t })); this.tray = snapshot.tray.slice(); this.reserve = snapshot.reserve.slice();
        this.matches = snapshot.matches; this.clearedCount = snapshot.cleared; this.moves = snapshot.moves; this.status = snapshot.status; this.undoLeft--; return true;
    }
    shovel(): boolean {
        if (!this.canShovel || this.shovelLeft < 1) return false;
        this.reserve.push(...this.tray); this.tray = [];
        this.history = []; this.shovelLeft--; return true;
    }
    reshuffle(): boolean {
        if (this.status !== 'playing' || this.shuffleLeft < 1 || this.remaining + this.tray.length === 0) return false;
        const unmatched = this.tiles.filter(t => !t.removed || this.tray.includes(t.id) || this.reserve.includes(t.id));
        const counts = Array(this.level.kinds).fill(0) as number[]; unmatched.forEach(t => counts[t.kind]++);
        const groups = groupsForCounts(counts, this.mode.id); if (!groups) return false;
        unmatched.forEach(tile => tile.removed = false); this.tray = []; this.reserve = [];
        // Redistribute identities across the remaining legal geometry as well as
        // changing kinds; animation can now send every card to its new position.
        const positions = shuffled(unmatched.map(t => ({ x: t.x, y: t.y, layer: t.layer })), this.rng);
        unmatched.forEach((tile, index) => Object.assign(tile, positions[index]));
        const sequence = shuffled(groups, this.rng).reduce((all, group) => [...all, ...group], [] as number[]), order = removalOrder(this.tiles, this.rng);
        order.forEach((id, index) => this.tiles[id].kind = sequence[index]); this.solution = order; this.history = []; this.shuffleLeft--; return true;
    }
    hint(): number[] {
        if (this.status !== 'playing' || this.hintLeft < 1) return [];
        const open = this.availableTiles(), held = this.tray.map(id => this.tiles[id].kind), counts = Array(this.level.kinds).fill(0) as number[];
        this.tiles.filter(t => !t.removed || this.tray.includes(t.id) || this.reserve.includes(t.id)).forEach(t => counts[t.kind]++);
        const candidates: number[][] = [], options: number[][] = [];
        for (let k = 0; k < this.level.kinds; k++) candidates.push(Array(this.mode.matchSize).fill(k));
        if (this.mode.id === 'fun') for (let a = 0; a < this.level.kinds; a++) for (let b = a + 1; b < this.level.kinds; b++) candidates.push([a, a, b, b]);
        for (const group of candidates) {
            const rest = counts.slice(); group.forEach(k => rest[k]--); if (rest.some(n => n < 0) || !groupsForCounts(rest, this.mode.id)) continue;
            const ids: number[] = []; let enough = true;
            for (const k of Array.from(new Set(group))) {
                const need = Math.max(0, group.filter(n => n === k).length - held.filter(n => n === k).length), choices = open.filter(t => t.kind === k).slice(0, need);
                if (choices.length < need) { enough = false; break; } ids.push(...choices.map(t => t.id));
            }
            let pending = held.slice(); for (const id of ids) { pending = afterPick(pending, this.tiles[id].kind, this.mode.id); if (pending.length >= CAPACITY) enough = false; }
            if (enough && ids.length) options.push(ids);
        }
        options.sort((a, b) => a.length - b.length); let ids = options[0];
        if (!ids) {
            const safe = open.filter(t => afterPick(held, t.kind, this.mode.id).length < CAPACITY);
            safe.sort((a, b) => held.filter(k => k === b.kind).length - held.filter(k => k === a.kind).length); ids = safe.length ? [safe[0].id] : [];
        }
        if (ids.length) this.hintLeft--; return ids;
    }
}
