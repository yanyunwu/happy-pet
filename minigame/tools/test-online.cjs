const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const ts=require('C:/ProgramData/cocos/editors/Creator/3.8.8/resources/app.asar.unpacked/node_modules/typescript');
function load(name){const file=path.resolve(__dirname,`../assets/scripts/core/${name}.ts`),mod=new Module(file);mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,file);return mod.exports}
const {MatchGame}=load('MatchGame'),{OnlineClient}=load('OnlineClient');
const fixtures=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../artifacts/rule-fixtures.json'),'utf8'));
let steps=0;for(const fixture of fixtures){const g=MatchGame.fromCloud({ordinal:fixture.stage,title:'QA',seed:97,state:fixture.initial});for(const event of fixture.events){if(event.type==='pick')assert(g.pick(event.tileId));else if(event.type==='undo')assert(g.undo());else if(event.type==='shovel')assert(g.shovel());else if(event.type==='hint')assert(g.hint().length);else if(event.type==='shuffle')g.applyCloud(event.state);assert.deepEqual(JSON.parse(JSON.stringify({tiles:g.tiles,tray:g.tray,reserve:g.reserve,status:g.status,moves:g.moves,matches:g.matches,cleared:g.cleared,tools:{undo:g.undoLeft,shovel:g.shovelLeft,hint:g.hintLeft,shuffle:g.shuffleLeft}})),Object.fromEntries(['tiles','tray','reserve','status','moves','matches','cleared','tools'].map(k=>[k,event.state[k]])),`${fixture.mode} stage ${fixture.stage} step ${steps}`);steps++}}
(async()=>{
 const store=new Map(),storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};let fail=true,seen=[],signins=0;
 global.wx={login:({success})=>success({code:'test-code'}),request:({url,data,success,fail:reject})=>{
  if(url.endsWith('/auth/wechat'))return success({statusCode:200,data:{accessToken:'qa-only',user:{id:'player1'}}});
  const assets={coins:20,bag:{undo:1,shovel:1,hint:1,shuffle:1},signInCount:1,signedOn:'2026-10-25'};
  if(url.endsWith('/assets'))return success({statusCode:200,data:assets});
  if(url.endsWith('/sessions'))return success({statusCode:200,data:{id:'session1',lastSeq:0,state:fixtures[0].initial}});
  if(url.endsWith('/events')){seen.push(JSON.parse(JSON.stringify(data.events)));if(fail){fail=false;return reject()}return success({statusCode:200,data:{state:fixtures[0].initial,lastSeq:data.events.at(-1).seq,assets}})}
  if(url.endsWith('/finish'))return success({statusCode:200,data:{status:data.outcome,hasNext:false,rewardCoins:10,assets}});
  if(url.endsWith('/signin')){signins++;return success({statusCode:200,data:assets})}throw new Error(url);
 }};
 const client=new OnlineClient('https://test.invalid/api/v1',storage);await client.start('classic');client.record('pick',4);await assert.rejects(client.flush());assert(store.get('happy-pet-upload-v1').includes('tileId'));const recovered=new OnlineClient('https://test.invalid/api/v1',storage);await recovered.recover();assert.deepEqual(seen[0],seen[1]);assert.equal(recovered.pending,false);await recovered.signIn();assert.equal(signins,1);await client.finish('abandoned');assert.equal(client.pending,false);
 const originalRequest=global.wx.request;let closedOutcome='';global.wx.request=options=>{
  if(options.url.endsWith('/session-closed/events'))return options.success({statusCode:400,data:{error:{message:'背包数量不足'}}});
  if(options.url.endsWith('/session-closed'))return options.success({statusCode:200,data:{id:'session-closed',lastSeq:0,state:fixtures[0].initial}});
  if(options.url.endsWith('/session-closed/finish'))closedOutcome=options.data.outcome;
  return originalRequest(options);
 };
 storage.setItem('happy-pet-upload-v1',JSON.stringify([{userId:'player1',sessionId:'session-closed',events:[{seq:1,type:'shuffle',at:0}]}]));
 const closed=new OnlineClient('https://test.invalid/api/v1',storage);await closed.recover();assert.equal(closed.pending,false);assert.equal(closedOutcome,'abandoned');delete global.wx;
 console.log(JSON.stringify({ok:true,serverClientParitySteps:steps,outbox:'retry, persistence and recovery passed'}));
})().catch(e=>{console.error(e);process.exit(1)});
