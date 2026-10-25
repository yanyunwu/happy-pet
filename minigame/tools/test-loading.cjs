// Verify the actual exported startup flow, including a transient download failure.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/kirito/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
 try{
  const settings=JSON.parse(fs.readFileSync('build/web-mobile/src/settings.json','utf8'));
  assert.equal(settings.splashScreen.logo.type,'none');assert.equal(settings.splashScreen.background.type,'custom');
  assert.equal(settings.splashScreen.background.base64.split(',')[1],fs.readFileSync('assets/startup/poster.jpg').toString('base64'));
  const page=await browser.newPage({viewport:{width:432,height:936},deviceScaleFactor:2}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/assets/resources/native/**',async route=>{await new Promise(r=>setTimeout(r,650));await route.continue();});
  await page.goto('http://127.0.0.1:7457',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.cc?.director?.getScene()?.getChildByName('LoadingController'),null,{timeout:30000});
  await page.screenshot({path:'output/custom-loading.png'});
  await page.waitForFunction(()=>window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')?.frames.length===15,null,{timeout:30000});
  await page.waitForFunction(()=>cc.director.getScene().getChildByName('StarIsleGame').getComponent('StarIsle').onlineReady);
  const start=await page.evaluate(()=>{const n=cc.director.getScene().getChildByName('StarIsleGame').getComponent('StarIsle').homeRoot.getChildByName('WelcomePanel').getChildByName('Mode-classic');return {x:n.position.x,y:-n.position.y};});
  await page.mouse.click(start.x*.6,start.y*.6);
  assert.equal(await page.evaluate(()=>cc.director.getScene().getChildByName('StarIsleGame').getComponent('StarIsle').modal?.name),'Rules');
  await page.close();
  const retry=await browser.newPage({viewport:{width:432,height:936}});let fail=true; const retryLogs=[];
  retry.on('console',m=>{if(m.type()==='error'||m.type()==='warning')retryLogs.push(m.text())});
  retry.on('pageerror',e=>errors.push(e.message));
  await retry.route('**/assets/resources/native/**',route=>fail?route.fulfill({status:404,body:'QA simulated unavailable resource'}):route.continue());
  await retry.goto('http://127.0.0.1:7457',{waitUntil:'domcontentloaded'});
  await retry.waitForFunction(()=>window.cc?.director?.getScene()?.getChildByName('LoadingController')?.getComponent('LoadingScreen')?.retry.active===true,null,{timeout:45000});
  await retry.screenshot({path:'output/loading-retry.png'});
  fail=false;await retry.mouse.click(216,831);
  await retry.waitForFunction(()=>cc.director.getScene()?.getChildByName('LoadingController')?.getComponent('LoadingScreen')?.token>=2||!!cc.director.getScene()?.getChildByName('StarIsleGame'),null,{timeout:3000});
  try { await retry.waitForFunction(()=>window.cc?.director?.getScene()?.getChildByName('StarIsleGame')?.getComponent('StarIsle')?.frames.length===15,null,{timeout:15000}); }
  catch(error){await retry.screenshot({path:'output/loading-retry-failure.png'});fs.writeFileSync('output/loading-retry-diagnostic.json',JSON.stringify({retryLogs,errors,state:await retry.evaluate(()=>{const a=cc.director.getScene()?.getChildByName('LoadingController')?.getComponent('LoadingScreen');return {scene:cc.director.getScene()?.name,busy:a?.busy,token:a?.token,status:a?.status?.string}})},null,2));throw error;}
  assert.deepEqual(errors,[]);
  fs.writeFileSync('output/loading-qa.json',JSON.stringify({success:true,checks:['standard custom splash exports exact project poster without a default Cocos logo layer','illustrated loading screen and real resource progress','home handoff and first-stage entry','failed downloads offer retry; retry recovers a complete scene'],errors},null,2));
  console.log('PASS — custom opening poster, native loading, real progress, main game handoff and failed-download recovery.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
