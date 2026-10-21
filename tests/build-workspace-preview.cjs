// Local static review artifacts only. Never publish real backup screenshots to the public repository.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..','artifacts');
(async()=>{
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Prague'});
  await context.route('**/*',route=>{const u=new URL(route.request().url()),file=path.resolve(root,'.'+u.pathname);return u.origin==='http://127.0.0.1:4179'&&route.request().method()==='GET'&&file.startsWith(root+path.sep)&&fs.existsSync(file)?route.fulfill({path:file}):route.abort();});
  const page=await context.newPage();await page.goto('http://127.0.0.1:4179/index.html');
  await page.evaluate(()=>{firebaseAvailable=false;const b=window.LIFTCONTROL_EMBEDDED_BACKUP.collections;data=JSON.parse(JSON.stringify(b.protokoly_test || []));faultsData=JSON.parse(JSON.stringify(b.hlaseni_poruch || []));partsData=JSON.parse(JSON.stringify(b.nahradni_dily || []));scheduleData=JSON.parse(JSON.stringify(b.plan_prace || []));revizeData=[];updateMainOverview();renderDispatchRegistry();});
  const css=await page.evaluate(()=>[...document.querySelectorAll('head style')].map(node=>node.textContent).join('\n'))+'\n'+['machine-passport.css','workspace-ui.css'].map(file=>fs.readFileSync(path.join(root,'assets',file),'utf8')).join('\n');
  const states=[];
  for(const [mode,section] of [['home',''],['technician','machines'],['manager','terms'],['inspector','newRevision']]){
   await page.evaluate(({mode,section})=>selectWorkspaceMode(mode,section || undefined),{mode,section});
   const state=await page.evaluate(()=>{
    const wrapper=document.createElement('div');wrapper.appendChild(document.querySelector('body > header').cloneNode(true));wrapper.appendChild(document.querySelector('.workspace-context').cloneNode(true));
    const main=document.createElement('main');main.className='container';main.appendChild(document.querySelector('.page-section.active').cloneNode(true));wrapper.appendChild(main);
    wrapper.querySelectorAll('#workspaceStaging,script,.dispatch-legacy-header,.workspace-old-nav').forEach(node=>node.remove());
    wrapper.querySelectorAll('*').forEach(node=>[...node.attributes].filter(attribute=>/^on/i.test(attribute.name)).forEach(attribute=>node.removeAttribute(attribute.name)));
    wrapper.querySelectorAll('button').forEach(button=>{if(button.dataset.workspaceMode){const anchor=document.createElement('a');anchor.href='workspace-'+button.dataset.workspaceMode+'.html';anchor.className='workspace-static-link '+button.className;anchor.textContent=button.textContent;button.replaceWith(anchor);}else button.disabled=true;});
    wrapper.querySelectorAll('input,select,textarea').forEach(node=>node.disabled=true);
    return {body:wrapper.innerHTML,mode:document.body.dataset.workspaceMode};
   });
   const html=`<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>LiftControl — pracovní prostředí / návrh</title><style>${css}\n.workspace-static-banner{padding:7px 16px;background:#ffcc00;color:#17191c;text-align:center;font:9px/1.7 monospace}.workspace-static-link{color:inherit;text-decoration:none;display:inline-flex;align-items:center}.workspace-nav .workspace-static-link{font:700 11px Arial,sans-serif;padding:12px;border-bottom:4px solid transparent;white-space:nowrap;flex-shrink:0}.workspace-nav .workspace-static-link.selected{border-color:#ffcc00}.workspace-launch-row .workspace-static-link{background:#ffcc00;border:1px solid #c3a600;padding:11px 16px;font-size:11px;font-weight:700;white-space:nowrap}button:disabled{opacity:1;cursor:default}@media(max-width:520px){.workspace-launch-row .workspace-static-link{grid-column:2;justify-self:start;padding:9px 12px}.workspace-nav .workspace-static-link{font-size:10px;padding:12px 9px}}</style></head><body class="dispatch-ui" data-workspace-ready="1" data-workspace-mode="${state.mode}"><div class="workspace-static-banner">NÁVRH K POSOUZENÍ · STATICKÝ / BEZ FIREBASE · PRACOVNÍ REŽIMY NEJSOU OPRÁVNĚNÍ</div>${state.body}</body></html>`;
   assert.ok(!/<script\b|\son[a-z]+\s*=/i.test(html));fs.writeFileSync(path.join(out,'workspace-'+mode+'.html'),html);states.push({mode,html});
  }
  for(const {mode,html} of states){for(const [device,width,height] of [['desktop',1440,1000],['mobile',390,844]]){await page.setViewportSize({width,height});await page.setContent(html);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,mode+' '+device+' overflow');await page.screenshot({path:path.join(out,'workspace-'+mode+'-'+device+'.png'),fullPage:true});}}
  console.log('Four offline workspace HTML views and eight PC/mobile screenshots exported to '+out);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
