import { ModeId } from './MatchGame';
export type ToolId = 'undo' | 'shovel' | 'shuffle' | 'hint';
export interface Progress {
  unlocked: number;
  completed: boolean;
  best: number;
}
export interface SaveData {
  version: number;
  sound: boolean;
  coins: number;
  modes: Record<ModeId, Progress>;
  bag: Record<ToolId, number>;
  signInCount: number;
  signedOn: string;
}
export const SIGN_IN_REWARDS: { coins: number; tool: ToolId; count: number }[] = [
  { coins: 20, tool: 'hint', count: 1 },
  { coins: 30, tool: 'undo', count: 1 },
  { coins: 40, tool: 'shuffle', count: 1 },
  { coins: 50, tool: 'shovel', count: 1 },
  { coins: 60, tool: 'undo', count: 2 },
  { coins: 80, tool: 'shuffle', count: 2 },
  { coins: 120, tool: 'hint', count: 3 },
];
const natural = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
export function normalizeSave(raw: any = {}): SaveData {
  raw = raw && typeof raw === 'object' ? raw : {};
  const progress = (p: any = {}): Progress => ({
    unlocked: p?.unlocked === 2 || p?.completed ? 2 : 1,
    completed: !!p?.completed,
    best: natural(p?.best),
  });
  return {
    version: 3,
    sound: raw.sound !== false,
    coins: natural(raw.coins ?? raw.stars),
    modes: {
      classic: progress(raw.modes?.classic || raw),
      quartet: progress(raw.modes?.quartet),
      fun: progress(raw.modes?.fun),
    },
    bag: {
      undo: natural(raw.bag?.undo),
      shovel: natural(raw.bag?.shovel),
      shuffle: natural(raw.bag?.shuffle),
      hint: natural(raw.bag?.hint),
    },
    signInCount: natural(raw.signInCount),
    signedOn: typeof raw.signedOn === 'string' ? raw.signedOn : '',
  };
}
export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** Once per local calendar day; skipped days keep the seven-day cycle. */
export function claimSignIn(save: SaveData, today = localDateKey()): boolean {
  if (save.signedOn >= today) return false;
  const reward = SIGN_IN_REWARDS[save.signInCount % 7];
  save.coins += reward.coins;
  save.bag[reward.tool] += reward.count;
  save.signInCount++;
  save.signedOn = today;
  return true;
}
