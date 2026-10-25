// Editable native Creator scene implementing the approved woodland concept.
// Ordinary builds never regenerate scenes or overwrite editor changes.
const { SceneWriter, frame, compress, uuid, color, vec } = require('./lib/creator.cjs');
const s = new SceneWriter(),
  W = 720,
  H = 1560;
const group = (p, name) => s.node(p, name, 0, 0, W, H, [0, 1]);
const icon = (p, name, index, x, y, size = 90) =>
  s.sprite(p, name, x, y, size, size, `assets/resources/cartoon/icons/${index}.png`);
const pet = (p, name, index, x, y, size = 82) =>
  s.sprite(p, name, x, y, size, size, `assets/resources/cartoon/pets/${index}.png`);
// Same white-face bounds and nine-slice mapping as ui/Layout.tileFaceCenterY.
const tileFaceCenterY = (height) => (4 + 26 + ((98 - 26) * (height - 52)) / 80 - height) / 2;
const label = (p, name, value, x, y, size = 28, options = {}) =>
  s.label(p, name, value, x, y, size, {
    tint: '#51351F',
    outline: '#FFF4DC',
    stroke: 0,
    ...options,
  });
const tilt = (node, degrees) => {
  s.items[node]._euler.z = degrees;
  const a = (degrees * Math.PI) / 360;
  s.items[node]._lrot = { __type__: 'cc.Quat', x: 0, y: 0, z: Math.sin(a), w: Math.cos(a) };
};
const entryIcon = (parent, petId) => {
  const n = s.node(parent, 'EntryIcon', -106, -5, 100, 104);
  tilt(n, 11);
  s.skin(n, 'PetTile', 0, 0, 91, 96, 'tile');
  if (petId === null) icon(n, 'Mountain', 3, 0, tileFaceCenterY(96), 83);
  else pet(n, 'PetIcon', petId, 0, tileFaceCenterY(96), 81);
};
const root = s.node(s.scene, 'StarIsleGame');
s.controller = root;
s.items[root]._layer = 1073741824;
const canvas = s.node(s.scene, 'Canvas', W / 2, -H / 2, W, H);
const cameraNode = s.node(canvas, 'UICamera');
s.items[cameraNode]._lpos = vec(0, 0, 1000);
const camera = s.component(cameraNode, 'cc.Camera', {
  _projection: 0,
  _priority: 1073741824,
  _fov: 45,
  _fovAxis: 0,
  _orthoHeight: H / 2,
  _near: 1,
  _far: 2000,
  _color: color('#BEC497'),
  _depth: 1,
  _stencil: 0,
  _clearFlags: 7,
  _rect: { __type__: 'cc.Rect', x: 0, y: 0, width: 1, height: 1 },
  _aperture: 19,
  _shutter: 7,
  _iso: 0,
  _screenScale: 1,
  _visibility: 33554432,
  _targetTexture: null,
});
s.component(canvas, 'cc.Canvas', { _cameraComponent: s.ref(camera), _alignCanvasWithScreen: true });
s.component(canvas, 'cc.Widget', {
  _alignFlags: 45,
  _target: null,
  _left: 0,
  _right: 0,
  _top: 0,
  _bottom: 0,
  _horizontalCenter: 0,
  _verticalCenter: 0,
  _isAbsLeft: true,
  _isAbsRight: true,
  _isAbsTop: true,
  _isAbsBottom: true,
  _isAbsHorizontalCenter: true,
  _isAbsVerticalCenter: true,
  _originalWidth: W,
  _originalHeight: H,
  _alignMode: 2,
  _lockFlags: 0,
});
const stage = s.node(canvas, 'Stage', -W / 2, -H / 2, W, H, [0, 1]);
const home = group(stage, 'HomePage');
s.sprite(home, 'KeyArt', 360, 780, W, H, 'assets/resources/cartoon/home.jpg');
const top = group(home, 'TopBar');
const menu = s.button(top, 'MenuButton', 56, 75, 76, 80, 'round-dark', 'onHomeNav', 'menu');
s.sprite(menu, 'Icon', 0, -3, 44, 44, 'assets/resources/cartoon/ui/menu.png');
s.skin(top, 'CoinCounter', 570, 76, 270, 82, 'pill-dark');
s.sprite(top, 'Coin', 464, 75, 86, 86, 'assets/resources/cartoon/home-ui/coin.png');
label(top, 'CoinsLabel', '萌宠金币', 588, 56, 22, { width: 172, tint: '#FFF0CA' });
label(top, 'CoinsValue', '0', 588, 89, 36, { width: 172, tint: '#FFE694' });
const branding = group(home, 'Branding');
s.sprite(
  branding,
  'Title',
  360,
  326,
  610,
  356,
  'assets/resources/cartoon/home-ui/woodland-logo.png',
);
const shortcuts = group(home, 'Shortcuts');
for (const [x, name, title, file, action] of [
  [110, 'SignInButton', '7日签到', 'home-ui/signin', 'signin'],
  [277, 'AlbumButton', '萌宠图鉴', 'icons/1', 'album'],
  [443, 'BagButton', '背包道具', 'home-ui/backpack', 'bag'],
  [610, 'SettingsButton', '声音设置', 'icons/4', 'settings'],
]) {
  const b = s.button(shortcuts, name, x, 1036, 138, 142, 'side-badge', 'onHomeNav', action);
  s.sprite(b, 'Icon', 0, -18, 104, 104, `assets/resources/cartoon/${file}.png`);
  s.skin(b, 'Nameplate', 0, 49, 154, 47, 'nav');
  label(b, 'Label', title, 0, 45, 24, { width: 148 });
  if (action === 'signin') s.skin(b, 'Notice', 54, -65, 21, 21, 'badge-red');
}
const welcome = group(home, 'WelcomePanel');
for (const [id, title, x, y, style, petId] of [
  ['classic', '经典三消', 185, 1220, 'button-blue', 12],
  ['quartet', '极限四消', 535, 1220, 'button-gold', 2],
  ['fun', '趣味规则消', 185, 1400, 'button-pink', 13],
]) {
  const b = s.button(welcome, `Mode-${id}`, x, y, 326, 158, style, 'onHomeMode', id);
  entryIcon(b, petId);
  label(b, 'Title', title, 31, -7, id === 'fun' ? 28 : 31, {
    width: 190,
    tint: '#FFF9E9',
    outline: '#75502D',
    stroke: 2,
  });
  label(b, 'Chevron', '›', 129, -8, 50, {
    width: 30,
    tint: '#FFF9E9',
    outline: '#75502D',
    stroke: 1,
  });
}
const campaign = s.button(
  welcome,
  'CampaignButton',
  535,
  1400,
  326,
  158,
  'button-amber',
  'onHomeNav',
  'campaign',
);
entryIcon(campaign, null);
label(campaign, 'Title', '闯关模式', 31, -7, 31, {
  width: 190,
  tint: '#FFF9E9',
  outline: '#986525',
  stroke: 2,
});
label(campaign, 'Chevron', '›', 129, -8, 50, {
  width: 30,
  tint: '#FFF9E9',
  outline: '#986525',
  stroke: 1,
});
const game = group(stage, 'GamePage');
s.inactive(game);
s.sprite(game, 'Background', 360, 780, W, H, 'assets/resources/cartoon/game.jpg');
const gameTop = group(game, 'TopBar');
for (const [x, name, glyph, action] of [
  [56, 'SettingsButton', 'gear', 'settings'],
  [664, 'PauseButton', 'pause', 'pause'],
]) {
  const b = s.button(gameTop, name, x, 77, 76, 80, 'round-dark', 'onGameAction', action);
  s.sprite(b, 'Icon', 0, -3, 49, 49, `assets/resources/cartoon/ui/${glyph}.png`);
}
s.sprite(
  gameTop,
  'ModePlaque',
  360,
  111,
  300,
  156,
  'assets/resources/cartoon/ui/header-hanging.png',
);
label(gameTop, 'LevelName', '经典三消', 360, 80, 32, { width: 276, tint: '#FFF5DA' });
label(gameTop, 'Chapter', '第 1 关', 360, 157, 27, { width: 222 });
s.inactive(label(gameTop, 'Remaining', '剩余 18', 620, 184, 19, { width: 130, tint: '#FFF5DA' }));
s.skin(game, 'InstructionPlaque', 360, 224, 360, 54, 'nav');
label(game, 'Instruction', '收集 3 个相同萌宠', 360, 220, 23, { width: 340 });
const boardPreview = group(game, 'BoardPreview');
for (let layer = 0; layer < 2; layer++)
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      const x = 360 + (col - 1) * 176,
        y = 646 + (row - 1) * 210 + (layer ? 24 : -22);
      const tile = s.skin(boardPreview, `PreviewPet-${layer}-${row}-${col}`, x, y, 94, 98, 'tile');
      pet(tile, 'Pet', (row + col + layer) % 3, 0, tileFaceCenterY(98), 81);
      if (!layer)
        s.sprite(tile, 'Covered', 0, -5, 94, 90, 'assets/resources/cartoon/ui/covered.png');
    }
group(game, 'Board');
const reserve = group(game, 'ReserveArea');
s.inactive(reserve);
s.skin(reserve, 'ReservePanel', 360, 1115, 680, 104, 'tray');
label(reserve, 'ReserveTitle', '铲出暂存 · 点击萌宠放回收纳槽', 360, 1045, 22, {
  width: 660,
  stroke: 1,
});
group(reserve, 'ReserveTiles');
s.inactive(
  label(game, 'TrayTitle', '空位不多啦，优先凑齐！', 360, 1351, 21, { width: 680, stroke: 1 }),
);
s.sprite(game, 'TrayPanel', 360, 1250, 690, 164, 'assets/resources/cartoon/ui/tray.png');
// Invisible editor guides mark the seven carved pockets and QA landing targets.
for (let i = 0; i < 7; i++) s.node(game, `Slot${i}`, 84 + i * 92, 1241, 89, 94);
group(game, 'Tray');
const tools = group(game, 'Toolbar');
for (const [x, name, title, idx, count] of [
  [120, 'undo', '撤回', 5, 1],
  [280, 'shovel', '铲出', 9, 1],
  [440, 'hint', '提示', 7, 3],
  [600, 'shuffle', '重排', 6, 1],
]) {
  const b = s.button(tools, `Tool-${name}`, x, 1434, 132, 140, 'tool-base', 'onGameAction', name);
  icon(b, 'Icon', idx, 0, -20, 86);
  label(b, 'Label', title, 0, 40, 25, { width: 116 });
  s.skin(b, 'CountBadge', 51, -59, 40, 30, 'badge-red');
  label(b, 'Count', String(count), 51, -62, 21, { width: 36, tint: '#FFF8EB' });
}
const skinNames = [
  'button-blue',
  'button-gold',
  'panel',
  'tile',
  'tray',
  'side-badge',
  'nav',
  'round-dark',
  'round-blue',
  'badge-red',
  'pill-dark',
  'button-pink',
  'button-amber',
];
s.component(root, compress(uuid('assets/scripts/StarIsle.ts')), {
  stageRoot: s.ref(stage),
  homeRoot: s.ref(home),
  gameRoot: s.ref(game),
  petFrames: Array.from({ length: 15 }, (_, i) => frame(`assets/resources/cartoon/pets/${i}.png`)),
  utilityFrames: [3, 4, 5, 6, 7, 9].map((i) => frame(`assets/resources/cartoon/icons/${i}.png`)),
  homeFrames: ['coin', 'signin', 'backpack'].map((name) =>
    frame(`assets/resources/cartoon/home-ui/${name}.png`),
  ),
  skinFrames: skinNames.map((name) => frame(`assets/resources/cartoon/ui/${name}.png`)),
  menuFrames: ['menu-support', 'menu-announcement'].map((name) =>
    frame(`assets/resources/cartoon/ui/${name}.png`),
  ),
});
s.finish('assets/scenes/main.scene');
console.log(
  `Native woodland scene: ${s.items.filter((i) => i.__type__ === 'cc.Node').length} nodes, ${s.items.filter((i) => i.__type__ === 'cc.Button').length} buttons.`,
);
