import { BlockInputEvents, Node, Tween, tween } from 'cc';
import { HEIGHT, WIDTH } from './Layout';
import * as P from './Paint';

interface Motion {
  node: Node;
  backdrop: Node;
  pivotX: number;
  pivotY: number;
  scale: number;
  opacity: number;
  closing: boolean;
  afterClose?: () => void;
}

/** Animates the content around its panel center while the input mask stays full-screen. */
export class ModalPresenter {
  private currentMotion: Motion | null = null;
  private motions = new Set<Motion>();

  constructor(
    private readonly stage: Node,
    private readonly sound?: (cue: 'popup-open' | 'popup-close') => void,
  ) {}

  get current(): Node | null {
    if (this.currentMotion?.node.isValid) return this.currentMotion.node;
    // A retiring overlay still blocks the new screen until its exit completes.
    return (
      Array.from(this.motions)
        .reverse()
        .find((motion) => motion.node.isValid)?.node || null
    );
  }

  show(name: string, shade = 162, pivotX = WIDTH / 2, pivotY = HEIGHT / 2): Node {
    this.close();
    this.sound?.('popup-open');
    const node = P.layer(this.stage, name);
    const backdrop = P.rounded(
      node,
      'Backdrop',
      WIDTH / 2,
      HEIGHT / 2,
      WIDTH,
      HEIGHT,
      '#251F15',
      0,
      undefined,
      shade,
    );
    backdrop.addComponent(BlockInputEvents);
    const motion: Motion = {
      node,
      backdrop,
      pivotX,
      pivotY,
      scale: 0.97,
      opacity: 0,
      closing: false,
    };
    this.currentMotion = motion;
    this.motions.add(motion);
    const blockClosing = (event: {
      propagationStopped: boolean;
      propagationImmediateStopped: boolean;
    }) => {
      if (!motion.closing) return;
      event.propagationStopped = true;
      event.propagationImmediateStopped = true;
    };
    for (const type of [
      Node.EventType.TOUCH_START,
      Node.EventType.TOUCH_MOVE,
      Node.EventType.TOUCH_END,
      Node.EventType.TOUCH_CANCEL,
      Node.EventType.MOUSE_DOWN,
      Node.EventType.MOUSE_UP,
    ]) {
      node.on(type, blockClosing, this, true);
    }
    this.apply(motion);
    tween(motion)
      .to(
        0.18,
        { scale: 1.008, opacity: 255 },
        { easing: 'quadOut', onUpdate: () => this.apply(motion) },
      )
      .to(0.08, { scale: 1 }, { easing: 'quadInOut', onUpdate: () => this.apply(motion) })
      .start();
    return node;
  }

  close(afterClose?: () => void): void {
    const node = this.current;
    const motion = Array.from(this.motions).find((item) => item.node === node);
    if (!motion) {
      afterClose?.();
      return;
    }
    if (afterClose && !motion.afterClose) motion.afterClose = afterClose;
    this.exit(motion);
  }

  owns(node: Node): boolean {
    return Array.from(this.motions).some((motion) => motion.node === node);
  }

  /** Screen changes cancel queued actions but allow the old artwork to fade away. */
  retire(): void {
    for (const motion of Array.from(this.motions)) {
      motion.afterClose = undefined;
      this.exit(motion);
    }
    this.currentMotion = null;
  }

  reset(): void {
    for (const motion of Array.from(this.motions)) this.dispose(motion);
    this.currentMotion = null;
  }

  private exit(motion: Motion): void {
    if (motion.closing) return;
    motion.closing = true;
    this.sound?.('popup-close');
    Tween.stopAllByTarget(motion);
    tween(motion)
      .to(
        0.18,
        { scale: Math.max(0.92, Math.min(0.97, motion.scale - 0.025)), opacity: 0 },
        { easing: 'quadIn', onUpdate: () => this.apply(motion) },
      )
      .call(() => {
        const callback = this.current === motion.node ? motion.afterClose : undefined;
        this.dispose(motion);
        callback?.();
      })
      .start();
  }

  private apply(motion: Motion): void {
    if (!motion.node.isValid) return;
    const scale = motion.scale;
    const x = motion.pivotX * (1 - scale),
      y = -motion.pivotY * (1 - scale);
    motion.node.setPosition(x, y);
    motion.node.setScale(scale, scale, 1);
    P.opacity(motion.node, motion.opacity);
    motion.backdrop.setPosition((WIDTH / 2 - x) / scale, (-HEIGHT / 2 - y) / scale);
    motion.backdrop.setScale(1 / scale, 1 / scale, 1);
  }

  private dispose(motion: Motion): void {
    Tween.stopAllByTarget(motion);
    this.motions.delete(motion);
    if (this.currentMotion === motion) this.currentMotion = null;
    if (!motion.node.isValid) return;
    motion.node.active = false;
    motion.node.removeFromParent();
    motion.node.destroy();
  }
}
