import {
  _decorator,
  assetManager,
  Component,
  EditBox,
  Game,
  ImageAsset,
  Label,
  Mask,
  Node,
  Sprite,
  SpriteFrame,
  Texture2D,
  UIOpacity,
  UITransform,
  game,
} from 'cc';
import { OnlineClient, OnlineError } from '../core/OnlineClient';
import {
  WechatAvatarButton,
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
  private input!: EditBox;
  private counter!: Label;
  private status!: Label;
  private saveLabel!: Label;
  private saveButton!: Node;
  private avatar!: Sprite;
  private defaultAvatar!: SpriteFrame;
  private remoteFrame: SpriteFrame | null = null;
  private remoteTexture: Texture2D | null = null;
  private remoteImage: ImageAsset | null = null;
  private avatarURL = '';
  private avatarChanged = false;
  private avatarLoading = false;
  private draftOwner = '';
  private imageGeneration = 0;
  private closed = false;
  private hidden = false;
  private editing = false;
  private ready = false;
  private loading = false;
  private saving = false;
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
        if (!this.alive() || this.saving || !this.ready) return;
        this.setAvatar(profile.avatarUrl, true);
      },
      (message) => {
        if (this.alive()) this.notify(message);
      },
    );
    P.text(
      this.node,
      'ProfileIntro',
      '换上熟悉的头像，让伙伴们认识你',
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
    P.button(
      this.node,
      'SyncAvatar',
      '使用微信头像',
      360,
      745,
      460,
      86,
      () => {
        if (!this.client) this.notify('请在微信小游戏中同步头像');
        else if (!this.bridge.supported) this.notify('当前微信暂不支持头像授权，请更新微信后再试');
        else if (!this.ready) this.notify('正在读取个人资料，请稍等');
      },
      true,
      27,
    );
    P.text(
      this.node,
      'NicknameCaption',
      '游戏昵称',
      360,
      832,
      23,
      P.PALETTE.deep,
      474,
      true,
      'left',
    );
    const field = P.skin(this.node, 'NicknameField', 'nav', 360, 901, 480, 84);
    const inputNode = P.node(field, 'NicknameInput', 0, -6, 436, 58);
    // Configure labels and SINGLE_LINE before EditBox preloads its native input.
    inputNode.active = false;
    const text = P.text(inputNode, 'InputText', '', 0, 0, 28, P.PALETTE.ink, 430, true, 'left');
    const placeholder = P.text(
      inputNode,
      'Placeholder',
      '给自己取个喜欢的名字',
      0,
      0,
      24,
      P.PALETTE.muted,
      430,
      false,
      'left',
    );
    text.node.getComponent(UITransform)!.setAnchorPoint(0, 1);
    placeholder.node.getComponent(UITransform)!.setAnchorPoint(0, 1);
    this.input = inputNode.addComponent(EditBox);
    this.input.textLabel = text;
    this.input.placeholderLabel = placeholder;
    this.input.inputMode = EditBox.InputMode.SINGLE_LINE;
    this.input.inputFlag = EditBox.InputFlag.DEFAULT;
    this.input.returnType = EditBox.KeyboardReturnType.DONE;
    this.input.maxLength = 64;
    this.input.string = '萌宠玩家';
    inputNode.active = true;
    inputNode.on(EditBox.EventType.TEXT_CHANGED, this.updateCount, this);
    inputNode.on(EditBox.EventType.EDITING_DID_BEGAN, () => {
      this.editing = true;
      this.bridge.setVisible(false);
    });
    inputNode.on(EditBox.EventType.EDITING_DID_ENDED, () => {
      this.editing = false;
      this.updateCount();
    });
    this.counter = P.text(
      this.node,
      'NicknameCount',
      '',
      360,
      958,
      19,
      P.PALETTE.muted,
      470,
      false,
      'right',
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
    this.saveButton = P.button(
      this.node,
      'SaveProfile',
      '保存设置',
      360,
      1138,
      480,
      90,
      () => {
        void this.save();
      },
      true,
      29,
    );
    this.saveLabel = this.saveButton.getChildByName('SaveProfile-label')!.getComponent(Label)!;
    game.on(Game.EVENT_HIDE, this.hide, this);
    game.on(Game.EVENT_SHOW, this.show, this);
    this.updateCount();
    if (this.client) void this.load();
    else {
      this.status.string = '请在微信小游戏中保存个人资料';
      this.paintState();
    }
  }

  update(): void {
    if (!this.bridge || !this.alive()) return;
    if (this.ready && this.client?.profile?.id !== this.draftOwner) this.invalidateAccount();
    const stable =
      Math.abs(this.node.scale.x - 1) < 0.001 &&
      (this.node.getComponent(UIOpacity)?.opacity ?? 255) === 255;
    const visible =
      this.ready &&
      !this.loading &&
      !this.saving &&
      !this.avatarLoading &&
      !this.editing &&
      !this.hidden &&
      stable;
    if (visible && !this.mounted && this.bridge.supported) {
      const windowSize = readWechatWindowSize();
      if (windowSize) {
        this.bridge.mount(
          designRectToScreen(
            { left: 130, top: 702, width: 460, height: 86 },
            windowSize.width,
            windowSize.height,
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
  private updateCount(): void {
    if (!this.counter) return;
    const count = Array.from(this.input.string.trim()).length;
    this.counter.string = `${count} / 32`;
    this.counter.color = P.color(count > 32 ? P.PALETTE.danger : P.PALETTE.muted);
  }
  private paintState(): void {
    const busy = this.loading || this.saving || this.avatarLoading;
    this.input.enabled = !busy && (this.ready || !this.client);
    this.saveLabel.string = this.loading
      ? '正在读取…'
      : this.saving
        ? '正在保存…'
        : this.avatarLoading
          ? '正在读取头像…'
          : this.client && !this.ready
            ? '重新加载资料'
            : '保存设置';
    P.opacity(this.saveButton, busy || !this.client ? 175 : 255);
    if (busy) this.bridge.setVisible(false);
  }
  private async load(): Promise<void> {
    if (!this.client || this.loading || !this.alive()) return;
    this.loading = true;
    this.paintState();
    try {
      const profile = await this.client.getProfile();
      if (!this.alive()) return;
      this.input.string = profile.nickname;
      this.draftOwner = profile.id;
      this.setAvatar(profile.avatarUrl);
      this.ready = true;
      this.avatarChanged = false;
      this.status.string = '头像和昵称仅用于游戏内展示';
      this.updateCount();
    } catch (error) {
      if (this.alive()) {
        this.status.string = '资料暂未加载，点击下方重新连接';
        this.notify(error instanceof Error ? error.message : '个人资料加载失败，请重试');
      }
    } finally {
      this.loading = false;
      if (this.alive()) this.paintState();
    }
  }
  private async save(): Promise<void> {
    if (!this.alive() || this.loading || this.saving || this.avatarLoading) return;
    if (!this.client) {
      this.notify('请在微信小游戏中保存个人资料');
      return;
    }
    if (!this.ready) {
      await this.load();
      return;
    }
    if (this.client.profile?.id !== this.draftOwner) {
      this.invalidateAccount();
      return;
    }
    const nickname = this.input.string.trim();
    if (
      !nickname ||
      Array.from(nickname).length > 32 ||
      Array.from(nickname).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    ) {
      this.notify('昵称请填写 1–32 个字符');
      return;
    }
    this.saving = true;
    this.paintState();
    try {
      const profile = await this.client.updateProfile({
        nickname,
        ...(this.avatarChanged ? { avatarUrl: this.avatarURL } : {}),
      });
      if (!this.alive()) return;
      this.input.string = profile.nickname;
      this.avatarChanged = false;
      this.setAvatar(profile.avatarUrl);
      this.updateCount();
      this.status.string = '个人资料已经保存';
      this.notify('头像和昵称已保存');
    } catch (error) {
      if (this.alive()) {
        if (error instanceof OnlineError && error.code === 'PROFILE_ACCOUNT_CHANGED')
          this.invalidateAccount();
        else this.notify(error instanceof Error ? error.message : '保存失败，请稍后再试');
      }
    } finally {
      this.saving = false;
      if (this.alive()) this.paintState();
    }
  }
  private setAvatar(value: string, candidate = false): void {
    const generation = ++this.imageGeneration;
    this.avatarLoading = false;
    if (!candidate) {
      this.releaseImage();
      this.avatarURL = value;
    }
    if (!value) return;
    let url: string;
    try {
      url = normalizeWechatAvatarUrl(value);
    } catch {
      return;
    }
    if (candidate) {
      this.avatarLoading = true;
      this.status.string = '正在读取微信头像…';
      this.paintState();
    }
    assetManager.loadRemote<ImageAsset>(url, { ext: '.png' }, (error, image) => {
      if (!this.alive() || generation !== this.imageGeneration) return;
      this.avatarLoading = false;
      if (error || !image) {
        if (candidate) {
          this.status.string = '头像读取失败，已保留原头像';
          this.notify('微信头像暂时无法读取，请重新同步');
          this.paintState();
        }
        return;
      }
      if (candidate) {
        this.releaseImage();
        this.avatarURL = url;
        this.avatarChanged = true;
        this.status.string = '头像已选好，记得保存设置';
      }
      image.addRef();
      this.remoteImage = image;
      this.remoteTexture = new Texture2D();
      this.remoteTexture.image = image;
      this.remoteFrame = new SpriteFrame();
      this.remoteFrame.texture = this.remoteTexture;
      this.avatar.spriteFrame = this.remoteFrame;
      this.paintState();
    });
  }
  private invalidateAccount(): void {
    const notify = this.ready;
    this.ready = false;
    this.draftOwner = '';
    this.avatarChanged = false;
    this.input.string = '';
    this.setAvatar('');
    this.bridge.setVisible(false);
    this.status.string = '登录账号已变化，请重新加载个人资料';
    this.updateCount();
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
  }
  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.imageGeneration++;
    this.bridge?.destroy();
    this.input?.blur();
    this.releaseImage();
    game.off(Game.EVENT_HIDE, this.hide, this);
    game.off(Game.EVENT_SHOW, this.show, this);
  }
  onDestroy(): void {
    this.dispose();
  }
}
