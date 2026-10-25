import { Label, Node, SpriteFrame, UITransform } from 'cc';
import { SaveData, SIGN_IN_REWARDS, ToolId } from '../core/Profile';
import * as P from './Paint';

export interface RewardTool {
  id: ToolId;
  name: string;
  icon: number;
  detail: string;
}

interface RewardArt {
  coin: SpriteFrame;
  tools: SpriteFrame[];
}

const C = P.PALETTE;

function statusStamp(
  parent: Node,
  state: 'claimed' | 'today' | 'later',
  x: number,
  y: number,
  width = 142,
): void {
  P.rounded(
    parent,
    'StateBadge',
    x,
    y,
    width,
    34,
    state === 'today' ? C.deep : state === 'claimed' ? '#DCE7C3' : '#E8D5B0',
    12,
  );
  P.text(
    parent,
    'State',
    state === 'claimed' ? '✓ 已领取' : state === 'today' ? '今日可领' : '待领取',
    x,
    y,
    20,
    state === 'today' ? C.white : state === 'claimed' ? C.deep : '#7C603E',
    width - 8,
    true,
  );
}

export function paintSignIn(
  parent: Node,
  save: SaveData,
  day: number,
  claimed: boolean,
  tools: RewardTool[],
  art: RewardArt,
  onClaim: () => void,
): Node {
  const reward = SIGN_IN_REWARDS[day];
  const tool = tools.find((item) => item.id === reward.tool)!;
  P.text(parent, 'Subtitle', '每天一份森林好礼', 253, 313, 25, C.deep, 310, true, 'left');
  P.skin(parent, 'BalancePill', 'pill-dark', 550, 313, 148, 48);
  P.sprite(parent, 'BalanceCoin', art.coin, 505, 312, 46, 46);
  P.text(parent, 'Balance', String(save.coins), 561, 310, 25, '#FFE6A6', 100, true);

  const hero = P.skin(parent, 'TodayReward', 'tile', 360, 444, 534, 208);
  P.text(
    hero,
    'HeroTitle',
    claimed ? '今日奖励已收好' : '今日奖励',
    -115,
    -73,
    27,
    C.deep,
    250,
    true,
    'left',
  );
  P.text(hero, 'HeroDay', `第${day + 1}天`, 186, -72, 23, C.muted, 110, true);
  P.sprite(hero, 'Coin', art.coin, -174, -9, 112, 112);
  P.text(hero, 'Coins', `+${reward.coins}`, -53, -15, 49, '#A65D22', 150, true);
  P.text(hero, 'CoinCaption', '萌宠金币', -53, 33, 21, C.muted, 150);
  P.sprite(hero, 'Tool', art.tools[tool.icon], 87, -13, 77, 77);
  P.text(hero, 'ToolName', tool.name, 182, -25, 28, C.deep, 115, true);
  P.text(hero, 'ToolCount', `×${reward.count}`, 182, 17, 29, '#A65D22', 115, true);
  P.leaf(hero, -233, 71, 14, '#91A760').angle = 18;
  P.leaf(hero, 233, 69, 11, '#B2BE77').angle = -28;

  P.text(parent, 'CalendarTitle', '七日补给', 189, 582, 27, C.deep, 190, true, 'left');
  P.text(
    parent,
    'Progress',
    `已领 ${day + (claimed ? 1 : 0)} / 7 天`,
    522,
    582,
    23,
    C.muted,
    205,
    false,
    'right',
  );
  P.line(parent, 98, 608, 622, 608, '#D5BD89', 2);
  SIGN_IN_REWARDS.forEach((entry, index) => {
    const state =
      index < day || (claimed && index === day)
        ? 'claimed'
        : !claimed && index === day
          ? 'today'
          : 'later';
    const item = tools.find((candidate) => candidate.id === entry.tool)!;
    if (index < 6) {
      const x = 178 + (index % 3) * 182;
      const y = 717 + Math.floor(index / 3) * 216;
      if (state === 'today')
        P.rounded(parent, 'TodayOutline', x, y - 3, 178, 204, '#91A65F', 25, '#6B8546');
      const card = P.skin(parent, `Day${index + 1}`, 'tile', x, y, 166, 192);
      P.text(card, 'Day', `第${index + 1}天`, 0, -69, 23, C.deep, 142, true);
      const coin = P.sprite(card, 'Coin', art.coin, -37, -21, 53, 53);
      P.text(card, 'Coins', `+${entry.coins}`, 31, -21, 30, '#A65D22', 89, true);
      P.text(card, 'Tool', `${item.name} ×${entry.count}`, 0, 24, 21, C.ink, 146);
      statusStamp(card, state, 0, 69);
      if (state === 'claimed') P.opacity(coin, 170);
    } else {
      const gift = P.skin(parent, 'Day7', 'nav', 360, 1114, 532, 138);
      P.star(gift, -231, -39, 13, '#BB762D');
      P.text(gift, 'Day', '第7天 · 满签礼', -94, -40, 25, C.deep, 245, true, 'left');
      statusStamp(gift, state, 181, -39, 110);
      P.sprite(gift, 'Coin', art.coin, -180, 18, 66, 66);
      P.text(gift, 'Coins', `+${entry.coins}`, -87, 18, 37, '#A65D22', 116, true);
      P.sprite(gift, 'ToolIcon', art.tools[item.icon], 47, 16, 67, 67);
      P.text(gift, 'Tool', `${item.name} ×${entry.count}`, 156, 17, 28, C.deep, 150, true);
    }
  });
  P.text(
    parent,
    'SignInNote',
    '累计签到，断签不重置 · 满7天开启新一轮',
    360,
    1218,
    21,
    C.muted,
    540,
  );
  const button = P.button(
    parent,
    'ClaimSignIn',
    claimed ? '今日已领 · 明天再来' : '收下今日奖励',
    360,
    1302,
    526,
    96,
    onClaim,
    true,
    30,
  );
  if (claimed) P.opacity(button, 165);
  return button;
}

export function paintBag(
  parent: Node,
  save: SaveData,
  online: boolean,
  tools: RewardTool[],
  art: RewardArt,
  onClose: () => void,
): void {
  P.text(parent, 'BagIntro', '签到攒补给，闯关更从容', 360, 369, 25, C.deep, 520, true);
  tools.forEach((tool, index) => {
    const count = save.bag[tool.id];
    const x = index % 2 === 0 ? 220 : 500;
    const y = index < 2 ? 565 : 887;
    const card = P.skin(parent, `Bag-${tool.id}`, 'tile', x, y, 254, 276);
    P.skin(card, 'QuantityBadge', 'pill-dark', 61, -106, 111, 45);
    P.text(card, 'Quantity', `×${count}`, 61, -109, 25, count ? '#FFF0B7' : '#E0CFB2', 100, true);
    const icon = P.sprite(card, 'ToolIcon', art.tools[tool.icon], -4, -46, 110, 110);
    if (!count) P.opacity(icon, 170);
    P.text(card, 'ToolName', tool.name, 0, 28, 32, C.deep, 218, true);
    const detail = P.text(card, 'ToolDetail', tool.detail, 0, 77, 21, C.muted, 215);
    detail.enableWrapText = true;
    detail.lineHeight = 27;
    detail.node.getComponent(UITransform)!.setContentSize(215, 60);
    detail.overflow = Label.Overflow.SHRINK;
  });
  P.text(
    parent,
    'FreeTools',
    online ? '每关免费次数以关卡配置为准' : '每局免费：撤回1 · 铲出1 · 提示3 · 重排1',
    360,
    1087,
    22,
    C.deep,
    540,
    true,
  );
  P.text(parent, 'BagUsage', '免费次数用完后，再消耗背包库存', 360, 1124, 21, C.muted, 530);
  P.button(parent, 'BagDone', '收好背包', 360, 1223, 526, 94, onClose, true, 30);
}
