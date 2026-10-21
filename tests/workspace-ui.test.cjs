const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const baseline=execFileSync('git',['show','fa32e1dd957df930689eb3e857675978ddf039e0:index.html'],{cwd:root,encoding:'utf8'}).replace(/\r\n/g,'\n');
let current=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\r\n/g,'\n');
for(const line of ["<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'self' 'unsafe-inline' https://unpkg.com https://cdnjs.cloudflare.com; connect-src 'self' data: blob:; form-action 'self'; object-src 'none'\">\n","<script src=\"./assets/test-isolation.js\"></script>\n"]){assert.equal(current.split(line).length,2);current=current.replace(line,'');}
for(const line of ['<link rel="stylesheet" href="./assets/workspace-ui.css">\n','<script src="./assets/workspace-ui.js" defer></script>\n']){assert.equal(current.split(line).length,2);current=current.replace(line,'');}
assert.equal(current,baseline,'No existing function, Firebase configuration, form, calendar, RZ generator, print rule or prefill may change');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES,'playwright'));
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Prague'}),mutations=[];
  await context.route('**/*',route=>{const request=route.request(),u=new URL(request.url()),p=path.resolve(root,'.'+u.pathname);if(request.method()!=='GET')mutations.push(request.method()+' '+u.host);return u.origin==='http://127.0.0.1:4179'&&request.method()==='GET'&&p.startsWith(root+path.sep)&&fs.existsSync(p)?route.fulfill({path:p}):route.abort();});
  const page=await context.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:4179/index.html');
  await page.evaluate(()=>{
   firebaseAvailable=false;data=[{id:'unit',vc:'WORK-01',typ:'Workspace test',rok:'2022',datum:'2026-10-01',dalsiKontrola:'2026-12-01'}];faultsData=[];partsData=[];revizeData=[{id:'revision-draft',draft:true,model:'Workspace test',vyrobni_cislo:'WORK-01',rok_vyroby:'2022',protokol:'TEST-RZ'}];
   window.workspaceBefore=JSON.stringify({data,faultsData,partsData,revizeData,storage:{...localStorage}});window.workspaceCalls=[];
   window._openWizard=()=>workspaceCalls.push('quarterly');window._openQr=()=>workspaceCalls.push('qr');openRevizeForm=id=>workspaceCalls.push(['revision',id || 'new']);
   updateMainOverview();renderDispatchRegistry();
  });
  assert.equal(await page.locator('#workspaceStaging').isVisible(),false);
  assert.equal(await page.locator('.dispatch-register').isVisible(),false,'Home must not show all machine records');
  assert.equal(await page.locator('.dispatch-deadlines').isVisible(),false);
  assert.match(await page.locator('#workspaceIdentity').innerText(),/ověřené přihlášení není/);
  assert.equal(await page.locator('#homeNameDayBox').evaluate(node=>node.textContent.includes(getLightHolidayText(new Date()))),true,'Reuse existing offline nameday calendar');
  assert.equal(await page.locator('.workspace-launch-row').count(),2);
  assert.equal(await page.locator('.workspace-nav [data-workspace-mode="inspector"]').count(),0);
  const summary=await page.locator('#section-home .workspace-stats strong').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return s.color+'|'+s.fontSize+'|'+s.fontWeight}));assert.equal(new Set(summary).size,1);
  const ids=await page.locator('[id]').evaluateAll(nodes=>nodes.map(node=>node.id));assert.equal(new Set(ids).size,ids.length);
  await page.locator('.workspace-launch-row [data-workspace-mode="technician"]').click();
  assert.equal(await page.locator('#section-workspace').isVisible(),true);assert.doesNotMatch(await page.locator('#workspaceSectionNav').innerText(),/Revize|RZ/);
  await page.locator('[data-workspace-section="quarterly"]').click();await page.locator('#workspacePanel [data-workspace-action="newQuarterly"]').click();assert.equal(await page.evaluate(()=>workspaceCalls.at(-1)),'quarterly');
  await page.locator('#workspacePanel [data-workspace-action="quarterly"]').click();assert.equal(await page.locator('#section-archive').isVisible(),true);await page.locator('#closeArchiveTopBtn').click();assert.equal(await page.locator('#section-workspace').isVisible(),true,'Native back must return to the selected workspace');
  await page.locator('[data-workspace-section="qr"]').click();await page.locator('#workspacePanel [data-workspace-action="qr"]').click();assert.equal(await page.evaluate(()=>workspaceCalls.at(-1)),'qr');
  await page.locator('.workspace-nav [data-workspace-mode="manager"]').click();assert.doesNotMatch(await page.locator('#workspaceSectionNav').innerText(),/Revize|RZ/);
  await page.locator('[data-workspace-section="terms"]').click();assert.equal(await page.locator('#workspacePanel .workspace-term-group').count(),3);assert.equal(await page.locator('.dispatch-register').isVisible(),false);
  assert.match(await page.locator('#workspacePanel').innerText(),/Čtvrtletní kontrola/);
  assert.equal(await page.locator('[data-workspace-section="users"]').count(),0);
  await page.locator('.workspace-context [data-workspace-mode="inspector"]').click();assert.doesNotMatch(await page.locator('#workspaceSectionNav').innerText(),/Čtvrtletní|Opravy|Provozní/);
  await page.locator('#workspacePanel [data-workspace-action="newRevision"]').click();assert.deepEqual(await page.evaluate(()=>workspaceCalls.at(-1)),['revision','new']);
  await page.locator('[data-workspace-section="draftRevisions"]').click();await page.locator('[data-workspace-draft="0"]').click();assert.deepEqual(await page.evaluate(()=>workspaceCalls.at(-1)),['revision','revision-draft']);
  // Suspend the original modal DOM without collect/reset/save; resume the exact same nodes and values.
  await page.evaluate(()=>{const modal=document.getElementById('repairModal');document.getElementById('repairWorkText').value='Rozepsaná práce <beze změny>';modal.classList.add('show');selectWorkspaceMode('technician');});
  assert.equal(await page.locator('#repairModal').isVisible(),false);assert.equal(await page.locator('#repairWorkText').inputValue(),'Rozepsaná práce <beze změny>');
  await page.locator('.workspace-context [data-workspace-mode="inspector"]').click();await page.locator('#workspaceResume').click();assert.equal(await page.locator('#repairModal').isVisible(),true);assert.equal(await page.locator('#repairWorkText').inputValue(),'Rozepsaná práce <beze změny>');await page.locator('#closeRepairTopBtn').click();
  await page.evaluate(()=>selectWorkspaceMode('technician','machines'));await page.locator('[data-dispatch-machine="WORK-01"]').click();assert.equal(await page.locator('#historyModal').isVisible(),true,JSON.stringify({errors,state:await page.locator('#historyModal').evaluate(node=>({className:node.className,display:getComputedStyle(node).display,parent:node.parentElement.id,body:document.body.className}))}));await page.locator('#closeHistoryTopBtn').click();
  for(const width of [320,375,390,768,1440]){await page.setViewportSize({width,height:950});for(const mode of ['home','technician','manager','inspector']){await page.evaluate(mode=>selectWorkspaceMode(mode),mode);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,mode+' overflows '+width);}}
  fs.mkdirSync(path.resolve(root,'../artifacts'),{recursive:true});
  for(const mode of ['home','technician','manager','inspector']){await page.evaluate(mode=>selectWorkspaceMode(mode),mode);for(const [device,width] of [['desktop',1440],['mobile',390]]){await page.setViewportSize({width,height:950});await page.screenshot({path:path.resolve(root,'../artifacts','connected-'+mode+'-'+device+'.png'),fullPage:true})}}
  assert.equal(await page.evaluate(()=>JSON.stringify({data,faultsData,partsData,revizeData,storage:{...localStorage}})===workspaceBefore),true,'Mode navigation must not alter records or localStorage');
  assert.deepEqual(mutations,[]);assert.deepEqual(errors,[]);
  console.log('workspace-ui: unchanged original app/RZ, offline calendar, honest identity, isolated role menus, original routing, no new user operation, draft suspension/resume, shared card, read-only state and 320/390/768/1440 layouts passed');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
