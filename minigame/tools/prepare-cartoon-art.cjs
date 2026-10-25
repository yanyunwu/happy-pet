// Mechanical atlas slicing / encoding; source illustrations are generated with image_gen.
const fs=require('node:fs'),path=require('node:path');
const {root,imageMeta,folderMeta}=require('./lib/creator.cjs');
let sharp;for(const p of ['sharp',process.env.SHARP_PATH,'C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp'].filter(Boolean)){try{sharp=require(p);break;}catch{}}
if(!sharp)throw new Error('sharp is required');
const source=path.join(root,'art/source-v2');
const sources={home:'home.png',game:'game.png',pets:'pets.png',icons:'icons.png'};
function cuts(histogram){const size=histogram.length,found=[0];for(let part=1;part<3;part++){const expected=size*part/3;let best=Math.round(expected),score=Infinity;for(let c=Math.floor(expected-size*.055);c<expected+size*.055;c++){let sum=0;for(let d=-2;d<=2;d++)sum+=histogram[c+d];sum+=Math.abs(c-expected)*.0001;if(sum<score){score=sum;best=c;}}found.push(best);}found.push(size);return found;}
function componentBounds(data,imageWidth,left,top,width,height){
 const seen=new Uint8Array(width*height),queue=new Int32Array(width*height),components=[];let best={count:0,left:0,top:0,right:width-1,bottom:height-1};
 const solid=p=>data[((top+Math.floor(p/width))*imageWidth+left+p%width)*4+3]>100;
 for(let p=0;p<seen.length;p++){if(seen[p]||!solid(p))continue;let head=0,tail=1;queue[0]=p;seen[p]=1;let minX=width,minY=height,maxX=0,maxY=0;
  while(head<tail){const q=queue[head++],x=q%width,y=Math.floor(q/width);minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);for(const r of [x>0?q-1:-1,x<width-1?q+1:-1,y>0?q-width:-1,y<height-1?q+width:-1])if(r>=0&&!seen[r]&&solid(r)){seen[r]=1;queue[tail++]=r;}}
  const component={count:tail,left:minX,top:minY,right:maxX,bottom:maxY};components.push(component);if(tail>best.count)best=component;
 }
 // Keep all meaningful detached pieces (e.g. both shuffle arrows), omit tiny
 // fragments from neighboring atlas cells when finding the crop rectangle.
 const pieces=components.filter(c=>c.count>=Math.max(32,best.count*.05));
 best={count:best.count,left:Math.min(...pieces.map(c=>c.left)),top:Math.min(...pieces.map(c=>c.top)),right:Math.max(...pieces.map(c=>c.right)),bottom:Math.max(...pieces.map(c=>c.bottom))};
 const x=Math.max(0,best.left-3),y=Math.max(0,best.top-3);return {left:left+x,top:top+y,width:Math.min(width-1,best.right+3)-x+1,height:Math.min(height-1,best.bottom+3)-y+1};
}
async function split(name){
 const input=path.join(source,sources[name]),{data,info}=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const rows=Array(info.height).fill(0),cols=Array(info.width).fill(0);
 for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const a=data[(y*info.width+x)*4+3];if(a>128){rows[y]++;cols[x]++;}}
 const xs=cuts(cols),ys=cuts(rows);console.log(name,'atlas grid',xs,ys);
 for(let i=0;i<9;i++){const col=i%3,row=Math.floor(i/3),file=`assets/resources/cartoon/${name}/${i}.png`;
  const bounds=componentBounds(data,info.width,xs[col],ys[row],xs[col+1]-xs[col],ys[row+1]-ys[row]);
  await sharp(input).extract(bounds).resize(240,240,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).extend({top:8,bottom:8,left:8,right:8,background:{r:0,g:0,b:0,alpha:0}}).png().toFile(path.join(root,file));imageMeta(file,256,256);
 }
}
(async()=>{
 for(const d of ['assets/resources/cartoon','assets/resources/cartoon/pets','assets/resources/cartoon/icons','assets/resources/cartoon/ui'])folderMeta(d);
 fs.mkdirSync(path.join(root,'art/source-v2'),{recursive:true});
 for(const name of ['home','game']){const file=`assets/resources/cartoon/${name}.jpg`;await sharp(path.join(source,sources[name])).jpeg({quality:92,mozjpeg:true}).toFile(path.join(root,file));const info=await sharp(path.join(root,file)).metadata();imageMeta(file,info.width,info.height);}
 await split('pets');await split('icons');
 console.log('Original cartoon art prepared.');
})();
