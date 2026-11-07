import type { ModeId } from './MatchGame';

export interface WechatShareImage {
  imageUrlId: string;
  imageUrl: string;
}

export type WechatShareImageMap = Partial<Record<ModeId, WechatShareImage>>;

const approvedShareImages: WechatShareImageMap = {
  fun: {
    imageUrlId: 'eS4o6XauRq29yezWdKw6EA==',
    imageUrl:
      'https://mmocgame.qpic.cn/wechatgame/D6MvJrHRtPM9Pg8wnW7LQ0LBFrErCoTzyRS3yC7Luf4s6exngFOPksFeeVJI1RF4/0',
  },
  quartet: {
    imageUrlId: 'Sl/xpz1fSQ2VwyekznINmg==',
    imageUrl:
      'https://mmocgame.qpic.cn/wechatgame/D6MvJrHRtPNbMAqCYFJuGMQYSyiauiaMEOqN6IMgHQ4OGbumuIpwNicibU2LPWNcZXJO/0',
  },
  classic: {
    imageUrlId: 'WKxC6DT6SpWGXS3nU3wbkQ==',
    imageUrl:
      'https://mmocgame.qpic.cn/wechatgame/D6MvJrHRtPN6IqKTLlJnYOJvtpZHwhc2pfmMY41xFMcYQpQ1ibjPB7kEiamLAGFspf/0',
  },
};

export function shareImageForMode(
  mode: ModeId,
  images: WechatShareImageMap = approvedShareImages,
): WechatShareImage | undefined {
  const image = images[mode];
  if (!image?.imageUrlId?.trim() || !image.imageUrl?.trim()) return undefined;
  return { imageUrlId: image.imageUrlId, imageUrl: image.imageUrl };
}
