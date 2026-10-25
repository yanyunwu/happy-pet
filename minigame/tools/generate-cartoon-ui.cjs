// Original vector-authored UI skins, rendered as Creator sprite assets.
const path=require('node:path');const {root,imageMeta,folderMeta}=require('./lib/creator.cjs');
let sharp;for(const p of ['sharp',process.env.SHARP_PATH,'C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'].filter(Boolean)){try{sharp=require(p);break;}catch{}}
const defs=`<defs>
<linearGradient id="blue" x2="0" y2="1"><stop stop-color="#50e4ff"/><stop offset=".42" stop-color="#20b9f7"/><stop offset="1" stop-color="#087bd9"/></linearGradient>
<linearGradient id="gold" x2="0" y2="1"><stop stop-color="#fff17d"/><stop offset=".42" stop-color="#ffd94b"/><stop offset="1" stop-color="#ff9b23"/></linearGradient>
<linearGradient id="pink" x2="0" y2="1"><stop stop-color="#ffb3d0"/><stop offset=".48" stop-color="#ff78aa"/><stop offset="1" stop-color="#ef4f86"/></linearGradient>
<linearGradient id="nav" x2="0" y2="1"><stop stop-color="#44cfff"/><stop offset=".08" stop-color="#299df4"/><stop offset="1" stop-color="#1879d8"/></linearGradient>
<linearGradient id="slot" x2="0" y2="1"><stop stop-color="#1b779e"/><stop offset="1" stop-color="#348da9"/></linearGradient>
<linearGradient id="teal" x2="0" y2="1"><stop stop-color="#52dce9"/><stop offset="1" stop-color="#2695bc"/></linearGradient>
</defs>`;
const rr=(x,y,w,h,r,fill,stroke='',sw=0)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${stroke?`stroke="${stroke}" stroke-width="${sw}"`:''}/>`;
const button=(kind)=>rr(3,13,250,112,29,'#225a75')+rr(3,3,250,112,29,`url(#${kind})`,kind==='blue'?'#047cc0':kind==='pink'?'#bf3f78':'#dd861b',6)+rr(8,7,240,100,24,'none',kind==='blue'?'#70e9ff':kind==='pink'?'#ffd5e9':'#ffe58b',3)+`<path d="M32 14H224" stroke="white" opacity=".65" stroke-width="5" stroke-linecap="round"/><ellipse cx="29" cy="26" rx="8" ry="4" fill="white" opacity=".65"/>`;
const shapes={
 'button-blue':[256,128,32,button('blue')],
 'button-gold':[256,128,32,button('gold')],
 'button-pink':[256,128,32,button('pink')],
 'panel':[128,128,28,rr(3,10,122,116,25,'#146887')+rr(3,3,122,116,25,'#fffdf4','#39bdda',5)+rr(8,8,112,106,21,'none','#d7f8ff',3)],
 'tile':[128,132,24,rr(3,13,122,116,21,'#238f9e')+rr(3,3,122,116,21,'#FFFFFF','#d9f7fa',3)+`<path d="M22 10H107" stroke="white" stroke-width="5" stroke-linecap="round"/>`],
 'covered':[128,132,0,'<rect x="3" y="3" width="122" height="116" rx="21" fill="#173e48" fill-opacity=".45"/>'],
 'tray':[256,128,28,rr(3,12,250,113,26,'#24738c')+rr(3,3,250,114,26,'url(#teal)','#208eb7',5)+rr(10,9,236,101,20,'#3a9ebd','#7deafa',3)],
 'slot':[128,128,20,rr(2,2,124,124,20,'url(#slot)','#206e97',4)+`<path d="M20 8H108" stroke="#145b7f" opacity=".5" stroke-width="4" stroke-linecap="round"/>`],
 'side-badge':[256,288,0,`<ellipse cx="128" cy="262" rx="112" ry="18" fill="#734a32" opacity=".25"/><circle cx="128" cy="126" r="114" fill="url(#blue)" stroke="#0470ac" stroke-width="7"/><circle cx="128" cy="126" r="95" fill="#087bd7" stroke="#52d9ff" stroke-width="5"/><path d="M53 59Q80 25 129 27" fill="none" stroke="#c3f8ff" stroke-width="10" stroke-linecap="round"/>`+rr(11,202,234,70,18,'url(#gold)','#dc8e19',5)+`<path d="M25 209H231" stroke="#fff1a2" stroke-width="5" stroke-linecap="round"/>`],
 'nav':[256,128,8,rr(0,0,256,128,0,'url(#nav)','#147cba',2)+`<path d="M0 4H256" stroke="#7ae7ff" stroke-width="5"/>`],
 'nav-active':[256,128,8,rr(0,0,256,128,0,'#46bdf7','#147cba',2)+`<path d="M0 4H256" stroke="#ffe889" stroke-width="7"/>`],
 'round-dark':[128,128,24,rr(3,3,122,122,26,'#255f73','#d9ffff',4)+rr(9,8,110,110,22,'none','#4290a2',2)],
 'round-blue':[128,128,24,rr(3,11,122,114,25,'#146f9d')+rr(3,3,122,114,25,'url(#blue)','#0785bd',5)+`<path d="M28 12H99" stroke="#b0faff" stroke-width="5" stroke-linecap="round"/>`],
 'combo':[160,160,0,`<circle cx="80" cy="83" r="77" fill="#285f6c" opacity=".55"/><circle cx="80" cy="79" r="66" fill="url(#pink)" stroke="#b84d75" stroke-width="5"/><circle cx="80" cy="78" r="59" fill="none" stroke="#ffbfd5" stroke-width="4"/><path d="M42 36Q78 13 114 35" stroke="#ffe2ef" stroke-width="5" fill="none" stroke-linecap="round"/>`],
 'badge-red':[80,52,18,rr(2,5,76,45,17,'#af395b')+rr(2,2,76,43,17,'url(#pink)','#cc4b6d',3)],
 'pill-dark':[128,64,24,rr(2,2,124,60,28,'#155e83','#5dc7e9',2)],
 'progress-fill':[128,40,16,rr(1,1,126,38,16,'url(#gold)','#e0a133',2)],
 'white':[8,8,0,rr(0,0,8,8,0,'white')],
 'star':[128,128,0,`<path d="M64 7L81 44L121 49L91 79L99 120L64 99L29 120L37 79L7 49L47 44Z" fill="url(#gold)" stroke="#d78a21" stroke-width="4"/><path d="M64 18L72 47L49 47Z" fill="#fffbb4"/>`],
 'menu':[128,128,0,`<g fill="white"><circle cx="27" cy="31" r="7"/><circle cx="27" cy="64" r="7"/><circle cx="27" cy="97" r="7"/>${rr(47,24,62,14,7,'white')+rr(47,57,62,14,7,'white')+rr(47,90,62,14,7,'white')}</g>`],
 'pause':[128,128,0,rr(27,20,25,88,10,'white')+rr(76,20,25,88,10,'white')],
 'lock':[128,128,0,`<g stroke="white" stroke-width="10" fill="none"><rect x="25" y="54" width="78" height="61" rx="12"/><path d="M40 54V35C40 4 88 4 88 35V54"/></g>`],
};
const teeth=[];for(let i=0;i<48;i++){const a=i/48*Math.PI*2,r=i%4<2?49:39;teeth.push(`${i?'L':'M'}${64+Math.cos(a)*r},${64+Math.sin(a)*r}`);}shapes.gear=[128,128,0,`<path d="${teeth.join(' ')}Z M64 44A20 20 0 1 0 64 84A20 20 0 1 0 64 44Z" fill="white" fill-rule="evenodd"/>`];
(async()=>{folderMeta('assets/resources/cartoon/ui');for(const[name,[w,h,border,shape]]of Object.entries(shapes)){const file=`assets/resources/cartoon/ui/${name}.png`;await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${defs}${shape}</svg>`)).png().toFile(path.join(root,file));imageMeta(file,w,h,border);}console.log(`Generated ${Object.keys(shapes).length} original glossy UI skins.`);})();
