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
   window.REVIZE_MACHINE_DB=[];
   window.passportFixture={protocols:[],faults:[],parts:[],repairs:[],revize:[{id:'new',vyrobni_cislo:'TEST',model:'Test model',rok_vyroby:'2020',datum_kontroly:'2026-10-01',nosnost:'230',bocni_dosah:'4',workingEnvelopes:[{mode:'restricted',label:'Omezená obálka <test>',capacity:'300',reach:'3'}]},{id:'old',vyrobni_cislo:'TEST',model:'Test model',rok_vyroby:'2018',datum_kontroly:'2024-01-01',nosnost:'200'}]};
   window.photoFixtures=[{id:'same',vc:'OTHER',typ:'Test model',rok:'2019',datum:'2026-10-01',photos:{right:{dataUrl:pixel}}},{id:'exact',vc:'TEST',typ:'Test model',rok:'2020',datum:'2024-01-01',photos:{right:{dataUrl:pixel}}}];
   assertNeverSave=()=>{throw Error('Passport attempted a write');};
   for(const key of ['saveRevizeRecord','saveLocalData','saveLocalRevize','setAndVerifyFirestore','setAndVerifyFirestoreRest'])window[key]=assertNeverSave;
   window.beforePassport=JSON.stringify({records:passportFixture,photos:photoFixtures,storage:{...localStorage}});
   getMachineRows=()=>passportFixture;getMachineState=()=>({cls:'',txt:'Test'});data=photoFixtures;
   openHistoryModal('TEST');
  });
  assert.match(await page.locator('#machinePassportReference').innerText(),/230 kg/);
  assert.match(await page.locator('#machinePassportReference').innerText(),/Omezená obálka <test>/);
  assert.deepEqual(await page.locator('#machinePassportYear option').allTextContents(),['2020','2019','2018']);
  await page.locator('#machinePassportYear').selectOption('2018');
  assert.match(await page.locator('.passport-identity').innerText(),/2020/,'Reference year must not replace the actual identity year');
  assert.match(await page.locator('#machinePassportReference').innerText(),/200 kg/);
  assert.match(await page.locator('#machinePassportReference').innerText(),/Neuvedeno/);
  assert.equal(await page.evaluate(()=>JSON.stringify({records:passportFixture,photos:photoFixtures,storage:{...localStorage}})===beforePassport),true);
  const photos=await page.evaluate(()=>({exact:machinePassportPhoto('TEST','Test model','2020',photoFixtures).record.id,fallback:machinePassportPhoto('MISSING','Test model','2020',photoFixtures),missing:machinePassportPhoto('MISSING','Other model','2020',photoFixtures),unknownYear:machinePassportPhoto('MISSING','Test model','',photoFixtures)}));
  assert.equal(photos.exact,'exact');assert.equal(photos.fallback.record.id,'exact');assert.equal(photos.fallback.illustrative,true);assert.equal(photos.missing,null);assert.equal(photos.unknownYear,null);
  const safety=await page.evaluate(()=>{
   const tied=machinePassportReferences({evidence:[{serial:'A',model:'Variant model',year:'2020'},{serial:'B',model:'Variant model',year:'2021'}]});
   const tiny=machinePassportReferences({evidence:[{serial:'A',model:'Variant model',year:'2020'}]});
   const rows={protocols:[{vc:'UNKNOWN',typ:'Variant model'}]};
   return {tie:machinePassportContext('UNKNOWN',rows,tied).selectedYear,tiny:machinePassportContext('UNKNOWN',rows,tiny).selectedYear,variant:machinePassportPhoto('MISSING','Test model','2020',photoFixtures.map(record=>({...record,variant:'different'})))};
  });
  assert.equal(safety.tie,'');assert.equal(safety.tiny,'');assert.equal(safety.variant,null,'Known different variant must never supply an illustrative photo');
  const modal=await page.evaluate(()=>{
   const rows={protocols:[{vc:'UNKNOWN',typ:'Only this model',rok:''}],revize:[]};
   const evidence=[{serial:'A',model:'Only this model',year:'2021'},{serial:'B',model:'Only this model',year:'2021'},{serial:'C',model:'Only this model',year:'2019'},...Array.from({length:10},()=>({serial:'C',model:'Only this model',year:'2019'})),{serial:'D',model:'Different model',year:'2023'}];
   const inventory=machinePassportReferences({...rows,evidence});
   const context=machinePassportContext('UNKNOWN',rows,inventory);
   window.REVIZE_MACHINE_DB=evidence;data=rows.protocols;revizeData=[];getMachineRows=()=>({...rows,faults:[],parts:[]});openHistoryModal('UNKNOWN');
   return {knownYear:context.knownYear,selectedYear:context.selectedYear,modalCount:context.modalCount,identity:document.querySelector('.passport-identity').textContent,notice:document.querySelector('.passport-reference-notice').textContent,storedYear:data[0].rok};
  });
  assert.equal(modal.knownYear,'');assert.equal(modal.selectedYear,'2021');assert.equal(modal.modalCount,2);assert.match(modal.identity,/Neznámý/);assert.match(modal.notice,/nejčastějšího/);assert.equal(modal.storedYear,'');
  await page.locator('#machinePassportYear').selectOption('2019');
  assert.match(await page.locator('.passport-reference-notice').innerText(),/Ručně zvolený/);
  assert.match(await page.locator('.passport-identity').innerText(),/Neznámý/);
  assert.equal(await page.evaluate(()=>data[0].rok),'');
  await page.evaluate(()=>{getMachineRows=()=>passportFixture;data=photoFixtures;});
  for(const width of [320,375,390,768,1440]){
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
   printRevizeById=id=>passportCalls.push(['revision',id]);
   loadLocalRepairs=()=>[{id:'repair',serial:'TEST',work:'Výměna spínače <safe>'}];printRepairRecord=record=>passportCalls.push(['repair',record.id]);
  });
  for(const [selector,kind,id] of [['[data-open-id]','protocol','quarterly'],['[data-fault-open]','fault','fault'],['[data-part-open]','part','part'],['[data-passport-revision="0"]','revision','new'],['[data-passport-repair="0"]','repair','repair']]){
   await page.evaluate(()=>openHistoryModal('TEST'));await page.locator('#historyBody '+selector).click();
   assert.deepEqual(await page.evaluate(()=>passportCalls.at(-1)),[kind,id]);
  }
  console.log('machine-passport: read-only manufacture years, deduplicated modal fallback, no forced tiny/tied sample, preserved unknown identity, variant-safe photos, escaped envelopes, five viewports and protocol/revision/repair routing passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
