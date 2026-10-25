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
  day: number,
  claimed: boolean,
  tools: RewardTool[],
  art: RewardArt,
  onClaim: () => void,
): Node {
  P.text(parent, 'CalendarTitle', '七日补给', 189, 442, 27, C.deep, 190, true, 'left');
  P.text(
    parent,
    'Progress',
    `已领 ${day + (claimed ? 1 : 0)} / 7 天`,
    522,
    442,
    23,
    C.muted,
    205,
    false,
    'right',
  );
  P.line(parent, 98, 468, 622, 468, '#D5BD89', 2);
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
      const y = 577 + Math.floor(index / 3) * 216;
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
      const gift = P.skin(parent, 'Day7', 'nav', 360, 974, 532, 138);
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
    1078,
    21,
    C.muted,
    540,
  );
  const button = P.button(
    parent,
    'ClaimSignIn',
    claimed ? '今日已领 · 明天再来' : '收下今日奖励',
    360,
    1162,
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
  P.text(parent, 'BagIntro', '背包补给，仅限闯关模式使用', 360, 369, 25, C.deep, 520, true);
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
    online ? '挑战仅用本关免费次数，不消耗背包' : '挑战免费：撤回1 · 铲出1 · 提示3 · 重排1',
    360,
    1087,
    22,
    C.deep,
    540,
    true,
  );
  P.text(
    parent,
    'BagUsage',
    '闯关先用免费次数，再用背包，直至库存用完',
    360,
    1124,
    21,
    C.muted,
    550,
  );
  P.button(parent, 'BagDone', '收好背包', 360, 1223, 526, 94, onClose, true, 30);
}
