import {
  _decorator,
  assetManager,
  Component,
  director,
  Label,
  Node,
  profiler,
  ResolutionPolicy,
  Tween,
  UITransform,
  Vec3,
  tween,
  view,
} from 'cc';

const { ccclass, property } = _decorator;

/** Lightweight authored launch scene. Loads the real game before handing off. */
@ccclass('LoadingScreen')
export class LoadingScreen extends Component {
  @property(Node) stageRoot: Node | null = null;
  private progress = 0;
  private token = 0;
  private busy = false;
  private startedAt = 0;
  private get status(): Label {
    return this.stageRoot!.getChildByName('Status')!.getComponent(Label)!;
  }
  private get percent(): Label {
    return this.stageRoot!.getChildByName('Percent')!.getComponent(Label)!;
  }
  private get retry(): Node {
    return this.stageRoot!.getChildByName('Retry')!;
  }

  onLoad(): void {
    profiler.hideStats();
    view.setDesignResolutionSize(720, 1560, ResolutionPolicy.SHOW_ALL);
    for (let i = 0; i < 3; i++) {
      const dot = this.stageRoot!.getChildByName(`Dot${i}`)!;
      tween(dot)
        .delay(i * 0.16)
        .repeatForever(
          tween()
            .to(0.34, { position: new Vec3(330 + i * 30, -1213) })
            .to(0.34, { position: new Vec3(330 + i * 30, -1205) })
            .delay(0.32),
        )
        .start();
    }
    this.retry.on(Node.EventType.TOUCH_END, () => this.loadGame());
    // Let the launch scene render before the first main-scene fetch.
    this.scheduleOnce(() => this.loadGame(), 0);
  }
  private setProgress(value: number): void {
    this.progress = Math.max(this.progress, Math.min(1, value));
    const fill = this.stageRoot!.getChildByName('ProgressFill')!;
    fill.active = this.progress > 0;
    fill.getComponent(UITransform)!.setContentSize(Math.max(1, 500 * this.progress), 22);
    this.percent.string = `${Math.floor(this.progress * 100)}%`;
  }
  private loadGame(): void {
    if (this.busy) return;
    this.busy = true;
    this.retry.active = false;
    this.progress = 0;
    this.startedAt = Date.now();
    this.status.string = '萌宠们正在集合…';
    this.setProgress(0);
    const token = ++this.token;
    const bundle = assetManager.bundles.find((item) => !!item.getSceneInfo('main'));
    if (!bundle) {
      this.failed();
      return;
    }
    if (token > 1) {
      // Creator 3.8 mutates packed scene data during deserialization.
      // After a failed dependency, re-download just this scene's import
      // record; otherwise the second parse can see a destroyed scene.
      (assetManager as unknown as { files: { remove(id: string): unknown } }).files.remove(
        `${bundle.getSceneInfo('main')!.uuid}@import`,
      );
    }
    // Load and parse the scene in one operation. A failed dependency can
    // leave a partial SceneAsset cached; retry must explicitly reload it.
    bundle.loadScene(
      'main',
      { reloadAsset: token > 1 },
      (finished, total) => {
        if (!this.isValid || token !== this.token || total <= 0) return;
        this.setProgress(finished / total);
      },
      (error, scene) => {
        if (!this.isValid || token !== this.token) return;
        if (error || !scene?.scene) {
          this.failed();
          return;
        }
        this.setProgress(1);
        this.status.string = '准备好啦，一起出发！';
        this.scheduleOnce(
          () => {
            if (!this.isValid || token !== this.token) return;
            director.runSceneImmediate(scene.scene!);
          },
          Math.max(0, (500 - (Date.now() - this.startedAt)) / 1000),
        );
      },
    );
  }
  private failed(): void {
    this.busy = false;
    this.status.string = '加载遇到问题，点一下重试吧';
    this.percent.string = '未完成';
    this.retry.active = true;
  }
  onDestroy(): void {
    this.token++;
    this.unscheduleAllCallbacks();
    this.stageRoot?.children.forEach((node) => Tween.stopAllByTarget(node));
  }
}
