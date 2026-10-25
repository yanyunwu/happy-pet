import { Graphics, Node, Rect, Size, SpriteFrame } from 'cc';
import * as P from './Paint';
import { EXTRA_SLOT_X, EXTRA_SLOT_Y } from './Layout';

/** Reuses the existing tray's carved end to make one full-width wooden pocket. */
export class ExtraSlotView {
  readonly node: Node;
  private readonly frame: SpriteFrame;
  private readonly prompt: Node;
  private enabled = false;

  constructor(parent: Node, tray: SpriteFrame, onUnlock: () => void) {
    const rect = tray.rect;
    const halfWidth = (rect.width * 74) / 720;
    this.frame = new SpriteFrame();
    this.frame.texture = tray.texture;
    this.frame.rect = new Rect(rect.x, rect.y, halfWidth, rect.height);
    this.frame.originalSize = new Size(halfWidth, rect.height);
    this.node = P.node(parent, 'UnlockExtraSlot', EXTRA_SLOT_X, EXTRA_SLOT_Y + 7, 128, 126);
    P.sprite(this.node, 'WoodLeft', this.frame, -32, 0, 64, 126);
    P.sprite(this.node, 'WoodRight', this.frame, 32, 0, 64, 126).setScale(-1, 1, 1);
    this.prompt = P.node(this.node, 'UnlockPrompt');
    this.drawVideoIcon();
    this.node.on(Node.EventType.TOUCH_END, () => {
      if (this.enabled) onUnlock();
    });
  }

  private drawVideoIcon(): void {
    const video = P.node(this.prompt, 'Video', 0, -8, 62, 68);
    const g = video.addComponent(Graphics);
    const rounded = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
      g.fillColor = P.color(fill);
      g.roundRect(x, y, w, h, r);
      g.fill();
    };
    const polygon = (points: number[][], fill: string) => {
      g.fillColor = P.color(fill);
      g.moveTo(points[0][0], points[0][1]);
      points.slice(1).forEach(([x, y]) => g.lineTo(x, y));
      g.close();
      g.fill();
    };
    // A raised teal badge, ivory clapperboard and warm edge highlights match the woodwork.
    rounded(-31, -35, 62, 66, 12, '#24434A');
    rounded(-31, -30, 62, 64, 12, '#79AFB1');
    rounded(-28, -29, 56, 59, 10, '#285F6D');
    rounded(-21, 26, 35, 2, 1, '#A8D0C9');
    rounded(-22, -25, 44, 34, 5, '#B4D2C6');
    rounded(-22, -21, 44, 33, 5, '#FFF5DC');
    rounded(-23, 13, 46, 12, 3, '#FFF5DC');
    for (const x of [-21, -5, 11]) {
      polygon(
        [
          [x, 25],
          [x + 7, 25],
          [Math.min(x + 17, 23), 13],
          [x + 10, 13],
        ],
        '#285F6D',
      );
    }
    rounded(-23, 10, 46, 3, 1, '#173F4A');
    polygon(
      [
        [-5, 5],
        [10, -4],
        [-5, -13],
      ],
      '#285F6D',
    );
    g.fillColor = P.color('#DEC18A');
    g.circle(-19, 11.5, 2);
    g.fill();
  }

  update(unlocked: boolean, pending: boolean, available: boolean): void {
    this.prompt.active = !unlocked;
    P.opacity(this.prompt, pending ? 140 : 255);
    this.enabled = !unlocked && !pending && available;
  }

  destroy(): void {
    this.frame.destroy();
  }
}
