import {
  _decorator,
  AudioClip,
  AudioSource,
  BlockInputEvents,
  Button,
  Canvas,
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
} from './ui/Layout';
import * as P from './ui/Paint';
import { OnlineClient, OnlineError, CloudAssets, CloudSession, EntryId } from './core/OnlineClient';

const { ccclass, property } = _decorator;
const C = P.PALETTE;
const SAVE_KEY = 'star-isle-v1';
const TOOL_INFO: { id: ToolId; name: string; icon: number; detail: string }[] = [
  { id: 'undo', name: '撤回', icon: 2, detail: '收回上一步，恢复消除前的萌宠' },
  { id: 'shovel', name: '铲出', icon: 5, detail: '槽内萌宠移到上方，点击可放回' },
  { id: 'hint', name: '提示', icon: 4, detail: '点亮可以优先收集的小伙伴' },
  { id: 'shuffle', name: '重排', icon: 3, detail: '所有剩余方块转一圈，重新落位' },
];
declare const wx:
  | undefined
  | {
      openCustomerServiceConversation?: (options: {
        sessionFrom: string;
        showMessageCard: boolean;
        fail: () => void;
      }) => void;
    };

@ccclass('StarIsle')
export class StarIsle extends Component {
  @property(Node) public stageRoot: Node | null = null;
  @property(Node) public homeRoot: Node | null = null;
  @property(Node) public gameRoot: Node | null = null;
  @property([SpriteFrame]) public petFrames: SpriteFrame[] = [];
  @property([SpriteFrame]) public utilityFrames: SpriteFrame[] = [];
  @property([SpriteFrame]) public skinFrames: SpriteFrame[] = [];
  @property([SpriteFrame]) public homeFrames: SpriteFrame[] = [];
  private stage!: Node;
  private screen!: Node;
  private effects!: Node;
  private board!: Node;
  private rack!: Node;
  private reserveRoot!: Node;
  private modal: Node | null = null;
  private toastNode: Node | null = null;
  private tileNodes = new Map<number, Node>();
  private trayNodes = new Map<number, Node>();
  private reserveNodes = new Map<number, Node>();
  private trayMotions = new Map<number, number>();
  private clearingGroups = new Map<number, Node[]>();
  private presentationEpoch = 0;
  private motionSerial = 0;
  private resultHandled = false;
  private frames: SpriteFrame[] = [];
  private clips = new Map<string, AudioClip>();
  private audio!: AudioSource;
  private music!: AudioSource;
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
      this.utilityFrames.length !== 6
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
    this.stage = this.stageRoot;
    this.frames = this.petFrames.slice();
    P.configureSkin(this.skinFrames);
    this.audio = this.node.addComponent(AudioSource);
    const cameraNode = this.stage.parent!.getComponent(Canvas)!.cameraComponent!.node;
    this.music = cameraNode.addComponent(AudioSource);
    this.music.loop = true;
    this.music.volume = 0.2;
    this.home();
    resources.load('online', JsonAsset, (error, asset) => {
      const address =
        !error && typeof asset?.json?.apiBaseUrl === 'string'
          ? asset.json.apiBaseUrl.replace(/\/$/, '')
          : '';
      this.onlineReady = true;
      if (address) {
        this.online = new OnlineClient(address, sys.localStorage);
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
      }
    });
    for (const name of ['tap', 'match', 'win', 'lose', 'music']) {
      resources.load(`audio/${name}`, AudioClip, (error, clip) => {
        if (!error && this.isValid) {
          this.clips.set(name, clip);
          if (name === 'music' && this.currentScreen === 'game') this.startMusic();
        }
      });
    }
  }
  update(dt: number): void {
    if (this.currentScreen === 'game' && this.game?.status === 'playing' && !this.modal)
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
    const clip = this.clips.get(name);
    if (clip && this.save.sound) this.audio.playOneShot(clip, name === 'tap' ? 0.3 : 0.6);
  }
  private startMusic(): void {
    const clip = this.clips.get('music');
    if (clip && this.save.sound && !this.music.playing) {
      this.music.clip = clip;
      this.music.play();
    }
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
    this.unscheduleAllCallbacks();
    this.clearHighlights();
    this.closeModal();
    this.resetTrayPresentation();
    this.stage.children.slice().forEach((n) => {
      if (n !== this.homeRoot && n !== this.gameRoot) {
        n.active = false;
        n.destroy();
      }
    });
    this.toastNode = null;
    this.tileNodes.clear();
    this.homeRoot!.active = name === 'home';
    this.gameRoot!.active = name === 'game';
    this.screen = name === 'home' ? this.homeRoot! : this.gameRoot!;
    this.currentScreen = name;
    this.resultHandled = false;
    this.effects = P.layer(this.stage, 'Effects');
  }
  private home(): void {
    if (this.online?.active && !this.practice && this.game?.status === 'playing') {
      void this.online.finish('abandoned').catch(() => {
        if (this.isValid) this.toast('退出记录已暂存，联网后会继续同步');
      });
    }
    this.online?.detach();
    this.clearScreen('home');
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
    this.play('tap');
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
      } else this.toast('先试试撤回或重排，给口袋腾个位置');
    }
  }
  private startLevel(id: number, seed?: number, mode: ModeId = this.selectedMode): void {
    if (this.online && !this.practice) {
      void this.startCloud(mode);
      return;
    }
    this.selectedMode = mode;
    this.mountLevel(new MatchGame(id, seed, mode), id === 1);
  }
  private mountLevel(game: MatchGame, rules: boolean): void {
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
      game.mode.id === 'fun' ? '3 个相同 / 两对不同萌宠' : `收集 ${game.mode.matchSize} 个相同萌宠`,
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
    P.text(m, 'Intro', '选择玩法，从第一关连续出发', 360, 420, 25, C.ink, 550, true);
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
      this.online ? '一关接一关，挑战更多萌宠棋盘' : '闯关关卡准备中 · 首页玩法可直接体验',
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
    const m = this.dialog('Connecting', '准备萌宠冒险', 520);
    m.getChildByName('Close')!.active = false;
    P.text(m, 'ConnectingText', '正在连接，准备这次的关卡…', 360, 790, 24, C.ink, 540, true);
    try {
      if (this.online.active && this.game?.status === 'playing')
        await this.online.finish('abandoned');
      const session: CloudSession = await this.online.start(mode, previous, this.selectedEntry);
      this.mountLevel(MatchGame.fromCloud(session), !previous);
    } catch (error) {
      if (
        error instanceof OnlineError &&
        (error.status === 400 || error.status === 409) &&
        this.online.active &&
        this.game
      )
        await this.reconcileCloud(error);
      else this.connectionError(error, () => this.startCloud(mode, previous));
    } finally {
      this.networkBusy = false;
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
      const available = enabled && left > 0 && !this.busy && g.status === 'playing';
      n.getComponent(Button)!.interactable = available;
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
    P.sprite(n, 'Pet', this.frames[tile.kind], 0, -9, 81, 81);
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
    this.play('tap');
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
          distance > 140 ? 0.18 : 0.1,
          { position: destination, scale: new Vec3(TRAY_SCALE, TRAY_SCALE, 1) },
          { easing: 'quadOut' },
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
      // Cleared groups rise above the rack, leaving the freed slots ready
      // for new taps even while the match effect is finishing.
      tween(n)
        .to(
          0.16,
          { position: new Vec3(x, y, 0), scale: new Vec3(TRAY_SCALE, TRAY_SCALE, 1) },
          { easing: 'quadOut' },
        )
        .call(() => {
          if (epoch !== this.presentationEpoch || index !== 0) return;
          this.play('match');
          result.matched.forEach((mid) =>
            this.burst(TRAY_X + result.displayTray.indexOf(mid) * TRAY_STEP, TRAY_Y, 8),
          );
        })
        .to(0.07, { position: new Vec3(x, y + 14, 0), scale: new Vec3(1, 1, 1) })
        .to(0.11, { position: new Vec3(x, y + 60, 0), scale: new Vec3(0.01, 0.01, 1) })
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
        this.play('win');
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
        this.play('win');
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
    if (!this.useTool('undo', () => this.game!.undo())) return;
    this.resultHandled = false;
    this.closeModal();
    this.clearHighlights();
    this.disposeChildren(this.board);
    this.buildBoard();
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
          0.28,
          {
            position: new Vec3(TRAY_X + g.reserve.indexOf(id) * TRAY_STEP, -RESERVE_Y),
            scale: new Vec3(RESERVE_SCALE, RESERVE_SCALE, 1),
          },
          { easing: 'quadOut' },
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
      .to(0.2, { phase: 1 }, { onUpdate: draw })
      .to(0.68, { phase: 2 }, { onUpdate: draw })
      .call(() => {
        cards.forEach(({ id, n }) => {
          if (n.isValid)
            n.getChildByName('Pet')!.getComponent(Sprite)!.spriteFrame =
              this.frames[g.tiles[id].kind];
        });
      })
      .to(0.25, { phase: 3 }, { onUpdate: draw })
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
    if (used) this.recordAction(tool);
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
        '#FFEF70',
        19,
        '#F5C62A',
        56,
      );
      const alpha = P.opacity(glow, 255);
      tween(alpha)
        .repeatForever(tween().to(0.55, { opacity: 80 }).to(0.55, { opacity: 255 }))
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
      const angle = (Math.PI * 2 * i) / count,
        distance = 30 + (i % 3) * 20;
      const n = P.star(this.effects, x, y, 7 + (i % 3), [C.gold, C.pink, '#A4F184'][i % 3]);
      tween(n)
        .to(0.5, {
          position: new Vec3(x + Math.cos(angle) * distance, -y + Math.sin(angle) * distance, 0),
          scale: new Vec3(0.1, 0.1, 1),
        })
        .call(() => n.destroy())
        .start();
    }
  }
  private closeModal(): void {
    if (this.modal?.isValid) {
      this.modal.active = false;
      this.modal.destroy();
    }
    this.modal = null;
  }
  private dialog(name: string, title: string, height = 900): Node {
    this.closeModal();
    const m = P.layer(this.stage, name);
    this.modal = m;
    P.rounded(
      m,
      'Backdrop',
      360,
      HEIGHT / 2,
      WIDTH,
      HEIGHT,
      '#251F15',
      0,
      undefined,
      162,
    ).addComponent(BlockInputEvents);
    P.skin(m, 'Panel', 'panel', 360, 780, 626, height);
    P.skin(m, 'Banner', 'button-blue', 360, 780 - height / 2 + 65, 545, 88);
    P.text(m, 'Title', title, 360, 780 - height / 2 + 58, 33, C.white, 490, true, 'center', 3);
    P.button(
      m,
      'Close',
      '×',
      640,
      780 - height / 2 + 25,
      58,
      62,
      () => {
        this.play('tap');
        this.closeModal();
      },
      true,
      38,
      'round-blue',
    );
    return m;
  }
  private showMenu(): void {
    this.closeModal();
    const m = P.layer(this.stage, 'HomeMenu');
    this.modal = m;
    const shade = P.rounded(
      m,
      'Backdrop',
      360,
      HEIGHT / 2,
      WIDTH,
      HEIGHT,
      '#251F15',
      0,
      undefined,
      155,
    );
    shade.addComponent(BlockInputEvents);
    shade.on(Node.EventType.TOUCH_END, () => this.closeModal());
    P.skin(m, 'MenuPanel', 'panel', 199, 283, 312, 330).addComponent(BlockInputEvents);
    [
      ['SystemSettings', '系统设置'],
      ['CustomerService', '联系客服'],
      ['Announcements', '更新公告'],
    ].forEach(([name, label], i) => {
      const b = P.button(
        m,
        name,
        '',
        199,
        178 + i * 102,
        282,
        84,
        () => {
          this.play('tap');
          if (i === 0) this.showSettings();
          else if (i === 1) this.showCustomerService();
          else this.showAnnouncements();
        },
        true,
      );
      if (i === 0) P.sprite(b, 'Gear', this.utilityFrames[1], -99, -5, 47, 47);
      else P.icon(b, i === 1 ? 'contact' : 'sound', -99, -4, 23, C.white);
      P.text(b, 'Label', label, 23, -5, 29, C.white, 205, true, 'center', 2);
    });
  }
  private showRules(): void {
    const g = this.game!,
      mode = g.mode,
      fun = mode.id === 'fun';
    const m = this.dialog('Rules', `${mode.title} · 规则`, 1110);
    m.getChildByName('Close')!.active = false;
    P.text(m, 'Intro', '第一关 · 先认识一下消除方法', 360, 386, 25, C.ink, 560, true);
    const example = (kinds: number[], y: number) =>
      kinds.forEach((kind, i) =>
        this.makeTile(
          m,
          { id: i, kind, x: 0, y: 0, layer: 0, removed: false },
          360 + (i - (kinds.length - 1) / 2) * 105,
          y,
          0.88,
        ),
      );
    example(Array(mode.matchSize).fill(0), 491);
    P.text(
      m,
      'SameRule',
      mode.id === 'quartet' ? '四个相同才消除，三个还不够哦' : '三个相同，自动消除',
      360,
      569,
      26,
      C.deep,
      550,
      true,
    );
    if (fun) {
      example([1, 1, 2, 2], 671);
      P.text(m, 'PairRule', '两种不同萌宠各两个，也能一起消除', 360, 750, 25, C.deep, 555, true);
    } else {
      P.sprite(m, 'TutorialPet', this.frames[3], 360, 706, 125, 125);
      P.text(m, 'NoAdjacency', '不用排成一行，也不需要相邻', 360, 803, 24, C.muted, 550);
    }
    const lines = fun
      ? [
          '点击亮色萌宠，进入下方 7 格收纳槽',
          '先判断三消；两对消除必须是不同种类',
          '棋盘和槽位都清空才算通关',
          '满槽或最后剩下无法成组的萌宠，会失败',
        ]
      : [
          '点击亮色萌宠，被覆盖的暂时不能点',
          '收纳槽共 7 格，满槽且不能消除就失败',
          '棋盘和收纳槽都清空，继续挑战下一关',
        ];
    lines.forEach((line, i) =>
      P.text(m, `RuleLine${i}`, line, 360, (fun ? 844 : 886) + i * 59, 22, C.ink, 550),
    );
    P.button(
      m,
      'Understood',
      '明白了，开始游戏！',
      360,
      1203,
      510,
      94,
      () => {
        this.closeModal();
        const charges = g.hintLeft,
          ids = g.hint();
        g.hintLeft = charges;
        if (ids.length) this.highlight(ids, false);
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
              this.play('win');
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
          this.play('win');
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
    this.closeModal();
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
    P.icon(m, 'contact', 360, 683, 65, C.deep);
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
    P.text(m, 'Version', '快乐萌宠消 · 森林木作', 360, 467, 27, C.deep, 555, true);
    const rows = [
      ['三种玩法，一起开玩', '经典三消、极限四消、趣味规则消现已开放'],
      ['一口气，连闯两关', '从第一关直接开始，过关后自动进入第二关'],
      ['森林木作，新装登场', '十二生肖和猫、熊猫、狮子，变身木雕小伙伴'],
      ['四种道具，帮你过关', '撤回、铲出、提示和顺时针转动重排'],
    ];
    rows.forEach(([title, detail], i) => {
      const y = 580 + i * 130;
      P.text(m, 'NewsTitle', title, 360, y, 27, C.ink, 540, true);
      P.text(m, 'NewsDetail', detail, 360, y + 45, 20, C.muted, 550);
    });
    P.button(m, 'NewsDone', '开始新的冒险', 360, 1152, 470, 88, () => this.closeModal(), true, 28);
  }
  private showAlbum(): void {
    const m = this.dialog('Album', '萌宠图鉴', 1110);
    P.text(m, 'Subtitle', '十二生肖 + 猫、熊猫、狮子', 360, 382, 24, C.ink, 560, true);
    for (let i = 0; i < this.frames.length; i++) {
      const x = 180 + (i % 3) * 180,
        y = 475 + Math.floor(i / 3) * 151;
      P.skin(m, `PetCard${i}`, 'tile', x, y, 105, 110);
      P.sprite(m, `Pet${i}`, this.frames[i], x, y - 5, 92, 92);
      P.text(m, `PetName${i}`, KIND_NAMES[i], x, y + 69, 22, C.deep, 166, true);
    }
    P.button(m, 'AlbumDone', '都好可爱！', 360, 1240, 456, 88, () => this.closeModal(), true, 28);
  }
  private toggleSound(): void {
    this.save.sound = !this.save.sound;
    this.persist();
    if (!this.save.sound) this.music.stop();
    else {
      this.startMusic();
      this.play('tap');
    }
  }
  private showSettings(): void {
    const inGame = this.currentScreen === 'game';
    const m = this.dialog('Settings', '系统设置', inGame ? 840 : 690);
    P.sprite(m, 'Gear', this.utilityFrames[1], 360, inGame ? 635 : 665, 140, 140);
    P.text(
      m,
      'SettingsDescription',
      '轻松的音乐，陪小可爱们一起出发',
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
      this.save.sound ? '音乐与音效：开启' : '音乐与音效：关闭',
      360,
      inGame ? 858 : 888,
      480,
      92,
      () => {
        this.toggleSound();
        b.children.find((n) => !!n.getComponent(Label))!.getComponent(Label)!.string = this.save
          .sound
          ? '音乐与音效：开启'
          : '音乐与音效：关闭';
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
      '从第一关重新开始',
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
    this.play(won ? 'win' : 'lose');
    const m = this.dialog(won ? 'Victory' : 'TryAgain', won ? '闯关成功！' : '就差一点点！', 960);
    m.getChildByName('Close')!.active = false;
    P.sprite(m, 'ResultPet', won ? this.utilityFrames[0] : this.frames[3], 360, 545, 168, 168);
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
      won ? `${g.mode.title}挑战完成，试试其他玩法吧！` : '优先凑齐槽里已有的萌宠，再收新种类。',
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
      '重新开始 · 第一关',
      360,
      1020,
      510,
      98,
      () => this.startLevel(1, undefined, g.mode.id),
      true,
      30,
    );
    P.button(m, 'ResultHome', '返回主页', 360, 1140, 510, 88, () => this.home(), false, 28);
    if (won)
      for (let i = 0; i < 22; i++) {
        const x = 72 + ((i * 91) % 570),
          y = 330 + ((i * 43) % 230);
        const n = P.star(m, x, y, 8 + (i % 5), [C.gold, C.pink, '#8BE49A', '#83E3FF'][i % 4]);
        tween(n)
          .to(2 + (i % 3) * 0.4, {
            position: new Vec3(x + (i % 2 ? 35 : -35), -y - 420, 0),
            angle: i % 2 ? 180 : -180,
          })
          .call(() => n.destroy())
          .start();
      }
  }
  private toast(message: string): void {
    if (this.toastNode?.isValid) {
      this.toastNode.active = false;
      this.toastNode.destroy();
    }
    const n = P.rounded(
      this.stage,
      'Toast',
      360,
      this.currentScreen === 'home' ? 1005 : 1000,
      656,
      this.currentScreen === 'home' ? 57 : 48,
      '#4E3A27',
      22,
      '#DBB474',
      245,
    );
    P.text(n, 'ToastMessage', message, 0, 0, 22, C.white, 626, true);
    this.toastNode = n;
    tween(P.opacity(n, 255))
      .delay(2.1)
      .to(0.25, { opacity: 0 })
      .call(() => {
        if (n.isValid) n.destroy();
        if (this.toastNode === n) this.toastNode = null;
      })
      .start();
  }
  onDestroy(): void {
    this.clearHighlights();
    this.music?.stop();
    this.unscheduleAllCallbacks();
  }
}
