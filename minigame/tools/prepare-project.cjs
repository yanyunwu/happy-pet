// Creates deterministic Creator metadata for this code-driven 2D scene.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const uuid = name => {
  const h = crypto.createHash('md5').update('star-isle/' + name).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
const write = (name, data) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
const scriptId = uuid('assets/scripts/StarIsle.ts');
const sceneId = uuid('assets/scenes/main.scene');
const hex = scriptId.replace(/-/g, '');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
let compressed = hex.slice(0, 5);
for (let i = 5; i < 32; i += 3) { const n = parseInt(hex.slice(i, i + 3), 16); compressed += alphabet[n >> 6] + alphabet[n & 63]; }
const ref = id => ({ __id__: id });
const scene = [
  { __type__: 'cc.SceneAsset', _name: 'main', _objFlags: 0, _native: '', scene: ref(1) },
  { __type__: 'cc.Scene', _name: 'main', _objFlags: 0, _parent: null, _children: [ref(2)], _active: true, _components: [], _prefab: null, autoReleaseAssets: false, _globals: ref(4), _id: sceneId },
  { __type__: 'cc.Node', _name: 'StarIsleGame', _objFlags: 0, _parent: ref(1), _children: [], _active: true, _components: [ref(3)], _prefab: null,
    _lpos: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 }, _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: { __type__: 'cc.Vec3', x: 1, y: 1, z: 1 }, _layer: 1073741824, _euler: { __type__: 'cc.Vec3', x: 0, y: 0, z: 0 }, _id: uuid('root-node') },
  { __type__: compressed, _name: '', _objFlags: 0, node: ref(2), _enabled: true, __prefab: null, _id: uuid('app-component') },
  { __type__: 'cc.SceneGlobals', ambient: ref(5), shadows: ref(6), _skybox: ref(7), fog: ref(8) },
  { __type__: 'cc.AmbientInfo', _skyColor: { __type__: 'cc.Vec4', x: .2, y: .5, z: .8, w: 1 }, _skyIllum: 20000, _groundAlbedo: { __type__: 'cc.Vec4', x: .2, y: .2, z: .2, w: 1 } },
  { __type__: 'cc.ShadowsInfo', _enabled: false },
  { __type__: 'cc.SkyboxInfo', _enabled: false },
  { __type__: 'cc.FogInfo', _enabled: false },
];
if (!fs.existsSync(path.join(root, 'assets/scenes/main.scene'))) write('assets/scenes/main.scene', scene);
function walk(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.endsWith('.meta')) continue;
    const file = path.join(folder, entry.name), relative = path.relative(root, file).replace(/\\/g, '/');
    const id = uuid(relative); let meta;
    if (entry.isDirectory()) {
      meta = { ver: '1.2.0', importer: 'directory', imported: true, uuid: id, files: [], subMetas: {}, userData: {} };
      walk(file);
    } else if (entry.name.endsWith('.ts')) {
      meta = { ver: '4.0.23', importer: 'typescript', imported: true, uuid: id, files: [], subMetas: {}, userData: {} };
    } else if (entry.name.endsWith('.scene')) {
      meta = { ver: '1.1.45', importer: 'scene', imported: true, uuid: id, files: ['.json'], subMetas: {}, userData: {} };
    } else if (/\.(png|jpg)$/.test(entry.name)) {
      meta = { ver: '1.0.26', importer: 'image', imported: false, uuid: id, files: [], subMetas: {}, userData: { type: 'texture', hasAlpha: entry.name.endsWith('.png') } };
    } else if (entry.name.endsWith('.wav')) {
      meta = { ver: '1.0.0', importer: 'audio-clip', imported: false, uuid: id, files: [], subMetas: {}, userData: {} };
    }
    if (meta && !fs.existsSync(file + '.meta')) write(relative + '.meta', meta);
  }
}
walk(path.join(root, 'assets'));
write('profiles/v2/packages/preview.json', { __version__: '1.0.1', general: { start_scene: sceneId } });
const common = { name: '快乐萌宠消', platform: 'web-mobile', startScene: sceneId, scenes: [{ url: 'db://assets/scenes/main.scene', uuid: sceneId }], buildPath: 'project://build', outputName: 'web-mobile', debug: true, sourceMaps: false, md5Cache: false, mainBundleCompressionType: 'merge_dep', useSplashScreen: true, packages: { 'web-mobile': { orientation: 'portrait', __version__: '1.0.1' } } };
write('build-config/web-mobile.json', common);
write('build-config/wechatgame.json', { ...common, platform: 'wechatgame', outputName: 'wechatgame', debug: false, packages: { wechatgame: { appid: '', orientation: 'portrait', separationEngine: false } } });
const resourceMetaPath = 'assets/resources.meta';
const resourceMeta = JSON.parse(fs.readFileSync(path.join(root, resourceMetaPath), 'utf8'));
resourceMeta.userData = { ...resourceMeta.userData, isBundle: true, bundleConfigID: 'starIsleResources', bundleName: 'resources', priority: 8 };
write(resourceMetaPath, resourceMeta);
write('settings/v2/packages/builder.json', {
  __version__: '1.3.9', textureCompressConfig: { genMipmaps: false },
  bundleConfig: { custom: { starIsleResources: { displayName: '快乐萌宠消美术与音频', configs: {
    web: { preferredOptions: { compressionType: 'merge_dep', isRemote: false } },
    native: { preferredOptions: { compressionType: 'merge_dep', isRemote: false } },
    miniGame: { configMode: 'overwrite', overwriteSettings: { wechatgame: { compressionType: 'subpackage', isRemote: false } } }
  } } } }
});
const includeModules = ['2d', 'graphics', 'affine-transform', 'animation', 'audio', 'base', 'gfx-webgl', 'gfx-webgl2', 'intersection-2d', 'profiler', 'tween', 'ui', 'legacy-pipeline'];
const cache = Object.fromEntries(includeModules.map(name => [name, { _value: true }]));
for (const name of ['3d', 'skeletal-animation', 'rich-text', 'mask', 'particle', 'particle-2d', 'physics', 'physics-2d', 'spine', 'dragon-bones', 'tiled-map', 'video', 'webview', 'marionette', 'terrain', 'xr', 'websocket']) cache[name] = { _value: false };
cache['render-pipeline'] = { _option: 'legacy-pipeline' };
write('settings/v2/packages/engine.json', { __version__: '1.0.12', modules: { configs: { defaultConfig: { name: '快乐萌宠消 2D', cache, includeModules, noDeprecatedFeatures: { value: false, version: '' }, flags: {} } }, globalConfigKey: 'defaultConfig' } });
console.log('Creator project prepared:', sceneId);
