// Editable native Creator scene implementing the approved woodland concept.
// Ordinary builds never regenerate scenes or overwrite editor changes.
const { SceneWriter, frame, compress, uuid, color, vec } = require('./lib/creator.cjs');
const s = new SceneWriter(), W = 720, H = 1560;
const group = (p, name) => s.node(p, name, 0, 0, W, H, [0, 1]);
const icon = (p, name, index, x, y, size = 90) => s.sprite(p, name, x, y, size, size, `assets/resources/cartoon/icons/${index}.png`);
const pet = (p, name, index, x, y, size = 82) => s.sprite(p, name, x, y, size, size, `assets/resources/cartoon/pets/${index}.png`);
const label = (p, name, value, x, y, size = 28, options = {}) => s.label(p, name, value, x, y, size, { tint: '#51351F', outline: '#FFF4DC', stroke: 0, ...options });
const root = s.node(s.scene, 'StarIsleGame'); s.controller = root; s.items[root]._layer = 1073741824;
const canvas = s.node(s.scene, 'Canvas', W / 2, -H / 2, W, H);
const cameraNode = s.node(canvas, 'UICamera'); s.items[cameraNode]._lpos = vec(0, 0, 1000);
const camera = s.component(cameraNode, 'cc.Camera', { _projection: 0, _priority: 1073741824, _fov: 45, _fovAxis: 0, _orthoHeight: H / 2, _near: 1, _far: 2000, _color: color('#BEC497'), _depth: 1, _stencil: 0, _clearFlags: 7, _rect: { __type__: 'cc.Rect', x: 0, y: 0, width: 1, height: 1 }, _aperture: 19, _shutter: 7, _iso: 0, _screenScale: 1, _visibility: 33554432, _targetTexture: null });
s.component(canvas, 'cc.Canvas', { _cameraComponent: s.ref(camera), _alignCanvasWithScreen: true });
s.component(canvas, 'cc.Widget', { _alignFlags: 45, _target: null, _left: 0, _right: 0, _top: 0, _bottom: 0, _horizontalCenter: 0, _verticalCenter: 0, _isAbsLeft: true, _isAbsRight: true, _isAbsTop: true, _isAbsBottom: true, _isAbsHorizontalCenter: true, _isAbsVerticalCenter: true, _originalWidth: W, _originalHeight: H, _alignMode: 2, _lockFlags: 0 });
const stage = s.node(canvas, 'Stage', -W / 2, -H / 2, W, H, [0, 1]);
const home = group(stage, 'HomePage'); s.sprite(home, 'KeyArt', 360, 780, W, H, 'assets/resources/cartoon/home.jpg');
const top = group(home, 'TopBar');
const menu = s.button(top, 'MenuButton', 56, 75, 76, 80, 'round-dark', 'onHomeNav', 'menu');
s.sprite(menu, 'Icon', 0, -3, 44, 44, 'assets/resources/cartoon/ui/menu.png');
s.skin(top, 'CoinCounter', 510, 76, 350, 78, 'pill-dark'); s.sprite(top, 'Coin', 364, 75, 85, 85, 'assets/resources/cartoon/home-ui/coin.png');
label(top, 'CoinsLabel', '萌宠金币', 504, 58, 22, { width: 180, tint: '#FFF0CA' }); label(top, 'CoinsValue', '0', 504, 89, 30, { width: 180, tint: '#FFF8E9' });
const branding = group(home, 'Branding'); s.sprite(branding, 'Title', 360, 326, 610, 356, 'assets/resources/cartoon/home-ui/woodland-logo.png');
const shortcuts = group(home, 'Shortcuts');
for (const [x, name, title, file, action] of [[110, 'SignInButton', '7日签到', 'home-ui/signin', 'signin'], [277, 'AlbumButton', '萌宠图鉴', 'icons/1', 'album'], [443, 'BagButton', '背包道具', 'home-ui/backpack', 'bag'], [610, 'SettingsButton', '声音设置', 'icons/4', 'settings']]) {
    const b = s.button(shortcuts, name, x, 1070, 140, 150, 'side-badge', 'onHomeNav', action);
    s.sprite(b, 'Icon', 0, -20, 100, 100, `assets/resources/cartoon/${file}.png`); s.skin(b, 'Nameplate', 0, 56, 154, 47, 'nav'); label(b, 'Label', title, 0, 53, 24, { width: 148 });
    if (action === 'signin') s.skin(b, 'Notice', 54, -65, 21, 21, 'badge-red');
}
const welcome = group(home, 'WelcomePanel');
for (const [id, title, x, y, style, petId] of [['classic', '经典三消', 185, 1240, 'button-blue', 12], ['quartet', '极限四消', 535, 1240, 'button-gold', 2], ['fun', '趣味规则消', 185, 1420, 'button-pink', 13]]) {
    const b = s.button(welcome, `Mode-${id}`, x, y, 326, 158, style, 'onHomeMode', id);
    s.skin(b, 'PetTile', -106, -5, 88, 92, 'tile'); pet(b, 'PetIcon', petId, -106, -11, 77);
    label(b, 'Title', title, 44, -7, id === 'fun' ? 28 : 31, { width: 200, tint: '#FFF9E9', outline: '#75502D', stroke: 2 });
}
const campaign = s.button(welcome, 'CampaignButton', 535, 1420, 326, 158, 'button-amber', 'onHomeNav', 'campaign');
icon(campaign, 'Trophy', 3, -106, -7, 99); label(campaign, 'Title', '闯关模式', 44, -7, 31, { width: 200, tint: '#FFF9E9', outline: '#986525', stroke: 2 });
const game = group(stage, 'GamePage'); s.inactive(game); s.sprite(game, 'Background', 360, 780, W, H, 'assets/resources/cartoon/game.jpg');
const gameTop = group(game, 'TopBar');
for (const [x, name, glyph, action] of [[56, 'SettingsButton', 'gear', 'settings'], [664, 'PauseButton', 'pause', 'pause']]) {
    const b = s.button(gameTop, name, x, 77, 76, 80, 'round-dark', 'onGameAction', action); s.sprite(b, 'Icon', 0, -3, 49, 49, `assets/resources/cartoon/ui/${glyph}.png`);
}
s.skin(gameTop, 'ModePlaque', 360, 77, 376, 77, 'pill-dark'); label(gameTop, 'LevelName', '经典三消', 360, 72, 32, { width: 352, tint: '#FFF5DA' });
s.skin(gameTop, 'ChapterPlaque', 360, 140, 200, 54, 'nav'); label(gameTop, 'Chapter', '第 1 关', 360, 137, 27, { width: 186 });
s.skin(gameTop, 'RemainingPill', 620, 148, 143, 43, 'pill-dark'); label(gameTop, 'Remaining', '剩余 18', 620, 145, 19, { width: 130, tint: '#FFF5DA' });
s.skin(game, 'InstructionPlaque', 360, 207, 536, 49, 'nav'); label(game, 'Instruction', '三个相同萌宠自动消除', 360, 203, 23, { width: 516 });
const boardPreview = group(game, 'BoardPreview');
for (let layer = 0; layer < 2; layer++) for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const x = 360 + (col - 1) * 176, y = 628 + (row - 1) * 210 + (layer ? 24 : -22); const tile = s.skin(boardPreview, `PreviewPet-${layer}-${row}-${col}`, x, y, 94, 98, 'tile');
    pet(tile, 'Pet', (row + col + layer) % 3, 0, -8, 81); if (!layer) s.sprite(tile, 'Covered', 0, -5, 94, 90, 'assets/resources/cartoon/ui/covered.png');
}
group(game, 'Board'); const reserve = group(game, 'ReserveArea'); s.inactive(reserve);
s.skin(reserve, 'ReservePanel', 360, 1115, 680, 104, 'tray'); label(reserve, 'ReserveTitle', '铲出暂存 · 点击萌宠放回收纳槽', 360, 1045, 22, { width: 660, stroke: 1 }); group(reserve, 'ReserveTiles');
label(game, 'TrayTitle', '收纳槽 0 / 7 · 三个相同就消除', 360, 1208, 22, { width: 680, stroke: 1 }); s.skin(game, 'TrayPanel', 360, 1290, 690, 136, 'tray');
for (let i = 0; i < 7; i++) s.skin(game, `Slot${i}`, 87 + i * 91, 1286, 84, 94, 'slot'); group(game, 'Tray');
const tools = group(game, 'Toolbar');
for (const [x, name, title, idx, count] of [[120, 'undo', '撤回', 5, 1], [280, 'shovel', '铲出', 9, 1], [440, 'hint', '提示', 7, 3], [600, 'shuffle', '重排', 6, 1]]) {
    const b = s.button(tools, `Tool-${name}`, x, 1434, 114, 114, 'round-blue', 'onGameAction', name); icon(b, 'Icon', idx, 0, -8, 86);
    s.skin(tools, `Nameplate-${name}`, x, 1496, 126, 46, 'nav'); label(tools, `Label-${name}`, title, x, 1493, 25, { width: 116 }); s.skin(b, 'CountBadge', 45, -48, 43, 32, 'badge-red'); label(b, 'Count', String(count), 45, -51, 22, { width: 39, tint: '#FFF8EB' });
}
const skinNames = ['button-blue', 'button-gold', 'panel', 'tile', 'tray', 'slot', 'side-badge', 'nav', 'round-dark', 'round-blue', 'badge-red', 'pill-dark', 'button-pink', 'button-amber'];
s.component(root, compress(uuid('assets/scripts/StarIsle.ts')), { stageRoot: s.ref(stage), homeRoot: s.ref(home), gameRoot: s.ref(game), petFrames: Array.from({ length: 15 }, (_, i) => frame(`assets/resources/cartoon/pets/${i}.png`)), utilityFrames: [3, 4, 5, 6, 7, 9].map(i => frame(`assets/resources/cartoon/icons/${i}.png`)), homeFrames: ['coin', 'signin', 'backpack'].map(name => frame(`assets/resources/cartoon/home-ui/${name}.png`)), skinFrames: skinNames.map(name => frame(`assets/resources/cartoon/ui/${name}.png`)) });
s.finish('assets/scenes/main.scene');
console.log(`Native woodland scene: ${s.items.filter(i => i.__type__ === 'cc.Node').length} nodes, ${s.items.filter(i => i.__type__ === 'cc.Button').length} buttons.`);
