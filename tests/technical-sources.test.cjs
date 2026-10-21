const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
 const context=await browser.newContext({serviceWorkers:'block'}),mutations=[];
 const baseline=execFileSync('git',['show','a4f7fbf2d8fd2e324eeeb23281e03795ce439da7:index.html'],{cwd:root,encoding:'utf8'});
 await context.route('**/*',route=>{const u=new URL(route.request().url()),file=path.resolve(root,'.'+u.pathname);if(route.request().method()!=='GET')mutations.push(u.origin);if(u.origin==='http://127.0.0.1:4179'&&u.pathname==='/baseline.html')return route.fulfill({body:baseline,contentType:'text/html'});return u.origin==='http://127.0.0.1:4179'&&file.startsWith(root+path.sep)&&fs.existsSync(file)&&route.request().method()==='GET'?route.fulfill({path:file}):route.abort()});
 const page=await context.newPage();await page.goto('http://127.0.0.1:4179/index.html');
 const before=await page.evaluate(()=>{
  data=[{id:'A',vc:'SAMPLE',typ:'Precise model',rok:'2020',datum:'2026-01-01',nosnost:'250',nosnost_osoby:'2',venkovni_vitr:'5',workingEnvelopes:[{mode:'restricted',capacity:'250',persons:'2',wind:'5',reach:'3'}]}];
  revizeData=[{id:'B',vyrobni_cislo:'SAMPLE',model:'Precise model',rok_vyroby:'2020',datum_kontroly:'2026-02-01',nosnost:'300'}];window.REVIZE_MACHINE_DB=[];
  getMachineRows=()=>({protocols:data,revize:revizeData,faults:[],parts:[]});openHistoryModal('SAMPLE');return JSON.stringify({data,revizeData,storage:{...localStorage}});
 });
 assert.match(await page.locator('.passport-specs').innerText(),/Rozpor/);
 await page.locator('.passport-source-list summary').click();assert.match(await page.locator('.passport-source-list').innerText(),/250/);assert.match(await page.locator('.passport-source-list').innerText(),/300/);
 assert.equal(await page.locator('#machinePassport [data-passport-tab]').count(),3);assert.equal(await page.locator('#machinePassport .document-index').count(),0);
 const computed=await page.evaluate(()=>{
   const ref=machinePassportReferences({protocols:data})[0];
   const table=machinePassportEnvelopeTable(ref,ref.values);
   const refs=machinePassportReferences({protocols:[{vc:'OWN',typ:'Precise model',rok:'2020',vyrobce:'Maker A',varianta:'v1'},{vc:'OTHER',typ:'Precise model',rok:'2020',vyrobce:'Maker B',nosnost:'999',varianta:'v2'}]});
   const conflictingYears=machinePassportReferences({protocols:[{vc:'AMBIGUOUS',typ:'Year model',rok:'2019'},{vc:'AMBIGUOUS',typ:'Year model',rok:'2020'}]});
   const yearContext=machinePassportContext('AMBIGUOUS',{},conflictingYears);
   const selected=machinePassportReferenceForYear(machinePassportContext('OWN',{},refs),refs,'2020');
   return {persons:ref.values.persons,wind:ref.values.wind,transport:ref.values.transportLength,table,selected:selected.serial,knownYear:yearContext.knownYear,yearConflict:yearContext.yearConflict,after:JSON.stringify({data,revizeData,storage:{...localStorage}})};
 });
 assert.equal(computed.persons,'2');assert.equal(computed.wind,'5');assert.equal(computed.transport,undefined);assert.doesNotMatch(computed.table,/12[,.]5/);assert.match(computed.table,/restricted|Omezená/);assert.equal(computed.selected,'OWN');assert.equal(computed.knownYear,'');assert.equal(computed.yearConflict,true);assert.equal(computed.after,before);
 await page.locator('[data-passport-tab="documents"]').click();assert.equal(await page.locator('.passport-photo-section').isVisible(),true);await page.locator('[data-passport-tab="parameters"]').click();assert.equal(await page.locator('.passport-photo-section').isVisible(),false);
 const revision=await page.evaluate(()=>{const record=revizeDefaultRecord();record.id='PRINT-FIXTURE';record.protokol='TEST-RZ';return {record,html:revizePaperHtml(record),styles:getPrintStyles()}});
 const original=await context.newPage();await original.goto('http://127.0.0.1:4179/baseline.html');
 const expected=await original.evaluate(record=>({html:revizePaperHtml(record),styles:getPrintStyles()}),revision.record);
 assert.equal(revision.html,expected.html,'RZ generated content must be byte identical');assert.equal(revision.styles,expected.styles,'RZ print CSS must be byte identical');assert.deepEqual(mutations,[]);
 console.log('technical-sources: source conflicts visible, variants/makers isolated, persons/wind preserved without defaults, no mutations; RZ output and print CSS byte identical to original.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
