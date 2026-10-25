import {
  _decorator,
  assetManager,
  Component,
  Game,
  ImageAsset,
  Label,
  Mask,
  Node,
  Sprite,
  SpriteFrame,
  Texture2D,
  UIOpacity,
  game,
} from 'cc';
import { CloudProfile, OnlineClient, OnlineError } from '../core/OnlineClient';
import {
  WechatAvatarButton,
  WechatUserProfile,
  designRectToScreen,
  normalizeWechatAvatarUrl,
  readWechatWindowSize,
} from '../core/WechatProfile';
import { tileFaceCenterY } from './Layout';
import * as P from './Paint';

const { ccclass } = _decorator;
@ccclass('PlayerProfileDialog')
export class PlayerProfileDialog extends Component {
  private client: OnlineClient | null = null;
  private notify: (message: string) => void = () => {};
  private bridge!: WechatAvatarButton;
  private nickname!: Label;
  private status!: Label;
  private syncLabel!: Label;
  private syncButton!: Node;
  private avatar!: Sprite;
  private defaultAvatar!: SpriteFrame;
  private remoteFrame: SpriteFrame | null = null;
  private remoteTexture: Texture2D | null = null;
  private remoteImage: ImageAsset | null = null;
  private avatarURL = '';
  private avatarFailed = false;
  private owner = '';
  private imageGeneration = 0;
  private statusRevision = 0;
  private closed = false;
  private hidden = false;
  private ready = false;
  private loading = false;
  private syncing = false;
  private mounted = false;

  configure(
    client: OnlineClient | null,
    fallback: SpriteFrame,
    notify: (message: string) => void,
  ): void {
    this.client = client;
    this.defaultAvatar = fallback;
    this.notify = notify;
    this.bridge = new WechatAvatarButton(
      (profile) => {
        if (this.alive() && this.ready && !this.syncing) void this.synchronize(profile);
      },
      (message) => {
        if (this.alive()) {
          this.setStatus(message);
          this.notify(message);
        }
      },
    );
    P.text(
      this.node,
      'ProfileIntro',
      '头像和昵称与微信保持一致',
      360,
      445,
      23,
      P.PALETTE.muted,
      510,
    );
    const frame = P.skin(this.node, 'AvatarFrame', 'tile', 360, 576, 178, 184);
    const clip = P.node(frame, 'AvatarClip', 0, tileFaceCenterY(184), 136, 136);
    clip.addComponent(Mask).type = Mask.Type.GRAPHICS_ELLIPSE;
    this.avatar = P.sprite(clip, 'AvatarPhoto', fallback, 0, 0, 136, 136).getComponent(Sprite)!;
    P.text(this.node, 'AvatarCaption', '微信头像', 360, 687, 21, P.PALETTE.deep, 460, true);
    P.text(this.node, 'NicknameCaption', '微信昵称', 360, 785, 23, P.PALETTE.deep, 474, true);
    P.skin(this.node, 'NicknameField', 'nav', 360, 862, 480, 90);
    this.nickname = P.text(
      this.node,
      'WechatNickname',
      '萌宠玩家',
      360,
      868,
      28,
      P.PALETTE.ink,
      430,
      true,
    );
    P.text(
      this.node,
      'ProfileHint',
      '授权后自动同步，无需手动填写',
      360,
      956,
      21,
      P.PALETTE.muted,
      510,
    );
    this.status = P.text(
      this.node,
      'ProfileStatus',
      '头像和昵称仅用于游戏内展示',
      360,
      1024,
      21,
      P.PALETTE.muted,
      510,
    );
    this.syncButton = P.button(
      this.node,
      'SyncWechatProfile',
      '同步微信资料',
      360,
      1138,
      480,
      90,
      () => {
        if (!this.client) this.notify('请在微信小游戏中同步个人资料');
        else if (!this.ready) void this.load();
        else void this.synchronize();
      },
      true,
      29,
    );
    this.syncLabel = this.syncButton
      .getChildByName('SyncWechatProfile-label')!
      .getComponent(Label)!;
    game.on(Game.EVENT_HIDE, this.hide, this);
    game.on(Game.EVENT_SHOW, this.show, this);
    if (this.client) void this.load();
    else {
      this.setStatus('请在微信小游戏中同步个人资料');
      this.paintState();
    }
  }

  update(): void {
    if (!this.bridge || !this.alive()) return;
    const confirmed = this.client?.profile;
    if (this.ready && confirmed?.id !== this.owner) this.invalidateAccount();
    else if (
      this.ready &&
      confirmed &&
      !this.loading &&
      !this.syncing &&
      (this.nickname.string !== confirmed.nickname || this.avatarURL !== confirmed.avatarUrl)
    ) {
      this.renderProfile(confirmed);
    }
    const stable =
      Math.abs(this.node.scale.x - 1) < 0.001 &&
      (this.node.getComponent(UIOpacity)?.opacity ?? 255) === 255;
    const visible = this.ready && !this.loading && !this.syncing && !this.hidden && stable;
    if (visible && !this.mounted && this.bridge.supported) {
      const size = readWechatWindowSize();
      if (size) {
        this.bridge.mount(
          designRectToScreen(
            { left: 120, top: 1093, width: 480, height: 90 },
            size.width,
            size.height,
          ),
        );
        this.mounted = true;
      }
    }
    this.bridge.setVisible(visible && this.mounted);
  }

  private alive(): boolean {
    return !this.closed && this.isValid && this.node.isValid;
  }

  private setStatus(message: string): void {
    this.statusRevision++;
    this.status.string = message;
  }

  private paintState(): void {
    const busy = this.loading || this.syncing;
    this.syncLabel.string = this.loading
      ? '正在读取…'
      : this.syncing
        ? '正在同步…'
        : this.client && !this.ready
          ? '重新加载资料'
          : '同步微信资料';
    P.opacity(this.syncButton, busy || !this.client ? 175 : 255);
    if (busy) this.bridge.setVisible(false);
  }

  private async load(): Promise<void> {
    if (!this.client || this.loading || this.syncing || !this.alive()) return;
    this.loading = true;
    this.paintState();
    try {
      const profile = await this.client.getProfile();
      if (!this.alive()) return;
      this.owner = profile.id;
      this.ready = true;
      this.setStatus('头像和昵称仅用于游戏内展示');
      this.renderProfile(profile);
    } catch (error) {
      if (this.alive()) {
        this.setStatus('资料暂未加载，点击下方重新连接');
        this.notify(error instanceof Error ? error.message : '个人资料加载失败，请重试');
      }
    } finally {
      this.loading = false;
      if (this.alive()) this.paintState();
    }
    if (this.alive() && this.ready) await this.synchronize();
  }

  private async synchronize(wechatProfile?: WechatUserProfile): Promise<void> {
    if (!this.client || !this.alive() || !this.ready || this.loading || this.syncing) return;
    if (this.client.profile?.id !== this.owner) {
      this.invalidateAccount();
      return;
    }
    this.syncing = true;
    this.setStatus('正在同步微信头像和昵称…');
    this.paintState();
    try {
      const profile = await this.client.syncWechatProfile(wechatProfile);
      if (!this.alive()) return;
      if (profile) {
        this.setStatus('头像和昵称已与微信同步');
        this.renderProfile(profile);
        if (wechatProfile) this.notify('微信头像和昵称已同步');
      } else {
        this.setStatus('点击下方，同步微信头像和昵称');
      }
    } catch (error) {
      if (this.alive()) {
        if (error instanceof OnlineError && error.code === 'PROFILE_ACCOUNT_CHANGED')
          this.invalidateAccount();
        else {
          this.setStatus('同步未完成，点击下方重试');
          this.notify(error instanceof Error ? error.message : '微信资料同步失败，请重试');
        }
      }
    } finally {
      this.syncing = false;
      if (this.alive()) this.paintState();
    }
  }

  private renderProfile(profile: CloudProfile): void {
    this.nickname.string = profile.nickname;
    if (this.avatarURL !== profile.avatarUrl || this.avatarFailed)
      this.setAvatar(profile.avatarUrl);
  }

  /** Download only affects display: an authorized profile is saved before this runs. */
  private setAvatar(value: string): void {
    const generation = ++this.imageGeneration;
    const statusRevision = this.statusRevision;
    this.releaseImage();
    this.avatarURL = value;
    this.avatarFailed = false;
    if (!value) return;
    let url: string;
    try {
      url = normalizeWechatAvatarUrl(value);
    } catch {
      return;
    }
    assetManager.loadRemote<ImageAsset>(url, { ext: '.png' }, (error, image) => {
      if (!this.alive() || generation !== this.imageGeneration) return;
      if (error || !image) {
        this.avatarFailed = true;
        // A previous image request must not overwrite a newer synchronization result.
        if (statusRevision === this.statusRevision) this.setStatus('资料已保存，头像暂时无法显示');
        return;
      }
      image.addRef();
      this.remoteImage = image;
      this.remoteTexture = new Texture2D();
      this.remoteTexture.image = image;
      this.remoteFrame = new SpriteFrame();
      this.remoteFrame.texture = this.remoteTexture;
      this.avatar.spriteFrame = this.remoteFrame;
    });
  }

  private invalidateAccount(): void {
    const notify = this.ready;
    this.ready = false;
    this.owner = '';
    this.nickname.string = '萌宠玩家';
    this.setAvatar('');
    this.bridge.setVisible(false);
    this.setStatus('登录账号已变化，请重新加载个人资料');
    this.paintState();
    if (notify) this.notify('登录账号已变化，请重新加载个人资料');
  }

  private releaseImage(): void {
    if (this.avatar && this.defaultAvatar) this.avatar.spriteFrame = this.defaultAvatar;
    this.remoteFrame?.destroy();
    this.remoteTexture?.destroy();
    this.remoteImage?.decRef();
    this.remoteFrame = null;
    this.remoteTexture = null;
    this.remoteImage = null;
  }
  private hide(): void {
    this.hidden = true;
    this.bridge?.destroy();
    this.mounted = false;
  }
  private show(): void {
    this.hidden = false;
    // Some native authorization flows background the game before delivering their callback.
    // Re-read granted permission on return so the confirmed consent can still be synchronized.
    if (this.ready) void this.synchronize();
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.imageGeneration++;
    this.bridge?.destroy();
    this.releaseImage();
    game.off(Game.EVENT_HIDE, this.hide, this);
    game.off(Game.EVENT_SHOW, this.show, this);
  }
  onDestroy(): void {
    this.dispose();
  }
}
