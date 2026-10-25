const fs = require('node:fs'),
  path = require('node:path');
const { SceneWriter, root, write, compress, uuid, color, vec } = require('./lib/creator.cjs');
const s = new SceneWriter('loading'),
  W = 720,
  H = 1560;
const controller = s.node(s.scene, 'LoadingController');
s.items[controller]._layer = 1073741824;
const canvas = s.node(s.scene, 'Canvas', W / 2, -H / 2, W, H),
  cameraNode = s.node(canvas, 'UICamera');
s.items[cameraNode]._lpos = vec(0, 0, 1000);
const camera = s.component(cameraNode, 'cc.Camera', {
  _projection: 0,
  _priority: 1073741824,
  _fov: 45,
  _fovAxis: 0,
  _orthoHeight: H / 2,
  _near: 1,
  _far: 2000,
  _color: color('#c9f4f7'),
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
s.sprite(stage, 'Background', 360, 780, 720, 1560, 'assets/startup/poster.jpg');
for (let i = 0; i < 3; i++)
  s.label(stage, `Dot${i}`, '•', 330 + i * 30, 1205, 22, {
    width: 36,
    tint: '#f7e3b3',
    outline: '#614328',
    stroke: 1,
  });
s.sprite(stage, 'ProgressTrack', 360, 1265, 536, 32, 'assets/startup/track.png', { sliced: true });
const fill = s.sprite(stage, 'ProgressFill', 110, 1265, 1, 22, 'assets/startup/fill.png', {
  sliced: true,
});
const transform = s.items[fill]._components
  .map((r) => s.items[r.__id__])
  .find((c) => c.__type__ === 'cc.UITransform');
transform._anchorPoint = { __type__: 'cc.Vec2', x: 0, y: 0.5 };
s.inactive(fill);
s.label(stage, 'Percent', '0%', 360, 1264, 18, {
  width: 480,
  tint: '#fff5de',
  outline: '#614328',
  stroke: 2,
});
s.label(stage, 'Status', '萌宠们正在集合…', 360, 1320, 25, {
  width: 620,
  tint: '#51351f',
  outline: '#fff0d1',
  stroke: 2,
});
const retry = s.sprite(stage, 'Retry', 360, 1385, 300, 62, 'assets/startup/fill.png', {
  sliced: true,
});
s.inactive(retry);
s.label(retry, 'Label', '重新加载', 0, 0, 25, {
  width: 280,
  tint: '#ffffff',
  outline: '#28658a',
  stroke: 2,
});
s.label(
  stage,
  'HealthNotice1',
  '抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。',
  360,
  1460,
  18,
  { width: 686, tint: '#51351f', outline: '#fff0d1', stroke: 1 },
);
s.label(
  stage,
  'HealthNotice2',
  '适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。',
  360,
  1496,
  18,
  { width: 686, tint: '#51351f', outline: '#fff0d1', stroke: 1 },
);
const script = 'assets/scripts/LoadingScreen.ts';
if (!fs.existsSync(path.join(root, script + '.meta')))
  write(script + '.meta', {
    ver: '4.0.24',
    importer: 'typescript',
    imported: false,
    uuid: uuid(script),
    files: [],
    subMetas: {},
    userData: {},
  });
s.component(controller, compress(uuid(script)), { stageRoot: s.ref(stage) });
s.finish('assets/scenes/loading.scene');
const scene = 'assets/scenes/loading.scene';
if (!fs.existsSync(path.join(root, scene + '.meta')))
  write(scene + '.meta', {
    ver: '1.1.50',
    importer: 'scene',
    imported: false,
    uuid: uuid(scene),
    files: [],
    subMetas: {},
    userData: {},
  });
for (const platform of ['web-mobile', 'wechatgame']) {
  const file = `build-config/${platform}.json`,
    config = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
  config.startScene = uuid(scene);
  config.scenes = [
    { url: 'db://' + scene, uuid: uuid(scene) },
    { url: 'db://assets/scenes/main.scene', uuid: uuid('assets/scenes/main.scene') },
  ];
  write(file, config);
}
console.log(
  'Authored native loading scene and made it the build entry; main game retained as the next scene.',
);
