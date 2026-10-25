// Author an actual editable Creator scene, using native Sprite/Label/Button nodes.
// Run only to regenerate the original layout: it overwrites main.scene.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let sharp;
for (const candidate of ['sharp', process.env.SHARP_PATH, 'C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'].filter(Boolean)) { try { sharp = require(candidate); break; } catch {} }
if (!sharp) throw new Error('Install sharp or set SHARP_PATH to generate the original UI shapes.');
const root = path.resolve(__dirname, '..');
const write = (name, data) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); };
const uuid = name => { const h = crypto.createHash('md5').update('star-isle/' + name).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`; };
function compress(id) { const h = id.replace(/-/g, ''), a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let s = h.slice(0, 5); for (let i = 5; i < 32; i += 3) { const n = parseInt(h.slice(i, i+3), 16); s += a[n >> 6] + a[n & 63]; } return s; }
function imageMeta(file, width, height, border = 0) {
  const id = uuid(file), alpha = !file.endsWith('.jpg');
  const textureId = id + '@6c48a', frameId = id + '@f9941';
  const common = { wrapModeS: 'clamp-to-edge', wrapModeT: 'clamp-to-edge', minfilter: 'linear', magfilter: 'linear', mipfilter: 'none', premultiplyAlpha: false, anisotropy: 0, isUuid: true };
  write(file + '.meta', { ver: '1.0.27', importer: 'image', imported: false, uuid: id, files: [],
    subMetas: {
      '6c48a': { importer: 'texture', uuid: textureId, displayName: path.basename(file), id: '6c48a', name: 'texture', ver: '1.0.22', imported: false, files: [], subMetas: {}, userData: { ...common, imageUuidOrDatabaseUri: id, visible: false } },
      'f9941': { importer: 'sprite-frame', uuid: frameId, displayName: path.basename(file), id: 'f9941', name: 'spriteFrame', ver: '1.0.12', imported: false, files: [], subMetas: {}, userData: { ...common, imageUuidOrDatabaseUri: textureId, trimType: 'none', trimThreshold: 1, rotated: false, offsetX: 0, offsetY: 0, trimX: 0, trimY: 0, width, height, rawWidth: width, rawHeight: height, borderTop: border, borderBottom: border, borderLeft: border, borderRight: border, packable: false, pixelsToUnit: 100, pivotX: .5, pivotY: .5, meshType: 0 } }
    }, userData: { type: 'sprite-frame', hasAlpha: alpha, redirect: frameId, fixAlphaTransparencyArtifacts: false } });
}
const shapes = {
  'panel': '<rect x="1" y="7" width="126" height="120" rx="38" fill="#88729e" fill-opacity=".12"/><rect x="1" y="1" width="126" height="120" rx="38" fill="#fffdf6" stroke="#fff" stroke-width="2"/>',
  'button-cream': '<rect x="1" y="8" width="126" height="119" rx="28" fill="#88729e" fill-opacity=".14"/><rect x="1" y="1" width="126" height="119" rx="28" fill="#fffdf6" stroke="#dfd3ef" stroke-width="2"/>',
  'button-purple': '<rect x="1" y="8" width="126" height="119" rx="28" fill="#88729e" fill-opacity=".16"/><rect x="1" y="1" width="126" height="119" rx="28" fill="#9671da" stroke="#8761ce" stroke-width="2"/><path d="M30 6H98" fill="none" stroke="#cdb5f4" stroke-width="2"/>',
  'pill': '<rect x="1" y="1" width="126" height="126" rx="63" fill="white"/>',
  'badge': '<rect x="1" y="1" width="126" height="126" rx="42" fill="white"/>',
  'pixel': '<rect width="128" height="128" fill="white"/>',
  'star': '<path d="M64 5L81 43L123 49L92 78L100 120L64 99L28 120L36 78L5 49L47 43Z" fill="white"/>',
  'play': '<path d="M35 15L110 64L35 113Z" fill="white"/>',
  'sound': '<g stroke="#7954bd" stroke-width="9" stroke-linejoin="round" stroke-linecap="round" fill="none"><path d="M15 47H38L67 24V104L38 81H15Z"/><path d="M88 38C116 53 116 75 88 90"/></g>',
  'mute': '<g stroke="#7954bd" stroke-width="9" stroke-linejoin="round" stroke-linecap="round" fill="none"><path d="M10 47H32L59 24V104L32 81H10Z"/><path d="M84 47L114 81M114 47L84 81"/></g>',
  'lock': '<g stroke="white" stroke-width="10" fill="none"><rect x="25" y="54" width="78" height="61" rx="12"/><path d="M40 54V35C40 4 88 4 88 35V54"/></g>',
};
(async () => {
  const folder = path.join(root, 'assets/resources/ui'); fs.mkdirSync(folder, { recursive: true });
  for (const [name, shape] of Object.entries(shapes)) {
    const file = `assets/resources/ui/${name}.png`;
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">${shape}</svg>`)).png().toFile(path.join(root, file));
    imageMeta(file, 128, 128, ['panel', 'button-cream', 'button-purple'].includes(name) ? 46 : name === 'badge' ? 44 : name === 'pill' ? 63 : 0);
  }
  write('assets/resources/ui.meta', { ver: '1.2.0', importer: 'directory', imported: true, uuid: uuid('assets/resources/ui'), files: [], subMetas: {}, userData: {} });
  imageMeta('assets/resources/art/hero.jpg', 1024, 1536);
  const sceneId = uuid('assets/scenes/main.scene'), scriptId = compress(uuid('assets/scripts/StarIsle.ts'));
  const all = [], ref = i => ({ __id__: i });
  const add = value => { all.push(value); return all.length - 1; };
  const color = (hex, a = 255) => ({ __type__: 'cc.Color', r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16), a });
  const v3 = (x=0, y=0, z=0) => ({ __type__: 'cc.Vec3', x, y, z });
  add({ __type__: 'cc.SceneAsset', _name: 'main', _objFlags: 0, _native: '', scene: ref(1) });
  const scene = add({ __type__: 'cc.Scene', _name: 'main', _objFlags: 0, _parent: null, _children: [], _active: true, _components: [], _prefab: null, autoReleaseAssets: false, _id: sceneId });
  function n(parent, name, x=0, y=0, w=0, h=0, anchor=[.5,.5]) {
    const index = add({ __type__: 'cc.Node', _name: name, _objFlags: 0, _parent: ref(parent), _children: [], _active: true, _components: [], _prefab: null, _lpos: v3(x,-y), _lrot: { __type__: 'cc.Quat', x:0,y:0,z:0,w:1 }, _lscale: v3(1,1,1), _layer: 33554432, _euler: v3(), _id: uuid('scene-node/' + all.length + '/' + name) });
    all[parent]._children.push(ref(index));
    c(index, 'cc.UITransform', { _contentSize: { __type__: 'cc.Size', width: w, height: h }, _anchorPoint: { __type__: 'cc.Vec2', x: anchor[0], y: anchor[1] } });
    return index;
  }
  function c(node, type, fields={}) { const index = add({ __type__: type, _name:'', _objFlags:0, node: ref(node), _enabled:true, __prefab:null, ...fields, _id:uuid('scene-component/' + all.length) }); all[node]._components.push(ref(index)); return index; }
  function sprite(parent,name,x,y,w,h,file,tint='#FFFFFF',sliced=false,alpha=255) {
    const index=n(parent,name,x,y,w,h);
    c(index,'cc.Sprite',{ _visFlags:0,_customMaterial:null,_srcBlendFactor:2,_dstBlendFactor:4,_color:color(tint,alpha),_spriteFrame:{__uuid__:uuid(file)+'@f9941',__expectedType__:'cc.SpriteFrame'},_type:sliced?1:0,_fillType:0,_sizeMode:0,_fillCenter:{__type__:'cc.Vec2',x:0,y:0},_fillStart:0,_fillRange:0,_isTrimmedMode:false,_useGrayscale:false,_atlas:null });
    return index;
  }
  const shape=(parent,name,x,y,w,h,asset,tint='#FFFFFF',sliced=true,alpha=255)=>sprite(parent,name,x,y,w,h,`assets/resources/ui/${asset}.png`,tint,sliced,alpha);
  function label(parent,name,value,x,y,size,tint='#514367',w=640,bold=false) {
    const index=n(parent,name,x,y,w,size*1.5);
    c(index,'cc.Label',{_visFlags:0,_customMaterial:null,_srcBlendFactor:2,_dstBlendFactor:4,_color:color(tint),_string:value,_horizontalAlign:1,_verticalAlign:1,_actualFontSize:size,_fontSize:size,_fontFamily:'Microsoft YaHei',_lineHeight:Math.ceil(size*1.4),_overflow:2,_enableWrapText:false,_font:null,_isSystemFontUsed:true,_isItalic:false,_isBold:bold,_isUnderline:false,_underlineHeight:0,_cacheMode:2}); return index;
  }
  const gameRoot=n(scene,'StarIsleGame'); all[gameRoot]._layer=1073741824;
  const canvasNode=n(scene,'Canvas',360,-640,720,1280);
  const cameraNode=n(canvasNode,'UICamera'); all[cameraNode]._lpos=v3(0,0,1000);
  const camera=c(cameraNode,'cc.Camera',{_projection:0,_priority:1073741824,_fov:45,_fovAxis:0,_orthoHeight:640,_near:1,_far:2000,_color:color('#F4EDF9'),_depth:1,_stencil:0,_clearFlags:7,_rect:{__type__:'cc.Rect',x:0,y:0,width:1,height:1},_aperture:19,_shutter:7,_iso:0,_screenScale:1,_visibility:33554432,_targetTexture:null});
  c(canvasNode,'cc.Canvas',{_cameraComponent:ref(camera),_alignCanvasWithScreen:true});
  c(canvasNode,'cc.Widget',{_alignFlags:45,_target:null,_left:0,_right:0,_top:0,_bottom:0,_horizontalCenter:0,_verticalCenter:0,_isAbsLeft:true,_isAbsRight:true,_isAbsTop:true,_isAbsBottom:true,_isAbsHorizontalCenter:true,_isAbsVerticalCenter:true,_originalWidth:720,_originalHeight:1280,_alignMode:2,_lockFlags:0});
  const stage=n(canvasNode,'Stage',-360,-640,720,1280,[0,1]);
  const home=n(stage,'HomePage',0,0,720,1280,[0,1]);
  c(gameRoot,scriptId,{stageRoot:ref(stage),homeRoot:ref(home)});
  function button(parent,name,x,y,w,h,handler,data='',purple=false) {
    const index=shape(parent,name,x,y,w,h,purple?'button-purple':'button-cream');
    const event=add({__type__:'cc.ClickEvent',target:ref(gameRoot),component:'',_componentId:scriptId,handler,customEventData:data});
    c(index,'cc.Button',{clickEvents:[ref(event)],_interactable:true,_transition:3,_duration:.08,_zoomScale:.96,_target:ref(index),_normalColor:color('#FFFFFF'),_hoverColor:color('#FFFFFF'),_pressedColor:color('#FFFFFF'),_disabledColor:color('#AAAAAA'),_normalSprite:null,_hoverSprite:null,_pressedSprite:null,_disabledSprite:null}); return index;
  }
  shape(home,'BackgroundColor',360,640,720,1280,'pixel','#F5EAF9',false);
  sprite(home,'KeyArt',360,540,720,1080,'assets/resources/art/hero.jpg');
  const branding=n(home,'Branding');
  shape(branding,'BrandPill',155,66,210,42,'pill','#FFFEFA',true,230);
  shape(branding,'BrandStar',73,66,22,22,'star','#9671DA',false);
  label(branding,'BrandLabel','S T A R  I S L E',168,66,16,'#7954BD',160,true);
  label(branding,'TitleShadow','星屿消消',361,175,82,'#DFB8DA',660,true);
  label(branding,'Title','星屿消消',360,169,82,'#6B5190',660,true);
  label(branding,'Tagline','把小小星光，装进口袋',360,252,27,'#8F74A4',620,true);
  shape(branding,'PinkStar',86,234,26,26,'star','#E7ABBA',false); shape(branding,'GoldStar',639,196,26,26,'star','#F6CE72',false);
  const help=button(home,'HelpButton',578,66,56,56,'onHomeHelp'); label(help,'Label','?',0,-1,26,'#514367',44,true);
  const sound=button(home,'SoundButton',654,66,56,56,'onHomeSound');
  shape(sound,'icon-sound',0,0,36,36,'sound','#FFFFFF',false);
  const mute=shape(sound,'icon-mute',0,0,36,36,'mute','#FFFFFF',false); all[mute]._active=false;
  const welcome=n(home,'WelcomePanel');
  shape(welcome,'PanelBackground',360,1059,676,398,'panel');
  shape(welcome,'WelcomeChip',360,861,182,38,'pill','#DDF3E8');
  label(welcome,'ChipLabel','今日份治愈冒险',360,861,18,'#6A947F',170,true);
  label(welcome,'WelcomeTitle','欢迎来到星屿',360,922,34,'#514367',600,true);
  label(welcome,'WelcomeDescription','点一点，凑三个。让烦恼一起消失吧！',360,968,22,'#9484A8',620);
  for (const id of [1,2]) {
    const b=button(welcome,`Chapter${id}Button`,id===1?202:518,1048,284,92,'onHomeChapter',String(id));
    shape(b,'Badge',-101,0,52,52,'badge',id===1?'#DDF3E8':'#FFE5DB');
    const number=label(b,'Number',`0${id}`,-101,0,22,id===1?'#6E9984':'#BB8F81',48,true); if(id===2) all[number]._active=false;
    const lock=shape(b,'Lock',-101,0,31,31,'lock','#BB8F81',false); all[lock]._active=id===2;
    label(b,'Title',id===1?'初遇星屿':'迷雾星海',17,-16,24,'#514367',166,true);
    label(b,'Difficulty',id===1?'入门 · 轻轻松松':'挑战 · 通关后解锁',17,19,17,'#9484A8',173);
  }
  const start=button(welcome,'StartButton',360,1162,584,90,'onHomeStart','',true);
  label(start,'Label','开始游戏',0,-1,32,'#FFFFFF',550,true); shape(start,'PlayIcon',195,0,40,40,'play','#FFFFFF',false);
  label(welcome,'Footer','3 个相同消除  ·  7 格收纳  ·  慢慢来就好',360,1233,18,'#9484A8',640);
  const globals=add({__type__:'cc.SceneGlobals'}); all[scene]._globals=ref(globals);
  all[globals].ambient=ref(add({__type__:'cc.AmbientInfo',_skyColor:{__type__:'cc.Vec4',x:.2,y:.5,z:.8,w:1},_skyIllum:20000,_groundAlbedo:{__type__:'cc.Vec4',x:.2,y:.2,z:.2,w:1}}));
  all[globals].shadows=ref(add({__type__:'cc.ShadowsInfo',_enabled:false})); all[globals]._skybox=ref(add({__type__:'cc.SkyboxInfo',_enabled:false})); all[globals].fog=ref(add({__type__:'cc.FogInfo',_enabled:false}));
  write('assets/scenes/main.scene',all);
  const count=type=>all.filter(item=>item.__type__===type).length;
  console.log(`Editable home authored: ${count('cc.Node')} nodes, ${count('cc.Sprite')} sprites, ${count('cc.Label')} labels, ${count('cc.Button')} buttons, Canvas + Camera.`);
})();
