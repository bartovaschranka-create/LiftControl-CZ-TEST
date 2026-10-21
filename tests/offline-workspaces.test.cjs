const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../artifacts');
const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
const calendar=source.match(/const CZECH_NAMEDAYS = (\{[\s\S]*?\n\});/);
assert.ok(calendar,'Reuse existing calendar');
const names=vm.runInNewContext('('+calendar[1]+')');
const today=new Date(new Date().toLocaleString('en-US',{timeZone:'Europe/Prague'}));
const key=String(today.getDate()).padStart(2,'0')+'.'+String(today.getMonth()+1).padStart(2,'0');
const alt=String(today.getMonth()+1).padStart(2,'0')+'-'+String(today.getDate()).padStart(2,'0');
const name=names[key]||names[alt];assert.ok(name,'Current name day exists');
let html=fs.readFileSync(path.join(root,'preview/workspaces.html'),'utf8');
html=html.replace('<script>','<script>window.PREVIEW_NAMEDAY='+JSON.stringify(name)+';\n');
fs.mkdirSync(out,{recursive:true});
for(const mode of ['home','technician','manager'])fs.writeFileSync(path.join(out,'workspace-'+mode+'.html'),html.replace("const initial=location.hash.slice(1)","const initial=location.hash.slice(1)||'"+mode+"'"));
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
 const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Prague'});const requests=[],errors=[];
 await context.route('**/*',r=>{requests.push(r.request().url());return r.abort()});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const mode of ['home','technician','manager']){
  await page.goto('about:blank');await page.setContent(fs.readFileSync(path.join(out,'workspace-'+mode+'.html'),'utf8'));
  assert.deepEqual(errors,[]);
  assert.match(await page.locator('#nameday').innerText(),new RegExp(name));
  assert.equal(await page.locator('.topnav button').count(),3);
  assert.doesNotMatch(await page.locator('main').innerText(),/Priorita|Jan Procházka/);
  const stats=await page.locator('.stat strong').evaluateAll(nodes=>nodes.map(n=>{const s=getComputedStyle(n);return [s.color,s.fontSize,s.fontWeight].join('|')}));assert.equal(new Set(stats).size,1);
  for(const width of [320,375,390,768,1280,1440]){
   await page.setViewportSize({width,height:width<700?844:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),mode+' overflow '+width);
   if(width===390||width===1440)await page.screenshot({path:path.join(out,'workspace-'+mode+'-'+(width===390?'mobile':'desktop')+'.png'),fullPage:true});
  }
 }
 await page.setViewportSize({width:390,height:844});
 for(const mode of ['technician','manager']){
  await page.locator('.topnav [data-mode="'+mode+'"]').click();
  const n=await page.locator('.tabs button').count();
  for(let i=0;i<n;i++){await page.locator('.tabs button').nth(i).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.equal(await page.locator('.tabs [aria-current="page"]').count(),1)}
 }
 await page.locator('.topnav [data-mode="technician"]').click();
 await page.locator('#search').fill('DEMO-002');await page.locator('#search').press('Enter');assert.equal(await page.locator('[data-machine]').count(),1);await page.locator('[data-machine]').click();assert.match(await page.locator('h1').innerText(),/model B/);await page.locator('#back').click();
 await page.locator('.tabs button').nth(1).click();await page.locator('[data-demo="Čtvrtletní kontroly"]').click();assert.match(await page.locator('[role="status"]').innerText(),/Žádná data/);
 await page.locator('.topnav [data-mode="home"]').click();assert.equal(await page.locator('.launch').count(),2);
 await page.keyboard.press('Tab');assert.notEqual(await page.evaluate(()=>document.activeElement.tagName),'BODY');
 assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
 console.log('PASS: 3 offline views, 6 PNG; 320/375/390/768/1280/1440; tabs/search/passport/keyboard; identical summary typography; zero network requests or page errors.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
