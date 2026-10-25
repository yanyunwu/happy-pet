export interface ProfileRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface WechatProfileResult {
  errMsg?: string;
  userInfo?: { avatarUrl?: string; nickName?: string };
}

type TapListener = (result: WechatProfileResult) => void;

interface NativeProfileButton {
  onTap(listener: TapListener): void;
  offTap(listener: TapListener): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

interface WechatProfileAPI {
  createUserInfoButton?: (options: {
    type: 'text';
    text: string;
    withCredentials: false;
    lang: 'zh_CN';
    style: ProfileRect & {
      backgroundColor: string;
      borderColor: string;
      borderWidth: number;
      color: string;
      fontSize: number;
    };
  }) => NativeProfileButton;
  getWindowInfo?: () => { windowWidth?: number; windowHeight?: number };
  getSystemInfoSync?: () => { windowWidth?: number; windowHeight?: number };
}

declare const wx: WechatProfileAPI | undefined;

/** Validate without the DOM URL global, which is not available in every mini-game runtime. */
export function normalizeWechatAvatarUrl(value: string): string {
  const invalid = () => new Error('微信头像地址不可用，请重新同步');
  if (typeof value !== 'string' || !value) throw invalid();
  // Percent decoding must validate UTF-8 too; '+' remains literal, as in server PathUnescape.
  let decoded: string;
  const byteLength = (text: string) =>
    encodeURIComponent(text).replace(/%[0-9a-f]{2}/gi, '_').length;
  try {
    decoded = decodeURIComponent(value);
    if (byteLength(value) > 2048) throw invalid();
  } catch {
    throw invalid();
  }
  if (
    /[\s\\]/.test(decoded) ||
    Array.from(decoded).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    throw invalid();
  const parts = /^(https?):\/\/([a-z0-9.-]+)(\/[^?#]*)?(\?[^#]*)?$/i.exec(value);
  if (!parts) throw invalid();
  const host = parts[2].toLowerCase();
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*(?:qlogo|qpic)\.cn$/.test(host) ||
    host.length > 253 ||
    host.split('.').some((label) => label.length > 63)
  )
    throw invalid();
  // Encode raw path characters before applying the same post-normalization server limit.
  const path = encodeURI(parts[3] || '')
    .replace(/%25/g, '%')
    .replace(/[!'()*]/g, (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase());
  const canonical = `https://${host}${path}${parts[4] || ''}`;
  if (byteLength(canonical) > 2048) throw invalid();
  return canonical;
}

/** A top-left rectangle in the 720 × 1560 design canvas, converted to logical screen pixels. */
export function designRectToScreen(
  rect: ProfileRect,
  windowWidth: number,
  windowHeight: number,
): ProfileRect {
  const scale = Math.min(windowWidth / 720, windowHeight / 1560);
  return {
    left: (windowWidth - 720 * scale) / 2 + rect.left * scale,
    top: (windowHeight - 1560 * scale) / 2 + rect.top * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
}

export function readWechatWindowSize(): { width: number; height: number } | null {
  if (typeof wx === 'undefined') return null;
  for (const read of [wx.getWindowInfo, wx.getSystemInfoSync]) {
    try {
      const info = read?.call(wx);
      const width = info?.windowWidth;
      const height = info?.windowHeight;
      if (
        typeof width === 'number' &&
        typeof height === 'number' &&
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width > 0 &&
        height > 0
      )
        return { width, height };
    } catch {
      /* Older SDKs may only expose getSystemInfoSync. */
    }
  }
  return null;
}

/** Creating this transparent control never requests authorization; only a native user tap does. */
export class WechatAvatarButton {
  private button: NativeProfileButton | null = null;
  private listener: TapListener | null = null;
  private rect: ProfileRect | null = null;
  private visible = false;
  private generation = 0;

  constructor(
    private readonly onResult: (profile: { avatarUrl: string; nickName: string }) => void,
    private readonly onFailure: (message: string) => void,
  ) {}

  get supported(): boolean {
    return typeof wx !== 'undefined' && typeof wx.createUserInfoButton === 'function';
  }

  mount(rect: ProfileRect): void {
    this.destroy();
    if (
      ![rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      this.onFailure('头像按钮暂时无法显示，请重新打开个人设置');
      return;
    }
    this.rect = { ...rect };
    this.setVisible(true);
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      // Recreate on show so an authorization begun before hiding cannot target a new listener.
      this.disposeNative();
      return;
    }
    if (!this.rect) return;
    if (!this.supported) {
      this.onFailure('请在微信小游戏中同步头像');
      return;
    }
    const generation = ++this.generation;
    try {
      const button = wx!.createUserInfoButton!({
        type: 'text',
        text: '',
        withCredentials: false,
        lang: 'zh_CN',
        style: {
          ...this.rect,
          backgroundColor: 'rgba(0,0,0,0)',
          borderColor: 'rgba(0,0,0,0)',
          borderWidth: 0,
          color: '#000000',
          fontSize: 1,
        },
      });
      this.button = button;
      this.listener = (result) => {
        if (this.button !== button || !this.visible || this.generation !== generation) return;
        if (result?.errMsg && !result.errMsg.endsWith(':ok')) {
          this.onFailure('未同步微信头像，原头像保持不变');
          return;
        }
        if (!result?.userInfo?.avatarUrl) {
          this.onFailure('微信暂未提供头像，原头像保持不变，请稍后重试');
          return;
        }
        let avatarUrl: string;
        try {
          avatarUrl = normalizeWechatAvatarUrl(result.userInfo.avatarUrl);
        } catch {
          this.onFailure('微信头像地址不可用，原头像保持不变，请稍后重试');
          return;
        }
        this.onResult({
          avatarUrl,
          nickName: typeof result.userInfo.nickName === 'string' ? result.userInfo.nickName : '',
        });
      };
      button.onTap(this.listener);
      button.show();
    } catch {
      this.disposeNative();
      this.onFailure('微信头像同步暂不可用，请稍后重试');
    }
  }

  private disposeNative(): void {
    this.generation++;
    const button = this.button;
    const listener = this.listener;
    this.button = null;
    this.listener = null;
    if (!button) return;
    for (const release of [
      () => button.hide(),
      () => listener && button.offTap(listener),
      () => button.destroy(),
    ]) {
      try {
        release();
      } catch {
        /* Continue cleanup even if the native control was already removed by WeChat. */
      }
    }
  }

  destroy(): void {
    this.visible = false;
    this.rect = null;
    this.disposeNative();
  }
}
