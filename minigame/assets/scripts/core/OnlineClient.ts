import { ModeId, GameStatus, Tile } from './MatchGame';
import { ToolId } from './Profile';
import {
  normalizeWechatAvatarUrl,
  normalizeWechatProfile,
  readAuthorizedWechatProfile,
  WechatUserProfile,
} from './WechatProfile';
export interface CloudProfile {
  id: string;
  nickname: string;
  avatarUrl: string;
}
export interface CloudAssets {
  coins: number;
  bag: Record<ToolId, number>;
  signInCount: number;
  signedOn: string;
}
export type EntryId = 'standard' | 'campaign';
export interface CloudState {
  tiles: Tile[];
  tray: number[];
  reserve: number[];
  status: GameStatus;
  matches: number;
  cleared: number;
  moves: number;
  tools: Record<ToolId, number>;
  capacity: number;
  mode: ModeId;
  rulesVersion: string;
  rules?: number[][];
  history?: {
    tiles: Tile[];
    tray: number[];
    reserve: number[];
    matches: number;
    cleared: number;
    moves: number;
    status: GameStatus;
  }[];
}
export interface CloudSession {
  id: string;
  entry: EntryId;
  levelId: string;
  revisionId: string;
  ordinal: number;
  title: string;
  seed: number;
  state: CloudState;
  lastSeq: number;
  settled: boolean;
  rewardCoins: number;
}
export interface CloudAction {
  seq: number;
  type: 'pick' | 'unlock_slot' | ToolId;
  tileId?: number;
  at: number;
}
export interface CloudFinish {
  status: string;
  rewardCoins: number;
  hasNext: boolean;
  assets: CloudAssets;
}
interface Storage {
  getItem(key: string): string | null | undefined;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface Pending {
  userId: string;
  sessionId: string;
  events: CloudAction[];
  outcome?: string;
}
type RequestMethod = 'OPTIONS' | 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE' | 'TRACE' | 'CONNECT';
interface WxAPI {
  login(options: { success: (r: { code: string }) => void; fail: () => void }): void;
  request(options: {
    url: string;
    method: RequestMethod;
    data?: unknown;
    header: Record<string, string>;
    timeout: number;
    success: (r: { statusCode: number; data: any }) => void;
    fail: () => void;
  }): void;
}
declare const wx: WxAPI | undefined;
const QUEUE_KEY = 'happy-pet-upload-v1';
const LEGACY_LOCAL_API = 'http://127.0.0.1:8080/api/v1';
const requestID = () =>
  `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
function readCloudProfile(value: unknown): CloudProfile | null {
  if (!value || typeof value !== 'object') return null;
  const profile = value as Partial<CloudProfile>;
  return typeof profile.id === 'string' &&
    !!profile.id &&
    typeof profile.nickname === 'string' &&
    typeof profile.avatarUrl === 'string'
    ? { id: profile.id, nickname: profile.nickname, avatarUrl: profile.avatarUrl }
    : null;
}
export class OnlineError extends Error {
  sessionId?: string;
  constructor(
    message: string,
    public status = 0,
    public code = '',
  ) {
    super(message);
  }
}
/** Persisted sequential batches; a retry reuses the exact event sequence numbers. */
export class OnlineClient {
  private token = '';
  private userId = '';
  private confirmedProfile: CloudProfile | null = null;
  private identityGeneration = 0;
  private queue: Pending[] = [];
  private pumping: Promise<void> | null = null;
  private session: CloudSession | null = null;
  private sequence = 0;
  private startGeneration = 0;
  private startedAt = 0;
  private lastAt = 0;
  private finishResults = new Map<string, CloudFinish>();
  private stateResults = new Map<string, CloudState>();
  private loginTask: Promise<void> | null = null;
  private profileSyncTask: Promise<CloudProfile | null> | null = null;
  private profileSyncOwner: { userId: string; generation: number } | null = null;
  private readonly storageScope: string;
  onAssets: (assets: CloudAssets) => void = () => {};
  onProfile: (profile: CloudProfile | null) => void = () => {};
  constructor(
    public readonly baseURL: string,
    private storage: Storage,
  ) {
    this.baseURL = baseURL.replace(/\/+$/, '');
    this.storageScope = `happy-pet-api:${encodeURIComponent(this.baseURL)}:`;
    try {
      const saved = JSON.parse(this.readStored(QUEUE_KEY) || '[]');
      this.queue = Array.isArray(saved)
        ? saved.filter(
            (p) =>
              p &&
              typeof p.userId === 'string' &&
              typeof p.sessionId === 'string' &&
              Array.isArray(p.events),
          )
        : [];
    } catch {
      this.queue = [];
    }
  }
  private readStored(key: string): string | null {
    const scoped = this.storage.getItem(this.storageScope + key);
    // WeChat's adapter can return ''/undefined for a missing key instead of null.
    if (typeof scoped === 'string' && scoped.length > 0) return scoped;
    if (this.baseURL !== LEGACY_LOCAL_API) return null;
    // The old shipped configuration used this exact loopback endpoint. Never
    // guess that endpoint-less legacy records belong to a newly configured API.
    const legacy = this.storage.getItem(key);
    if (typeof legacy !== 'string' || legacy.length === 0) return null;
    try {
      this.storage.setItem(this.storageScope + key, legacy);
      this.storage.removeItem(key);
    } catch {
      /* Keep the old copy if local persistence is unavailable. */
    }
    return legacy;
  }
  get active(): CloudSession | null {
    return this.session;
  }
  get profile(): CloudProfile | null {
    return this.confirmedProfile ? { ...this.confirmedProfile } : null;
  }
  async announcement(): Promise<string> {
    // Announcements are public and must remain available before WeChat login succeeds.
    const value = await this.request<{ content?: unknown }>('/settings/announcement');
    if (!value || typeof value.content !== 'string')
      throw new OnlineError('公告内容暂时无法读取', 0, 'INVALID_ANNOUNCEMENT');
    return value.content;
  }
  private cacheProfile(profile: CloudProfile | null): void {
    this.confirmedProfile = profile ? { ...profile } : null;
    this.onProfile(this.profile);
  }
  get pending(): boolean {
    return this.queue.some((p) => p.userId === this.userId && (p.events.length > 0 || !!p.outcome));
  }
  private save(): void {
    this.storage.setItem(this.storageScope + QUEUE_KEY, JSON.stringify(this.queue));
  }
  async request<T>(path: string, method: RequestMethod = 'GET', data?: unknown): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return new Promise<T>((resolve, reject) => {
      const receive = (status: number, body: any) => {
        if (status >= 200 && status < 300) resolve(body as T);
        else
          reject(
            new OnlineError(
              body?.error?.message || '连接暂时不可用，请稍后重试',
              status,
              body?.error?.code || '',
            ),
          );
      };
      if (typeof wx !== 'undefined' && wx.request)
        wx.request({
          url: this.baseURL + path,
          method,
          data,
          header: headers,
          timeout: 12000,
          success: (r) => receive(r.statusCode, r.data),
          fail: () => reject(new OnlineError('网络连接中断，操作已保存在本机', 0, 'NETWORK_ERROR')),
        });
      else {
        const xhr = new XMLHttpRequest();
        xhr.open(method, this.baseURL + path, true);
        xhr.timeout = 12000;
        Object.keys(headers).forEach((k) => xhr.setRequestHeader(k, headers[k]));
        xhr.onload = () => {
          let body: any;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            body = {};
          }
          receive(xhr.status, body);
        };
        xhr.onerror = xhr.ontimeout = () =>
          reject(new OnlineError('暂时连接不上服务器', 0, 'NETWORK_ERROR'));
        xhr.send(data === undefined ? undefined : JSON.stringify(data));
      }
    });
  }
  async login(): Promise<void> {
    if (this.loginTask) return this.loginTask;
    this.loginTask = (async () => {
      if (typeof wx === 'undefined' || !wx.login)
        throw new OnlineError('请在微信小游戏中登录，网页预览可使用离线练习');
      const code = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new OnlineError('微信登录超时，请重试')), 12000);
        wx!.login({
          success: (r) => {
            clearTimeout(timer);
            if (r.code) resolve(r.code);
            else reject(new OnlineError('微信登录未返回凭证'));
          },
          fail: () => {
            clearTimeout(timer);
            reject(new OnlineError('微信登录失败，请重试'));
          },
        });
      });
      const result = await this.request<{
        accessToken: string;
        user: { id: string; nickname?: string; avatarUrl?: string };
      }>('/auth/wechat', 'POST', { code });
      const accountChanged = this.userId !== result.user.id;
      if (accountChanged) this.identityGeneration++;
      this.token = result.accessToken;
      this.userId = result.user.id;
      const profile = readCloudProfile(result.user);
      if (profile || accountChanged) this.cacheProfile(profile);
      await this.refreshAssets();
    })().finally(() => {
      this.loginTask = null;
    });
    void this.loginTask.then(
      () => {
        // Profile permissions and avatar servers must never hold up login or gameplay.
        void this.syncWechatProfile().catch((error) => {
          if (error instanceof OnlineError && error.code === 'PROFILE_ACCOUNT_CHANGED') return;
          console.warn('[pet-profile] 自动同步未完成，可在个人设置重试');
        });
      },
      () => {},
    );
    return this.loginTask;
  }
  async refreshAssets(): Promise<void> {
    this.onAssets(await this.request<CloudAssets>('/user/assets'));
  }
  async signIn(): Promise<void> {
    await this.recover();
    this.onAssets(await this.request<CloudAssets>('/user/signin', 'POST', {}));
  }
  private async ready(): Promise<void> {
    if (this.loginTask) await this.loginTask;
    else if (!this.token) await this.login();
  }
  async getProfile(): Promise<CloudProfile> {
    return this.requestProfile('GET');
  }
  async syncWechatProfile(input?: WechatUserProfile): Promise<CloudProfile | null> {
    const pendingOwner = this.profileSyncOwner;
    const sameAccount =
      !pendingOwner?.userId ||
      (pendingOwner.userId === this.userId && pendingOwner.generation === this.identityGeneration);
    const previous = sameAccount ? this.profileSyncTask : null;
    if (!input && previous) return previous;
    const supplied = input ? normalizeWechatProfile(input) : null;
    const initialOwner = this.userId;
    const initialGeneration = this.identityGeneration;
    const syncOwner = { userId: initialOwner, generation: initialGeneration };
    const task = (async () => {
      if (previous) await previous.catch(() => {});
      await this.ready();
      const owner = initialOwner || this.userId;
      const generation = initialOwner ? initialGeneration : this.identityGeneration;
      const checkAccount = () => {
        if (owner !== this.userId || generation !== this.identityGeneration)
          throw new OnlineError('登录账号已变化，请重新同步微信资料', 0, 'PROFILE_ACCOUNT_CHANGED');
      };
      checkAccount();
      syncOwner.userId = owner;
      syncOwner.generation = generation;
      const profile = supplied || (await readAuthorizedWechatProfile());
      checkAccount();
      if (!profile) return null;
      if (
        this.confirmedProfile?.nickname === profile.nickName &&
        this.confirmedProfile.avatarUrl === profile.avatarUrl
      )
        return this.profile;
      return this.updateProfile({ nickname: profile.nickName, avatarUrl: profile.avatarUrl });
    })().finally(() => {
      if (this.profileSyncTask === task) {
        this.profileSyncTask = null;
        this.profileSyncOwner = null;
      }
    });
    this.profileSyncTask = task;
    this.profileSyncOwner = syncOwner;
    return task;
  }
  async updateProfile(input: { nickname: string; avatarUrl?: string }): Promise<CloudProfile> {
    const nickname = typeof input.nickname === 'string' ? input.nickname.trim() : '';
    if (!nickname || Array.from(nickname).length > 32)
      throw new OnlineError('昵称需要填写 1–32 个字符', 0, 'PROFILE_NICKNAME_INVALID');
    const data: { nickname: string; avatarUrl?: string } = { nickname };
    if (input.avatarUrl !== undefined) data.avatarUrl = normalizeWechatAvatarUrl(input.avatarUrl);
    return this.requestProfile('PUT', data);
  }
  private async requestProfile(
    method: 'GET' | 'PUT',
    data?: { nickname: string; avatarUrl?: string },
  ): Promise<CloudProfile> {
    try {
      return await this.performProfileRequest(method, data);
    } catch (error) {
      if (error instanceof OnlineError && error.code === 'NETWORK_ERROR')
        throw new OnlineError(
          method === 'PUT' ? '网络连接中断，资料尚未保存，请重试' : '暂时无法读取资料，请稍后重试',
          0,
          'NETWORK_ERROR',
        );
      throw error;
    }
  }
  private async performProfileRequest(
    method: 'GET' | 'PUT',
    data?: { nickname: string; avatarUrl?: string },
  ): Promise<CloudProfile> {
    const previousUserId = this.userId;
    const previousGeneration = this.identityGeneration;
    await this.ready();
    const owner = previousUserId || this.userId;
    const generation = previousUserId ? previousGeneration : this.identityGeneration;
    const checkAccount = () => {
      if (owner !== this.userId || generation !== this.identityGeneration)
        throw new OnlineError(
          '登录账号已变化，请重新打开个人设置后再试',
          0,
          'PROFILE_ACCOUNT_CHANGED',
        );
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      checkAccount();
      const token = this.token;
      let response: unknown;
      try {
        response = await this.request<unknown>('/user/me', method, data);
      } catch (error) {
        checkAccount();
        if (error instanceof OnlineError && error.status === 401 && attempt === 0) {
          if (this.token === token) this.token = '';
          await this.ready();
          checkAccount();
          continue;
        }
        throw error;
      }
      checkAccount();
      const profile = readCloudProfile(response);
      if (!profile || profile.id !== owner)
        throw new OnlineError('玩家资料暂时无法读取，请重试', 0, 'PROFILE_INVALID');
      this.cacheProfile(profile);
      return { ...profile };
    }
    throw new OnlineError('请重新登录后再试', 401);
  }
  async start(
    mode: ModeId,
    previousSessionId = '',
    entry: EntryId = 'campaign',
  ): Promise<CloudSession> {
    const generation = ++this.startGeneration;
    await this.recover();
    if (generation !== this.startGeneration)
      throw new OnlineError('本次关卡请求已取消', 0, 'START_CANCELLED');
    const keyName = `happy-pet-start-${this.userId}-${entry}-${mode}-${previousSessionId}`;
    let key = this.readStored(keyName);
    if (!key) {
      key = requestID();
      this.storage.setItem(this.storageScope + keyName, key);
    }
    const session = await this.request<CloudSession>('/user/sessions', 'POST', {
      entry,
      mode,
      previousSessionId,
      requestId: key,
    });
    if (generation !== this.startGeneration)
      throw new OnlineError('本次关卡请求已取消', 0, 'START_CANCELLED');
    this.storage.removeItem(this.storageScope + keyName);
    this.session = session;
    this.sequence = session.lastSeq;
    this.startedAt = Date.now();
    this.lastAt = 0;
    return session;
  }
  record(type: CloudAction['type'], tileId?: number): void {
    const s = this.session;
    if (!s) throw new OnlineError('对局尚未开始');
    let pending = this.queue.find((q) => q.sessionId === s.id && q.userId === this.userId);
    if (!pending) {
      pending = { userId: this.userId, sessionId: s.id, events: [] };
      this.queue.push(pending);
    }
    this.lastAt = Math.max(this.lastAt, Date.now() - this.startedAt);
    const event: CloudAction = { seq: ++this.sequence, type, at: this.lastAt };
    if (type === 'pick') event.tileId = tileId;
    pending.events.push(event);
    this.save();
  }
  flush(): Promise<void> {
    if (this.pumping) return this.pumping;
    this.pumping = this.drain().finally(() => {
      this.pumping = null;
    });
    return this.pumping;
  }
  private async drain(): Promise<void> {
    for (const item of this.queue.filter((q) => q.userId === this.userId)) {
      while (item.events.length) {
        const batch = item.events.slice(0, 64);
        const result = await this.request<{
          state: CloudState;
          lastSeq: number;
          assets: CloudAssets;
        }>(`/user/sessions/${item.sessionId}/events`, 'POST', { events: batch }).catch((error) => {
          if (error instanceof OnlineError) error.sessionId = item.sessionId;
          throw error;
        });
        this.stateResults.set(item.sessionId, result.state);
        item.events = item.events.filter((e) => e.seq > result.lastSeq);
        this.save();
        if (!item.events.length) this.onAssets(result.assets);
      }
      if (item.outcome) {
        const result = await this.request<CloudFinish>(
          `/user/sessions/${item.sessionId}/finish`,
          'POST',
          { outcome: item.outcome },
        );
        this.finishResults.set(item.sessionId, result);
        this.onAssets(result.assets);
        item.outcome = undefined;
        this.save();
      }
    }
    this.queue = this.queue.filter((q) => q.events.length || q.outcome);
    this.save();
  }
  async finish(outcome: string): Promise<CloudFinish> {
    if (!this.session) throw new OnlineError('没有正在进行的对局');
    const id = this.session.id;
    let item = this.queue.find((q) => q.sessionId === id);
    if (!item) {
      item = { userId: this.userId, sessionId: id, events: [] };
      this.queue.push(item);
    }
    item.outcome = outcome;
    this.save();
    await this.recover();
    if (this.pending) await this.flush();
    const result = this.finishResults.get(id);
    if (!result) throw new OnlineError('结果仍在等待同步');
    return result;
  }
  async shuffle(): Promise<CloudState> {
    await this.recover();
    if (this.pending) await this.flush();
    this.record('shuffle');
    return this.syncState();
  }
  async syncState(): Promise<CloudState> {
    await this.recover();
    if (this.pending) await this.flush();
    const result = this.stateResults.get(this.session!.id);
    if (!result) throw new OnlineError('操作暂未完成');
    return result;
  }
  async recover(): Promise<void> {
    await this.ready();
    try {
      await this.flush();
    } catch (e) {
      if (e instanceof OnlineError && e.status === 401) {
        this.token = '';
        await this.login();
        await this.flush();
      } else if (
        e instanceof OnlineError &&
        (e.status === 400 || e.status === 409) &&
        e.sessionId &&
        !this.session
      ) {
        // A rejected tool can arrive after the player has already left the board.
        // Close that round from its confirmed state instead of blocking every future login.
        const item = this.queue.find(
          (p) => p.userId === this.userId && p.sessionId === e.sessionId,
        );
        if (!item) throw e;
        const current = await this.request<CloudSession>(`/user/sessions/${item.sessionId}`);
        item.events = [];
        item.outcome = current.state.status === 'playing' ? 'abandoned' : current.state.status;
        this.save();
        await this.flush();
      } else throw e;
    }
  }
  async reconcile(): Promise<CloudSession> {
    if (!this.session) throw new OnlineError('对局已离开');
    if (this.pumping) await this.pumping.catch(() => {});
    const current = await this.request<CloudSession>(`/user/sessions/${this.session.id}`);
    this.queue = this.queue.filter((q) => q.sessionId !== current.id || q.userId !== this.userId);
    this.sequence = current.lastSeq;
    this.session = current;
    this.save();
    await this.refreshAssets();
    return current;
  }
  detach(): void {
    this.startGeneration++;
    this.session = null;
  }
}
