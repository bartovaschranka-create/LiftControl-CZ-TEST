const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try {
  const context=await browser.newContext({serviceWorkers:'block'});
  await context.route('**/*',route=>{
   const u=new URL(route.request().url()),p=path.resolve(root,'.'+u.pathname);
   return u.origin==='http://127.0.0.1:4179'&&route.request().method()==='GET'&&p.startsWith(root+path.sep)&&fs.existsSync(p)?route.fulfill({path:p}):route.abort();
  });
  const page=await context.newPage();await page.goto('http://127.0.0.1:4179/index.html');
  await page.evaluate(()=>{
   firebaseAvailable=false;
   const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
   window.passportFixture={protocols:[],faults:[],parts:[],repairs:[],revize:[{id:'new',vyrobni_cislo:'TEST',model:'Test model',rok_vyroby:'2020',datum_kontroly:'2026-10-01',nosnost:'230',bocni_dosah:'4',workingEnvelopes:[{mode:'restricted',label:'Omezená obálka <test>',capacity:'300',reach:'3'}]},{id:'old',vyrobni_cislo:'TEST',model:'Test model',rok_vyroby:'2020',datum_kontroly:'2024-01-01',nosnost:'200'}]};
   window.photoFixtures=[{id:'same',vc:'OTHER',typ:'Test model',rok:'2019',datum:'2026-10-01',photos:{right:{dataUrl:pixel}}},{id:'exact',vc:'TEST',typ:'Test model',rok:'2020',datum:'2024-01-01',photos:{right:{dataUrl:pixel}}}];
   assertNeverSave=()=>{throw Error('Passport attempted a write');};
   for(const key of ['saveRevizeRecord','saveLocalData','saveLocalRevize','setAndVerifyFirestore','setAndVerifyFirestoreRest'])window[key]=assertNeverSave;
   window.beforePassport=JSON.stringify({records:passportFixture,photos:photoFixtures,storage:{...localStorage}});
   getMachineRows=()=>passportFixture;getMachineState=()=>({cls:'',txt:'Test'});data=photoFixtures;
   openHistoryModal('TEST');
  });
  assert.match(await page.locator('#machinePassportReference').innerText(),/230 kg/);
  await page.locator('#machinePassport summary').click();
  assert.match(await page.locator('#machinePassportReference').innerText(),/Omezená obálka <test>/);
  await page.locator('#machinePassportYear').selectOption('2024');
  assert.match(await page.locator('#machinePassportReference').innerText(),/200 kg/);
  assert.match(await page.locator('#machinePassportReference').innerText(),/Neuvedeno/);
  assert.equal(await page.evaluate(()=>JSON.stringify({records:passportFixture,photos:photoFixtures,storage:{...localStorage}})===beforePassport),true);
  const photos=await page.evaluate(()=>({exact:machinePassportPhoto('TEST','Test model','2020',photoFixtures).record.id,fallback:machinePassportPhoto('MISSING','Test model','2020',photoFixtures),missing:machinePassportPhoto('MISSING','Other model','2020',photoFixtures),unknownYear:machinePassportPhoto('MISSING','Test model','',photoFixtures)}));
  assert.equal(photos.exact,'exact');assert.equal(photos.fallback.record.id,'exact');assert.equal(photos.fallback.illustrative,true);assert.equal(photos.missing,null);assert.equal(photos.unknownYear,null);
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:950});
   assert.equal(await page.locator('#machinePassport').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'passport overflow at '+width);
   assert.equal(await page.locator('#historyBody').evaluate(el=>el.scrollWidth<=el.clientWidth),true,'history overflow at '+width);
  }
  await page.evaluate(()=>{
   window.passportCalls=[];
   passportFixture.protocols=[{id:'quarterly',datum:'2026-01-01',vc:'TEST'}];
   passportFixture.faults=[{id:'fault',date:'2026-01-01'}];
   passportFixture.parts=[{id:'part'}];
   openPreviewById=id=>passportCalls.push(['protocol',id]);
   openFaultsModal=()=>{};openFaultForm=id=>passportCalls.push(['fault',id]);
   openPartsModal=()=>{};closePartForm=()=>{};scrollToPartCard=id=>passportCalls.push(['part',id]);
  });
  for(const [selector,kind,id] of [['[data-open-id]','protocol','quarterly'],['[data-fault-open]','fault','fault'],['[data-part-open]','part','part']]){
   await page.evaluate(()=>openHistoryModal('TEST'));await page.locator('#historyBody '+selector).click();
   assert.deepEqual(await page.evaluate(()=>passportCalls.at(-1)),[kind,id]);
  }
  console.log('machine-passport: read-only years, missing values, escaped envelopes, photo selection, three viewport widths and existing action routing passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
