// Render real app DOM offline, then export ONLY presentation with a strict no-network/no-script CSP.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..','artifacts');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1050},serviceWorkers:'block'});
  await context.route('**/*',route=>{const u=new URL(route.request().url()),p=path.resolve(root,'.'+u.pathname);return u.origin==='http://127.0.0.1:4179'&&route.request().method()==='GET'&&p.startsWith(root+path.sep)&&fs.existsSync(p)?route.fulfill({path:p}):route.abort();});
  const page=await context.newPage();await page.goto('http://127.0.0.1:4179/index.html');
  await page.evaluate(()=>{
   firebaseAvailable=false;const backup=window.LIFTCONTROL_EMBEDDED_BACKUP.collections;
   data=JSON.parse(JSON.stringify(backup.protokoly_test || []));faultsData=JSON.parse(JSON.stringify(backup.hlaseni_poruch || []));partsData=JSON.parse(JSON.stringify(backup.nahradni_dily || []));scheduleData=JSON.parse(JSON.stringify(backup.plan_prace || []));revizeData=[];
   updateMainOverview();renderDispatchRegistry();showSection('home');
  });
  const css=await page.evaluate(()=>[...document.querySelectorAll('head style')].map(node=>node.textContent).join('\n'))+'\n'+fs.readFileSync(path.join(root,'assets/machine-passport.css'),'utf8');
  const exportState=()=>page.evaluate(()=>{
   const header=document.querySelector('body > header').cloneNode(true);
   let main;
   if(document.body.classList.contains('passport-open'))main=document.getElementById('historyModal').cloneNode(true);
   else{main=document.createElement('main');main.className='container';main.id='appRoot';main.appendChild(document.getElementById('section-home').cloneNode(true));}
   main.querySelectorAll('.page-section:not(.active),.dispatch-legacy').forEach(node=>node.remove());
   const wrapper=document.createElement('div');wrapper.append(header,main);
   wrapper.querySelectorAll('script,.dispatch-legacy-header').forEach(node=>node.remove());
   wrapper.querySelectorAll('img').forEach(img=>{if(!img.src.startsWith('data:image/'))img.replaceWith(Object.assign(document.createElement('div'),{className:'passport-no-photo',textContent:'Fotografie z cloudového úložiště není součástí offline náhledu.'}));});
   wrapper.querySelectorAll('*').forEach(node=>[...node.attributes].filter(attribute=>/^on/i.test(attribute.name)).forEach(attribute=>node.removeAttribute(attribute.name)));
   wrapper.querySelectorAll('button').forEach(button=>{
    let href='';if(button.dataset.dispatch==='home'||button.id==='closeHistoryTopBtn')href='dispatch-preview.html';if(button.dataset.dispatch==='machines'||button.dataset.dispatchMachine)href='machine-passport-preview.html';
    if(href){const anchor=document.createElement('a');anchor.className=button.className+' static-navigation';anchor.textContent=button.textContent;anchor.href=href;button.replaceWith(anchor);}else button.disabled=true;
   });
   wrapper.querySelectorAll('input,select').forEach(node=>node.disabled=true);
   return {body:wrapper.innerHTML,classes:document.body.className};
  });
  const htmlFor=state=>`<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>LiftControl — statický návrh k vizuálnímu schválení</title><style>${css}\n.static-preview-banner{background:#edc500;color:#202222;padding:8px 20px;font:10px/1.6 monospace;text-align:center}.static-navigation{display:inline-flex;align-items:center;color:inherit;text-decoration:none;padding:0 10px;font-size:11px;min-height:35px}.dispatch-nav .static-navigation{color:#36383b;border-bottom:3px solid transparent}.dispatch-nav .static-navigation.selected{border-color:#ffcc00;color:#17191c;background:transparent}.dispatch-registry .static-navigation{border-bottom:1px solid #9ca18e;padding:0;font-weight:700}.dispatch-ui .dispatch-legacy{display:none!important}body.dispatch-ui{margin:0;font-family:Arial,sans-serif}button:disabled{cursor:default;opacity:1}input:disabled{opacity:1}.passport-page a.static-navigation{border:1px solid #9ca18e;border-radius:0;background:none;color:#202222;font:11px Arial,sans-serif;padding:9px 12px;min-height:34px}</style></head><body class="${state.classes}"><div class="static-preview-banner">NÁVRH K VIZUÁLNÍMU SCHVÁLENÍ · STATICKÝ NÁHLED · BEZ FIREBASE · SKUTEČNÁ PŘILOŽENÁ ZÁLOHA, NIKOLI ŽIVÝ STAV</div>${state.body}</body></html>`;
  const home=htmlFor(await exportState());
  await page.evaluate(()=>{const first=data.find(record=>machinePassportReferences({evidence:window.REVIZE_MACHINE_DB}).some(ref=>normalizeSerial(ref.serial)===normalizeSerial(record.vc))) || data[0];openHistoryModal(first.vc);});
  // Allow the page-layout observer to apply before capturing the machine document.
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  const machine=htmlFor(await exportState());
  for(const [name,html] of [['dispatch-preview',home],['machine-passport-preview',machine]]){
   assert.ok(!/<script\b|\son[a-z]+\s*=/i.test(html),'Export must contain no scripts or event handlers');
   fs.writeFileSync(path.join(out,name+'.html'),html);
   for(const [device,width,height] of [['desktop',1440,1050],['mobile',390,844],['narrow',320,740]]){
    await page.setViewportSize({width,height});await page.setContent(html);await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} overflows ${device}`);
    await page.screenshot({path:path.join(out,name+'-'+device+'.png'),fullPage:true});
   }
  }
  console.log('Offline home + machine document exported for desktop/mobile: '+out);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
