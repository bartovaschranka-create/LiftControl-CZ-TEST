const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.newContext({serviceWorkers:'block'}),unexpected=[];
  await context.route('**/*',route=>{const request=route.request(),u=new URL(request.url()),file=path.resolve(root,'.'+u.pathname);if(request.method()!=='GET')unexpected.push(request.method()+' '+u.hostname);return u.origin==='http://127.0.0.1:4179'&&request.method()==='GET'&&file.startsWith(root+path.sep)&&fs.existsSync(file)?route.fulfill({path:file}):route.abort();});
  // Exercise the original dispatch adapter independently; workspace navigation has its own suite.
  await context.route('**/assets/workspace-ui.js',route=>route.fulfill({body:'',contentType:'text/javascript'}));
  const page=await context.newPage();page.setDefaultTimeout(7000);await page.goto('http://127.0.0.1:4179/index.html');
  const initial=await page.evaluate(()=>{
   firebaseAvailable=false;data=[{id:'d1',vc:'DISPATCH-01',typ:'Test model',rok:'2022',datum:'2026-10-01',umisteni:'Brno'}];faultsData=[{id:'fault-ui',serial:'DISPATCH-01',type:'Test model',date:'2026-10-01',status:'service',description:'Existing fault'}];partsData=[];revizeData=[];
   window.dispatchRecordsBefore=JSON.stringify({data,faultsData,partsData,revizeData});updateMainOverview();renderDispatchRegistry();
   return {ids:[...document.querySelectorAll('[id]')].map(node=>node.id),inputReady:document.getElementById('homeMachineSearch').dataset.homeMachineSuggestReady,photos:!!document.getElementById('faultPhotoInput'),repairPhotos:!!document.getElementById('repairPhotoInput')};
  });
  assert.equal(new Set(initial.ids).size,initial.ids.length,'Relocation must not duplicate IDs');assert.equal(initial.inputReady,'1');assert.equal(initial.photos,true);assert.equal(initial.repairPhotos,true);
  const routes=[['[data-dispatch="archive"]','section-archive'],['[data-dispatch="revize"]','section-revize'],['[data-dispatch="faults"]','section-faults']];
  for(const [button,section] of routes){await page.locator(button).click();assert.equal(await page.locator('#'+section).evaluate(node=>node.classList.contains('active')),true);await page.locator('[data-dispatch="home"]').click();}
  await page.locator('[data-dispatch="repair"]').click();assert.equal(await page.locator('#repairModal').evaluate(node=>node.classList.contains('show')),true);await page.locator('#closeRepairTopBtn').click();
  await page.locator('#homePlanBtn').click();assert.equal(await page.locator('#section-plan').evaluate(node=>node.classList.contains('active')),true);await page.locator('[data-dispatch="home"]').click();
  await page.evaluate(()=>{window.newControlOpened=0;window._openWizard=()=>newControlOpened++;});await page.locator('#newProtocolHomeBtn').click();assert.equal(await page.evaluate(()=>newControlOpened),1);
  await page.locator('#homeMachineSearch').fill('DISPATCH');assert.equal(await page.locator('.home-machine-suggest-box.show [data-serial="DISPATCH-01"]').count(),1);
  await page.locator('.home-machine-suggest-box.show [data-serial="DISPATCH-01"]').dispatchEvent('pointerdown');
  assert.equal(await page.locator('#historyModal').evaluate(node=>node.classList.contains('show')),true);
  assert.equal(await page.locator('#historyModal').evaluate(node=>node.parentElement===document.body && !node.classList.contains('modal')),true,'Passport must be a separate page, not a nested modal');
  await page.locator('#closeHistoryTopBtn').click();
  assert.equal(await page.evaluate(()=>JSON.stringify({data,faultsData,partsData,revizeData})===dispatchRecordsBefore),true,'Opening views must not mutate saved records');
  await page.locator('.dispatch-tools > summary').click();assert.equal(await page.locator('#sideSettingsBtn').isVisible(),true);await page.locator('.dispatch-tools > summary').click();
  for(const width of [320,375,390,768,1440]){
   await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Home overflow '+width);
   const appearance=await page.locator('body > header').evaluate(node=>({background:getComputedStyle(node).backgroundColor,sidebar:getComputedStyle(document.getElementById('sidePanel')).display}));assert.equal(appearance.background,'rgb(247, 245, 240)');assert.equal(appearance.sidebar,'none');
   assert.equal(await page.locator('#homeMachineSearch').isVisible(),true);assert.equal(await page.locator('#homeMachineSearch').evaluate(node=>node.getBoundingClientRect().width>140),true,'Search width '+width);
   await page.locator('[data-dispatch-machine="DISPATCH-01"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Passport overflow '+width);await page.locator('#closeHistoryTopBtn').click();
  }
  assert.deepEqual(unexpected,[],'No test should attempt a backend mutation');
  console.log('dispatch-ui: unique IDs, preserved suggestions/photo inputs, original navigation/forms, read-only records, separate passport page, tools and desktop/tablet/mobile layout passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
