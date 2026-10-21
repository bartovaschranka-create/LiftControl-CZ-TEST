// Exports only rendered presentation. No app script or backend is included in the result.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'..','artifacts');
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
  const context=await browser.newContext({viewport:{width:1200,height:1100},serviceWorkers:'block'});
  await context.route('**/*',route=>{const u=new URL(route.request().url()),p=path.resolve(root,'.'+u.pathname);return u.origin==='http://127.0.0.1:4179'&&route.request().method()==='GET'&&p.startsWith(root+path.sep)&&fs.existsSync(p)?route.fulfill({path:p}):route.abort();});
  const page=await context.newPage();await page.goto('http://127.0.0.1:4179/index.html');
  const card=await page.evaluate(()=>{
   firebaseAvailable=false;
   data=JSON.parse(JSON.stringify(window.LIFTCONTROL_EMBEDDED_BACKUP.collections.protokoly_test));
   faultsData=[];partsData=[];revizeData=[];
   openHistoryModal(data[0].vc);
   // No remote image requests are included in the exported snapshot.
   els.historyBody.querySelectorAll('img').forEach(img=>img.remove());
   els.historyBody.querySelectorAll('button,select').forEach(el=>{el.disabled=true;el.removeAttribute('onclick');});
   return els.historyBody.innerHTML;
  });
  const css=fs.readFileSync(path.join(root,'assets/machine-passport.css'),'utf8');
  const html=`<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>LiftControl CZ — bezpečný náhled karty</title><style>body{margin:0;background:#dedbd3;font:16px/1.5 Arial,sans-serif}main{max-width:1000px;margin:24px auto;padding:24px;background:#f4f1e9}button,select{font:inherit;padding:8px}button{opacity:.6}.preview-note{padding:12px;background:#f0c419;color:#17191a} ${css}</style><main id="historyModal"><p class="preview-note">Statický náhled nové karty · skutečný záznam z přiložené zálohy · bez připojení k úložišti · ovládací akce vypnuté</p>${card}</main></html>`;
  fs.writeFileSync(path.join(out,'machine-passport-preview.html'),html);
  await page.setContent(html);await page.screenshot({path:path.join(out,'machine-passport-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'machine-passport-mobile.png'),fullPage:true});
  console.log('Safe static preview exported to '+out);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
