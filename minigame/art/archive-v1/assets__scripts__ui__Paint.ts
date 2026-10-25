import { Color, Graphics, Label, Layers, Node, Sprite, SpriteFrame, UITransform, UIOpacity, Vec3, tween } from 'cc';

export const PALETTE = {
    ink: '#514367', muted: '#9484A8', purple: '#9671DA', deep: '#7954BD',
    cream: '#FFFDF6', lavender: '#F0E9FB', mint: '#DDF3E8', peach: '#FFE5DB',
    pink: '#ECA6BD', border: '#DFD3EF', white: '#FFFFFF', gold: '#F6CE72', danger: '#D27A96',
};
export function color(hex: string, alpha = 255): Color {
    const c = new Color(); Color.fromHEX(c, hex); c.a = alpha; return c;
}
export function node(parent: Node, name: string, x = 0, y = 0, w = 0, h = 0): Node {
    const n = new Node(name); n.layer = Layers.Enum.UI_2D; n.parent = parent;
    n.setPosition(x, -y); n.addComponent(UITransform).setContentSize(w, h); return n;
}
export function layer(parent: Node, name: string): Node {
    const n = node(parent, name, 0, 0, 720, 1280);
    n.getComponent(UITransform)!.setAnchorPoint(0, 1); return n;
}
export function rounded(parent: Node, name: string, x: number, y: number, w: number, h: number,
    fill: string, radius = 24, stroke?: string, alpha = 255, shadow = false): Node {
    const n = node(parent, name, x, y, w, h); const g = n.addComponent(Graphics);
    if (shadow) { g.fillColor = color('#88729E', 30); g.roundRect(-w / 2, -h / 2 - 7, w, h, radius); g.fill(); }
    g.fillColor = color(fill, alpha); g.roundRect(-w / 2, -h / 2, w, h, radius); g.fill();
    if (stroke) { g.strokeColor = color(stroke); g.lineWidth = 2; g.roundRect(-w / 2, -h / 2, w, h, radius); g.stroke(); }
    return n;
}
export function text(parent: Node, name: string, value: string, x: number, y: number, size = 26,
    tint = PALETTE.ink, width = 640, bold = false, align: 'center' | 'left' | 'right' = 'center'): Label {
    const n = node(parent, name, x, y, width, size * 1.5); const l = n.addComponent(Label);
    l.string = value; l.fontSize = size; l.lineHeight = Math.ceil(size * 1.4);
    l.fontFamily = 'Microsoft YaHei'; l.isBold = bold; l.color = color(tint);
    l.horizontalAlign = align === 'left' ? Label.HorizontalAlign.LEFT : align === 'right' ? Label.HorizontalAlign.RIGHT : Label.HorizontalAlign.CENTER;
    l.verticalAlign = Label.VerticalAlign.CENTER; l.overflow = Label.Overflow.SHRINK; l.enableWrapText = false;
    l.cacheMode = Label.CacheMode.CHAR; return l;
}
export function sprite(parent: Node, name: string, frame: SpriteFrame, x: number, y: number, w: number, h: number): Node {
    const n = node(parent, name, x, y, w, h); const s = n.addComponent(Sprite);
    // Setting spriteFrame can apply its native atlas dimensions. Reapply the
    // requested UI size after choosing CUSTOM so sliced icons stay tile-sized.
    s.sizeMode = Sprite.SizeMode.CUSTOM; s.spriteFrame = frame;
    n.getComponent(UITransform)!.setContentSize(w, h); return n;
}
export function opacity(n: Node, value: number): UIOpacity {
    const o = n.getComponent(UIOpacity) || n.addComponent(UIOpacity); o.opacity = value; return o;
}
export function button(parent: Node, name: string, label: string, x: number, y: number, w: number, h: number,
    onClick: () => void, primary = false, fontSize = 28): Node {
    const n = rounded(parent, name, x, y, w, h, primary ? PALETTE.purple : PALETTE.cream, Math.min(28, h / 2), primary ? '#8761CE' : PALETTE.border, 255, true);
    if (primary) {
        const g = n.getComponent(Graphics)!; g.strokeColor = color('#CDB5F4'); g.lineWidth = 2;
        g.moveTo(-w / 2 + 30, h / 2 - 5); g.lineTo(w / 2 - 30, h / 2 - 5); g.stroke();
    }
    if (label) text(n, `${name}-label`, label, 0, -1, fontSize, primary ? PALETTE.white : PALETTE.ink, w - 24, true);
    n.on(Node.EventType.TOUCH_START, () => { n.setScale(0.96, 0.96, 1); });
    n.on(Node.EventType.TOUCH_CANCEL, () => { n.setScale(1, 1, 1); });
    n.on(Node.EventType.TOUCH_END, () => { n.setScale(1, 1, 1); onClick(); });
    return n;
}
export function star(parent: Node, x: number, y: number, radius: number, tint: string, alpha = 255): Node {
    const n = node(parent, 'star', x, y); const g = n.addComponent(Graphics); g.fillColor = color(tint, alpha);
    for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + i * Math.PI / 5; const r = i % 2 ? radius * 0.46 : radius;
        if (i === 0) g.moveTo(Math.cos(a) * r, Math.sin(a) * r); else g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.close(); g.fill(); return n;
}
export function line(parent: Node, x1: number, y1: number, x2: number, y2: number, tint: string, width = 2): void {
    const n = node(parent, 'line'); const g = n.addComponent(Graphics); g.strokeColor = color(tint); g.lineWidth = width;
    g.moveTo(x1, -y1); g.lineTo(x2, -y2); g.stroke();
}
export function icon(parent: Node, type: string, x: number, y: number, size = 22, tint = PALETTE.ink): Node {
    const n = node(parent, `icon-${type}`, x, y, size * 2, size * 2); const g = n.addComponent(Graphics);
    g.strokeColor = color(tint); g.fillColor = color(tint); g.lineWidth = 3.5; g.lineCap = Graphics.LineCap.ROUND; g.lineJoin = Graphics.LineJoin.ROUND;
    const s = size;
    if (type === 'back') { g.moveTo(s * .3, s * .6); g.lineTo(-s * .35, 0); g.lineTo(s * .3, -s * .6); g.stroke(); }
    if (type === 'close') { g.moveTo(-s * .45, -s * .45); g.lineTo(s * .45, s * .45); g.moveTo(-s * .45, s * .45); g.lineTo(s * .45, -s * .45); g.stroke(); }
    if (type === 'sound' || type === 'mute') {
        g.moveTo(-s * .7, -s * .22); g.lineTo(-s * .35, -s * .22); g.lineTo(s * .1, -s * .6);
        g.lineTo(s * .1, s * .6); g.lineTo(-s * .35, s * .22); g.lineTo(-s * .7, s * .22); g.close(); g.stroke();
        if (type === 'sound') { g.moveTo(s * .4, s * .4); g.bezierCurveTo(s * .9, s * .22, s * .9, -s * .22, s * .4, -s * .4); g.stroke(); }
        else { g.moveTo(s * .4, -s * .28); g.lineTo(s * .9, s * .28); g.moveTo(s * .4, s * .28); g.lineTo(s * .9, -s * .28); g.stroke(); }
    }
    if (type === 'undo') { g.moveTo(-s * .6, s * .3); g.bezierCurveTo(-s * .1, s * .9, s * .9, s * .4, s * .65, -s * .25); g.bezierCurveTo(s * .5, -s * .75, -s * .3, -s * .8, -s * .55, -s * .35); g.stroke(); g.moveTo(-s * .65, s * .75); g.lineTo(-s * .65, s * .3); g.lineTo(-s * .2, s * .3); g.stroke(); }
    if (type === 'shuffle') {
        g.moveTo(-s * .7, s * .45); g.lineTo(-s * .35, s * .45); g.lineTo(s * .35, -s * .45); g.lineTo(s * .7, -s * .45);
        g.moveTo(-s * .7, -s * .45); g.lineTo(-s * .35, -s * .45); g.lineTo(s * .35, s * .45); g.lineTo(s * .7, s * .45); g.stroke();
        for (const d of [-1, 1]) { g.moveTo(s * .4, d * s * .2); g.lineTo(s * .75, d * s * .45); g.lineTo(s * .4, d * s * .7); g.stroke(); }
    }
    if (type === 'hint') { g.circle(0, s * .15, s * .5); g.stroke(); g.moveTo(-s * .2, -s * .4); g.lineTo(-s * .2, -s * .7); g.lineTo(s * .2, -s * .7); g.lineTo(s * .2, -s * .4); g.stroke(); }
    if (type === 'play') { g.moveTo(-s * .35, s * .55); g.lineTo(s * .6, 0); g.lineTo(-s * .35, -s * .55); g.close(); g.fill(); }
    if (type === 'lock') { g.roundRect(-s * .45, -s * .6, s * .9, s * .85, 4); g.stroke(); g.moveTo(-s * .3, s * .23); g.lineTo(-s * .3, s * .43); g.bezierCurveTo(-s * .3, s * .88, s * .3, s * .88, s * .3, s * .43); g.lineTo(s * .3, s * .23); g.stroke(); }
    return n;
}
export function pop(n: Node, delay = 0): void {
    n.setScale(.9, .9, 1); const o = opacity(n, 0);
    tween(n).delay(delay).to(.32, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
    tween(o).delay(delay).to(.2, { opacity: 255 }).start();
}
