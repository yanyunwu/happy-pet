import { _decorator, Component, Label, Mask, Node, RichText, ScrollView, UITransform } from 'cc';
import * as P from './Paint';

const { ccclass } = _decorator;
const WIDTH = 514;
const HEIGHT = 744;

@ccclass('AnnouncementDialog')
export class AnnouncementDialog extends Component {
  private body!: RichText;
  private content!: UITransform;
  private scroll!: ScrollView;
  private action!: Label;
  private request!: () => Promise<string>;
  private closed = false;
  private loading = false;
  private failed = false;
  private generation = 0;

  configure(request: () => Promise<string>, onClose: () => void): void {
    this.request = request;
    const root = P.node(this.node, 'AnnouncementScroll', 360, 770, WIDTH, HEIGHT);
    const view = P.node(root, 'Viewport', 0, 0, WIDTH, HEIGHT);
    view.addComponent(Mask).type = Mask.Type.GRAPHICS_RECT;
    const content = P.node(view, 'Content', -WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT);
    this.content = content.getComponent(UITransform)!;
    this.content.setAnchorPoint(0, 1);
    const text = P.node(content, 'AnnouncementText', 0, 0, WIDTH, HEIGHT);
    text.getComponent(UITransform)!.setAnchorPoint(0, 1);
    // RichText lays out separate line textures, so even many newlines cannot create
    // one oversized texture. All markup is escaped: this remains plain text only.
    this.body = text.addComponent(RichText);
    this.body.fontFamily = 'Microsoft YaHei';
    this.body.fontSize = 32;
    this.body.lineHeight = 48;
    this.body.fontColor = P.color('#171717');
    this.body.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.body.verticalAlign = Label.VerticalAlign.TOP;
    this.body.maxWidth = WIDTH;
    this.body.handleTouchEvent = false;
    text.on(Node.EventType.SIZE_CHANGED, this.resizeContent, this);
    this.scroll = root.addComponent(ScrollView);
    this.scroll.content = content;
    this.scroll.horizontal = false;
    this.scroll.vertical = true;
    this.scroll.inertia = true;
    this.scroll.elastic = true;
    const button = P.button(
      this.node,
      'NewsDone',
      '知道了',
      360,
      1237,
      510,
      86,
      () => {
        if (this.failed) void this.load();
        else onClose();
      },
      true,
      29,
    );
    this.action = button.getComponentInChildren(Label)!;
    void this.load();
  }

  private resizeContent(): void {
    this.content.setContentSize(
      WIDTH,
      Math.max(HEIGHT, this.body.node.getComponent(UITransform)!.height),
    );
  }

  private setText(value: string): void {
    // Cocos decodes &amp; before quote entities. Keep each literal ampersand in
    // its own same-color segment so strings such as "&quot;" cannot decode twice.
    this.body.string = value
      .split('&')
      .map((part) => part.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
      .join('<color=#171717>&amp;</color>');
    this.resizeContent();
    this.scroll.stopAutoScroll();
    this.scroll.scrollToTop(0);
  }

  private async load(): Promise<void> {
    if (this.closed || this.loading) return;
    this.loading = true;
    this.failed = false;
    const generation = ++this.generation;
    this.action.string = '知道了';
    this.setText('公告加载中…');
    try {
      const text = await this.request();
      if (this.closed || !this.isValid || generation !== this.generation) return;
      this.setText(text.trim() ? text : '暂无公告');
    } catch {
      if (this.closed || !this.isValid || generation !== this.generation) return;
      this.failed = true;
      this.setText('公告暂时加载失败。\n\n请点击下方按钮重新加载。');
      this.action.string = '重新加载';
    } finally {
      if (generation === this.generation) this.loading = false;
    }
  }

  dispose(): void {
    this.closed = true;
    this.generation++;
    this.scroll?.stopAutoScroll();
  }

  onDestroy(): void {
    this.dispose();
  }
}
