const fs=require('node:fs'),path=require('node:path');
const sharp=require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const {root,folderMeta,imageMeta}=require('./lib/creator.cjs');
(async()=>{
 const manifest=require('../art/loading-manifest.json');folderMeta('assets/startup');
 fs.mkdirSync(path.join(root,'art/source-loading'),{recursive:true});fs.copyFileSync(manifest.source,path.join(root,'art/source-loading/logo.png'));
 await sharp(manifest.source).resize(720,480,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toFile(path.join(root,manifest.output));imageMeta(manifest.output,720,480);
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1560"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#e6fcff"/><stop offset=".5" stop-color="#8ae6ef"/><stop offset="1" stop-color="#e4fae9"/></linearGradient><radialGradient id="glow"><stop stop-color="white" stop-opacity=".9"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><rect width="720" height="1560" fill="url(#sky)"/><ellipse cx="360" cy="660" rx="530" ry="550" fill="url(#glow)"/><g fill="white" opacity=".48"><circle cx="55" cy="330" r="12"/><circle cx="638" cy="458" r="8"/><circle cx="91" cy="980" r="7"/><circle cx="615" cy="1130" r="12"/><circle cx="110" cy="1360" r="90"/><circle cx="35" cy="1400" r="110"/><circle cx="675" cy="1400" r="155"/><circle cx="584" cy="1450" r="105"/></g><g fill="#fff5b5" opacity=".85"><path d="M100 460l8 20 21 3-16 14 4 21-17-11-18 11 4-21-16-14 21-3z"/><path d="M620 860l6 15 16 2-12 11 3 16-13-9-14 9 3-16-12-11 16-2z"/></g></svg>`;
 await sharp(Buffer.from(svg)).png().toFile(path.join(root,'assets/startup/background.png'));imageMeta('assets/startup/background.png',720,1560);
 for(const [name,fill,stroke] of [['track','#edfaff','#62bed1'],['fill','#ffce48','#e6a126']]){
  const img=`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="48"><rect x="2" y="2" width="92" height="44" rx="21" fill="${fill}" stroke="${stroke}" stroke-width="3"/><path d="M24 9H72" stroke="white" opacity=".7" stroke-width="4" stroke-linecap="round"/></svg>`;
  await sharp(Buffer.from(img)).png().toFile(path.join(root,`assets/startup/${name}.png`));imageMeta(`assets/startup/${name}.png`,96,48,22);
 }
 console.log('Prepared project-owned loading logo and native UI assets.');
})();
