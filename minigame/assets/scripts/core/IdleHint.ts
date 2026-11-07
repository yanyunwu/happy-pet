import type { MatchGame } from './MatchGame';

export class IdleHintClock {
  private elapsed = 0;
  private shown = false;

  constructor(private readonly delay: number) {}

  reset(): void {
    this.elapsed = 0;
    this.shown = false;
  }

  advance(dt: number, active: boolean): boolean {
    if (!active) {
      this.reset();
      return false;
    }
    if (this.shown) return false;
    this.elapsed += Math.max(0, dt);
    if (this.elapsed < this.delay) return false;
    this.shown = true;
    return true;
  }
}

export function selectIdleHint(game: MatchGame): number | null {
  if (game.status !== 'playing' || !game.tray.length) return null;
  const held = new Set(game.tray.map((id) => game.tiles[id].kind));
  return (
    game.tiles.find((tile) => !tile.removed && held.has(tile.kind) && game.isAvailable(tile.id))
      ?.id ?? null
  );
}
