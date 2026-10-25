export interface ProfileRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WechatUserProfile {
  avatarUrl: string;
  nickName: string;
}

interface WechatProfileFailure {
  errMsg?: string;
  errno?: number;
  errCode?: number;
}

interface WechatProfileResult extends WechatProfileFailure {
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
  getPrivacySetting?: (options: {
    success: (result: { needAuthorization: boolean }) => void;
    fail: (result?: WechatProfileFailure) => void;
  }) => void;
  getSetting?: (options: {
    success: (result: { authSetting?: { 'scope.userInfo'?: boolean } }) => void;
    fail: (result?: WechatProfileFailure) => void;
  }) => void;
  getUserInfo?: (options: {
    withCredentials: false;
    lang: 'zh_CN';
    success: (result: WechatProfileResult) => void;
    fail: (result?: WechatProfileFailure) => void;
  }) => void;
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

function hasWechatFailure(result?: WechatProfileFailure): boolean {
  return (
    [result?.errno, result?.errCode].some(
      (code) => typeof code === 'number' && Number.isFinite(code) && code !== 0,
    ) ||
    (typeof result?.errMsg === 'string' && !!result.errMsg && !result.errMsg.endsWith(':ok'))
  );
}

function wechatFailureMessage(stage: string, result?: WechatProfileFailure): string {
  const errMsg = typeof result?.errMsg === 'string' ? result.errMsg.slice(0, 320) : '';
  const errno = typeof result?.errno === 'number' ? result.errno : undefined;
  const errCode = typeof result?.errCode === 'number' ? result.errCode : undefined;
  const privacyUnavailable =
    [errno, errCode].some((code) => code === 112 || code === 1025 || code === 1026) ||
    /announce your privacy usage/i.test(errMsg);
  // Keep the platform cause, never the response object (which can contain personal data).
  console.warn(
    '[pet-profile] 微信接口失败',
    JSON.stringify({
      stage,
      errno,
      errCode,
      errMsg,
      action: privacyUnavailable
        ? '检查微信公众平台：设置 > 服务内容声明 > 用户隐私保护指引，确认头像、昵称用途已声明并生效；若接口被限制，按后台提示处理。'
        : undefined,
    }),
  );
  if (privacyUnavailable) return '微信资料授权暂不可用，请稍后再试';
  if (/cancel/i.test(errMsg)) return '已取消同步，原头像和昵称保持不变';
  if (/auth deny|user deny/i.test(errMsg)) return '未授权微信资料，原头像和昵称保持不变';
  return '微信资料暂时无法获取，请重新同步';
}

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

export function normalizeWechatProfile(value?: {
  avatarUrl?: string;
  nickName?: string;
}): WechatUserProfile {
  const nickName = typeof value?.nickName === 'string' ? value.nickName.trim() : '';
  if (
    !nickName ||
    Array.from(nickName).length > 32 ||
    Array.from(nickName).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    })
  )
    throw new Error('微信暂未提供有效昵称，请重新同步');
  return { nickName, avatarUrl: normalizeWechatAvatarUrl(value?.avatarUrl || '') };
}

/** This path never opens a permission prompt. First-time consent belongs to the native button. */
export function readAuthorizedWechatProfile(timeoutMs = 8000): Promise<WechatUserProfile | null> {
  const api = typeof wx === 'undefined' ? undefined : wx;
  if (!api?.getSetting || !api.getUserInfo) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (profile: WechatUserProfile | null, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(profile);
    };
    const timer = setTimeout(() => finish(null, new Error('微信资料获取超时，请重试')), timeoutMs);
    const failure = (stage: string, result?: WechatProfileFailure) => {
      if (!finished) finish(null, new Error(wechatFailureMessage(stage, result)));
    };
    const readUserInfo = () => {
      if (finished) return;
      try {
        api.getUserInfo!({
          withCredentials: false,
          lang: 'zh_CN',
          success: (result) => {
            if (finished) return;
            try {
              if (hasWechatFailure(result)) {
                failure('getUserInfo', result);
                return;
              }
              finish(normalizeWechatProfile(result?.userInfo));
            } catch (error) {
              finish(null, error instanceof Error ? error : new Error('微信资料暂时无法获取'));
            }
          },
          fail: (result) => failure('getUserInfo', result),
        });
      } catch (error) {
        failure('getUserInfo', { errMsg: error instanceof Error ? error.message : undefined });
      }
    };
    try {
      api.getSetting!({
        success: (setting) => {
          if (finished) return;
          if (setting.authSetting?.['scope.userInfo'] !== true) {
            finish(null);
            return;
          }
          try {
            if (api.getPrivacySetting) {
              api.getPrivacySetting({
                success: (privacy) => {
                  // false can also mean no collection is declared; getUserInfo may still reject it.
                  if (privacy?.needAuthorization === false) readUserInfo();
                  else finish(null);
                },
                fail: (result) => failure('getPrivacySetting', result),
              });
            } else readUserInfo();
          } catch (error) {
            failure('getPrivacySetting', {
              errMsg: error instanceof Error ? error.message : undefined,
            });
          }
        },
        fail: (result) => failure('getSetting', result),
      });
    } catch (error) {
      failure('getSetting', { errMsg: error instanceof Error ? error.message : undefined });
    }
  });
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
    private readonly onResult: (profile: WechatUserProfile) => void,
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
        if (hasWechatFailure(result)) {
          this.onFailure(wechatFailureMessage('UserInfoButton.onTap', result));
          return;
        }
        let profile: WechatUserProfile;
        try {
          profile = normalizeWechatProfile(result?.userInfo);
        } catch (error) {
          this.onFailure(
            error instanceof Error ? error.message : '微信资料暂时无法获取，请重新同步',
          );
          return;
        }
        this.onResult(profile);
      };
      button.onTap(this.listener);
      button.show();
    } catch (error) {
      this.disposeNative();
      this.onFailure(
        wechatFailureMessage('createUserInfoButton', {
          errMsg: error instanceof Error ? error.message : undefined,
        }),
      );
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
