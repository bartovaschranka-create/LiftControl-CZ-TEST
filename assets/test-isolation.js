// TEST only. Run before any application code; never import this file into production.
(() => {
  'use strict';
  const prefix='liftcontrol-cz-test-isolated-v1:';
  function isolatedStorage(native){
    const keys=()=>Object.keys(native).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length));
    const api={getItem:key=>native.getItem(prefix+key),setItem:(key,value)=>native.setItem(prefix+key,String(value)),removeItem:key=>native.removeItem(prefix+key),clear:()=>keys().forEach(key=>native.removeItem(prefix+key)),key:index=>keys()[index]??null};
    Object.defineProperty(api,'length',{get:()=>keys().length,configurable:true});
    return new Proxy(api,{get:(target,key)=>key in target?Reflect.get(target,key):typeof key==='string'?api.getItem(key):undefined,set:(_,key,value)=>{api.setItem(key,value);return true},deleteProperty:(_,key)=>{api.removeItem(key);return true},ownKeys:keys,getOwnPropertyDescriptor:(_,key)=>keys().includes(key)?{enumerable:true,configurable:true,value:api.getItem(key),writable:true}:undefined});
  }
  for(const name of ['localStorage','sessionStorage']){
    const scoped=isolatedStorage(window[name]);
    Object.defineProperty(window,name,{value:scoped,configurable:false,writable:false});
  }
  // Existing save routines use their original local fallback. SDKs cannot initialize the shared project.
  Object.defineProperty(window,'firebase',{get:()=>undefined,set:()=>{},configurable:false});
  Object.defineProperty(window,'LIFTCONTROL_TEST_ISOLATED',{value:true,writable:false});
  document.addEventListener('DOMContentLoaded',()=>{
    const banner=document.createElement('div');banner.className='test-isolation-banner';banner.setAttribute('role','status');
    banner.textContent='TEST · Oddělené místní ukládání · Firebase je vypnutý · Změny se nesynchronizují do ostré aplikace';
    document.querySelector('body > header')?.before(banner);
  });
})();
