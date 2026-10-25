import type { BoardState, Tile } from '../game-api';
import { petNames } from '../game-api';
export const petImage = (kind: number) => `${import.meta.env.BASE_URL}pets/${kind}.png`;
export default function Board({
  state,
  highlight,
  onPick,
}: {
  state: BoardState;
  highlight?: number;
  onPick?: (id: number) => void;
}) {
  const covered = (t: Tile) =>
    state.tiles.some(
      (o) =>
        !o.removed && o.layer > t.layer && Math.abs(o.x - t.x) < 90 && Math.abs(o.y - t.y) < 94,
    );
  const card = (t: Tile, inBoard = false) => (
    <button
      type="button"
      title={`${petNames[t.kind]} · 方块 ${t.id} · 第 ${t.layer + 1} 层`}
      aria-label={`${petNames[t.kind]} 方块 ${t.id}`}
      className={`replay-tile${inBoard && covered(t) ? ' covered' : ''}${t.id === highlight ? ' highlighted' : ''}`}
      style={
        inBoard
          ? { left: `${(t.x + 360 - 47) / 7.2}%`, top: `${(t.y + 420 - 49) / 9.2}%` }
          : undefined
      }
      onClick={() => onPick?.(t.id)}
      disabled={!onPick || (inBoard && covered(t))}
    >
      <img src={petImage(t.kind)} alt={petNames[t.kind]} />
    </button>
  );
  return (
    <div className="replay-board">
      <div className="replay-field">
        {state.tiles
          .filter((t) => !t.removed)
          .sort((a, b) => a.layer - b.layer || a.id - b.id)
          .map((t) => (
            <span key={t.id}>{card(t, true)}</span>
          ))}
      </div>
      <div className="replay-storage">
        <small>铲出暂存 · {state.reserve.length}/7</small>
        <div className="replay-tray">
          {state.reserve.map((id) => (
            <span key={id}>{card(state.tiles[id])}</span>
          ))}
        </div>
        <small>
          收纳槽 · {state.tray.length}/{state.capacity}
        </small>
        <div className="replay-tray">
          {Array.from({ length: state.capacity }, (_, i) =>
            state.tray[i] === undefined ? (
              <span className="empty-slot" key={i} />
            ) : (
              <span key={i}>{card(state.tiles[state.tray[i]])}</span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
