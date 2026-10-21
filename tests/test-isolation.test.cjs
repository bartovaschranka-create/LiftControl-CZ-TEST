const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require(path.join(process.env.CODEX_NODE_MODULES,'playwright'));
const root=path.resolve(__dirname,'..');
// Exercise activation against unrelated production cache names, not a text-only assertion.
const listeners={},deleted=[],cacheNames=['liftcontrol-cz-v1-6-5-394','other-app-cache','liftcontrol-cz-test-v1-6-5-226','liftcontrol-cz-test-isolated-workspaces-v2'];
vm.runInNewContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),{self:{addEventListener:(key,fn)=>listeners[key]=fn,clients:{claim:async()=>{}}},caches:{keys:async()=>cacheNames,delete:async key=>deleted.push(key)}});
(async()=>{
 let activation;listeners.activate({waitUntil:p=>activation=p});await activation;assert.deepEqual(deleted,['liftcontrol-cz-test-v1-6-5-226']);
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{
 const context=await browser.newContext({serviceWorkers:'block'}),requests=[],errors=[];
 await context.addInitScript(()=>{
   window.__nativeStorage=window.localStorage;window.__nativeSession=window.sessionStorage;
   localStorage.setItem('ctvrtletni_protokoly_local','PRODUCTION_SENTINEL');localStorage.setItem('production-other','KEEP');sessionStorage.setItem('session-other','KEEP');
 });
 await context.route('**/*',r=>{const u=new URL(r.request().url()),file=path.resolve(root,'.'+u.pathname);requests.push({url:u.origin+u.pathname,method:r.request().method()});return u.origin==='http://127.0.0.1:4179'&&file.startsWith(root+path.sep)&&fs.existsSync(file)&&r.request().method()==='GET'?r.fulfill({path:file}):r.abort()});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4179/index.html');
 const result=await page.evaluate(async()=>{
   const before={firebaseAvailable,storageAvailable,db,storage};
   let initialized=false;window.firebase={initializeApp:()=>initialized=true};
   const blocked=await fetch('https://firestore.googleapis.com/v1/projects/doctype-test/databases/(default)/documents/x',{method:'POST',body:'TEST'}).then(()=>false,()=>true);
   await saveProtocol({id:'ISOLATED-UNIT',vc:'ISOLATED-UNIT',typ:'Test isolation',datum:'2026-10-21'});
   const saved=loadLocalData().some(r=>r.id==='ISOLATED-UNIT');
   saveLocalRevize([{id:'ISOLATED-RZ',draft:true}]);const revisionSaved=loadLocalRevize()[0].id==='ISOLATED-RZ';
   localStorage.setItem('proxy-property','value');const roundtrip=localStorage.getItem('proxy-property')==='value'&&Object.keys(localStorage).includes('proxy-property');
   localStorage.clear();sessionStorage.clear();
   return {before,initialized,blocked,saved,revisionSaved,roundtrip,cloudStillUnavailable:window.firebase===undefined,production:__nativeStorage.getItem('ctvrtletni_protokoly_local'),other:__nativeStorage.getItem('production-other'),session:__nativeSession.getItem('session-other'),testKeys:Object.keys(localStorage)};
 });
 assert.deepEqual(result,{before:{firebaseAvailable:false,storageAvailable:false,db:null,storage:null},initialized:false,blocked:true,saved:true,revisionSaved:true,roundtrip:true,cloudStillUnavailable:true,production:'PRODUCTION_SENTINEL',other:'KEEP',session:'KEEP',testKeys:[]});
 assert.deepEqual(requests.filter(r=>r.method!=='GET'||r.url.includes('firestore.googleapis.com')),[]);
 assert.deepEqual(errors,[]);await browser.close();
 console.log('test-isolation: original local saves work; SDK initialization and cloud POST blocked; production local/session keys and cache preserved.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
