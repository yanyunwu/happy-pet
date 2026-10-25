/** Pure game rules. No engine, DOM, network or platform dependencies. */
export type GameStatus = 'playing' | 'won' | 'lost';
export interface Tile { id: number; kind: number; x: number; y: number; layer: number; removed: boolean; }
export interface Level { id: number; title: string; subtitle: string; kinds: number; total: number; }
export const LEVELS: Level[] = [
    { id: 1, title: '初遇星屿', subtitle: '轻松入门 · 让三颗星物相遇', kinds: 3, total: 18 },
    { id: 2, title: '迷雾星海', subtitle: '高难挑战 · 每一个空位都很珍贵', kinds: 9, total: 108 },
];
export const CAPACITY = 7;
export const TILE_W = 78;
export const TILE_H = 82;
export const KIND_NAMES = ['许愿星', '弯弯月', '樱花', '水晶', '轻羽', '心愿瓶', '小星喵', '蝴蝶结', '魔法书'];
export interface PickResult { tile: Tile; displayTray: number[]; matched: number[]; insertion: number; }
interface Snapshot { tiles: Tile[]; tray: number[]; matches: number; moves: number; status: GameStatus; }

export function randomSource(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state += 0x6D2B79F5;
        let t = state;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
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
    return over.layer > under.layer && Math.abs(under.x - over.x) < TILE_W - 4 && Math.abs(under.y - over.y) < TILE_H - 4;
}
function available(tiles: Tile[]): Tile[] {
    return tiles.filter(t => !t.removed && !tiles.some(over => !over.removed && overlaps(t, over)));
}
/** A geometry-only legal removal order, used as a witness when dealing cards. */
function removalOrder(tiles: Tile[], rng: () => number): number[] {
    const copy = tiles.map(t => ({ ...t }));
    const result: number[] = [];
    while (copy.some(t => !t.removed)) {
        const candidates = available(copy);
        const tile = candidates[Math.floor(rng() * candidates.length)];
        if (!tile) throw new Error('Invalid board geometry');
        result.push(tile.id);
        tile.removed = true;
    }
    return result;
}

export class MatchGame {
    readonly level: Level;
    readonly seed: number;
    tiles: Tile[] = [];
    tray: number[] = [];
    status: GameStatus = 'playing';
    matches = 0;
    moves = 0;
    undoLeft = 1;
    shuffleLeft = 1;
    hintLeft = 3;
    /** Verified initial solution; useful for reproducible level QA, never shown to players. */
    solution: number[] = [];
    private history: Snapshot[] = [];
    private rng: () => number;

    constructor(levelId: number, seed: number = Date.now()) {
        this.level = LEVELS[levelId - 1] || LEVELS[0];
        this.seed = seed >>> 0;
        this.rng = randomSource(this.seed);
        if (this.level.id === 1) {
            for (let row = 0; row < 3; row++) for (let col = 0; col < 6; col++) {
                this.addTile((col - 2.5) * 88, (row - 1) * 96, 0);
            }
        } else {
            // 42 + 30 + 20 + 12 + 4 = 108. Offsets reveal lower cards at the edges.
            const layers = [[6, 7], [5, 6], [4, 5], [3, 4], [2, 2]];
            layers.forEach(([cols, rows], layer) => {
                for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
                    this.addTile((col - (cols - 1) / 2) * 86, (row - (rows - 1) / 2) * 76 - layer * 3, layer);
                }
            });
        }
        this.solution = removalOrder(this.tiles, this.rng);
        const counts = Array(this.level.kinds).fill(this.level.total / this.level.kinds) as number[];
        const pending = Array(this.level.kinds).fill(0) as number[];
        // Deal along a legal path with no more than six unmatched cards. This proves
        // initial solvability without making the player's visible choices trivial.
        for (const id of this.solution) {
            const held = pending.reduce((a, b) => a + b, 0);
            const kinds = counts.map((count, kind) => kind).filter(kind => counts[kind] > 0);
            let choices = kinds;
            if (held >= 5) {
                const pairs = kinds.filter(kind => pending[kind] === 2);
                choices = pairs.length ? pairs : kinds.filter(kind => pending[kind] > 0);
            }
            const kind = choices[Math.floor(this.rng() * choices.length)];
            this.tiles[id].kind = kind;
            counts[kind]--;
            pending[kind] = (pending[kind] + 1) % 3;
        }
    }

    private addTile(x: number, y: number, layer: number): void {
        this.tiles.push({ id: this.tiles.length, kind: 0, x, y, layer, removed: false });
    }
    get remaining(): number { return this.tiles.filter(t => !t.removed).length; }
    get cleared(): number { return this.matches * 3; }
    get score(): number { return this.matches * 100; }
    get canUndo(): boolean { return this.undoLeft > 0 && this.history.length > 0 && this.status !== 'won'; }
    availableTiles(): Tile[] { return available(this.tiles); }
    isAvailable(id: number): boolean {
        const tile = this.tiles[id];
        return !!tile && !tile.removed && !this.tiles.some(t => !t.removed && overlaps(tile, t));
    }
    pick(id: number): PickResult | null {
        if (this.status !== 'playing' || !this.isAvailable(id)) return null;
        this.history.push({ tiles: this.tiles.map(t => ({ ...t })), tray: this.tray.slice(), matches: this.matches, moves: this.moves, status: this.status });
        const tile = this.tiles[id];
        tile.removed = true;
        this.moves++;
        const lastSame = this.tray.reduce((found, tid, index) => this.tiles[tid].kind === tile.kind ? index : found, -1);
        const insertion = lastSame < 0 ? this.tray.length : lastSame + 1;
        this.tray.splice(insertion, 0, id);
        const displayTray = this.tray.slice();
        const matched = this.tray.filter(tid => this.tiles[tid].kind === tile.kind);
        if (matched.length === 3) {
            this.tray = this.tray.filter(tid => !matched.includes(tid));
            this.matches++;
        } else matched.length = 0;
        // Resolve triples BEFORE checking fullness, including a match in slot seven.
        if (this.remaining === 0 && this.tray.length === 0) this.status = 'won';
        else if (this.tray.length >= CAPACITY) this.status = 'lost';
        return { tile: { ...tile }, displayTray, matched, insertion };
    }
    undo(): boolean {
        if (!this.canUndo) return false;
        const snapshot = this.history.pop()!;
        this.tiles = snapshot.tiles.map(t => ({ ...t }));
        this.tray = snapshot.tray.slice();
        this.matches = snapshot.matches;
        this.moves = snapshot.moves;
        this.status = snapshot.status;
        this.undoLeft--;
        return true;
    }
    reshuffle(): boolean {
        if (this.status !== 'playing' || this.shuffleLeft < 1 || this.remaining === 0) return false;
        // Six different tray cards have no legal next move with seven slots.
        // Return ALL unmatched tray cards to their board positions before
        // redealing; merely shuffling the board cannot recover this state.
        this.tray.forEach(id => this.tiles[id].removed = false);
        this.tray = [];
        const counts = Array(this.level.kinds).fill(0) as number[];
        this.tiles.filter(t => !t.removed).forEach(t => counts[t.kind]++);
        const sequence: number[] = [];
        const groups: number[] = [];
        counts.forEach((count, kind) => { for (let i = 0; i < count / 3; i++) groups.push(kind); });
        shuffled(groups, this.rng).forEach(kind => sequence.push(kind, kind, kind));
        const order = removalOrder(this.tiles, this.rng);
        order.forEach((id, index) => this.tiles[id].kind = sequence[index]);
        this.solution = order;
        this.history = []; // Old snapshots must never restore a pre-shuffle layout.
        this.shuffleLeft--;
        return true;
    }
    hint(): number[] {
        if (this.status !== 'playing' || this.hintLeft < 1) return [];
        const open = this.availableTiles();
        const ranked = open.map(tile => {
            const held = this.tray.filter(id => this.tiles[id].kind === tile.kind).length;
            const same = open.filter(t => t.kind === tile.kind);
            return { tile, held, same, value: (held + same.length >= 3 ? 100 : 0) + held * 20 + same.length + tile.layer };
        }).filter(option => this.tray.length < 6 || option.held === 2).sort((a, b) => b.value - a.value);
        if (!ranked.length) return [];
        this.hintLeft--;
        return ranked[0].same.slice(0, 3 - ranked[0].held).map(t => t.id);
    }
}
