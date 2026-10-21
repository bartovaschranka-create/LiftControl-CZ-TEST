// Presentation modes over existing capabilities. These are NOT identities, ACLs or database roles.
const WORKSPACE_MODES={
  technician:{label:'Technik',description:'Konkrétní stroj, kontrola, závada nebo oprava.',sections:[['machines','Vyhledávání stroje'],['quarterly','Čtvrtletní kontroly'],['service','Servis a historie'],['documents','Technické podklady']]},
  manager:{label:'Vedoucí',description:'Termíny, otevřené požadavky a přehled provedené práce.',sections:[['terms','Termíny kontrol'],['faults','Otevřené závady'],['work','Provedené práce'],['machines','Evidence strojů']]},
  inspector:{label:'Revize',description:'Revize, rozpracované záznamy, protokoly a podklady.',sections:[['newRevision','Nová revize'],['draftRevisions','Rozpracované revize'],['revisions','Archiv a protokoly'],['machines','Stroj a technické podklady']]}
};
const workspaceView={mode:'home',lastMode:'technician',section:'',suspended:new Map()};
function workspaceOriginalAction(action){
  if(workspaceView.suspended.size && action!=='settings'){document.getElementById('workspaceStatus').textContent='Nejdříve obnovte rozepsanou práci v jejím původním prostředí tlačítkem Pokračovat. Formulář zůstává zachovaný.';return;}
  const actions={newQuarterly:()=>window._openWizard(),quarterly:()=>document.getElementById('homeArchiveBtn').click(),faults:()=>document.getElementById('homeFaultsBtn').click(),repair:()=>document.getElementById('homeRepairBtn').click(),repairHistory:()=>{openRepairModal();document.getElementById('repairArchiveBtn').click();},plan:()=>document.getElementById('homePlanBtn').click(),audit:()=>document.getElementById('sideAuditBtn').click(),documents:()=>openManualsModule(),qr:()=>window._openQr(),newRevision:()=>openRevizeForm(),revisions:()=>openRevizeArchive(),settings:()=>document.getElementById('sideSettingsBtn').click()};
  if(!actions[action])return;
  actions[action]();updateWorkspaceBackLink();
}
function workspaceSuspendOpenViews(){
  if(workspaceView.mode==='home')return;
  const modals=[...document.querySelectorAll('.modal.show:not(.workspace-suspended)')];
  if(!modals.length)return;
  const view=document.querySelector('.page-section.active:not(#section-workspace)')?.id;
  workspaceView.suspended.set(workspaceView.mode,{modals,view,focus:document.activeElement});
  modals.forEach(node=>{node.classList.remove('show');node.classList.add('workspace-suspended');});
}
function workspaceResume(){
  const saved=workspaceView.suspended.get(workspaceView.mode);if(!saved)return;
  const view={ 'section-revize':'revize','section-archive':'archive','section-faults':'faults','section-plan':'plan','section-parts':'parts','section-manuals':'manuals','section-home':'home' }[saved.view];
  if(view){document.getElementById('section-workspace').classList.remove('active');showSection(view);}
  saved.modals.forEach(node=>{node.classList.remove('workspace-suspended');node.classList.add('show');});
  workspaceView.suspended.delete(workspaceView.mode);if(saved.focus?.isConnected)saved.focus.focus({preventScroll:true});updateWorkspaceBackLink();
}
function selectWorkspaceMode(mode='home',section){
  if(mode!=='home' && !WORKSPACE_MODES[mode])return;
  if(workspaceView.mode!==mode)workspaceSuspendOpenViews();
  closeHistoryModal();workspaceView.mode=mode;if(mode!=='home')workspaceView.lastMode=mode;
  document.getElementById('workspaceStatus').textContent=workspaceView.suspended.size?'Rozepsaná práce je dočasně pozastavená v původním prostředí. Údaje zůstávají ve formuláři.':'';
  const home=document.getElementById('section-home'),work=document.getElementById('section-workspace');
  showSection('home');work.classList.remove('active');home.classList.toggle('active',mode==='home');
  document.body.dataset.workspaceMode=mode;
  document.querySelectorAll('button[data-workspace-mode]').forEach(button=>{const active=button.dataset.workspaceMode===mode;button.classList.toggle('selected',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  if(mode==='home'){renderWorkspaceWelcome();updateWorkspaceBackLink();return;}
  work.classList.add('active');
  const definition=WORKSPACE_MODES[mode];
  document.getElementById('workspaceModeName').textContent=definition.label;
  document.getElementById('workspaceModeDescription').textContent=definition.description;
  document.getElementById('workspaceSectionNav').innerHTML=definition.sections.map(([key,label])=>`<button type="button" data-workspace-section="${key}">${escapeHtml(label)}</button>`).join('');
  document.getElementById('workspaceResume').hidden=!workspaceView.suspended.has(mode);
  showWorkspaceSection(section || (mode==='manager'?'terms':definition.sections[0][0]));updateWorkspaceBackLink();
}
function workspaceButtons(items){return '<div class="workspace-actions">'+items.map(([action,label])=>`<button type="button" data-workspace-action="${action}">${escapeHtml(label)} <span aria-hidden="true">↗</span></button>`).join('')+'</div>';}
function showWorkspaceSection(key){
  const search=document.querySelector('.dispatch-header-search');if(search)document.querySelector('body > header .dispatch-tools').before(search);
  const definition=WORKSPACE_MODES[workspaceView.mode];if(!definition || !definition.sections.some(item=>item[0]===key))return;
  workspaceView.section=key;
  const host=document.getElementById('workspacePanel'),staging=document.getElementById('workspaceStaging');
  host.querySelectorAll('[data-workspace-reused]').forEach(node=>staging.appendChild(node));host.replaceChildren();
  document.querySelectorAll('[data-workspace-section]').forEach(button=>{const active=button.dataset.workspaceSection===key;button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));});
  const title=definition.sections.find(item=>item[0]===key)[1];
  document.getElementById('workspaceSectionName').textContent=title;
  const reuse=selector=>{const node=document.querySelector(selector);if(node){node.dataset.workspaceReused='1';host.appendChild(node);}};
  if(key==='machines'||key==='records'){
    host.innerHTML='<div class="workspace-search-block"><h2>Vyhledání stroje</h2><div id="workspaceSearchHost"></div></div>';
    const search=document.querySelector('.dispatch-header-search');if(search)document.getElementById('workspaceSearchHost').appendChild(search);
    if(workspaceView.mode==='technician')host.insertAdjacentHTML('beforeend',workspaceButtons([['qr','QR skener'],['newQuarterly','Nová čtvrtletní kontrola']])+workspaceRecentWork());
    reuse('.dispatch-register');
    host.querySelectorAll('.document-index').forEach(node=>node.remove());
    if(workspaceView.mode==='technician'){host.querySelector('.dispatch-register').hidden=true;host.insertAdjacentHTML('beforeend','<button type="button" class="workspace-show-registry" data-workspace-registry>Otevřít evidenci strojů →</button>');}
    if(key==='records')host.insertAdjacentHTML('beforeend','<p class="workspace-help">Nová správa kmenových údajů se zde nepřidává. Otevření průkazu využívá existující evidenci.</p>');
  }else if(key==='terms'){host.innerHTML=workspaceTerms(true);}
  else if(key==='service')host.innerHTML=workspaceButtons([['faults','Závady / nahlásit závadu'],['repair','Zapsat opravu'],['repairHistory','Historie oprav'],['quarterly','Historie kontrol']]);
  else if(key==='quarterly')host.innerHTML=workspaceButtons([['newQuarterly','Nová čtvrtletní kontrola'],['quarterly','Uložené kontroly a historie']]);
  else if(key==='faults'){
    host.innerHTML=workspaceButtons([['faults',workspaceView.mode==='manager'?'Otevřít agendu závad':'Závady / nahlásit závadu']]);
    host.insertAdjacentHTML('beforeend',workspaceFaults(12));
  }else if(key==='repairs')host.innerHTML=workspaceButtons([['repair','Zapsat opravu'],['repairHistory','Archiv a stav oprav']]);
  else if(key==='history')host.innerHTML=workspaceButtons([['quarterly','Historie čtvrtletních kontrol'],['repairHistory','Historie oprav']]);
  else if(key==='documents')host.innerHTML=workspaceButtons([['documents','Otevřít technickou dokumentaci']])+'<a class="workspace-source-link" href="https://bartovaschranka-create.github.io/pomoc-infolince-plosiny/" target="_blank" rel="noopener noreferrer">Technická infolinka ↗</a>';
  else if(key==='qr')host.innerHTML='<p class="workspace-help">Stávající skener najde stroj podle QR z fotografie nebo fotoaparátu. Zachovává původní oprávnění zařízení.</p>'+workspaceButtons([['qr','Otevřít QR skener']]);
  else if(key==='work')host.innerHTML=workspaceRecentWork()+workspaceButtons([['plan','Plán práce'],['quarterly','Provedené kontroly'],['repairHistory','Provedené opravy'],['audit','Historie změn']]);
  else if(key==='users')host.innerHTML='<p class="workspace-help"><strong>Správa uživatelů není v současné aplikaci implementovaná.</strong> Bez doloženého přihlášení a existujícího modelu oprávnění zde nelze bezpečně nabízet vytváření uživatelů ani změny rolí. Tato etapa nepřidává žádnou novou operaci.</p>';
  else if(key==='newRevision')host.innerHTML='<p class="workspace-help">Otevře se původní formulář revize včetně jeho přednastavení, fotografií a kontrol. Protokol RZ, náhled, tisk ani export se nemění.</p>'+workspaceButtons([['newRevision','Založit novou revizi']]);
  else if(key==='draftRevisions'){
    const rows=(revizeData || []).filter(record=>record.draft);
    host.innerHTML=rows.length?'<div class="workspace-drafts">'+rows.map((record,index)=>`<div><span><strong>${escapeHtml(record.protokol || 'Bez čísla')}</strong> · ${escapeHtml(record.model || '')}<small>${escapeHtml(record.vyrobni_cislo || '')}</small></span><button type="button" data-workspace-draft="${index}">Pokračovat ↗</button></div>`).join('')+'</div>':'<p class="workspace-help">V načtené evidenci nejsou rozpracované revize. Pokud jsou uložené původní funkcí, zobrazí se zde.</p>';
    host.querySelectorAll('[data-workspace-draft]').forEach(button=>button.addEventListener('click',()=>{if(workspaceView.suspended.size){document.getElementById('workspaceStatus').textContent='Nejdříve obnovte rozepsanou práci v původním prostředí.';return;}openRevizeForm(rows[Number(button.dataset.workspaceDraft)].id);}));
  }else if(key==='revisions'||key==='protocols')host.innerHTML='<p class="workspace-help">Společný původní archiv revizí nabízí historii, náhled, tisk/PDF a export. Nevytváří se druhá evidence ani nový generátor.</p>'+workspaceButtons([['revisions','Otevřít revizní archiv a protokoly']]);
}
function renderWorkspaceWelcome(){
  const person=typeof getLastEnteredBy==='function'?getLastEnteredBy():'';
  document.getElementById('workspaceIdentity').textContent=person?'Místně zadaný pracovník: '+person+' · přihlášení není ověřené':'Přihlášený uživatel: ověřené přihlášení není v této verzi dostupné';
  document.getElementById('workspaceToday').textContent=new Date().toLocaleDateString('cs-CZ',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('workspaceHomeTerms').innerHTML=workspaceHomeBrief();
  renderWorkspaceSummary();
}
function workspaceBlock(title,body,action='') {return `<section class="workspace-block"><div class="workspace-block-heading"><h2>${title}</h2>${action}</div>${body}</section>`;}
function workspaceHomeBrief(){
  const terms=workspaceTermRows(),today=ymd(new Date()),open=(faultsData||[]).filter(r=>!faultIsRepaired(r)).length;
  return '<div class="workspace-brief">'+[
    ['Termíny kontrol',terms.length?`${terms.filter(r=>r.due<today).length} po termínu · nejbližší ${formatDate(terms[0].due)}`:'Žádné doložené termíny','manager','terms'],
    ['Otevřené závady',`${open} požadavků v načtené evidenci`,'manager','faults'],
    ['Poslední práce',(data||[]).length?'Otevřít provedené kontroly a opravy':'V načtené evidenci nejsou kontroly','manager','work']
  ].map(([label,text,mode,section])=>`<button type="button" data-workspace-jump="${section}" data-workspace-target="${mode}"><strong>${label}</strong><span>${escapeHtml(text)}</span><b aria-hidden="true">→</b></button>`).join('')+'</div>';
}
function workspaceTermRows(){
  const refs=machinePassportReferences({protocols:data || [],revize:revizeData || [],evidence:[]}),seen=new Set();
  return refs.filter(ref=>{const key=normalizeSerial(ref.serial)+'/'+ref.kind;if(!ref.serial||seen.has(key))return false;seen.add(key);return true;}).map(ref=>({...ref,due:ref.record.dalsiKontrola || ref.record.platnost || ref.record.validTo})).filter(ref=>/^\d{4}-\d{2}-\d{2}$/.test(String(ref.due||''))).sort((a,b)=>a.due.localeCompare(b.due));
}
function workspaceTerms(grouped){
  const today=ymd(new Date()),end=ymd(addDays(new Date(),(7-new Date().getDay())%7)),rows=workspaceTermRows();
  const groups=grouped?[['Po termínu',rows.filter(r=>r.due<today)],['Tento týden',rows.filter(r=>r.due>=today&&r.due<=end)],['Později',rows.filter(r=>r.due>end)]]:[['',rows]];
  const body=groups.map(([label,items])=>`${label?`<h3 class="workspace-term-group">${label} <span>(${items.length})</span></h3>`:''}<div class="workspace-rows">${items.slice(0,grouped?5:4).map(r=>`<div class="workspace-data-row"><strong>${escapeHtml(formatDate(r.due))}</strong><button type="button" data-workspace-machine="${escapeHtml(r.serial)}">${escapeHtml(r.model||'Stroj')}<small>${escapeHtml(r.serial)}</small></button><span>${escapeHtml(r.kind)}</span></div>`).join('')||'<p class="workspace-help">Žádné doložené termíny.</p>'}</div>`).join('');
  return workspaceBlock('Nejbližší termíny kontrol',body,`<button type="button" data-workspace-action="quarterly">Archiv kontrol ↗</button>`);
}
function workspaceFaults(limit){
  const rows=(faultsData||[]).filter(r=>!faultIsRepaired(r));
  return workspaceBlock('Otevřené závady',`<div class="workspace-rows">${rows.slice(0,limit).map(r=>`<div class="workspace-data-row"><span>${escapeHtml(formatDate(r.datum||r.date||''))}</span><strong>${escapeHtml(r.type||'Stroj')}<small>${escapeHtml(r.vc||r.serial||'')}</small></strong><span>${escapeHtml(r.description||'Servisní požadavek')}</span></div>`).join('')||'<p class="workspace-help">V načtené evidenci nejsou otevřené závady.</p>'}</div>`,`<button type="button" data-workspace-action="faults">Zobrazit všechny ↗</button>`);
}
function workspaceRecentWork(){
  const rows=[...(data||[])].sort((a,b)=>String(b.datum||'').localeCompare(String(a.datum||''))).slice(0,4);
  return workspaceBlock('Poslední provedené kontroly',`<div class="workspace-rows">${rows.map(r=>`<div class="workspace-data-row"><span>${escapeHtml(formatDate(r.datum||''))}</span><strong>${escapeHtml(r.typ||'Stroj')}<small>${escapeHtml(r.vc||'')}</small></strong><span>Čtvrtletní kontrola</span></div>`).join('')||'<p class="workspace-help">V načtené evidenci nejsou kontroly.</p>'}</div>`);
}
function renderWorkspaceSummary(){
  const today=ymd(new Date()),end=ymd(addDays(new Date(),(7-new Date().getDay())%7)),terms=workspaceTermRows();
  const count=new Set(machinePassportReferences({protocols:data||[],revize:revizeData||[],evidence:window.REVIZE_MACHINE_DB||[]}).map(r=>normalizeSerial(r.serial)).filter(Boolean)).size;
  const html=workspaceBlock('Rychlý přehled','<div class="workspace-stats">'+[['Strojů v evidenci',count],['Po termínu',terms.filter(r=>r.due<today).length],['Tento týden',terms.filter(r=>r.due>=today&&r.due<=end).length],['Uložených kontrol',(data||[]).length]].map(([label,n])=>`<div><span>${label}</span><strong>${n}</strong></div>`).join('')+'</div>');
  document.querySelectorAll('.workspace-summary').forEach(node=>node.innerHTML=html);
}
function updateWorkspaceBackLink(){
  const active=document.querySelector('.page-section.active');
  document.getElementById('workspaceBack').hidden=!active || active.id==='section-home'||active.id==='section-workspace';
}
function installWorkspaceNavigation(){
  if(!document.body.dataset.dispatchReady || document.body.dataset.workspaceReady)return;
  document.body.dataset.workspaceReady='1';
  const home=document.getElementById('section-home'),staging=document.createElement('div');staging.id='workspaceStaging';staging.hidden=true;
  while(home.firstChild)staging.appendChild(home.firstChild);home.appendChild(staging);
  home.insertAdjacentHTML('afterbegin',`<div class="workspace-welcome"><div class="document-kicker">LiftControl CZ / pracovní prostředí</div><h1>Přehled provozu</h1><p>Rychlý přehled techniky, termínů a pracovních úkonů.</p></div><div class="workspace-layout"><div class="workspace-main"><section class="workspace-launcher" aria-label="Pracovní prostředí">${Object.entries(WORKSPACE_MODES).filter(([key])=>key!=='inspector').map(([key,mode])=>`<div class="workspace-launch-row"><div><h2>${mode.label}</h2><p>${mode.description}</p></div><button type="button" data-workspace-mode="${key}">Otevřít prostředí →</button></div>`).join('')}</section><div id="workspaceHomeTerms"></div></div></div>`);
  const work=document.createElement('section');work.id='section-workspace';work.className='page-section';work.innerHTML='<div class="workspace-heading"><div><div class="document-kicker">Pracovní prostředí</div><h1 id="workspaceModeName"></h1><p id="workspaceModeDescription"></p></div><button type="button" data-workspace-mode="home">← Společný přehled</button></div><nav id="workspaceSectionNav" aria-label="Sekce pracovního prostředí"></nav><button id="workspaceResume" type="button" hidden>Pokračovat v rozepsané práci ↗</button><div class="workspace-section-heading"><h2 id="workspaceSectionName"></h2></div><div class="workspace-layout"><div id="workspacePanel" class="workspace-main"></div><aside class="workspace-summary"></aside></div>';
  home.after(work);
  const header=document.querySelector('body > header'),legacyNav=header.querySelector('.dispatch-nav');legacyNav.classList.add('workspace-old-nav');
  header.querySelector('.lift-brand > span:last-child').firstChild.textContent='LiftControl CZ';
  const nav=document.createElement('nav');nav.className='workspace-nav';nav.setAttribute('aria-label','Pracovní prostředí');nav.innerHTML='<button type="button" data-workspace-mode="home">Přehled</button>'+Object.entries(WORKSPACE_MODES).filter(([key])=>key!=='inspector').map(([key,mode])=>`<button type="button" data-workspace-mode="${key}">${mode.label}</button>`).join('');legacyNav.after(nav);
  const revisionEntry=document.createElement('button');revisionEntry.type='button';revisionEntry.dataset.workspaceMode='inspector';revisionEntry.textContent='Revize';document.getElementById('dispatchTools').prepend(revisionEntry);
  const context=document.createElement('div');context.className='workspace-context';context.innerHTML='<span id="workspaceToday"></span><span id="workspaceNameDay"></span><span id="workspaceIdentity"></span><button type="button" data-workspace-mode="inspector">Revize</button><button type="button" data-workspace-action="settings">Nastavení</button><span id="workspaceStatus" role="status"></span>';header.after(context);
  const nameday=document.getElementById('homeNameDayBox');document.getElementById('workspaceNameDay').appendChild(nameday);
  const back=document.createElement('div');back.id='workspaceBack';back.hidden=true;back.innerHTML='<button type="button">← Zpět do pracovního prostředí</button>';context.after(back);back.querySelector('button').addEventListener('click',()=>selectWorkspaceMode(workspaceView.mode==='home'?workspaceView.lastMode:workspaceView.mode,workspaceView.section));
  document.addEventListener('click',event=>{const button=event.target.closest('button[data-workspace-mode],button[data-workspace-section],button[data-workspace-action]');if(!button)return;if(button.dataset.workspaceMode)selectWorkspaceMode(button.dataset.workspaceMode);else if(button.dataset.workspaceSection)showWorkspaceSection(button.dataset.workspaceSection);else workspaceOriginalAction(button.dataset.workspaceAction);});
  document.addEventListener('click',event=>{const button=event.target.closest('button[data-workspace-machine]');if(button)openHistoryModal(button.dataset.workspaceMachine);});
  document.addEventListener('click',event=>{const button=event.target.closest('button[data-workspace-registry]');if(button){document.querySelector('#workspacePanel .dispatch-register').hidden=false;button.hidden=true;}});
  document.addEventListener('click',event=>{const button=event.target.closest('button[data-workspace-jump]');if(button)selectWorkspaceMode(button.dataset.workspaceTarget,button.dataset.workspaceJump);});
  document.getElementById('workspaceResume').addEventListener('click',workspaceResume);
  document.querySelector('.lift-brand').addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();selectWorkspaceMode('home');},{capture:true});
  new MutationObserver(()=>{const active=document.querySelector('.page-section.active:not(#section-workspace)');if(active && work.classList.contains('active'))work.classList.remove('active');if(active?.id==='section-home' && workspaceView.mode!=='home' && !work.classList.contains('active'))selectWorkspaceMode(workspaceView.mode,workspaceView.section);updateWorkspaceBackLink();}).observe(document.getElementById('appRoot'),{subtree:true,attributes:true,attributeFilter:['class']});
  new MutationObserver(()=>{renderWorkspaceSummary();if(workspaceView.mode==='home')renderWorkspaceWelcome();}).observe(document.getElementById('dashControlsTotal'),{childList:true,subtree:true,characterData:true});
  selectWorkspaceMode('home');
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installWorkspaceNavigation);else installWorkspaceNavigation();
