import {
  _decorator,
  BlockInputEvents,
  Button,
  Component,
  Label,
  Node,
  ResolutionPolicy,
  Sprite,
  SpriteFrame,
  Tween,
  UIOpacity,
  Vec3,
  profiler,
  resources,
  sys,
  tween,
  view,
  JsonAsset,
} from 'cc';
import {
  KIND_NAMES,
  MatchGame,
  MODES,
  ModeId,
  PickResult,
  TILE_H,
  TILE_W,
  Tile,
  ruleDescription,
} from './core/MatchGame';
import {
  claimSignIn,
  localDateKey,
  normalizeSave,
  SaveData,
  SIGN_IN_REWARDS,
  ToolId,
} from './core/Profile';
import {
  WIDTH,
  HEIGHT,
  BOARD_X,
  BOARD_Y,
  TRAY_X,
  TRAY_STEP,
  TRAY_Y,
  TRAY_SCALE,
  RESERVE_Y,
  RESERVE_SCALE,
  tileFaceCenterY,
} from './ui/Layout';
import * as P from './ui/Paint';
import { ModalPresenter } from './ui/ModalPresenter';
import { ToastPresenter } from './ui/ToastPresenter';
import { PlayerProfileDialog } from './ui/PlayerProfileDialog';
import { WoodlandAudio } from './ui/WoodlandAudio';
import { LeafTransition } from './ui/LeafTransition';
import { OnlineClient, OnlineError, CloudAssets, CloudSession, EntryId } from './core/OnlineClient';
import {
  resolveApiConfiguration,
  ApiEnvironment,
  WechatEnvironmentAPI,
} from './core/ApiEnvironment';

const { ccclass, property } = _decorator;
const C = P.PALETTE;
const MODAL_INSET = 44;
const SAVE_KEY = 'star-isle-v1';
const TOOL_INFO: { id: ToolId; name: string; icon: number; detail: string }[] = [
  { id: 'undo', name: '撤回', icon: 2, detail: '收回上一步，恢复消除前的萌宠' },
  { id: 'shovel', name: '铲出', icon: 5, detail: '槽内萌宠移到上方，点击可放回' },
  { id: 'hint', name: '提示', icon: 4, detail: '点亮可以优先收集的小伙伴' },
  { id: 'shuffle', name: '重排', icon: 3, detail: '所有剩余方块转一圈，重新落位' },
];
declare const wx:
  | undefined
  | (WechatEnvironmentAPI & {
      openCustomerServiceConversation?: (options: {
        sessionFrom: string;
        showMessageCard: boolean;
        fail: () => void;
      }) => void;
    });

@ccclass('StarIsle')
export class StarIsle extends Component {
  @property(Node) public stageRoot: Node | null = null;
  @property(Node) public homeRoot: Node | null = null;
  @property(Node) public gameRoot: Node | null = null;
  @property([SpriteFrame]) public petFrames: SpriteFrame[] = [];
  @property([SpriteFrame]) public utilityFrames: SpriteFrame[] = [];
  @property([SpriteFrame]) public skinFrames: SpriteFrame[] = [];
  @property([SpriteFrame]) public homeFrames: SpriteFrame[] = [];
  @property([SpriteFrame]) public menuFrames: SpriteFrame[] = [];
  private profileDialog: PlayerProfileDialog | null = null;
  private stage!: Node;
  private screen!: Node;
  private effects!: Node;
  private board!: Node;
  private rack!: Node;
  private reserveRoot!: Node;
  private modals!: ModalPresenter;
  private get modal(): Node | null {
    return this.modals?.current || null;
  }
  private toasts!: ToastPresenter;
  private tileNodes = new Map<number, Node>();
  private trayNodes = new Map<number, Node>();
  private reserveNodes = new Map<number, Node>();
  private trayMotions = new Map<number, number>();
  private clearingGroups = new Map<number, Node[]>();
  private presentationEpoch = 0;
  private motionSerial = 0;
  private resultHandled = false;
  private frames: SpriteFrame[] = [];
  private soundscape!: WoodlandAudio;
  private levelTransition!: LeafTransition;
  private game: MatchGame | null = null;
  private busy = false;
  private boardTransition = false;
  private shuffleMotion: { phase: number } | null = null;
  private playTime = 0;
  private currentScreen = 'home';
  private selectedMode: ModeId = 'classic';
  private selectedEntry: EntryId = 'standard';
  private save: SaveData = normalizeSave();
  private localSave: SaveData = normalizeSave();
  private cloudSave: SaveData = normalizeSave();
  private online: OnlineClient | null = null;
  private practice = true;
  private networkBusy = false;
  private onlineReady = false;
  private onlineConfigError = false;
  private apiEnvironment: ApiEnvironment = 'local';
  private rewardCoins = 0;
  private reconciling = false;

  onLoad(): void {
    profiler.hideStats();
    view.setDesignResolutionSize(WIDTH, HEIGHT, ResolutionPolicy.SHOW_ALL);
    if (
      !this.stageRoot ||
      !this.homeRoot ||
      !this.gameRoot ||
      this.petFrames.length !== KIND_NAMES.length ||
      this.utilityFrames.length !== 6 ||
      this.menuFrames.length !== 2
    ) {
      throw new Error(
        'Bind the native pages, all 15 pet frames and 6 utility frames in main.scene.',
      );
    }
    try {
      const raw = JSON.parse(sys.localStorage.getItem(SAVE_KEY) || '{}');
      this.save = normalizeSave(raw);
    } catch {
      /* Local storage is optional; keep the game playable. */
    }
    this.localSave = this.save;
    // Sound is a device preference, including while WeChat login is still pending.
    this.cloudSave.sound = this.localSave.sound;
    this.stage = this.stageRoot;
    this.modals = new ModalPresenter(this.stage, (cue) => this.play(cue));
    this.frames = this.petFrames.slice();
    P.configureSkin(this.skinFrames);
    this.toasts = new ToastPresenter(this.stage);
    this.soundscape = this.node.addComponent(WoodlandAudio);
    this.soundscape.configure(() => this.save.sound);
    this.levelTransition = new LeafTransition(
      this.stage,
      this.gameRoot.getChildByName('Background')!.getComponent(Sprite)!.spriteFrame,
    );
    this.at(this.gameRoot, 'Instruction').on(Node.EventType.TOUCH_END, () => {
      if (
        this.game?.status === 'playing' &&
        !this.modal &&
        !this.networkBusy &&
        !this.levelTransition.active
      )
        this.showRules(false);
    });
    this.home();
    resources.load('online', JsonAsset, (error, asset) => {
      if (!this.isValid) return;
      this.onlineReady = true;
      try {
        if (error) throw error;
        const selected = resolveApiConfiguration(
          asset?.json,
          typeof wx === 'undefined' ? undefined : wx,
        );
        this.apiEnvironment = selected.environment;
        console.info(`[pet-online] ${selected.environment}: ${selected.apiBaseUrl}`);
        this.online = new OnlineClient(selected.apiBaseUrl, sys.localStorage);
        this.online.onAssets = (value) => this.receiveAssets(value);
        if (typeof wx !== 'undefined') {
          this.practice = false;
          this.save = this.cloudSave;
          void this.online
            .recover()
            .then(() => this.refreshHome())
            .catch(() => {
              if (this.isValid) this.toast('连接暂未完成，开始闯关时将重试');
            });
        }
      } catch (failure) {
        this.onlineConfigError = true;
        console.warn('[pet-online] 无法读取当前环境的接口配置', failure);
      }
    });
  }
  update(dt: number): void {
    if (
      this.currentScreen === 'game' &&
      this.game?.status === 'playing' &&
      !this.modal &&
      !this.levelTransition.active
    )
      this.playTime += dt;
  }
  private at(root: Node, path: string): Node {
    let result = root;
    for (const part of path.split('/')) {
      const next = result.getChildByName(part);
      if (!next) throw new Error(`Missing authored UI node: ${path}`);
      result = next;
    }
    return result;
  }
  private setText(root: Node, path: string, value: string): void {
    this.at(root, path).getComponent(Label)!.string = value;
  }
  private persist(): void {
    try {
      this.localSave.sound = this.save.sound;
      sys.localStorage.setItem(
        SAVE_KEY,
        JSON.stringify(this.practice ? this.save : this.localSave),
      );
    } catch {
      /* Optional persistence. */
    }
  }
  private receiveAssets(value: CloudAssets): void {
    Object.assign(this.cloudSave, {
      coins: value.coins,
      bag: { ...value.bag },
      signInCount: value.signInCount,
      signedOn: value.signedOn,
      sound: this.localSave.sound,
    });
    if (!this.practice) {
      this.save = this.cloudSave;
      if (this.currentScreen === 'home') this.refreshHome();
      else if (this.game) this.updateControls();
    }
  }
  private play(name: string): void {
    this.soundscape?.play(name);
  }
  private startMusic(): void {
    this.soundscape.setMode('game');
  }
  private disposeChildren(parent: Node): void {
    parent.children.slice().forEach((node) => {
      node.active = false;
      node.destroy();
    });
  }

  private resetTrayPresentation(): void {
    // Invalidate callbacks before switching rounds, undoing or reshuffling.
    this.presentationEpoch++;
    if (this.shuffleMotion) Tween.stopAllByTarget(this.shuffleMotion);
    this.shuffleMotion = null;
    this.boardTransition = false;
    this.trayNodes.forEach((n) => Tween.stopAllByTarget(n));
    this.reserveNodes.forEach((n) => Tween.stopAllByTarget(n));
    this.clearingGroups.forEach((nodes) =>
      nodes.forEach((n) => {
        Tween.stopAllByTarget(n);
        if (n.isValid) {
          n.active = false;
          n.destroy();
        }
      }),
    );
    this.trayNodes.clear();
    this.trayMotions.clear();
    this.clearingGroups.clear();
    this.reserveNodes.clear();
    if (this.rack?.isValid) this.disposeChildren(this.rack);
    if (this.reserveRoot?.isValid) this.disposeChildren(this.reserveRoot);
    this.busy = false;
  }

  private clearScreen(name: 'home' | 'game'): void {
    this.disposeProfileDialog();
    this.unscheduleAllCallbacks();
    this.toasts.reset();
    this.clearHighlights();
    this.modals.retire();
    this.resetTrayPresentation();
    this.stage.children.slice().forEach((n) => {
      if (
        n !== this.homeRoot &&
        n !== this.gameRoot &&
        !this.modals.owns(n) &&
        !this.levelTransition.owns(n)
      ) {
        n.active = false;
        n.destroy();
      }
    });
    this.tileNodes.clear();
    this.homeRoot!.active = name === 'home';
    this.gameRoot!.active = name === 'game';
    this.screen = name === 'home' ? this.homeRoot! : this.gameRoot!;
    this.currentScreen = name;
    this.resultHandled = false;
    this.effects = P.layer(this.stage, 'Effects');
  }
  private home(): void {
    if (this.levelTransition.active) {
      this.levelTransition.reset();
      this.networkBusy = false;
    }
    if (this.modal) {
      this.closeModal(() => this.home());
      return;
    }
    if (this.online?.active && !this.practice && this.game?.status === 'playing') {
      void this.online.finish('abandoned').catch(() => {
        if (this.isValid) this.toast('退出记录已暂存，联网后会继续同步');
      });
    }
    this.online?.detach();
    this.clearScreen('home');
    this.soundscape.setMode('home');
    this.game = null;
    this.refreshHome();
    [...MODES.map((mode) => `Mode-${mode.id}`), 'CampaignButton'].forEach((name, index) =>
      P.pop(this.at(this.homeRoot!, `WelcomePanel/${name}`), index * 0.04),
    );
  }
  private refreshHome(): void {
    this.setText(this.homeRoot!, 'TopBar/CoinsValue', String(this.save.coins));
    this.at(this.homeRoot!, 'Shortcuts/SignInButton/Notice').active =
      this.save.signedOn < localDateKey();
  }
  public onHomeMode(_event: unknown, mode: string): void {
    if (this.modal) return;
    this.beginMode(mode, 'standard');
  }
  private beginMode(mode: string, entry: EntryId): void {
    if (this.networkBusy || !MODES.some((m) => m.id === mode)) return;
    if (typeof wx !== 'undefined' && this.onlineConfigError) {
      this.toast('服务暂未准备好，请稍后再试');
      return;
    }
    if (!this.onlineReady) {
      this.toast('正在准备冒险，请稍等一下');
      return;
    }
    if (entry === 'campaign' && !this.online) {
      this.toast('闯关关卡准备中，先体验首页三种玩法吧');
      return;
    }
    if (entry === 'campaign' && typeof wx === 'undefined') {
      this.toast('闯关模式请在微信中体验');
      return;
    }
    this.selectedEntry = entry;
    this.practice = entry === 'standard' && (!this.online || typeof wx === 'undefined');
    this.save = this.practice ? this.localSave : this.cloudSave;
    this.closeModal();
    this.play('tap');
    this.selectedMode = mode as ModeId;
    this.startLevel(1);
  }
  public onHomeNav(_event: unknown, action: string): void {
    if (this.modal || !this.frames.length) return;
    this.play('tap');
    if (action === 'campaign') this.showCampaign();
    else if (action === 'menu') this.showMenu();
    else if (action === 'signin') this.showSignIn();
    else if (action === 'bag') this.showBag();
    else if (action === 'album') this.showAlbum();
    else if (action === 'settings') this.showSettings();
    else if (action === 'home') this.home();
  }
  public onGameAction(_event: unknown, action: string): void {
    const g = this.game;
    if (!g || this.modal || this.networkBusy || g.status !== 'playing') return;
    if (this.busy && ['undo', 'shovel', 'shuffle', 'hint'].includes(action)) return;
    if (action === 'pause' || action === 'settings') this.play('tap');
    if (action === 'pause') this.showPause();
    else if (action === 'settings') this.showSettings();
    else if (action === 'undo') this.undo();
    else if (action === 'shovel') this.shovel();
    else if (action === 'shuffle') this.reshuffle();
    else if (action === 'hint') {
      let ids: number[] = [];
      this.useTool('hint', () => {
        ids = g.hint();
        return ids.length > 0;
      });
      if (ids.length) {
        this.highlight(ids);
        this.updateControls();
        this.toast('优先收集发光的小伙伴吧！');
      } else {
        this.play('blocked');
        this.toast('先试试撤回或重排，给口袋腾个位置');
      }
    }
  }
  private startLevel(id: number, seed?: number, mode: ModeId = this.selectedMode): void {
    if (this.modal) {
      this.closeModal(() => this.startLevel(id, seed, mode));
      return;
    }
    if (this.online && !this.practice) {
      void this.startCloud(mode);
      return;
    }
    this.selectedMode = mode;
    this.mountLevel(new MatchGame(id, seed, mode), id === 1);
  }
  private mountLevel(game: MatchGame, rules: boolean): void {
    if (!this.isValid) return;
    this.clearScreen('game');
    this.game = game;
    this.playTime = 0;
    this.rewardCoins = 0;
    this.startMusic();
    this.at(this.gameRoot!, 'BoardPreview').active = false;
    this.board = this.at(this.gameRoot!, 'Board');
    this.rack = this.at(this.gameRoot!, 'Tray');
    this.reserveRoot = this.at(this.gameRoot!, 'ReserveArea/ReserveTiles');
    this.disposeChildren(this.board);
    this.disposeChildren(this.rack);
    this.setText(this.gameRoot!, 'TopBar/Chapter', `第 ${game.level.id} 关`);
    this.setText(
      this.gameRoot!,
      'TopBar/LevelName',
      `${this.selectedEntry === 'campaign' ? '闯关 · ' : ''}${this.game.mode.title}`,
    );
    this.setText(
      this.gameRoot!,
      'Instruction',
      game.rules.length <= 3
        ? `${game.rules.map((rule) => rule.join('+')).join(' / ')} · 点击查看规则`
        : `${game.rules.length} 条消除规则 · 点击查看`,
    );
    this.buildBoard();
    this.syncReserve();
    this.updateHud();
    this.updateControls();
    if (rules) {
      this.showRules();
    }
  }
  private showCampaign(): void {
    if (!this.onlineReady) {
      this.toast('正在准备冒险，请稍等一下');
      return;
    }
    const m = this.dialog('Campaign', '闯关模式', 1030);
    P.text(m, 'Intro', '选择玩法，继续你的闯关进度', 360, 420, 25, C.ink, 550, true);
    MODES.forEach((mode, index) => {
      const b = P.button(
        m,
        `Campaign-${mode.id}`,
        mode.title,
        360,
        570 + index * 175,
        510,
        112,
        () => this.beginMode(mode.id, 'campaign'),
        index !== 1,
        34,
      );
      P.sprite(b, 'Pet', this.frames[[9, 12, 3][index]], -202, -4, 66, 66);
      P.text(m, `Rule-${mode.id}`, mode.shortRule, 360, 642 + index * 175, 21, C.muted, 540);
    });
    P.text(
      m,
      'CampaignNote',
      this.online
        ? '三种玩法独立保存进度，新的冒险持续开放'
        : '闯关关卡准备中 · 挑战玩法可直接体验',
      360,
      1160,
      21,
      C.muted,
      570,
    );
  }
  private async startCloud(mode: ModeId, previous = ''): Promise<void> {
    if (!this.online || this.networkBusy) return;
    this.networkBusy = true;
    this.selectedMode = mode;
    this.modals.reset();
    const token = this.levelTransition.show();
    const online = this.online;
    let failure: unknown;
    try {
      if (online.active && this.game?.status === 'playing') await online.finish('abandoned');
      if (!this.isValid || !this.levelTransition.isCurrent(token)) return;
      const session: CloudSession = await online.start(mode, previous, this.selectedEntry);
      if (!this.isValid || !this.levelTransition.isCurrent(token)) return;
      const nextGame = MatchGame.fromCloud(session);
      const changedRules = JSON.stringify(this.game?.rules) !== JSON.stringify(nextGame.rules);
      this.mountLevel(nextGame, !previous || changedRules);
      this.levelTransition.bringToFront();
    } catch (error) {
      failure = error;
    } finally {
      await this.levelTransition.hide(token);
      if (this.isValid && this.levelTransition.isCurrent(token)) this.networkBusy = false;
    }
    if (failure && this.isValid && this.levelTransition.isCurrent(token)) {
      if (failure instanceof OnlineError && failure.code === 'CAMPAIGN_COMPLETE') {
        const m = this.dialog('CampaignComplete', '暂时没有新关卡', 620);
        P.sprite(m, 'Pet', this.frames[12], 360, 710, 130, 130);
        P.text(
          m,
          'SavedProgress',
          '进度已保存，新的关卡开放后继续冒险',
          360,
          840,
          24,
          C.ink,
          530,
          true,
        );
        P.button(m, 'CompleteHome', '返回主页', 360, 955, 470, 84, () => this.home(), true, 28);
        return;
      }
      if (
        failure instanceof OnlineError &&
        (failure.status === 400 || failure.status === 409) &&
        online.active &&
        this.game
      )
        await this.reconcileCloud(failure);
      else this.connectionError(failure, () => this.startCloud(mode, previous));
    }
  }
  private connectionError(error: unknown, retry: () => Promise<unknown>): void {
    const m = this.dialog('NetworkRetry', '连接中断了', 670);
    m.getChildByName('Close')!.active = false;
    P.text(
      m,
      'Message',
      error instanceof Error ? error.message : '请检查网络后重试',
      360,
      710,
      23,
      C.ink,
      550,
      true,
    );
    P.text(m, 'Saved', '已记录的操作会保留，重试不会重复扣费', 360, 785, 21, C.muted, 550);
    P.button(
      m,
      'RetryNetwork',
      '重试连接',
      360,
      897,
      475,
      88,
      () => {
        if (!this.networkBusy) {
          this.closeModal();
          void retry();
        }
      },
      true,
      28,
    );
    P.button(m, 'NetworkHome', '返回主页', 360, 1002, 475, 80, () => this.home(), false, 27);
  }
  private recordAction(type: 'pick' | ToolId, id?: number): void {
    if (!this.online || this.practice) return;
    this.online.record(type, id);
    void this.online.flush().catch((error) => {
      if (!this.isValid || this.currentScreen !== 'game') return;
      if (error instanceof OnlineError && (error.status === 400 || error.status === 409))
        void this.reconcileCloud(error);
      else this.toast('网络较慢，操作已暂存');
    });
  }
  private async reconcileCloud(error: Error): Promise<void> {
    if (this.reconciling || !this.online?.active || this.practice) return;
    this.reconciling = true;
    this.networkBusy = true;
    const previous = this.game,
      elapsed = this.playTime;
    try {
      const session = await this.online.reconcile();
      if (this.game === previous) {
        this.mountLevel(MatchGame.fromCloud(session), false);
        this.playTime = elapsed;
        this.toast(`${error.message}，已恢复已确认的棋盘`);
        if (this.game!.status !== 'playing') this.finishPick();
      }
    } catch (failure) {
      this.connectionError(failure, () => this.reconcileCloud(error));
    } finally {
      this.reconciling = false;
      this.networkBusy = false;
    }
  }
  private updateHud(): void {
    const g = this.game!,
      root = this.gameRoot!;
    this.setText(root, 'TopBar/Remaining', `剩余 ${g.remaining}`);
    const title = this.at(root, 'TrayTitle').getComponent(Label)!;
    title.node.active = g.tray.length >= 5;
    title.string = `还剩 ${Math.max(0, 7 - g.tray.length)} 个空位，优先凑齐相同萌宠`;
    title.color = P.color('#944721');
  }
  private updateControls(): void {
    const g = this.game!;
    for (const [key, left, enabled] of [
      ['undo', g.undoLeft + this.save.bag.undo, g.hasUndo],
      ['shovel', g.shovelLeft + this.save.bag.shovel, g.canShovel],
      ['hint', g.hintLeft + this.save.bag.hint, true],
      ['shuffle', g.shuffleLeft + this.save.bag.shuffle, true],
    ] as [string, number, boolean][]) {
      const n = this.at(this.gameRoot!, `Toolbar/Tool-${key}`);
      const available = enabled && left > 0 && g.status === 'playing';
      // Short animations lock input without flashing the tool's availability appearance.
      n.getComponent(Button)!.interactable = available && !this.busy;
      P.opacity(n, 255);
      P.opacity(this.at(n, 'Icon'), available ? 255 : 130);
      this.setText(n, 'Count', String(left));
    }
  }
  private buildBoard(): void {
    this.tileNodes.clear();
    this.game!.tiles.filter((tile) => !tile.removed)
      .sort((a, b) => a.layer - b.layer || a.id - b.id)
      .forEach((tile) => {
        const n = this.makeTile(this.board, tile, BOARD_X + tile.x, BOARD_Y + tile.y);
        n.name = `tile-${tile.id}`;
        n.on(Node.EventType.TOUCH_END, () => this.pick(tile.id));
        this.tileNodes.set(tile.id, n);
      });
    this.syncBoard();
  }
  private makeTile(parent: Node, tile: Tile, x: number, y: number, scale = 1): Node {
    const n = P.skin(parent, `pet-${tile.id}`, 'tile', x, y, TILE_W, TILE_H);
    P.sprite(n, 'Pet', this.frames[tile.kind], 0, tileFaceCenterY(TILE_H), 81, 81);
    n.setScale(scale, scale, 1);
    return n;
  }
  private syncBoard(): void {
    for (const [id, n] of this.tileNodes) {
      if (this.game!.tiles[id].removed) {
        n.active = false;
        n.destroy();
        this.tileNodes.delete(id);
        continue;
      }
      // Reuse the shade. Destroy is deferred until frame end, so replacing
      // it on every rapid tap can leave extra active shades on exposed tiles.
      const covered = !this.game!.isAvailable(id);
      let shade = n.getChildByName('Covered');
      if (covered && !shade)
        shade = P.rounded(
          n,
          'Covered',
          0,
          -5,
          TILE_W - 2,
          TILE_H - 10,
          '#34362C',
          16,
          undefined,
          102,
        );
      if (shade) shade.active = covered;
    }
  }
  private renderTray(ids = this.game!.tray): void {
    this.resetTrayPresentation();
    ids.forEach((id, index) => {
      const n = this.makeTile(
        this.rack,
        this.game!.tiles[id],
        TRAY_X + index * TRAY_STEP,
        TRAY_Y - 3,
        TRAY_SCALE,
      );
      n.name = `tray-${id}`;
      this.trayNodes.set(id, n);
    });
  }
  private syncReserve(): void {
    const g = this.game!;
    this.at(this.gameRoot!, 'ReserveArea').active = g.reserve.length > 0;
    for (const [id, n] of this.reserveNodes)
      if (!g.reserve.includes(id)) {
        Tween.stopAllByTarget(n);
        n.active = false;
        n.destroy();
        this.reserveNodes.delete(id);
      }
    g.reserve.forEach((id, index) => {
      let n = this.reserveNodes.get(id);
      if (!n) {
        n = this.makeTile(
          this.reserveRoot,
          g.tiles[id],
          TRAY_X + index * TRAY_STEP,
          RESERVE_Y,
          RESERVE_SCALE,
        );
        n.name = `reserve-${id}`;
        n.on(Node.EventType.TOUCH_END, () => this.pick(id));
        this.reserveNodes.set(id, n);
      }
      n.setPosition(TRAY_X + index * TRAY_STEP, -RESERVE_Y);
      n.setScale(RESERVE_SCALE, RESERVE_SCALE, 1);
    });
  }
  private pick(id: number): void {
    if (this.modal || this.networkBusy || this.boardTransition || this.game?.status !== 'playing')
      return;
    const reserved = this.game.reserve.includes(id);
    if (!this.game.tiles[id] || (this.game.tiles[id].removed && !reserved)) return;
    if (!this.game.isAvailable(id)) {
      this.play('blocked');
      this.toast('先收集上面的小伙伴，下面的才能出来哦');
      return;
    }
    // Rules resolve synchronously in tap order. Animations never mutate the
    // game, so other exposed cards can be collected while this one is moving.
    const origin = reserved ? this.reserveNodes.get(id)!.position.clone() : null;
    const result = this.game.pick(id);
    if (!result) return;
    this.recordAction('pick', id);
    this.busy = true;
    this.play('tile');
    this.clearHighlights();
    this.syncBoard();
    this.syncReserve();
    const incoming = this.makeTile(
      this.rack,
      result.tile,
      origin ? origin.x : BOARD_X + result.tile.x,
      origin ? -origin.y : BOARD_Y + result.tile.y,
      reserved ? RESERVE_SCALE : 1,
    );
    incoming.name = `tray-${id}`;
    incoming.angle = id % 2 ? -5 : 5;
    this.trayNodes.set(id, incoming);
    const epoch = this.presentationEpoch;
    if (result.matched.length) this.animateMatch(result, epoch);
    this.moveTrayCards(epoch);
    this.updateHud();
    this.finishPick();
  }
  private moveTrayCards(epoch: number): void {
    this.game!.tray.forEach((id, index) => {
      const n = this.trayNodes.get(id)!;
      const destination = new Vec3(TRAY_X + index * TRAY_STEP, -TRAY_Y + 3, 0);
      Tween.stopAllByTarget(n);
      const distance = Vec3.distance(n.position, destination);
      if (distance < 0.1 && Math.abs(n.scale.x - TRAY_SCALE) < 0.001) {
        n.setPosition(destination);
        this.trayMotions.delete(id);
        return;
      }
      // A later tap can insert before a card that is still flying. Retarget
      // the existing node, keeping its current position and one completion.
      const serial = ++this.motionSerial;
      this.trayMotions.set(id, serial);
      tween(n)
        .to(
          distance > 140 ? 0.22 : 0.12,
          { position: destination, scale: new Vec3(TRAY_SCALE, TRAY_SCALE, 1), angle: 0 },
          { easing: 'cubicOut' },
        )
        .call(() => {
          if (epoch !== this.presentationEpoch || this.trayMotions.get(id) !== serial) return;
          this.trayMotions.delete(id);
          this.finishPick();
        })
        .start();
    });
  }
  private animateMatch(result: PickResult, epoch: number): void {
    const group = ++this.motionSerial;
    const nodes = result.matched.map((id) => this.trayNodes.get(id)!);
    this.clearingGroups.set(group, nodes);
    let remaining = nodes.length;
    nodes.forEach((n, index) => {
      const id = result.matched[index],
        slot = result.displayTray.indexOf(id);
      const x = TRAY_X + slot * TRAY_STEP,
        y = -TRAY_Y + 3;
      Tween.stopAllByTarget(n);
      this.trayMotions.delete(id);
      this.trayNodes.delete(id);
      n.parent = this.effects;
      n.name = `matching-${id}`;
      const fade = P.opacity(n, 255);
      // Cleared groups rise above the rack, leaving the freed slots ready
      // for new taps even while the match effect is finishing.
      tween(n)
        .to(
          0.19,
          { position: new Vec3(x, y, 0), scale: new Vec3(TRAY_SCALE, TRAY_SCALE, 1), angle: 0 },
          { easing: 'quadOut' },
        )
        .call(() => {
          if (epoch !== this.presentationEpoch || index !== 0) return;
          const sameKind = result.matched.every(
            (id) => this.game?.tiles[id].kind === this.game?.tiles[result.matched[0]].kind,
          );
          this.play(
            sameKind ? (result.matched.length >= 4 ? 'match-four' : 'match') : 'match-pairs',
          );
          result.matched.forEach((mid) =>
            this.burst(TRAY_X + result.displayTray.indexOf(mid) * TRAY_STEP, TRAY_Y, 8),
          );
        })
        .to(
          0.09,
          { position: new Vec3(x, y + 9, 0), scale: new Vec3(1.02, 1.02, 1) },
          { easing: 'quadOut' },
        )
        .to(
          0.17,
          {
            position: new Vec3(x, y + 36, 0),
            scale: new Vec3(0.7, 0.7, 1),
            angle: index % 2 ? -7 : 7,
          },
          {
            easing: 'quadIn',
            onUpdate: (_target, ratio = 0) => {
              if (n.isValid) fade.opacity = 255 * (1 - ratio);
            },
          },
        )
        .call(() => {
          if (n.isValid) n.destroy();
          if (epoch !== this.presentationEpoch) return;
          if (--remaining === 0) {
            this.clearingGroups.delete(group);
            this.finishPick();
          }
        })
        .start();
    });
  }
  private finishPick(): void {
    if (this.currentScreen !== 'game' || !this.game) return;
    this.busy = this.boardTransition || this.trayMotions.size > 0 || this.clearingGroups.size > 0;
    this.updateControls();
    if (this.busy || this.resultHandled) return;
    const g = this.game!;
    if (g.status === 'playing') return;
    this.resultHandled = true;
    if (this.online && !this.practice) {
      void this.finishCloud();
      return;
    }
    const epoch = this.presentationEpoch;
    const show = () => {
      if (epoch === this.presentationEpoch && this.game === g && this.currentScreen === 'game')
        this.showResult(g.status === 'won');
    };
    if (g.status === 'won') {
      const progress = this.save.modes[g.mode.id];
      progress.unlocked = 2;
      if (g.level.id === 2) progress.completed = true;
      progress.best = Math.max(progress.best, g.score);
      this.save.coins += g.matches;
      this.persist();
      this.rewardCoins = g.matches;
      if (g.level.id === 1) {
        this.play('stage');
        this.soundscape.speak('next');
        this.toast('第一关通过！马上进入第二关');
        this.scheduleOnce(() => {
          if (epoch === this.presentationEpoch && this.game === g)
            this.startLevel(2, undefined, g.mode.id);
        }, 1);
      } else this.scheduleOnce(show, 0.25);
    } else this.scheduleOnce(show, 0.18);
  }
  private async finishCloud(): Promise<void> {
    const g = this.game!,
      online = this.online!;
    this.networkBusy = true;
    try {
      const result = await online.finish(g.status);
      if (this.game !== g || this.currentScreen !== 'game') return;
      this.rewardCoins = result.rewardCoins;
      if (g.status === 'won' && result.hasNext) {
        this.play('stage');
        this.soundscape.speak('next');
        this.toast(`第 ${g.level.id} 关通过！马上进入下一关`);
        const previous = online.active!.id;
        this.scheduleOnce(() => {
          if (this.game === g) void this.startCloud(g.mode.id, previous);
        }, 1);
      } else this.showResult(g.status === 'won');
    } catch (error) {
      if (this.game === g) {
        if (error instanceof OnlineError && (error.status === 400 || error.status === 409))
          await this.reconcileCloud(error);
        else this.connectionError(error, () => this.finishCloud());
      }
    } finally {
      this.networkBusy = false;
    }
  }
  private undo(): void {
    const removed = new Set(this.game!.tiles.filter((tile) => tile.removed).map((tile) => tile.id));
    if (!this.useTool('undo', () => this.game!.undo())) return;
    this.resultHandled = false;
    this.closeModal();
    this.clearHighlights();
    this.disposeChildren(this.board);
    this.buildBoard();
    this.tileNodes.forEach((node, id) => {
      if (removed.has(id)) P.pop(node);
    });
    this.renderTray();
    this.syncReserve();
    this.updateHud();
    this.updateControls();
    this.toast('已撤回刚才那一步');
  }
  private shovel(): void {
    const g = this.game!,
      moved = g.tray.slice();
    if (!this.useTool('shovel', () => g.shovel())) return;
    this.clearHighlights();
    this.boardTransition = true;
    this.busy = true;
    this.at(this.gameRoot!, 'ReserveArea').active = true;
    const epoch = this.presentationEpoch;
    let pending = moved.length;
    moved.forEach((id) => {
      const n = this.trayNodes.get(id)!;
      this.trayNodes.delete(id);
      this.trayMotions.delete(id);
      n.parent = this.reserveRoot;
      n.name = `reserve-${id}`;
      this.reserveNodes.set(id, n);
      n.on(Node.EventType.TOUCH_END, () => this.pick(id));
      tween(n)
        .to(
          0.32,
          {
            position: new Vec3(TRAY_X + g.reserve.indexOf(id) * TRAY_STEP, -RESERVE_Y),
            scale: new Vec3(RESERVE_SCALE, RESERVE_SCALE, 1),
            angle: 0,
          },
          { easing: 'sineOut' },
        )
        .call(() => {
          if (epoch !== this.presentationEpoch || --pending > 0) return;
          this.boardTransition = false;
          this.syncReserve();
          this.finishPick();
        })
        .start();
    });
    this.updateHud();
    this.updateControls();
    this.toast('已暂存到上方，点击萌宠可放回收纳槽');
  }
  private reshuffle(): void {
    if (this.online && !this.practice) {
      const g = this.game!;
      this.networkBusy = true;
      this.updateControls();
      const apply = async (retry: boolean): Promise<void> => {
        this.networkBusy = true;
        try {
          const state = await (retry ? this.online!.syncState() : this.online!.shuffle());
          if (this.game === g) {
            g.applyCloud(state);
            this.animateShuffle();
          }
        } catch (error) {
          if (this.game === g) {
            if (error instanceof OnlineError && (error.status === 400 || error.status === 409))
              await this.reconcileCloud(error);
            else this.connectionError(error, () => apply(true));
          }
        } finally {
          this.networkBusy = false;
        }
      };
      void apply(false);
      return;
    }
    if (!this.useTool('shuffle', () => this.game!.reshuffle())) {
      this.toast('剩余萌宠无法成组，试试撤回或重新挑战');
      return;
    }
    this.animateShuffle();
  }
  private animateShuffle(): void {
    this.play('shuffle');
    this.clearHighlights();
    const g = this.game!,
      layer = P.layer(this.effects, 'ShuffleAnimation');
    const cards = Array.from(this.tileNodes.entries())
      .concat(Array.from(this.trayNodes.entries()), Array.from(this.reserveNodes.entries()))
      .map(([id, n], i) => {
        n.parent = layer;
        n.off(Node.EventType.TOUCH_END);
        Tween.stopAllByTarget(n);
        const shade = n.getChildByName('Covered');
        if (shade) shade.active = false;
        const start = n.position.clone(),
          startScale = n.scale.x,
          theta = Math.atan2(start.y + 640, start.x - 360);
        const radius = 0.42 + (i % 5) * 0.145;
        const orbit = (angle: number) =>
          new Vec3(360 + Math.cos(angle) * 230 * radius, -640 + Math.sin(angle) * 285 * radius, 0);
        return { id, n, start, startScale, theta, orbit };
      });
    this.resetTrayPresentation();
    this.tileNodes.clear();
    this.at(this.gameRoot!, 'ReserveArea').active = false;
    this.boardTransition = true;
    this.busy = true;
    this.updateHud();
    this.updateControls();
    this.toast('萌宠们转个圈，重新排队！');
    this.burst(BOARD_X, BOARD_Y, 12);
    const epoch = this.presentationEpoch,
      motion = { phase: 0 };
    this.shuffleMotion = motion;
    const draw = () =>
      cards.forEach((card) => {
        const { n, start, theta, orbit, id } = card,
          p = motion.phase;
        if (!n.isValid) return;
        if (p <= 1) {
          n.setPosition(Vec3.lerp(new Vec3(), start, orbit(theta), p));
          const scale = card.startScale + (0.58 - card.startScale) * p;
          n.setScale(scale, scale, 1);
        } else if (p <= 2) {
          n.setPosition(orbit(theta - (p - 1) * Math.PI * 2));
          n.angle = -(p - 1) * 360;
        } else {
          const t = g.tiles[id];
          n.setPosition(
            Vec3.lerp(new Vec3(), orbit(theta), new Vec3(BOARD_X + t.x, -BOARD_Y - t.y), p - 2),
          );
          n.angle = 0;
          const scale = 0.58 + (p - 2) * 0.42;
          n.setScale(scale, scale, 1);
        }
      });
    tween(motion)
      .to(0.24, { phase: 1 }, { easing: 'sineOut', onUpdate: draw })
      .to(0.72, { phase: 2 }, { easing: 'sineInOut', onUpdate: draw })
      .call(() => {
        cards.forEach(({ id, n }) => {
          if (n.isValid)
            n.getChildByName('Pet')!.getComponent(Sprite)!.spriteFrame =
              this.frames[g.tiles[id].kind];
        });
      })
      .to(0.28, { phase: 3 }, { easing: 'sineIn', onUpdate: draw })
      .call(() => {
        if (epoch !== this.presentationEpoch || this.game !== g) return;
        this.shuffleMotion = null;
        this.boardTransition = false;
        this.busy = false;
        layer.active = false;
        layer.destroy();
        this.buildBoard();
        this.renderTray();
        this.syncReserve();
        this.updateHud();
        this.updateControls();
        this.play('tap');
        this.toast('重新排好啦，继续收集小伙伴！');
      })
      .start();
  }
  private useTool(tool: ToolId, action: () => boolean): boolean {
    const g = this.game!,
      key = `${tool}Left` as 'undoLeft' | 'shovelLeft' | 'shuffleLeft' | 'hintLeft';
    const fromBag = g[key] === 0;
    if (fromBag) {
      if (this.save.bag[tool] === 0) return false;
      g[key]++;
    }
    const used = action();
    if (fromBag) {
      if (used) {
        this.save.bag[tool]--;
        this.persist();
      } else g[key]--;
    }
    if (used) {
      this.recordAction(tool);
      if (tool !== 'shuffle') this.play(tool);
    }
    return used;
  }
  private highlight(ids: number[], timed = true): void {
    this.clearHighlights();
    ids.forEach((id) => {
      const n = this.tileNodes.get(id) || this.reserveNodes.get(id);
      if (!n) return;
      const glow = P.rounded(
        n,
        'HintGlow',
        0,
        -4,
        TILE_W + 5,
        TILE_H - 2,
        '#F4DA94',
        19,
        '#DDAE47',
        24,
      );
      const alpha = P.opacity(glow, 255);
      tween(alpha)
        .repeatForever(
          tween()
            .to(0.75, { opacity: 130 }, { easing: 'sineInOut' })
            .to(0.75, { opacity: 255 }, { easing: 'sineInOut' }),
        )
        .start();
    });
    if (timed) this.scheduleOnce(() => this.clearHighlights(), 4);
  }
  private clearHighlights(): void {
    const clear = (n: Node) => {
      const glow = n.getChildByName('HintGlow');
      if (glow) {
        const alpha = glow.getComponent(UIOpacity);
        if (alpha) Tween.stopAllByTarget(alpha);
        glow.active = false;
        glow.destroy();
      }
    };
    this.tileNodes.forEach(clear);
    this.reserveNodes.forEach(clear);
  }
  private burst(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * (0.15 + (0.7 * i) / Math.max(1, count - 1)),
        distance = 28 + (i % 3) * 15;
      const n =
        i % 3
          ? P.leaf(this.effects, x, y, 7 + (i % 4), ['#93A85A', '#B9BE71', '#D5AE60'][i % 3])
          : P.rounded(this.effects, 'WoodChip', x, y, 8, 5, '#D8AD6D', 2);
      const fade = P.opacity(n, 255);
      tween(n)
        .to(
          0.2,
          {
            position: new Vec3(x + Math.cos(angle) * distance, -y + Math.sin(angle) * distance, 0),
            angle: i % 2 ? 32 : -32,
          },
          { easing: 'quadOut' },
        )
        .to(
          0.42,
          {
            position: new Vec3(x + Math.cos(angle) * distance + (i % 2 ? 12 : -12), -y + 12, 0),
            scale: new Vec3(0.45, 0.45, 1),
            angle: i % 2 ? 85 : -75,
          },
          {
            easing: 'sineIn',
            onUpdate: (_target, ratio = 0) => {
              if (n.isValid) fade.opacity = 255 * (1 - ratio);
            },
          },
        )
        .call(() => n.destroy())
        .start();
    }
  }
  private closeModal(afterClose?: () => void): void {
    this.disposeProfileDialog();
    this.modals.close(afterClose);
  }
  private disposeProfileDialog(): void {
    this.profileDialog?.dispose();
    this.profileDialog = null;
  }
  private dialog(name: string, title: string, height = 900): Node {
    this.disposeProfileDialog();
    const m = this.modals.show(name);
    this.toasts.bringToFront();
    const width = 626,
      top = 780 - height / 2,
      headerHeight = 82;
    const headerY = top + MODAL_INSET + headerHeight / 2;
    P.skin(m, 'Panel', 'panel', 360, 780, width, height);
    P.skin(m, 'Banner', 'button-blue', 360, headerY, width - MODAL_INSET * 2, headerHeight);
    P.text(
      m,
      'Title',
      title,
      360,
      headerY - 5,
      33,
      C.white,
      width - MODAL_INSET * 2 - 24,
      true,
      'center',
      3,
    );
    P.button(
      m,
      'Close',
      '×',
      639,
      top + 30,
      68,
      72,
      () => {
        this.play('tap');
        this.closeModal();
      },
      true,
      46,
      'round-blue',
    );
    return m;
  }
  private showMenu(): void {
    this.disposeProfileDialog();
    const m = this.modals.show('HomeMenu', 155, 199, 324.5);
    this.toasts.bringToFront();
    const shade = m.getChildByName('Backdrop')!;
    shade.on(Node.EventType.TOUCH_END, () => this.closeModal());
    P.skin(m, 'MenuPanel', 'panel', 199, 324.5, 312, 414).addComponent(BlockInputEvents);
    [
      ['PersonalSettings', '个人设置'],
      ['SystemSettings', '系统设置'],
      ['CustomerService', '联系客服'],
      ['Announcements', '更新公告'],
    ].forEach(([name, label], i) => {
      const b = P.button(
        m,
        name,
        '',
        199,
        200 + i * 83,
        312 - MODAL_INSET * 2,
        76,
        () => {
          this.play('tap');
          if (i === 0) this.showPersonalSettings();
          else if (i === 1) this.showSettings();
          else if (i === 2) this.showCustomerService();
          else this.showAnnouncements();
        },
        true,
      );
      P.sprite(
        b,
        'MenuIcon',
        [this.frames[3], this.utilityFrames[1], ...this.menuFrames][i],
        -77,
        -5,
        52,
        52,
      );
      P.text(b, 'Label', label, 25, -5, 27, C.white, 152, true, 'center', 2);
    });
  }
  private showPersonalSettings(): void {
    const modal = this.dialog('PersonalSettings', '个人设置', 1010);
    this.profileDialog = modal.addComponent(PlayerProfileDialog);
    this.profileDialog.configure(
      typeof wx === 'undefined' ? null : this.online,
      this.frames[3],
      (message) => this.toast(message),
    );
  }
  private showRules(tutorial = true): void {
    const g = this.game!;
    const m = this.dialog('Rules', '本关消除规则', 1110);
    m.getChildByName('Close')!.active = !tutorial;
    P.text(m, 'Intro', '第 ' + g.level.id + ' 关 · 按顺序优先匹配', 360, 386, 25, C.ink, 560, true);
    const compact = g.rules.length > 3;
    g.rules.forEach((pattern, index) => {
      const y = compact
        ? 465 + index * 98
        : g.rules.length === 3
          ? 480 + index * 155
          : 500 + index * 175;
      P.text(
        m,
        'Rule-' + index,
        index + 1 + '. ' + ruleDescription(pattern),
        360,
        y - 36,
        compact ? 22 : 25,
        C.deep,
        530,
        true,
      );
      const kinds = pattern.flatMap((amount, kind) => Array<number>(amount).fill(kind));
      const scale = compact ? 0.48 : 0.62;
      kinds.forEach((kind, i) =>
        this.makeTile(
          m,
          { id: i, kind, x: 0, y: 0, layer: 0, removed: false },
          360 + (i - (kinds.length - 1) / 2) * (compact ? 53 : 66),
          y + 12,
          scale,
        ),
      );
    });
    if (g.rules.length === 1) P.sprite(m, 'TutorialPet', this.frames[3], 360, 744, 128, 128);
    const noteY = compact ? 1055 : 952;
    [
      '点击亮色萌宠，放入下方 7 格收纳槽',
      '组合不要求相邻；加号两侧必须是不同种类',
      '清空棋盘与槽位通关，满槽无法消除则失败',
    ].forEach((line, i) => P.text(m, 'RuleLine' + i, line, 360, noteY + i * 39, 21, C.ink, 540));
    P.button(
      m,
      'Understood',
      tutorial ? '明白了，开始游戏！' : '继续游戏',
      360,
      1203,
      510,
      94,
      () => {
        this.closeModal();
        if (tutorial) {
          this.soundscape.speak('start');
          const charges = g.hintLeft,
            ids = g.hint();
          g.hintLeft = charges;
          if (ids.length) this.highlight(ids, false);
        }
      },
      true,
      29,
    );
  }
  private showSignIn(): void {
    const m = this.dialog('SignIn', '7日签到', 1110),
      today = localDateKey();
    const claimed = this.save.signedOn >= today,
      count = this.save.signInCount;
    const day = (count - (claimed && count > 0 ? 1 : 0)) % 7;
    P.text(m, 'Subtitle', '每天来看看，领取萌宠金币和道具', 360, 390, 25, C.ink, 560, true);
    SIGN_IN_REWARDS.forEach((reward, i) => {
      const x = i < 4 ? 144 + i * 144 : 216 + (i - 4) * 144,
        y = i < 4 ? 568 : 808;
      const done = i < day || (claimed && i === day),
        current = !claimed && i === day;
      P.rounded(
        m,
        `Day${i + 1}`,
        x,
        y,
        131,
        205,
        current ? '#F8E2AE' : done ? '#E1E8CD' : '#F1E4C9',
        20,
        current ? '#C39442' : '#D2B98C',
      );
      P.text(m, `DayLabel${i}`, `第 ${i + 1} 天`, x, y - 72, 22, C.deep, 120, true);
      P.sprite(m, `DayCoin${i}`, this.homeFrames[0], x, y - 20, 70, 70);
      P.text(m, `CoinReward${i}`, `+${reward.coins} 金币`, x, y + 30, 20, '#AE6A1E', 122, true);
      P.text(
        m,
        `ToolReward${i}`,
        `${TOOL_INFO.find((t) => t.id === reward.tool)!.name} ×${reward.count}`,
        x,
        y + 67,
        20,
        C.muted,
        122,
      );
      if (done) P.text(m, `Claimed${i}`, '已领取', x, y + 104, 18, '#238867', 126, true);
    });
    P.text(m, 'SignInNote', '累计签到满 7 天后开启下一轮，中断不重置', 360, 1005, 21, C.muted, 570);
    P.text(m, 'Balance', `我的萌宠金币：${this.save.coins}`, 360, 1070, 26, '#B47C23', 560, true);
    P.button(
      m,
      'ClaimSignIn',
      claimed ? '今日已领 · 明天再来' : `领取第 ${day + 1} 天奖励`,
      360,
      1203,
      510,
      94,
      () => {
        if (this.online && !this.practice) {
          if (this.networkBusy) return;
          this.networkBusy = true;
          void this.online
            .signIn()
            .then(() => {
              this.showSignIn();
              this.play('reward');
            })
            .catch((error) => this.toast(error instanceof Error ? error.message : '签到暂未完成'))
            .finally(() => {
              this.networkBusy = false;
            });
          return;
        }
        if (claimSignIn(this.save)) {
          this.persist();
          this.refreshHome();
          this.play('reward');
          this.showSignIn();
          this.toast('金币和道具已经放进背包啦！');
        } else this.toast('今天已经领取过啦，明天再来！');
      },
      !claimed,
      27,
    );
  }
  private showBag(): void {
    const m = this.dialog('Bag', '背包道具', 1110);
    P.text(m, 'BagIntro', '签到获得的道具，三种玩法都能用', 360, 390, 24, C.ink, 560, true);
    TOOL_INFO.forEach((tool, i) => {
      const y = 500 + i * 158;
      P.rounded(m, `Bag-${tool.id}`, 360, y, 534, 135, '#F1E5CE', 23, '#D3BB91');
      P.sprite(m, 'ToolIcon', this.utilityFrames[tool.icon], 167, y, 101, 101);
      P.text(
        m,
        'ToolName',
        `${tool.name}  ×${this.save.bag[tool.id]}`,
        421,
        y - 30,
        30,
        C.deep,
        355,
        true,
        'left',
      );
      P.text(m, 'ToolDetail', tool.detail, 421, y + 25, 18, C.muted, 355, false, 'left');
    });
    P.text(
      m,
      'FreeTools',
      this.online && !this.practice
        ? '每关免费次数以当前关卡配置为准'
        : '每局免费：撤回 ×1、铲出 ×1、提示 ×3、重排 ×1',
      360,
      1075,
      21,
      C.ink,
      560,
      true,
    );
    P.text(m, 'BagUsage', '免费次数用完后，继续点击会消耗背包道具', 360, 1110, 20, C.muted, 570);
    P.button(m, 'BagDone', '知道啦', 360, 1210, 480, 86, () => this.closeModal(), true, 29);
  }
  private showCustomerService(): void {
    if (this.modal) {
      this.closeModal(() => this.showCustomerService());
      return;
    }
    if (typeof wx !== 'undefined' && typeof wx.openCustomerServiceConversation === 'function') {
      try {
        wx.openCustomerServiceConversation({
          sessionFrom: 'home-menu',
          showMessageCard: false,
          fail: () => this.customerServiceFallback(true),
        });
      } catch {
        this.customerServiceFallback(true);
      }
    } else this.customerServiceFallback(false);
  }
  private customerServiceFallback(unavailable: boolean): void {
    if (!this.isValid) return;
    const m = this.dialog('CustomerService', '联系客服', 620);
    P.sprite(m, 'SupportHeadset', this.menuFrames[0], 360, 683, 140, 140);
    P.text(
      m,
      'ContactDescription',
      unavailable ? '客服暂时未能连接，请稍后再试' : '请在微信小游戏中点击「联系客服」',
      360,
      805,
      24,
      C.ink,
      555,
      true,
    );
    P.text(
      m,
      'ContactHint',
      '遇到问题时，可以说明玩法、关卡和具体情况',
      360,
      862,
      20,
      C.muted,
      555,
    );
    P.button(m, 'ContactDone', '知道啦', 360, 982, 460, 84, () => this.closeModal(), true, 28);
  }
  private showAnnouncements(): void {
    const m = this.dialog('Announcements', '更新公告', 930);
    P.sprite(m, 'AnnouncementHorn', this.menuFrames[1], 152, 476, 80, 80);
    P.text(m, 'Version', '快乐萌宠消 · 森林木作', 405, 467, 26, C.deep, 402, true);
    const rows = [
      ['三种玩法，一起开玩', '经典三消、极限四消、趣味规则消现已开放'],
      ['一口气，连闯两关', '从第一关直接开始，过关后自动进入第二关'],
      ['森林木作，新装登场', '十二生肖和猫、熊猫、狮子，变身木雕小伙伴'],
      ['四种道具，帮你过关', '撤回、铲出、提示和顺时针转动重排'],
    ];
    rows.forEach(([title, detail], i) => {
      const y = 580 + i * 130;
      P.rounded(m, 'NewsCard', 360, y + 18, 528, 110, '#F1E5CC', 18, '#D3BC93');
      P.text(m, 'NewsTitle', title, 360, y - 5, 26, C.ink, 478, true, 'left');
      P.text(m, 'NewsDetail', detail, 360, y + 38, 19, C.muted, 478, false, 'left');
    });
    P.button(m, 'NewsDone', '开始新的冒险', 360, 1152, 470, 88, () => this.closeModal(), true, 28);
  }
  private showAlbum(): void {
    const m = this.dialog('Album', '萌宠图鉴', 1110);
    for (let i = 0; i < this.frames.length; i++) {
      const x = 180 + (i % 3) * 180,
        y = 435 + Math.floor(i / 3) * 160;
      const card = P.skin(m, `PetCard${i}`, 'tile', x, y, 105, 110);
      P.sprite(card, `Pet${i}`, this.frames[i], 0, tileFaceCenterY(110), 92, 92);
      P.text(m, `PetName${i}`, KIND_NAMES[i], x, y + 69, 22, C.deep, 166, true);
    }
    P.button(m, 'AlbumDone', '都好可爱！', 360, 1240, 456, 88, () => this.closeModal(), true, 28);
  }
  private toggleSound(): void {
    this.save.sound = !this.save.sound;
    this.persist();
    this.soundscape.syncEnabled();
    if (this.save.sound) this.play('tap');
  }
  private showSettings(): void {
    const inGame = this.currentScreen === 'game';
    const m = this.dialog('Settings', '系统设置', inGame ? 840 : 690);
    P.sprite(m, 'Gear', this.utilityFrames[1], 360, inGame ? 635 : 665, 140, 140);
    P.text(
      m,
      'SettingsDescription',
      '温柔的木琴，陪萌宠一起出发',
      360,
      inGame ? 752 : 782,
      23,
      C.ink,
      550,
      true,
    );
    const b = P.button(
      m,
      'SoundToggle',
      this.save.sound ? '音乐、音效与语音：开启' : '音乐、音效与语音：关闭',
      360,
      inGame ? 858 : 888,
      480,
      92,
      () => {
        this.toggleSound();
        b.children.find((n) => !!n.getComponent(Label))!.getComponent(Label)!.string = this.save
          .sound
          ? '音乐、音效与语音：开启'
          : '音乐、音效与语音：关闭';
      },
      true,
      27,
    );
    P.button(
      m,
      'SettingsDone',
      '知道啦',
      360,
      inGame ? 970 : 1004,
      480,
      82,
      () => this.closeModal(),
      false,
      27,
    );
    if (inGame)
      P.button(
        m,
        'SettingsHome',
        '返回主页',
        360,
        1080,
        480,
        82,
        () => {
          this.play('tap');
          this.home();
        },
        false,
        27,
      );
  }
  private showPause(): void {
    const m = this.dialog('Pause', '休息一下', 790);
    P.sprite(m, 'Bunny', this.frames[3], 360, 613, 150, 150);
    P.text(m, 'PauseDescription', '小伙伴们会乖乖等你回来', 360, 740, 27, C.ink, 540, true);
    P.button(m, 'Continue', '继续游戏', 360, 850, 470, 90, () => this.closeModal(), true, 30);
    P.button(
      m,
      'Restart',
      this.selectedEntry === 'campaign' && !this.practice ? '重新挑战当前关' : '从第一关重新开始',
      360,
      962,
      470,
      84,
      () => this.startLevel(1),
      false,
      27,
    );
    P.button(m, 'PauseHome', '返回主页', 360, 1070, 470, 84, () => this.home(), false, 27);
  }
  private showResult(won: boolean): void {
    const g = this.game!;
    const campaign = this.selectedEntry === 'campaign' && !this.practice;
    this.play(won ? 'win' : 'lose');
    this.soundscape.speak(won ? 'win' : 'lose');
    const m = this.dialog(won ? 'Victory' : 'TryAgain', won ? '闯关成功！' : '就差一点点！', 960);
    m.getChildByName('Close')!.active = false;
    const resultPet = P.sprite(
      m,
      'ResultPet',
      won ? this.utilityFrames[0] : this.frames[3],
      360,
      545,
      168,
      168,
    );
    if (won)
      tween(resultPet)
        .to(
          0.18,
          { position: new Vec3(360, -537), scale: new Vec3(1.04, 1.04, 1) },
          { easing: 'quadOut' },
        )
        .to(
          0.22,
          { position: new Vec3(360, -545), scale: new Vec3(1, 1, 1) },
          { easing: 'sineInOut' },
        )
        .start();
    else
      tween(resultPet)
        .to(0.12, { angle: -4 })
        .to(0.24, { angle: 4 })
        .to(0.12, { angle: 0 })
        .start();
    P.text(
      m,
      'ResultTitle',
      won
        ? g.level.id === 1
          ? '这一关，轻松拿下！'
          : '小可爱们都到家啦！'
        : g.stranded
          ? '剩余萌宠无法成组'
          : '收纳槽装满啦',
      360,
      695,
      34,
      C.deep,
      570,
      true,
    );
    P.text(
      m,
      'ResultSubtitle',
      won
        ? campaign
          ? '当前已开放关卡全部完成，进度已保存'
          : `${g.mode.title}挑战完成，试试其他玩法吧！`
        : '优先凑齐槽里已有的萌宠，再收新种类。',
      360,
      753,
      22,
      C.muted,
      570,
    );
    P.rounded(m, 'StatsPanel', 360, 860, 522, 125, '#F1E5CE', 22, '#D3BB91');
    const seconds = Math.floor(this.playTime),
      stats = [
        ['消除方块', String(g.cleared)],
        ['消除组数', String(g.matches)],
        ['本次用时', `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`],
      ];
    stats.forEach(([name, value], i) => {
      P.text(m, 'StatName', name, 186 + i * 174, 829, 20, C.muted, 160, true);
      P.text(m, 'StatValue', value, 186 + i * 174, 880, 34, C.deep, 160, true);
    });
    if (won)
      P.text(
        m,
        'CoinReward',
        this.rewardCoins ? `萌宠金币 +${this.rewardCoins}` : '本关首次通关奖励已领取',
        360,
        944,
        23,
        '#B87C1E',
        540,
        true,
      );
    P.button(
      m,
      'ResultPrimary',
      campaign ? (won ? '返回主页' : '重试 · 当前关') : '重新开始 · 第一关',
      360,
      1020,
      510,
      98,
      () => (campaign && won ? this.home() : this.startLevel(1, undefined, g.mode.id)),
      true,
      30,
    );
    if (!(campaign && won))
      P.button(m, 'ResultHome', '返回主页', 360, 1140, 510, 88, () => this.home(), false, 28);
    if (won)
      for (let i = 0; i < 16; i++) {
        const x = 110 + ((i * 89) % 500),
          y = 420 + ((i * 47) % 200);
        const n = P.leaf(m, x, y, 8 + (i % 5), ['#90A85A', '#B7BD70', '#D8B562'][i % 3]);
        const fade = P.opacity(n, 230);
        tween(n)
          .to(
            1.8 + (i % 3) * 0.3,
            {
              position: new Vec3(x + (i % 2 ? 16 : -16), -y - 300, 0),
              angle: i % 2 ? 180 : -180,
            },
            {
              easing: 'sineInOut',
              onUpdate: (_target, ratio = 0) => {
                if (n.isValid) fade.opacity = 230 * (1 - ratio);
              },
            },
          )
          .call(() => n.destroy())
          .start();
      }
  }
  private toast(message: string): void {
    this.toasts.show(message);
    this.levelTransition.bringToFront();
  }
  onDestroy(): void {
    this.disposeProfileDialog();
    this.toasts?.reset();
    this.levelTransition?.reset();
    this.online?.detach();
    this.modals?.reset();
    this.clearHighlights();
    this.unscheduleAllCallbacks();
  }
}
