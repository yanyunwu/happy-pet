const fs=require('node:fs'),path=require('node:path');
const sharp=require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const {root,imageMeta,write}=require('./lib/creator.cjs');
(async()=>{
 for(const asset of require('../art/loading-adventure-manifest.json').assets){
  fs.copyFileSync(asset.source,path.join(root,`art/source-loading/${asset.name}.png`));
  await sharp(asset.source).resize(720,1560,{fit:'cover'}).jpeg({quality:91,mozjpeg:true}).toFile(path.join(root,asset.output));imageMeta(asset.output,720,1560);
 }
 for(const [name,fill,stroke] of [['track','#565375','#ffffff'],['fill','#28c8ee','#8df1ff']]){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect x="2" y="2" width="92" height="44" rx="21" fill="${fill}" stroke="${stroke}" stroke-width="3"/><path d="M24 9H72" stroke="white" opacity=".65" stroke-width="4" stroke-linecap="round"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(root,`assets/startup/${name}.png`));imageMeta(`assets/startup/${name}.png`,96,48,22);
 }
 const file='settings/v2/packages/builder.json',config=JSON.parse(fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,''));
 // Standard project splash options, enabled through Creator's official UI.
 // The complete poster contains its own title, so a second logo layer is unnecessary.
 config['splash-setting']={displayRatio:1,totalTime:700,logo:{type:'none',image:'project://settings/logo.png'},background:{type:'custom',image:'project://settings/loading-poster.jpg',color:{x:1,y:.9,z:.8,w:1}},watermarkLocation:'default',autoFit:true};
 config.bundleConfig.custom.starIsleResources.displayName='快乐萌宠消美术与音频';config.hasSetSplash=true;
 fs.copyFileSync(path.join(root,'assets/startup/poster.jpg'),path.join(root,'settings/loading-poster.jpg'));write(file,config);
 console.log('Imported illustrated opening poster and configured standard Creator splash.');
})();
