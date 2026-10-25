import { designRectToScreen, ProfileRect, readWechatWindowSize } from './WechatProfile';

/** Top-left bounds of the home screen's clearly labelled game-club entry, in design pixels. */
export const HOME_GAME_CLUB_RECT: ProfileRect = { left: 533, top: 959, width: 154, height: 154 };

interface WechatGameClubFailure {
  errMsg?: string;
  errno?: number;
  errCode?: number;
}

interface WindowSize {
  width: number;
  height: number;
}

type TapListener = (result?: WechatGameClubFailure) => void;
type ResizeListener = (result?: { windowWidth?: number; windowHeight?: number }) => void;

interface NativeGameClubButton {
  onTap(listener: TapListener): void;
  offTap(listener: TapListener): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

interface WechatGameClubAPI {
  createGameClubButton?: (options: {
    type: 'text';
    icon: 'green';
    text: string;
    style: ProfileRect & {
      backgroundColor: string;
      borderColor: string;
      borderWidth: number;
      color: string;
      fontSize: number;
    };
  }) => NativeGameClubButton;
  onWindowResize?: (listener: ResizeListener) => void;
  offWindowResize?: (listener: ResizeListener) => void;
}

declare const wx: WechatGameClubAPI | undefined;

const UNAVAILABLE_MESSAGE = '游戏圈暂不可用，请稍后再试';

function hasWechatFailure(result?: WechatGameClubFailure): boolean {
  return (
    [result?.errno, result?.errCode].some(
      (code) => typeof code === 'number' && Number.isFinite(code) && code !== 0,
    ) ||
    (typeof result?.errMsg === 'string' && !!result.errMsg && !result.errMsg.endsWith(':ok'))
  );
}

function logFailure(stage: string, error: unknown): void {
  const result = error && typeof error === 'object' ? (error as WechatGameClubFailure) : undefined;
  const message = error instanceof Error ? error.message : result?.errMsg;
  // Do not log arbitrary native response fields or an unbounded platform error message.
  console.warn(
    '[game-club] 微信接口失败',
    JSON.stringify({
      stage,
      errMsg: typeof message === 'string' ? message.slice(0, 320) : undefined,
      errno: Number.isFinite(result?.errno) ? result?.errno : undefined,
      errCode: Number.isFinite(result?.errCode) ? result?.errCode : undefined,
    }),
  );
}

/** WeChat opens this game's club only after a user taps the transparent native control. */
export class WechatGameClubButton {
  private button: NativeGameClubButton | null = null;
  private tapListener: TapListener | null = null;
  private resizeListener: ResizeListener | null = null;
  private resizeAPI: WechatGameClubAPI | null = null;
  private windowSize: WindowSize | null = null;
  private visible = false;
  private destroyed = false;
  private failed = false;
  private generation = 0;

  constructor(private readonly onFailure: (message: string) => void) {}

  get supported(): boolean {
    return typeof wx !== 'undefined' && typeof wx?.createGameClubButton === 'function';
  }

  get fallbackMessage(): string {
    return typeof wx === 'undefined' ? '请在微信小游戏中打开游戏圈' : UNAVAILABLE_MESSAGE;
  }

  setVisible(visible: boolean): void {
    if (this.destroyed || this.visible === visible) return;
    this.visible = visible;
    if (!visible) {
      this.release();
      return;
    }
    this.failed = false;
    const api = typeof wx === 'undefined' ? undefined : wx;
    if (typeof api?.createGameClubButton !== 'function') return;
    try {
      const size = readWechatWindowSize();
      if (!size) throw new Error('window dimensions unavailable');
      this.createNative(api, size);
      this.bindResize(api);
    } catch (error) {
      this.failMount('mount', error);
    }
  }

  private createNative(api: WechatGameClubAPI, size: WindowSize): void {
    if (
      this.button &&
      this.windowSize?.width === size.width &&
      this.windowSize.height === size.height
    )
      return;
    this.disposeNative();
    const generation = this.generation;
    const button = api.createGameClubButton!({
      type: 'text',
      icon: 'green',
      text: '',
      // No openlink: the native control opens the current mini-game's own club.
      style: {
        ...designRectToScreen(HOME_GAME_CLUB_RECT, size.width, size.height),
        backgroundColor: 'rgba(0,0,0,0)',
        borderColor: 'rgba(0,0,0,0)',
        borderWidth: 0,
        color: '#000000',
        fontSize: 1,
      },
    });
    this.button = button;
    this.windowSize = size;
    this.tapListener = (result) => {
      if (this.button !== button || this.generation !== generation || !this.visible) return;
      if (hasWechatFailure(result)) {
        logFailure('GameClubButton.onTap', result);
        this.onFailure(UNAVAILABLE_MESSAGE);
      }
    };
    button.onTap(this.tapListener);
    button.show();
  }

  private bindResize(api: WechatGameClubAPI): void {
    if (typeof api.onWindowResize !== 'function' || typeof api.offWindowResize !== 'function')
      return;
    const listener: ResizeListener = (result) => {
      if (this.resizeListener !== listener || !this.visible || this.failed || this.destroyed)
        return;
      const width = result?.windowWidth;
      const height = result?.windowHeight;
      if (
        typeof width !== 'number' ||
        typeof height !== 'number' ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      )
        return;
      try {
        this.createNative(api, { width, height });
      } catch (error) {
        this.failMount('resize', error);
      }
    };
    // Save both before registering so a partially successful native call can still be released.
    this.resizeAPI = api;
    this.resizeListener = listener;
    api.onWindowResize(listener);
  }

  private failMount(stage: string, error: unknown): void {
    this.failed = true;
    this.release();
    logFailure(stage, error);
    // Keep visible=true: repeated UI updates must not retry or toast on every frame.
    // The Canvas entry can display fallbackMessage when the user explicitly taps it.
  }

  private disposeNative(): void {
    this.generation++;
    const button = this.button;
    const listener = this.tapListener;
    this.button = null;
    this.tapListener = null;
    this.windowSize = null;
    if (!button) return;
    for (const release of [
      () => button.hide(),
      () => listener && button.offTap(listener),
      () => button.destroy(),
    ]) {
      try {
        release();
      } catch {
        /* Continue releasing if WeChat has already removed part of the native control. */
      }
    }
  }

  private release(): void {
    this.disposeNative();
    const api = this.resizeAPI;
    const listener = this.resizeListener;
    this.resizeAPI = null;
    this.resizeListener = null;
    if (api && listener) {
      try {
        api.offWindowResize?.(listener);
      } catch {
        /* The cleared listener identity also makes already-queued resize callbacks inert. */
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.visible = false;
    this.release();
  }
}
