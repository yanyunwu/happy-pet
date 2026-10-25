const fs=require('node:fs'),path=require('node:path');
const sharp=require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const {root,imageMeta}=require('./lib/creator.cjs');
(async()=>{
  const manifest=require('../art/pets-v4-manifest.json'); fs.mkdirSync(path.join(root,'art/source-v4'),{recursive:true});
  for(const asset of manifest.assets){
    const original=path.join(root,`art/source-v4/${asset.name}.png`);fs.copyFileSync(asset.source,original);
    await sharp(original).trim({threshold:12}).resize(240,240,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).extend({top:8,bottom:8,left:8,right:8,background:{r:0,g:0,b:0,alpha:0}}).png().toFile(path.join(root,asset.output));
    imageMeta(asset.output,256,256);
  }
  console.log('Imported six additional pets and shovel icon; 15 animals in total.');
})();
