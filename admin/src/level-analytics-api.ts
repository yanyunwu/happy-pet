import { request } from './api';
import type { Entry, Mode } from './game-api';

export type AnalyticsRange = '7d' | '30d' | '90d' | 'all';
export interface AnalyticsDay {
  date: string;
  attempts: number;
  won: number;
  lost: number;
  abandoned: number;
  unfinished: number;
  winRate: number | null;
}
export interface AnalyticsRevision {
  id: string;
  version: number;
  title: string;
  publishedAt: string;
  current: boolean;
}
export interface LevelAnalytics {
  level: {
    id: string;
    title: string;
    entry: Entry;
    mode: Mode;
    ordinal: number;
    publishedRevisionId: string;
  };
  range: AnalyticsRange;
  revisionId: string;
  from: string | null;
  to: string;
  trendFrom: string;
  timezone: 'Asia/Shanghai';
  generatedAt: string;
  summary: {
    attempts: number;
    players: number;
    won: number;
    lost: number;
    abandoned: number;
    unfinished: number;
    winRate: number | null;
    finishedWinRate: number | null;
    avgWinDurationSeconds: number | null;
    winDurationSamples: number;
    avgWinMoves: number | null;
  };
  daily: AnalyticsDay[];
  revisions: AnalyticsRevision[];
  tools: {
    type: 'undo' | 'shovel' | 'hint' | 'shuffle' | 'unlock_slot';
    uses: number;
    sessions: number;
  }[];
}
export const levelAnalytics = (
  id: string,
  range: AnalyticsRange,
  revisionId: string,
  signal: AbortSignal,
) =>
  request<LevelAnalytics>(
    `/admin/levels/${encodeURIComponent(id)}/analytics?${new URLSearchParams({ range, revisionId })}`,
    { signal },
  );
export const analyticsPercent = (value: number | null) =>
  value === null ? '—' : `${value.toFixed(1)}%`;
