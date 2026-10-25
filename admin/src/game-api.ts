import { request } from './api';
export type Mode = 'classic' | 'quartet' | 'fun';
export type Entry = 'standard' | 'campaign';
export const entryNames: Record<Entry, string> = { standard: '首页玩法', campaign: '闯关模式' };
export const modeNames: Record<Mode, string> = {
  classic: '经典三消',
  quartet: '极限四消',
  fun: '趣味规则消',
};
export const petNames = [
  '小黄啾',
  '蓝莓喵',
  '奶糖汪',
  '棉花兔',
  '青团蛙',
  '桃桃猪',
  '葡萄鸮',
  '团团熊',
  '小狮宝',
  '蜜橘狐',
  '棉花羊',
  '豆豆企鹅',
  '布丁鼠',
  '抱抱考拉',
  '紫芋象',
];
export const toolNames: Record<string, string> = {
  undo: '撤回',
  shovel: '铲出',
  hint: '提示',
  shuffle: '重排',
};
export interface Assets {
  coins: number;
  bag: Record<string, number>;
  signInCount: number;
  signedOn: string;
}
export interface Ledger {
  id: number;
  asset: string;
  delta: number;
  balance: number;
  reason: string;
  actorId: string;
  createdAt: string;
}
export interface Cell {
  x: number;
  y: number;
}
export interface Config {
  rulesVersion: string;
  mode: Mode;
  columns: number;
  rows: number;
  layers: { z: number; cells: Cell[] }[];
  counts: number[];
  capacity: number;
  freeTools: Record<string, number>;
  rewardCoins: number;
}
export interface Level {
  id: string;
  mode: Mode;
  ordinal: number;
  title: string;
  config: Config;
  draftVersion: number;
  revisionId: string;
  enabled: boolean;
  updatedAt: string;
}
export interface Tile {
  id: number;
  kind: number;
  x: number;
  y: number;
  layer: number;
  removed: boolean;
}
export interface BoardState {
  tiles: Tile[];
  tray: number[];
  reserve: number[];
  status: string;
  matches: number;
  cleared: number;
  moves: number;
  tools: Record<string, number>;
  capacity: number;
  mode: Mode;
  rulesVersion: string;
}
export interface Action {
  seq: number;
  type: string;
  tileId?: number;
  at: number;
}
export interface Session {
  entry: Entry;
  id: string;
  userId: string;
  nickname: string;
  mode: Mode;
  ordinal: number;
  title: string;
  revisionId: string;
  status: string;
  settled: boolean;
  moves: number;
  cleared: number;
  total: number;
  steps: number;
  rewardCoins: number;
  startedAt: string;
}
export interface Replay {
  session: {
    entry: Entry;
    id: string;
    title: string;
    ordinal: number;
    revisionId: string;
    seed: number;
    state: BoardState;
  };
  initial: BoardState;
  config: Config;
  events: { seq: number; action: Action; state: BoardState; receivedAt: string }[];
  status: string;
  userId: string;
  campaignId: string;
  startedAt: string;
}
export const date = (s: string) =>
  new Date(s).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const body = (v: unknown) => JSON.stringify(v);
export const gameApi = {
  assets: (id: string) => request<Assets>(`/admin/users/${id}/assets`),
  ledger: (id: string) => request<Ledger[]>(`/admin/users/${id}/ledger`),
  adjust: (id: string, v: { requestId: string; asset: string; delta: number; reason: string }) =>
    request<Assets>(`/admin/users/${id}/assets`, { method: 'POST', body: body(v) }),
  levels: () => request<Level[]>('/admin/levels'),
  save: (l: Level) =>
    request<Level>(l.id ? `/admin/levels/${l.id}` : '/admin/levels', {
      method: l.id ? 'PUT' : 'POST',
      body: body({
        mode: l.mode,
        ordinal: l.ordinal,
        title: l.title,
        config: l.config,
        draftVersion: l.draftVersion,
      }),
    }),
  publish: (l: Level) =>
    request<Level>(`/admin/levels/${l.id}/publish`, {
      method: 'POST',
      body: body({ draftVersion: l.draftVersion }),
    }),
  enabled: (id: string, enabled: boolean) =>
    request(`/admin/levels/${id}/enabled`, { method: 'POST', body: body({ enabled }) }),
  preview: (config: Config, seed: number) =>
    request<BoardState>('/admin/levels/preview', { method: 'POST', body: body({ config, seed }) }),
  sessions: (query: Record<string, string | number>) =>
    request<{ items: Session[]; total: number; page: number; pageSize: number }>(
      `/admin/sessions?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}`,
    ),
  replay: (id: string) => request<Replay>(`/admin/sessions/${id}/replay`),
};
