const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const write = (file, data) => {
  const out = path.join(root, file),
    text = JSON.stringify(data, null, 2) + '\n';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out) && fs.readFileSync(out, 'utf8') === text) return;
  // Creator may memory-map a live .meta file on Windows; replace it atomically.
  const staging = path.join(root, 'temp/asset-preparation');
  fs.mkdirSync(staging, { recursive: true });
  const temporary = path.join(
    staging,
    crypto.createHash('sha256').update(out).digest('hex') + '.json',
  );
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, out);
};
const uuid = (name) => {
  const h = crypto
    .createHash('md5')
    .update('star-isle/' + name)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};
const compress = (id) => {
  const h = id.replace(/-/g, ''),
    a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = h.slice(0, 5);
  for (let i = 5; i < 32; i += 3) {
    const n = parseInt(h.slice(i, i + 3), 16);
    s += a[n >> 6] + a[n & 63];
  }
  return s;
};
const frame = (file) => ({ __uuid__: uuid(file) + '@f9941', __expectedType__: 'cc.SpriteFrame' });
function imageMeta(file, width, height, border = 0) {
  const id = uuid(file),
    tex = id + '@6c48a',
    sf = id + '@f9941';
  const common = {
    wrapModeS: 'clamp-to-edge',
    wrapModeT: 'clamp-to-edge',
    minfilter: 'linear',
    magfilter: 'linear',
    mipfilter: 'none',
    premultiplyAlpha: false,
    anisotropy: 0,
    isUuid: true,
  };
  write(file + '.meta', {
    ver: '1.0.27',
    importer: 'image',
    imported: false,
    uuid: id,
    files: [],
    subMetas: {
      '6c48a': {
        importer: 'texture',
        uuid: tex,
        displayName: path.basename(file),
        id: '6c48a',
        name: 'texture',
        ver: '1.0.22',
        imported: false,
        files: [],
        subMetas: {},
        userData: { ...common, imageUuidOrDatabaseUri: id, visible: false },
      },
      f9941: {
        importer: 'sprite-frame',
        uuid: sf,
        displayName: path.basename(file),
        id: 'f9941',
        name: 'spriteFrame',
        ver: '1.0.12',
        imported: false,
        files: [],
        subMetas: {},
        userData: {
          ...common,
          imageUuidOrDatabaseUri: tex,
          trimType: 'none',
          trimThreshold: 1,
          rotated: false,
          offsetX: 0,
          offsetY: 0,
          trimX: 0,
          trimY: 0,
          width,
          height,
          rawWidth: width,
          rawHeight: height,
          borderTop: border,
          borderBottom: border,
          borderLeft: border,
          borderRight: border,
          packable: false,
          pixelsToUnit: 100,
          pivotX: 0.5,
          pivotY: 0.5,
          meshType: 0,
        },
      },
    },
    userData: {
      type: 'sprite-frame',
      hasAlpha: !file.endsWith('.jpg'),
      redirect: sf,
      fixAlphaTransparencyArtifacts: false,
    },
  });
}
function folderMeta(folder) {
  fs.mkdirSync(path.join(root, folder), { recursive: true });
  if (!fs.existsSync(path.join(root, folder + '.meta')))
    write(folder + '.meta', {
      ver: '1.2.0',
      importer: 'directory',
      imported: true,
      uuid: uuid(folder),
      files: [],
      subMetas: {},
      userData: {},
    });
}
const color = (hex, a = 255) => ({
  __type__: 'cc.Color',
  r: parseInt(hex.slice(1, 3), 16),
  g: parseInt(hex.slice(3, 5), 16),
  b: parseInt(hex.slice(5, 7), 16),
  a,
});
const vec = (x = 0, y = 0, z = 0) => ({ __type__: 'cc.Vec3', x, y, z });
class SceneWriter {
  constructor(name = 'main') {
    this.name = name;
    this.items = [];
    this.add({
      __type__: 'cc.SceneAsset',
      _name: name,
      _objFlags: 0,
      _native: '',
      scene: this.ref(1),
    });
    this.scene = this.add({
      __type__: 'cc.Scene',
      _name: name,
      _objFlags: 0,
      _parent: null,
      _children: [],
      _active: true,
      _components: [],
      _prefab: null,
      autoReleaseAssets: false,
      _id: uuid(`assets/scenes/${name}.scene`),
    });
  }
  ref(i) {
    return { __id__: i };
  }
  add(data) {
    this.items.push(data);
    return this.items.length - 1;
  }
  node(parent, name, x = 0, y = 0, w = 0, h = 0, anchor = [0.5, 0.5]) {
    const i = this.add({
      __type__: 'cc.Node',
      _name: name,
      _objFlags: 0,
      _parent: this.ref(parent),
      _children: [],
      _active: true,
      _components: [],
      _prefab: null,
      _lpos: vec(x, -y),
      _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
      _lscale: vec(1, 1, 1),
      _layer: 33554432,
      _euler: vec(),
      _id: uuid(`v2-node/${this.items.length}/${name}`),
    });
    this.items[parent]._children.push(this.ref(i));
    this.component(i, 'cc.UITransform', {
      _contentSize: { __type__: 'cc.Size', width: w, height: h },
      _anchorPoint: { __type__: 'cc.Vec2', x: anchor[0], y: anchor[1] },
    });
    return i;
  }
  component(node, type, fields = {}) {
    const i = this.add({
      __type__: type,
      _name: '',
      _objFlags: 0,
      node: this.ref(node),
      _enabled: true,
      __prefab: null,
      ...fields,
      _id: uuid('v2-component/' + this.items.length),
    });
    this.items[node]._components.push(this.ref(i));
    return i;
  }
  sprite(parent, name, x, y, w, h, file, { tint = '#FFFFFF', sliced = false, alpha = 255 } = {}) {
    const i = this.node(parent, name, x, y, w, h);
    this.component(i, 'cc.Sprite', {
      _visFlags: 0,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: color(tint, alpha),
      _spriteFrame: frame(file),
      _type: sliced ? 1 : 0,
      _fillType: 0,
      _sizeMode: 0,
      _fillCenter: { __type__: 'cc.Vec2', x: 0, y: 0 },
      _fillStart: 0,
      _fillRange: 0,
      _isTrimmedMode: false,
      _useGrayscale: false,
      _atlas: null,
    });
    return i;
  }
  skin(parent, name, x, y, w, h, asset, options = {}) {
    const file = `assets/resources/cartoon/ui/${asset}.png`;
    const metadata = JSON.parse(fs.readFileSync(path.join(root, file + '.meta'), 'utf8'));
    const { rawWidth, rawHeight } = metadata.subMetas.f9941.userData;
    if (options.sliced !== false && h > 0 && rawWidth > rawHeight) {
      // Match Paint.skin: keep artwork at its original height, stretch only
      // horizontally, then scale uniformly inside a stable native hit area.
      const host = this.node(parent, name, x, y, w, h);
      const scale = h / rawHeight;
      const graphic = this.sprite(host, 'SkinGraphic', 0, 0, w / scale, rawHeight, file, {
        sliced: true,
        ...options,
      });
      this.items[graphic]._lscale = vec(scale, scale, 1);
      return host;
    }
    return this.sprite(parent, name, x, y, w, h, file, {
      sliced: true,
      ...options,
    });
  }
  label(
    parent,
    name,
    value,
    x,
    y,
    size = 28,
    { tint = '#FFFFFF', width = 640, bold = true, outline = '#176083', stroke = 3, align = 1 } = {},
  ) {
    const i = this.node(parent, name, x, y, width, size * 1.6 + stroke * 2);
    this.component(i, 'cc.Label', {
      _visFlags: 0,
      _customMaterial: null,
      _srcBlendFactor: 2,
      _dstBlendFactor: 4,
      _color: color(tint),
      _string: value,
      _horizontalAlign: align,
      _verticalAlign: 1,
      _actualFontSize: size,
      _fontSize: size,
      _fontFamily: 'Microsoft YaHei',
      _lineHeight: Math.ceil(size * 1.45),
      _overflow: 2,
      _enableWrapText: false,
      _font: null,
      _isSystemFontUsed: true,
      _isItalic: false,
      _isBold: bold,
      _isUnderline: false,
      _underlineHeight: 0,
      _cacheMode: 0,
      _enableOutline: stroke > 0,
      _outlineColor: color(outline),
      _outlineWidth: stroke,
    });
    return i;
  }
  button(parent, name, x, y, w, h, asset, handler, data = '') {
    const i = this.skin(parent, name, x, y, w, h, asset);
    const event = this.add({
      __type__: 'cc.ClickEvent',
      target: this.ref(this.controller),
      component: '',
      _componentId: compress(uuid('assets/scripts/StarIsle.ts')),
      handler,
      customEventData: data,
    });
    this.component(i, 'cc.Button', {
      clickEvents: [this.ref(event)],
      _interactable: true,
      _transition: 3,
      _duration: 0.09,
      _zoomScale: 0.98,
      _target: this.ref(i),
      _normalColor: color('#FFFFFF'),
      _hoverColor: color('#FFFFFF'),
      _pressedColor: color('#FFFFFF'),
      _disabledColor: color('#AAAAAA'),
      _normalSprite: null,
      _hoverSprite: null,
      _pressedSprite: null,
      _disabledSprite: null,
    });
    return i;
  }
  inactive(node) {
    this.items[node]._active = false;
    return node;
  }
  finish(file) {
    const g = this.add({ __type__: 'cc.SceneGlobals' });
    this.items[this.scene]._globals = this.ref(g);
    for (const [key, type] of [
      ['ambient', 'cc.AmbientInfo'],
      ['shadows', 'cc.ShadowsInfo'],
      ['_skybox', 'cc.SkyboxInfo'],
      ['fog', 'cc.FogInfo'],
    ])
      this.items[g][key] = this.ref(this.add({ __type__: type, _enabled: false }));
    write(file, this.items);
  }
}
module.exports = {
  root,
  write,
  uuid,
  compress,
  frame,
  imageMeta,
  folderMeta,
  color,
  vec,
  SceneWriter,
};
