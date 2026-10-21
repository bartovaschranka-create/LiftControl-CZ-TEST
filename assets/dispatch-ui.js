// Relocate existing DOM nodes: preserve listeners, IDs, suggestion inputs and form behavior.
function installDispatchPresentation(){
  if(document.body.dataset.dispatchReady)return;document.body.dataset.dispatchReady='1';
  document.body.classList.add('dispatch-ui');
  const header=document.querySelector('body > header'),oldHeader=document.createElement('div');oldHeader.className='dispatch-legacy-header';
  while(header.firstChild)oldHeader.appendChild(header.firstChild);header.appendChild(oldHeader);
  header.insertAdjacentHTML('afterbegin','<a href="#" class="lift-brand" aria-label="LiftControl — dispečink"><span class="lift-monogram" aria-hidden="true">LC<span></span></span><span>LiftControl<small>TECHNICKÁ EVIDENCE / CZ</small></span></a><nav class="dispatch-nav" aria-label="Hlavní navigace"><button data-dispatch="home" class="selected">Dispečink</button><button data-dispatch="machines">Stroje</button><button data-dispatch="revize">Revize ZZ</button><button data-dispatch="archive">Čtvrtletní kontroly</button><button data-dispatch="faults">Závady</button><button data-dispatch="repair">Opravy</button></nav><details class="dispatch-tools"><summary>Nástroje <span>＋</span></summary><div id="dispatchTools"></div></details>');
  document.querySelector('.lift-brand').addEventListener('click',event=>{event.preventDefault();closeHistoryModal();showSection('home');});
  // All original auxiliary navigation and administration controls stay available at the top.
  const tools=document.getElementById('dispatchTools');
  [...document.querySelectorAll('#sidePanel .side-nav > button,#sidePanel .side-bottom > button')].forEach(button=>tools.appendChild(button));
  tools.addEventListener('click',event=>{if(event.target.closest('button'))document.querySelector('.dispatch-tools').open=false;});
  const home=document.getElementById('section-home'),legacy=document.createElement('div');legacy.className='dispatch-legacy';legacy.hidden=true;
  while(home.firstChild)legacy.appendChild(home.firstChild);home.appendChild(legacy);
  home.insertAdjacentHTML('afterbegin',`<div class="dispatch-masthead"><div><div class="document-kicker">Provoz / servis / technická evidence</div><h1>Dispečink<span class="masthead-period">.</span></h1><p>Stroje, které potřebují vaši pozornost. Práce, která má navazovat.</p></div><div class="dispatch-date"><span>PRACOVNÍ PŘEHLED</span><strong id="dispatchDate"></strong><small>LiftControl CZ · testovací verze</small></div></div><div class="dispatch-command"><div class="dispatch-search"><label for="homeMachineSearch">VYHLEDAT STROJ / VÝROBNÍ ČÍSLO</label><div id="dispatchSearchHost"></div></div><div class="dispatch-primary-actions" id="dispatchPrimaryActions"></div></div><div class="dispatch-body"><div class="dispatch-main-column"><section class="dispatch-register"><div class="document-section-title"><span class="document-index">01</span><h2>Evidence strojů</h2><span id="dispatchMachineCount"></span></div><div class="dispatch-registry-wrap"><table class="dispatch-registry"><thead><tr><th>Stroj / výrobní číslo</th><th>Rok výroby</th><th>Poslední místo</th><th>Evidence</th><th></th></tr></thead><tbody id="dispatchMachineRows"></tbody></table></div><p class="dispatch-table-note">Výběr z evidence · vyhledejte konkrétní stroj výrobním číslem</p></section><section class="dispatch-activity"><div class="document-section-title"><span class="document-index">02</span><h2>Provozní události</h2><span>Posledních 48 pracovních hodin</span></div><div id="dispatchActivityHost"></div></section></div><aside class="dispatch-work-column"><section class="dispatch-work-plan"><div class="document-section-title"><span class="document-index">03</span><h2>Práce techniků</h2></div><div id="dispatchPlanHost"></div></section><section class="dispatch-ledger"><div class="document-section-title"><span class="document-index">04</span><h2>Stav agendy</h2></div><div id="dispatchLedgerHost"></div></section><div class="dispatch-actions-title">NAVAZUJÍCÍ AGENDA</div><div class="dispatch-secondary-actions" id="dispatchSecondaryActions"></div></aside></div><footer class="dispatch-footer"><span>LC / CZ — PROVOZNÍ EVIDENCE</span><span>Technické hodnoty ověřujte pro konkrétní stroj.</span></footer>`);
  const move=(selector,target)=>{const node=legacy.querySelector(selector);if(node)document.getElementById(target).appendChild(node);return node;};
  const search=move('.home-machine-search-row','dispatchSearchHost');if(search)search.querySelector('input').placeholder='Výrobní číslo stroje…';
  move('#homeMachineList','dispatchSearchHost');
  const first=move('#newProtocolHomeBtn','dispatchPrimaryActions');if(first)first.textContent='+ Čtvrtletní kontrola';
  const fault=move('#homeFaultsBtn','dispatchPrimaryActions');if(fault)fault.textContent='Nahlásit závadu';
  ['#homeRepairBtn','#homePlanBtn','#homePartsBtn','#homeArchiveBtn'].forEach(selector=>move(selector,'dispatchSecondaryActions'));
  move('.day-calendar-card','dispatchPlanHost');move('#attentionList','dispatchActivityHost');
  const activity=document.getElementById('dispatchActivityHost');
  const recent=document.createElement('details');recent.className='dispatch-recent-events';recent.innerHTML='<summary>Události za posledních 48 pracovních hodin</summary>';recent.appendChild(document.getElementById('attentionList'));activity.appendChild(recent);
  activity.insertAdjacentHTML('afterbegin','<div class="dispatch-queue-title">Otevřené servisní požadavky</div><div id="dispatchWorkQueue"></div>');
  [...legacy.querySelectorAll('.home-summary-grid > div')].forEach(node=>document.getElementById('dispatchLedgerHost').appendChild(node));
  document.getElementById('dispatchDate').textContent=new Date().toLocaleDateString('cs-CZ',{day:'2-digit',month:'2-digit',year:'numeric'});
  arrangeDispatchReferenceLayout(home,header);
  const history=document.getElementById('historyModal');document.body.appendChild(history);history.classList.remove('modal');history.classList.add('passport-page');history.setAttribute('aria-label','Digitální technický průkaz');
  history.querySelector('.preview-title').textContent='Technický průkaz stroje';document.getElementById('closeHistoryTopBtn').textContent='← Zpět do evidence';
  const sync=()=>{
    const passportOpen=history.classList.contains('show');document.body.classList.toggle('passport-open',passportOpen);
    const active=document.querySelector('.page-section.active')?.id;
    document.querySelectorAll('[data-dispatch]').forEach(button=>{const map={home:'section-home',revize:'section-revize',archive:'section-archive',faults:'section-faults'};const selected=passportOpen?button.dataset.dispatch==='machines':map[button.dataset.dispatch]===active;button.classList.toggle('selected',selected);if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  };
  new MutationObserver(sync).observe(history,{attributes:true,attributeFilter:['class']});
  document.querySelectorAll('.page-section').forEach(section=>new MutationObserver(sync).observe(section,{attributes:true,attributeFilter:['class']}));
  document.querySelectorAll('[data-dispatch]').forEach(button=>button.addEventListener('click',()=>{
    closeHistoryModal();document.querySelector('.dispatch-tools').open=false;
    const view=button.dataset.dispatch;
    if(view==='machines'){showSection('home');document.getElementById('homeMachineSearch').focus();document.querySelector('.dispatch-register').scrollIntoView({block:'center'});}
    else if(view==='repair')document.getElementById('homeRepairBtn').click();
    else if(view==='revize')document.querySelector('#dispatchTools [data-view="revize"]').click();
    else if(view==='faults')document.getElementById('homeFaultsBtn').click();
    else if(view==='archive')document.getElementById('homeArchiveBtn').click();else showSection('home');
  }));
  document.querySelector('.dispatch-register').addEventListener('click',event=>{const button=event.target.closest('[data-dispatch-machine]');if(button)openHistoryModal(button.dataset.dispatchMachine);});
  document.getElementById('dispatchWorkQueue').addEventListener('click',event=>{const button=event.target.closest('button');if(!button)return;if(button.dataset.dispatchFault)openFaultsList(button.dataset.dispatchFault,'all');if(button.dataset.dispatchPart)openPartsList(button.dataset.dispatchPart);});
  new MutationObserver(()=>renderDispatchRegistry()).observe(document.getElementById('dashControlsTotal'),{childList:true,subtree:true,characterData:true});
  renderDispatchRegistry();sync();
}
function renderDispatchRegistry(){
  const host=document.getElementById('dispatchMachineRows');if(!host)return;
  const refs=machinePassportReferences({protocols:data || [],revize:revizeData || [],evidence:window.REVIZE_MACHINE_DB || []}),machines=new Map();
  refs.forEach(ref=>{if(ref.serial && !machines.has(normalizeSerial(ref.serial)))machines.set(normalizeSerial(ref.serial),ref);});
  document.getElementById('dispatchMachineCount').textContent=machines.size+' strojů v evidenci';
  host.innerHTML=[...machines.values()].slice(0,6).map(ref=>`<tr><td><strong>${escapeHtml(ref.model || 'Typ neuveden')}</strong><span class="registry-serial">${escapeHtml(ref.serial)}</span></td><td class="registry-year">${ref.year || '—'}</td><td>${escapeHtml(displayPlaceName(ref.record.umisteni || ref.record.place || '') || 'Neuvedeno')}</td><td><span class="registry-source">${escapeHtml(ref.kind)}</span></td><td><button type="button" data-dispatch-machine="${escapeHtml(ref.serial)}" aria-label="Otevřít průkaz stroje ${escapeHtml(ref.serial)}">Průkaz ↗</button></td></tr>`).join('') || '<tr><td colspan="5">Evidence je prázdná. Vyhledejte nebo načtěte existující stroj.</td></tr>';
  const queue=[...(faultsData || []).filter(record=>!faultIsRepaired(record)).map(record=>({record,kind:'fault',status:getFaultStatus(record).txt,model:record.type,serial:record.serial,text:record.description,date:record.date})),...(partsData || []).filter(record=>!record.resolved && !record.sent).map(record=>({record,kind:'part',status:getPartStatus(record).txt,model:record.type,serial:record.serial,text:record.partName || record.note,date:record.date || record.createdAt}))];
  document.getElementById('dispatchWorkQueue').innerHTML=queue.slice(0,5).map(item=>`<div class="dispatch-queue-row"><div><span class="queue-status">${escapeHtml(item.status)}</span><p><strong>${escapeHtml(item.model || 'Typ neuveden')} · ${escapeHtml(item.serial || 'Výrobní číslo neuvedeno')}</strong>${escapeHtml(item.text || 'Bez popisu')}</p><small>${escapeHtml(String(item.date || 'Datum neuvedeno').slice(0,10))}</small></div><button data-dispatch-${item.kind}="${escapeHtml(item.record.id)}" type="button">Otevřít ↗</button></div>`).join('') || '<p class="technical-note">V načtené evidenci nejsou otevřené poruchy ani neodeslané požadavky na díly.</p>';
  renderDispatchTerms();
}
function arrangeDispatchReferenceLayout(home,header){
  const primaryActions=document.getElementById('dispatchPrimaryActions'),secondaryActions=document.getElementById('dispatchSecondaryActions');
  const masthead=home.querySelector('.dispatch-masthead');masthead.querySelector('h1').textContent='Dispečink';masthead.querySelector('p').textContent='Technika  ›  Dispečink  ›  Pracovní přehled';
  const search=home.querySelector('.dispatch-search');search.classList.add('dispatch-header-search');header.querySelector('.dispatch-tools').before(search);
  const body=home.querySelector('.dispatch-body'),activity=home.querySelector('.dispatch-activity'),registry=home.querySelector('.dispatch-register'),plan=home.querySelector('.dispatch-work-plan'),ledger=home.querySelector('.dispatch-ledger');
  [activity,registry,plan,ledger].forEach(node=>body.appendChild(node));
  home.querySelector('.dispatch-main-column').remove();home.querySelector('.dispatch-work-column').remove();
  const actions=document.createElement('section');actions.className='dispatch-quick-actions';actions.innerHTML='<div class="document-section-title"><span class="document-index">04</span><h2>Rychlé akce</h2></div>';actions.appendChild(primaryActions);actions.appendChild(secondaryActions);body.appendChild(actions);
  home.querySelector('.dispatch-command').remove();
  const terms=document.createElement('section');terms.className='dispatch-deadlines';terms.innerHTML='<div class="document-section-title"><span class="document-index">03</span><h2>Nejbližší termíny</h2></div><div class="dispatch-terms-table-wrap"><table class="dispatch-terms-table"><thead><tr><th>Termín</th><th>Stroj / výrobní číslo</th><th>Událost</th></tr></thead><tbody id="dispatchTerms"></tbody></table></div><p class="technical-note">Termíny pouze z doložené evidence kontrol a revizí.</p>';body.appendChild(terms);
  const planning=document.createElement('section');planning.className='dispatch-planning';planning.innerHTML='<div class="document-section-title"><span class="document-index">01</span><h2>Plán práce / následujících sedm dní</h2></div><div id="dispatchWeekStrip"></div>';masthead.after(planning);
  activity.querySelector('h2').textContent='Otevřené závady a servis';activity.querySelector('.document-section-title > span:last-child').textContent='Skutečné požadavky';registry.querySelector('.document-index').textContent='05';plan.querySelector('.document-index').textContent='06';ledger.querySelector('.document-index').textContent='07';
  terms.addEventListener('click',event=>{const button=event.target.closest('[data-term-machine]');if(button)openHistoryModal(button.dataset.termMachine);});
}
function renderDispatchTerms(){
  const strip=document.getElementById('dispatchWeekStrip'),host=document.getElementById('dispatchTerms');if(!strip || !host)return;
  const now=new Date(),today=ymd(now);
  strip.innerHTML=Array.from({length:7},(_,index)=>{const date=addDays(now,index),key=ymd(date),count=(scheduleData || []).filter(row=>row.date===key).length;return `<div class="dispatch-day ${index===0?'today':''}"><span>${index===0?'Dnes':date.toLocaleDateString('cs-CZ',{weekday:'short'})}</span><strong>${date.toLocaleDateString('cs-CZ',{day:'2-digit',month:'2-digit'})}</strong><b>${count}</b><small>plánovaných úkolů</small></div>`;}).join('');
  const refs=machinePassportReferences({protocols:data || [],revize:revizeData || [],evidence:window.REVIZE_MACHINE_DB || []}),dedup=new Set(),terms=[];
  refs.forEach(ref=>{const key=normalizeSerial(ref.serial)+'/'+(ref.kind==='Čtvrtletní kontrola'?'quarterly':'revision');if(!ref.serial || dedup.has(key))return;dedup.add(key);const due=ref.record.dalsiKontrola || ref.record.platnost || ref.record.validTo;if(/^\d{4}-\d{2}-\d{2}$/.test(String(due || '')))terms.push({...ref,due});});
  terms.sort((a,b)=>Math.abs(new Date(a.due)-now)-Math.abs(new Date(b.due)-now));
  host.innerHTML=terms.slice(0,7).map(ref=>`<tr><td><strong class="${ref.due<today?'term-overdue':''}">${escapeHtml(formatDate(ref.due))}</strong><small>${ref.due<today?'Po termínu':'Doložený termín'}</small></td><td><button type="button" data-term-machine="${escapeHtml(ref.serial)}">${escapeHtml(ref.model || 'Stroj')}</button><small>${escapeHtml(ref.serial)}</small></td><td>${escapeHtml(ref.kind)}</td></tr>`).join('') || '<tr><td colspan="3">V dostupné evidenci nejsou doložené termíny.</td></tr>';
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installDispatchPresentation);else installDispatchPresentation();
