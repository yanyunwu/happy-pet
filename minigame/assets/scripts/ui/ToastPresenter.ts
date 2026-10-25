import { Label, Node, Tween, UIOpacity, UITransform, sys, tween } from 'cc';
import { HEIGHT, WIDTH } from './Layout';
import * as P from './Paint';

interface Notice {
  node: Node;
  label: Label;
  badge: Node;
  fade: UIOpacity;
  x: number;
  top: number;
  height: number;
  offset: number;
  opacity: number;
}

/** One non-blocking woodland notice, shared by home, play and dialogs. */
export class ToastPresenter {
  private notice: Notice | null = null;

  constructor(private readonly stage: Node) {}

  show(message: string): void {
    const text = message.trim();
    if (!text || !this.stage.isValid) return;
    const fresh = !this.notice?.node.isValid;
    const notice = fresh ? this.create() : this.notice!;
    this.notice = notice;
    Tween.stopAllByTarget(notice);
    this.layout(notice, text);
    this.bringToFront();
    this.apply(notice);
    const lifetime = Math.max(2.6, Math.min(5, Array.from(text).length * 0.085));
    tween(notice)
      .to(
        fresh ? 0.22 : 0.12,
        { offset: 0, opacity: 255 },
        { easing: 'cubicOut', onUpdate: () => this.apply(notice) },
      )
      .delay(lifetime)
      .to(
        0.22,
        { offset: -12, opacity: 0 },
        { easing: 'sineIn', onUpdate: () => this.apply(notice) },
      )
      .call(() => this.dispose(notice))
      .start();
  }

  bringToFront(): void {
    if (this.notice?.node.isValid) this.notice.node.setSiblingIndex(this.stage.children.length - 1);
  }

  reset(): void {
    if (this.notice) this.dispose(this.notice);
  }

  private create(): Notice {
    // No buttons, touch handlers or input mask: the game remains usable underneath.
    const node = P.node(this.stage, 'Toast');
    const badge = P.rounded(node, 'LeafBadge', 0, -6, 62, 62, '#526B3B', 31, '#D9D49A');
    P.rounded(badge, 'BadgeInset', 0, -1, 52, 52, '#65804A', 26);
    const leaf = P.leaf(badge, -7, 0, 18, '#E0E9A6');
    leaf.angle = -36;
    const bud = P.leaf(badge, 10, -8, 12, '#F7E7AF');
    bud.angle = 38;
    const label = P.text(node, 'ToastMessage', '', 36, -6, 25, '#3F5630', 496, true, 'left');
    label.enableWrapText = true;
    label.lineHeight = 34;
    return {
      node,
      label,
      badge,
      fade: P.opacity(node, 0),
      x: WIDTH / 2,
      top: 196,
      height: 92,
      offset: -18,
      opacity: 0,
    };
  }

  private layout(notice: Notice, message: string): void {
    let left = 32,
      right = WIDTH - 32,
      top = 196;
    try {
      const safe = sys.getSafeAreaRect(false);
      if (safe.width > 0 && safe.height > 0) {
        const safeLeft = Math.max(left, safe.x + 16);
        const safeRight = Math.min(right, safe.x + safe.width - 16);
        if (safeRight - safeLeft >= 280) {
          left = safeLeft;
          right = safeRight;
        }
        top = Math.max(top, HEIGHT - safe.y - safe.height + 24);
      }
    } catch {
      // Older hosts still use the authored portrait margins.
    }
    const width = Math.min(624, right - left);
    const { label, node } = notice;
    const textBox = label.node.getComponent(UITransform)!;
    label.string = message;
    label.fontSize = 25;
    label.overflow = Label.Overflow.RESIZE_HEIGHT;
    textBox.setContentSize(width - 128, 34);
    label.updateRenderData(true);
    const textHeight = Math.max(34, Math.min(102, textBox.height));
    // Keep very long server messages inside the plate instead of spilling onto play.
    label.overflow = Label.Overflow.SHRINK;
    textBox.setContentSize(width - 128, textHeight);
    label.updateRenderData(true);
    notice.height = Math.max(92, textHeight + 44);
    notice.top = top;
    notice.x = (left + right) / 2;
    node.getComponent(UITransform)!.setContentSize(width, notice.height);
    notice.badge.setPosition(-width / 2 + 52, 6);
    const oldSurface = node.getChildByName('Surface');
    if (oldSurface) {
      oldSurface.removeFromParent();
      oldSurface.destroy();
    }
    const surface = P.skin(node, 'Surface', 'nav', 0, 0, width, notice.height);
    surface.setSiblingIndex(0);
  }

  private apply(notice: Notice): void {
    if (!notice.node.isValid) return;
    notice.node.setPosition(notice.x, -(notice.top + notice.height / 2 + notice.offset));
    notice.fade.opacity = notice.opacity;
  }

  private dispose(notice: Notice): void {
    Tween.stopAllByTarget(notice);
    if (this.notice === notice) this.notice = null;
    if (!notice.node.isValid) return;
    notice.node.active = false;
    notice.node.removeFromParent();
    notice.node.destroy();
  }
}
