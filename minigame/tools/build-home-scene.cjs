// Re-author native home + gameplay UI. Ordinary builds do not run this script.
const {SceneWriter,write,frame,compress,uuid,color,vec}=require('./lib/creator.cjs');
const s=new SceneWriter(),W=720,H=1560;
const group=(p,name)=>s.node(p,name,0,0,W,H,[0,1]);
const icon=(p,name,index,x,y,size=90)=>s.sprite(p,name,x,y,size,size,`assets/resources/cartoon/icons/${index}.png`);
const pet=(p,name,index,x,y,size=82)=>s.sprite(p,name,x,y,size,size,`assets/resources/cartoon/pets/${index}.png`);
const label=(...args)=>s.label(...args);
const root=s.node(s.scene,'StarIsleGame');s.controller=root;s.items[root]._layer=1073741824;
const canvas=s.node(s.scene,'Canvas',W/2,-H/2,W,H);
const cameraNode=s.node(canvas,'UICamera');s.items[cameraNode]._lpos=vec(0,0,1000);
const camera=s.component(cameraNode,'cc.Camera',{_projection:0,_priority:1073741824,_fov:45,_fovAxis:0,_orthoHeight:H/2,_near:1,_far:2000,_color:color('#087fa9'),_depth:1,_stencil:0,_clearFlags:7,_rect:{__type__:'cc.Rect',x:0,y:0,width:1,height:1},_aperture:19,_shutter:7,_iso:0,_screenScale:1,_visibility:33554432,_targetTexture:null});
s.component(canvas,'cc.Canvas',{_cameraComponent:s.ref(camera),_alignCanvasWithScreen:true});
s.component(canvas,'cc.Widget',{_alignFlags:45,_target:null,_left:0,_right:0,_top:0,_bottom:0,_horizontalCenter:0,_verticalCenter:0,_isAbsLeft:true,_isAbsRight:true,_isAbsTop:true,_isAbsBottom:true,_isAbsHorizontalCenter:true,_isAbsVerticalCenter:true,_originalWidth:W,_originalHeight:H,_alignMode:2,_lockFlags:0});
const stage=s.node(canvas,'Stage',-W/2,-H/2,W,H,[0,1]);
const home=group(stage,'HomePage');s.sprite(home,'KeyArt',360,780,1040,1560,'assets/resources/cartoon/home.jpg');
const top=group(home,'TopBar');
const menu=s.button(top,'MenuButton',56,75,70,72,'round-blue','onHomeNav','menu');s.sprite(menu,'Icon',0,-3,43,43,'assets/resources/cartoon/ui/menu.png');
s.skin(top,'CoinCounter',320,75,330,62,'pill-dark');s.sprite(top,'Coin',167,75,80,80,'assets/resources/cartoon/home-ui/coin.png');label(top,'CoinsLabel','萌宠金币',265,74,23,{width:155,tint:'#ffe9a3',stroke:2});label(top,'CoinsValue','0',405,74,30,{width:130,stroke:3});
const branding=group(home,'Branding');label(branding,'TitleShadow','快乐萌宠消',361,191,78,{width:650,tint:'#c36c26',outline:'#fff8cf',stroke:9});label(branding,'Title','快乐萌宠消',360,183,78,{width:650,tint:'#fff18a',outline:'#925322',stroke:4});label(branding,'Tagline','把小可爱，一起带回家！',360,258,24,{width:600,tint:'#fff8d1',outline:'#aa693c',stroke:3});
const shortcuts=group(home,'Shortcuts');
for(const[x,y,name,title,file,action]of [[92,370,'SignInButton','7日签到','home-ui/signin','signin'],[628,370,'AlbumButton','萌宠图鉴','icons/1','album'],[92,555,'BagButton','背包道具','home-ui/backpack','bag'],[628,555,'SettingsButton','声音设置','icons/4','settings']]){
 const b=s.button(shortcuts,name,x,y,148,166,'side-badge','onHomeNav',action);s.sprite(b,'Icon',0,-27,110,110,`assets/resources/cartoon/${file}.png`);label(b,'Label',title,0,53,23,{width:138,tint:'#98531e',outline:'#fff5b3',stroke:1});
 if(action==='signin')s.skin(b,'Notice',54,-65,24,24,'badge-red');
}
const welcome=group(home,'WelcomePanel');
for(const[i,id,title,subtitle,style]of [[0,'classic','经典三消','三个相同消除 · 双关挑战','button-blue'],[1,'quartet','极限四消','四个相同消除 · 双关挑战','button-gold'],[2,'fun','趣味规则消','三消 / 两对消除 · 双关挑战','button-pink']]){
 const b=s.button(welcome,`Mode-${id}`,360,1048+i*124,550,108,style,'onHomeMode',id);
 pet(b,'PetIcon',[0,1,3][i],-202,-4,80);label(b,'Title',title,35,-22,35,{width:375,stroke:3,outline:i===1?'#b56a20':i===2?'#a33d70':'#176083'});label(b,'Subtitle',subtitle,35,23,21,{width:383,tint:'#fff7cc',stroke:2,outline:i===1?'#b56a20':i===2?'#a33d70':'#176083'});
}
const campaign=s.button(welcome,'CampaignButton',360,1442,550,122,'button-blue','onHomeNav','campaign');
icon(campaign,'Trophy',3,-202,-4,86);label(campaign,'Title','闯关模式',35,-24,39,{width:375,stroke:3});label(campaign,'Subtitle','选择玩法 · 更多关卡',35,27,23,{width:383,tint:'#fff7cc',stroke:2});
const game=group(stage,'GamePage');s.inactive(game);s.sprite(game,'Background',360,780,1040,1560,'assets/resources/cartoon/game.jpg');
const gameTop=group(game,'TopBar');for(const[x,name,glyph,action]of [[56,'SettingsButton','gear','settings'],[145,'PauseButton','pause','pause']]){const b=s.button(gameTop,name,x,77,70,72,'round-dark','onGameAction',action);s.sprite(b,'Icon',0,0,48,48,`assets/resources/cartoon/ui/${glyph}.png`);}
label(gameTop,'Chapter','第 1 关',388,77,37,{width:320,stroke:4});s.skin(gameTop,'RemainingPill',620,78,148,48,'pill-dark');label(gameTop,'Remaining','剩余 18',620,77,22,{width:140,stroke:2});label(gameTop,'LevelName','新手乐园',389,131,23,{width:430,tint:'#b9faff',stroke:2});
label(game,'Instruction','三个相同自动消除，先点亮色的小可爱',360,180,23,{width:665,stroke:2});
const boardPreview=group(game,'BoardPreview');for(let layer=0;layer<2;layer++)for(let row=0;row<3;row++)for(let col=0;col<3;col++){const x=360+(col-1)*176,y=590+(row-1)*210+(layer?24:-22);const tile=s.skin(boardPreview,`PreviewPet-${layer}-${row}-${col}`,x,y,94,98,'tile');pet(tile,'Pet',(row+col+layer)%3,0,-6,82);if(!layer)s.sprite(tile,'Covered',0,0,94,98,'assets/resources/cartoon/ui/covered.png');}
group(game,'Board');
const reserve=group(game,'ReserveArea');s.inactive(reserve);s.skin(reserve,'ReservePanel',360,1115,680,104,'tray');label(reserve,'ReserveTitle','铲出暂存 · 点击萌宠放回收纳槽',360,1045,22,{width:660,stroke:2});group(reserve,'ReserveTiles');
label(game,'TrayTitle','收纳槽 0 / 7 · 三个相同就消除',360,1208,24,{width:680,outline:'#176b8f',stroke:3});s.skin(game,'TrayPanel',360,1290,690,128,'tray');for(let i=0;i<7;i++)s.skin(game,`Slot${i}`,87+i*91,1286,84,94,'slot');group(game,'Tray');
const tools=group(game,'Toolbar');for(const[x,name,title,idx,count]of [[120,'undo','撤回',5,1],[280,'shovel','铲出',9,1],[440,'hint','提示',7,3],[600,'shuffle','重排',6,1]]){const b=s.button(tools,`Tool-${name}`,x,1434,106,110,'round-blue','onGameAction',name);icon(b,'Icon',idx,0,-5,91);label(tools,`Label-${name}`,title,x,1510,24,{width:130,stroke:3});if(count!==null){s.skin(b,'CountBadge',43,-48,49,34,'badge-red');label(b,'Count',String(count),43,-51,23,{width:44,outline:'#b44365',stroke:2});}}
const skinNames=['button-blue','button-gold','panel','tile','tray','slot','side-badge','nav','nav-active','round-dark','round-blue','combo','badge-red','pill-dark','progress-fill','button-pink'];
s.component(root,compress(uuid('assets/scripts/StarIsle.ts')),{stageRoot:s.ref(stage),homeRoot:s.ref(home),gameRoot:s.ref(game),petFrames:Array.from({length:15},(_,i)=>frame(`assets/resources/cartoon/pets/${i}.png`)),utilityFrames:Array.from({length:10},(_,i)=>frame(`assets/resources/cartoon/icons/${i}.png`)),homeFrames:['coin','signin','backpack'].map(name=>frame(`assets/resources/cartoon/home-ui/${name}.png`)),skinFrames:skinNames.map(name=>frame(`assets/resources/cartoon/ui/${name}.png`))});
s.finish('assets/scenes/main.scene');write('settings/v2/packages/project.json',{__version__:'1.0.5',general:{designResolution:{width:W,height:H,fitWidth:true,fitHeight:true}}});console.log(`Native home and game pages authored: ${s.items.filter(i=>i.__type__==='cc.Node').length} nodes, ${s.items.filter(i=>i.__type__==='cc.Button').length} buttons, ${W}x${H}.`);
