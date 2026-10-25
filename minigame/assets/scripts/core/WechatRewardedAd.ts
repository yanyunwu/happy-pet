interface RewardedVideo {
  show(): Promise<void>;
  load(): Promise<void>;
  onClose(listener: (result?: { isEnded?: boolean }) => void): void;
  offClose(listener: (result?: { isEnded?: boolean }) => void): void;
  onError(listener: () => void): void;
  offError(listener: () => void): void;
  destroy(): void;
}
declare const wx:
  | undefined
  | {
      createRewardedVideoAd?: (options: {
        adUnitId: string;
        multiton: boolean;
        disableFallbackSharePage: boolean;
      }) => RewardedVideo;
    };

/** A reward is earned only by WeChat's explicit complete-video callback. */
export class WechatRewardedAd {
  private pending: Promise<boolean> | null = null;
  private cancel: (() => void) | null = null;

  watch(adUnitId: string): Promise<boolean> {
    if (this.pending) return this.pending;
    if (!/^adunit-[\w-]+$/.test(adUnitId))
      return Promise.reject(new Error('广告暂不可用，请稍后再试'));
    if (typeof wx === 'undefined' || typeof wx.createRewardedVideoAd !== 'function')
      return Promise.reject(new Error('请在微信小游戏中观看广告'));

    let resolve!: (completed: boolean) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<boolean>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.pending = pending;
    let ad: RewardedVideo | undefined;
    let settled = false;
    const timer = setTimeout(() => finish(false, true), 20000);
    const finish = (completed: boolean, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this.pending = null;
      this.cancel = null;
      if (ad) {
        for (const clean of [
          () => ad!.offClose(onClose),
          () => ad!.offError(onError),
          () => ad!.destroy(),
        ]) {
          try {
            clean();
          } catch {
            // Native teardown must not leave the game waiting for a callback.
          }
        }
      }
      if (failed) reject(new Error('广告暂不可用，请稍后再试'));
      else resolve(completed);
    };
    const onClose = (result?: { isEnded?: boolean }) => finish(result?.isEnded === true);
    const onError = () => finish(false, true);
    this.cancel = () => finish(false);
    try {
      ad = wx.createRewardedVideoAd({
        adUnitId,
        multiton: true,
        disableFallbackSharePage: true,
      });
      ad.onClose(onClose);
      ad.onError(onError);
      void Promise.resolve()
        .then(() => {
          if (!settled) return ad!.show();
        })
        .catch(() => {
          if (settled) return;
          return ad!.load().then(() => {
            if (!settled) return ad!.show();
          });
        })
        .then(() => clearTimeout(timer))
        .catch(onError);
    } catch {
      onError();
    }
    return pending;
  }

  destroy(): void {
    this.cancel?.();
  }
}
