import { BlockInputEvents, Node, SpriteFrame, Tween, tween } from 'cc';
import { HEIGHT, WIDTH } from './Layout';
import * as P from './Paint';

interface LeafMotion {
  token: number;
  node: Node;
  phase: number;
  started: number;
  closing?: Promise<void>;
  resolve?: () => void;
}

/** A text-free cover owned by a single level request, independent of dialogs. */
export class LeafTransition {
  private serial = 0;
  private motion: LeafMotion | null = null;

  constructor(
    private readonly stage: Node,
    private readonly background: SpriteFrame | null,
  ) {}

  get active(): boolean {
    return !!this.motion;
  }
  owns(node: Node): boolean {
    return this.motion?.node === node;
  }
  isCurrent(token: number): boolean {
    return this.serial === token && this.stage.isValid;
  }

  show(): number {
    this.reset();
    const node = P.layer(this.stage, 'LevelTransition');
    node.addComponent(BlockInputEvents);
    if (this.background)
      P.sprite(node, 'Forest', this.background, WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT);
    P.rounded(node, 'Mist', WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, '#E6EAD4', 0, undefined, 224);
    const center = P.rounded(
      node,
      'SeedGlow',
      WIDTH / 2,
      HEIGHT / 2 - 20,
      132,
      132,
      '#FFF4C8',
      66,
      undefined,
      125,
    );
    const leaves = Array.from({ length: 6 }, (_, i) => {
      const leaf = P.leaf(
        node,
        WIDTH / 2,
        HEIGHT / 2 - 20,
        34,
        ['#78934D', '#A8B65E', '#C9AE65', '#547B45', '#91A95A', '#D7BC78'][i],
      );
      return leaf;
    });
    const motion: LeafMotion = { token: this.serial, node, phase: 0, started: Date.now() };
    this.motion = motion;
    const draw = () => {
      if (!node.isValid) return;
      const amount = motion.phase;
      leaves.forEach((leaf, i) => {
        const angle = (i * Math.PI) / 3 + amount * 0.65;
        const radius = 115 * (1 - amount) + 23;
        leaf.setPosition(
          WIDTH / 2 + Math.cos(angle) * radius,
          -HEIGHT / 2 + 20 + Math.sin(angle) * radius,
        );
        leaf.angle = (angle * 180) / Math.PI;
        const scale = 0.82 + amount * 0.18;
        leaf.setScale(scale, scale, 1);
      });
      center.setScale(0.65 + amount * 0.35, 0.65 + amount * 0.35, 1);
      P.opacity(center, 100 + amount * 130);
    };
    draw();
    tween(P.opacity(node, 0)).to(0.16, { opacity: 255 }).start();
    tween(motion)
      .repeatForever(
        tween<LeafMotion>()
          .to(0.85, { phase: 1 }, { easing: 'sineInOut', onUpdate: draw })
          .delay(0.12)
          .to(0.85, { phase: 0 }, { easing: 'sineInOut', onUpdate: draw }),
      )
      .start();
    return motion.token;
  }

  bringToFront(): void {
    if (this.motion?.node.isValid) this.motion.node.setSiblingIndex(this.stage.children.length - 1);
  }

  hide(token: number): Promise<void> {
    const motion = this.motion;
    if (!motion || motion.token !== token) return Promise.resolve();
    if (motion.closing) return motion.closing;
    motion.closing = new Promise<void>((resolve) => {
      motion.resolve = resolve;
      const opacity = P.opacity(motion.node, 255);
      Tween.stopAllByTarget(opacity);
      tween(opacity)
        .delay(Math.max(0, 0.38 - (Date.now() - motion.started) / 1000))
        .to(0.2, { opacity: 0 }, { easing: 'sineOut' })
        .call(() => this.dispose(motion))
        .start();
    });
    return motion.closing;
  }

  reset(): void {
    this.serial++;
    if (this.motion) this.dispose(this.motion);
  }

  private dispose(motion: LeafMotion): void {
    Tween.stopAllByTarget(motion);
    if (motion.node.isValid) {
      Tween.stopAllByTarget(P.opacity(motion.node, 0));
      motion.node.active = false;
      motion.node.removeFromParent();
      motion.node.destroy();
    }
    if (this.motion === motion) this.motion = null;
    motion.resolve?.();
  }
}
