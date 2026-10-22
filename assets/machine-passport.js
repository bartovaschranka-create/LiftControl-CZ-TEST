// Read-only view model: never call form defaults or persistence from this file.
function machinePassportYear(value){return /^(19|20)\d{2}$/.test(String(value || '').trim())?String(value).trim():'';}
function machinePassportModel(value){return normalizeSearchText(value || '').replace(/[^a-z0-9]/g,'');}
function machinePassportExtraValues(record){
  // Read-only field aliases verified against the existing revision import mapping. No defaults.
  const read=(local,imported)=>record[local]??record[imported];
  const explicitPersons=read('nosnost_osoby','capacityPersons');
  const matches=[...String(record.nosnost||record.capacity||'').matchAll(/\b(\d+)\s*os(?:ob|oby|\.)?/gi)];
  return {persons:explicitPersons??(matches.length===1?matches[0][1]:undefined),platform:read('rozmer_plosiny','platform'),power:read('napajeni','power'),wind:read('venkovni_vitr','outdoorWind'),tilt:read('naklon','tilt'),stabilizers:read('stabilizatory','stabilizers'),deck:record.deck,charger:read('nabijec','charger'),socket:read('zasuvka_kos','socket'),transportLength:record.transportLength,transportWidth:record.transportWidth,transportHeight:record.transportHeight};
}
function machinePassportCompatible(a,b){
  const maker=r=>machinePassportModel(r?.record.vyrobce||r?.record.maker||''),variant=r=>machinePassportModel(r?.record.variant||r?.record.varianta||'');
  return !(maker(a)&&maker(b)&&maker(a)!==maker(b)) && !(variant(a)&&variant(b)&&variant(a)!==variant(b));
}
function machinePassportReferences(rows){
  return [
    ...(rows.revize || []).map(record=>({record,kind:'Revize ZZ',serial:record.vyrobni_cislo,model:record.model || record.typ,year:machinePassportYear(record.rok_vyroby),date:String(record.datum_kontroly || ''),id:record.protokol || record.id,values:{capacity:record.nosnost,workHeight:record.pracovni_vyska,floorHeight:record.vyska_podlahy,reach:record.bocni_dosah,weight:record.hmotnost,drive:record.pohon}})),
    ...(rows.protocols || []).map(record=>({record,kind:'Čtvrtletní kontrola',serial:record.vc,model:record.typ,year:machinePassportYear(record.rok),date:String(record.datum || ''),id:record.id,values:{capacity:record.nosnost,workHeight:record.pracovni_vyska,floorHeight:record.vyska_podlahy,reach:record.bocni_dosah,weight:record.hmotnost}})),
    ...(rows.evidence || []).map(record=>({record,kind:'Evidence revizí',serial:record.serial,model:record.model,year:machinePassportYear(record.year),date:String(record.created || ''),id:record.protocol || record.file || record.source,values:{capacity:record.capacity,workHeight:record.workHeight,floorHeight:record.floorHeight,reach:record.reach,weight:record.weight,drive:record.drive}}))
  ].map(ref=>({...ref,values:{...ref.values,...machinePassportExtraValues(ref.record)}})).sort((a,b)=>b.date.localeCompare(a.date) || String(a.id || '').localeCompare(String(b.id || '')));
}
function machinePassportContext(serial,rows,inventory){
  const own=inventory.filter(ref=>normalizeSerial(ref.serial)===normalizeSerial(serial));
  const model=own.find(ref=>ref.model)?.model || rows.protocols?.find(row=>row.typ)?.typ || '';
  const key=machinePassportModel(model),bySerial=new Map();
  // Count each serial once; repeated inspections must not bias the modal manufacture year.
  inventory.filter(ref=>key && machinePassportModel(ref.model)===key && machinePassportCompatible(own[0],ref) && ref.year && ref.serial).forEach(ref=>{const serialKey=normalizeSerial(ref.serial);if(!bySerial.has(serialKey))bySerial.set(serialKey,new Set());bySerial.get(serialKey).add(ref.year);});
  const counts=new Map();for(const years of bySerial.values()){if(years.size===1){const year=[...years][0];counts.set(year,(counts.get(year)||0)+1);}}
  const ranked=[...counts].sort((a,b)=>b[1]-a[1] || Number(b[0])-Number(a[0]));
  const modal=ranked[0],reliableModal=modal && modal[1]>=2 && (!ranked[1] || modal[1]>ranked[1][1]);
  const ownYears=[...new Set(own.map(ref=>ref.year).filter(Boolean))],yearConflict=ownYears.length>1;
  const knownYear=ownYears.length===1?ownYears[0]:'';
  return {own,model,knownYear,yearConflict,selectedYear:knownYear || (reliableModal?modal[0]:''),years:[...new Set(inventory.filter(ref=>key && machinePassportModel(ref.model)===key && machinePassportCompatible(own[0],ref) && ref.year).map(ref=>ref.year))].sort((a,b)=>Number(b)-Number(a)),modalCount:modal?.[1] || 0,sampleSize:[...bySerial.values()].filter(years=>years.size===1).length};
}
function machinePassportReferenceForYear(context,inventory,year){
  if(!year)return null;
  const candidates=inventory.filter(ref=>ref.year===year && machinePassportModel(ref.model)===machinePassportModel(context.model) && machinePassportCompatible(context.own[0],ref));
  const hasTechnical=ref=>Object.values(ref.values).some(value=>value!==undefined && String(value).trim());
  // Display one explicit source instead of assembling an untraceable mix of parameters.
  return candidates.find(ref=>context.own.includes(ref) && hasTechnical(ref)) || candidates.find(hasTechnical) || candidates.find(ref=>context.own.includes(ref)) || candidates[0] || null;
}
function machinePassportPhoto(serial,model,year,protocols,variant='',maker='',actualYear=''){
  const photoOf=record=>['right','front','left','rear'].map(key=>record.photos?.[key]).find(photo=>photo && /^(https:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(photo.url || photo.dataUrl || ''));
  const compatible=record=>(!model||!record.typ||machinePassportModel(record.typ)===machinePassportModel(model))&&(!maker||!(record.maker||record.vyrobce)||machinePassportModel(record.maker||record.vyrobce)===machinePassportModel(maker))&&(!variant||!(record.variant||record.varianta)||normalizeSearchText(record.variant||record.varianta)===normalizeSearchText(variant));
  const exact=protocols.filter(record=>normalizeSerial(record.vc)===normalizeSerial(serial)&&compatible(record)&&(!actualYear||!machinePassportYear(record.rok)||machinePassportYear(record.rok)===actualYear)).sort((a,b)=>String(b.datum || '').localeCompare(String(a.datum || ''))).find(photoOf);
  if(exact)return {record:exact,photo:photoOf(exact),illustrative:false};
  if(!model || !machinePassportYear(year))return null;
  const candidates=protocols.filter(record=>compatible(record)&&machinePassportModel(record.typ)===machinePassportModel(model) && normalizeSearchText(record.variant || record.varianta || '')===normalizeSearchText(variant) && machinePassportYear(record.rok) && photoOf(record));
  candidates.sort((a,b)=>Math.abs(Number(a.rok)-Number(year))-Math.abs(Number(b.rok)-Number(year)) || String(b.datum || '').localeCompare(String(a.datum || '')));
  return candidates[0]?{record:candidates[0],photo:photoOf(candidates[0]),illustrative:true}:null;
}
function renderMachinePassport(serial,rows){
  const host=document.getElementById('machinePassport');if(!host)return;
  const ownRevisions=rows.revize || (revizeData || []).filter(record=>normalizeSerial(record.vyrobni_cislo)===normalizeSerial(serial));
  const inventory=machinePassportReferences({revize:[...(revizeData || []),...ownRevisions],protocols:[...(data || []),...(rows.protocols || [])],evidence:Array.isArray(window.REVIZE_MACHINE_DB)?window.REVIZE_MACHINE_DB:[]});
  const context=machinePassportContext(serial,rows,inventory),latest=context.own[0],info=rows.protocols?.[0] || {};
  const publicReference=context.own.length>0&&context.own.every(ref=>ref.record.referenceOnly===true);
  const unit=value=>escapeHtml(String(value || 'Neuvedeno'));
  host.innerHTML=`<div class="passport-document-head"><div><div class="document-kicker">Evidence zařízení / digitální technický průkaz</div><h1>${escapeHtml(context.model || 'Stroj bez uvedeného typu')}</h1><p class="passport-serial">${publicReference?'ANONYMIZOVANÁ REFERENCE':'VÝROBNÍ ČÍSLO'} <strong>${escapeHtml(serial)}</strong></p></div><div class="passport-folio"><span>LC / CZ</span><strong>STROJNÍ<br>PASPORT</strong><span>ČTECÍ NÁHLED</span></div></div><div class="passport-identity"><div><span>${publicReference?'Referenční rok výroby':'Rok výroby stroje'}</span><strong>${context.knownYear || (context.yearConflict?'Rozpor v evidenci — ověřit':'Neznámý — nedoložen')}</strong></div><div><span>Poslední evidované místo</span><strong>${unit(displayPlaceName(info.umisteni || latest?.record.place || latest?.record.umisteni || ''))}</strong></div><div><span>Motohodiny / čtvrtletní kontrola</span><strong>${unit(info.mh)} <small>${escapeHtml(info.datum || '')}</small></strong></div></div><div class="passport-reference-bar"><div><span class="document-index">01</span><strong>Technická specifikace</strong></div><label for="machinePassportYear">Referenční rok výroby <select id="machinePassportYear" ${context.years.length?'':'disabled'}>${context.years.length?context.years.map(year=>`<option value="${year}" ${year===context.selectedYear?'selected':''}>${year}</option>`).join(''):'<option value="">Nedoložen</option>'}</select></label></div><div id="machinePassportReference" aria-live="polite"></div>`;
  const render=()=>{
    const savedBar=host.querySelector('.passport-reference-bar');host.querySelector('#machinePassportReference').before(savedBar);
    if(!context.selectedYear && !context.knownYear && !document.querySelector('#machinePassportYear option[value=""]'))document.getElementById('machinePassportYear').insertAdjacentHTML('afterbegin','<option value="" selected>Zvolit orientační rok</option>');
    const year=document.getElementById('machinePassportYear').value,ref=machinePassportReferenceForYear(context,inventory,year);
    const record=ref?.record || {},values={...(ref?.values || {})};
    const sources=inventory.filter(item=>item.year===year && (context.own.includes(ref)?normalizeSerial(item.serial)===normalizeSerial(serial):machinePassportModel(item.model)===machinePassportModel(context.model)) && machinePassportCompatible(ref,item));
    const conflicts=Object.keys(values).filter(key=>new Set(sources.map(item=>String(item.values[key]??'').trim()).filter(Boolean)).size>1);
    conflicts.forEach(key=>values[key]='Rozpor — viz zdroje');
    const source=ref?`${ref.kind} · ${ref.id || 'bez čísla'} · ${ref.date || 'bez data'} · v. č. ${ref.serial || 'neuvedeno'}`:'V evidenci nejsou doložené technické parametry pro tento ročník.';
    const illustrative=publicReference||!context.knownYear || year!==context.knownYear || normalizeSerial(ref?.serial)!==normalizeSerial(serial);
    const notice=publicReference?'ANONYMIZOVANÁ TECHNICKÁ REFERENCE — NEOVĚŘENO PRO KONKRÉTNÍ VÝROBNÍ ČÍSLO.':context.yearConflict?'ROZPOR ROKU VÝROBY VE ZDROJÍCH: '+[...new Set(context.own.map(item=>item.year).filter(Boolean))].join(', ')+'. Náhled není potvrzeným údajem stroje.':!context.knownYear?`ROK STROJE NENÍ DOLOŽEN. ${year?(year===context.selectedYear?'Orientační ročník '+year+' podle nejčastějšího doloženého roku stejného modelu ('+context.modalCount+' z '+context.sampleSize+' strojů).':'Ručně zvolený orientační ročník '+year+'.'):'Vzorek je malý, nerozhodný nebo ročníky nejsou doložené — zvolte rok pouze pro porovnání.'}`:illustrative?'ORIENTAČNÍ MODEL / ROČNÍK — NEOVĚŘENO PRO TOTO VÝROBNÍ ČÍSLO.':'KONKRÉTNÍ STROJ / DOLOŽENÝ ROK VÝROBY.';
    const value=(val,suffix='')=>val===undefined || val===null || String(val).trim()===''?'Nedoloženo':escapeHtml(String(val))+(suffix && !String(val).includes(suffix) && !String(val).startsWith('Rozpor')?' '+suffix:'');
    const metric=(label,field,suffix)=>`<div><dt>${label}</dt><dd class="${String(values[field] || '').length>24?'raw-value':''}">${value(values[field],suffix)}</dd></div>`;
    const variant=context.own.map(item=>item.record.variant || item.record.varianta).find(Boolean) || '';
    const maker=context.own.map(item=>item.record.vyrobce||item.record.maker).find(Boolean)||'';
    const photo=machinePassportPhoto(serial,context.model,year,data || [],variant,maker,context.knownYear);
    let envelopes=[];try{const stored=typeof record.workingEnvelopes==='string'?JSON.parse(record.workingEnvelopes):record.workingEnvelopes;envelopes=Array.isArray(stored)?stored.filter(item=>item && typeof item==='object'):[];}catch(_invalidStoredEnvelope){}
    const secondFields=['venkovni_nosnost','venkovni_pracovni_vyska','venkovni_bocni_dosah'];
    document.getElementById('machinePassportReference').innerHTML=`<p class="passport-reference-notice"><strong>${notice}</strong> Změna ročníku mění jen tento náhled. Neukládá se do stroje, kontroly ani revize.</p><div class="passport-technical-layout"><figure class="passport-photo">${photo?`<img alt="${photo.illustrative?'Ilustrační fotografie stejného modelu':'Fotografie konkrétního stroje'}" src="${escapeHtml(photo.photo.url || photo.photo.dataUrl)}"><figcaption>${photo.illustrative?'ILUSTRAČNÍ · stejný typ · rok výroby '+escapeHtml(photo.record.rok):'SHODA VÝROBNÍHO ČÍSLA · '+escapeHtml(serial)}<br>Čtvrtletní kontrola ${escapeHtml(photo.record.datum || 'bez data')}</figcaption>`:'<div class="passport-no-photo"><span>FOTOGRAFIE</span><strong>Fotografie není<br>v dostupné evidenci</strong><p>Přednost má snímek výrobního čísla ze čtvrtletní kontroly.</p></div>'}</figure><div class="passport-technical-sheet"><div class="sheet-caption">PARAMETRY / ${escapeHtml(year || 'ROK NEDOLOŽEN')} <span>${illustrative?'ORIENTAČNÍ':'EVIDOVANÉ'}</span></div><dl class="passport-specs">${metric('Jmenovitá nosnost','capacity','kg')}${metric('Pracovní výška','workHeight','m')}${metric('Boční dosah','reach','m')}${metric('Výška podlahy','floorHeight','m')}${metric('Hmotnost','weight','kg')}${metric('Pohon','drive','')}${metric('Počet osob','persons','')}${metric('Rozměr plošiny','platform','')}${metric('Napájení','power','')}${metric('Doložený limit větru','wind','m/s')}${metric('Náklon','tilt','°')}${metric('Transportní délka','transportLength','m')}${metric('Transportní šířka','transportWidth','m')}${metric('Transportní výška','transportHeight','m')}</dl><div class="passport-source">ZDROJ ZÁZNAMU<br>${escapeHtml(source)}</div></div></div><section class="passport-envelope" aria-label="Pracovní obálky"><div class="document-section-title"><span class="document-index">02</span><h2>Nosnosti a pracovní obálky</h2><a href="https://bartovaschranka-create.github.io/pomoc-infolince-plosiny/" target="_blank" rel="noopener noreferrer">Infolinka ↗</a></div><div class="envelope-layout"><div class="envelope-note"><span>PROVOZNÍ ROZSAH</span><p>Platí štítek a návod konkrétního stroje. Přepnutí ročníku nemění jeho parametry.</p><small>Graf bez doložených bodů nevykreslujeme.</small></div><div class="envelope-table-wrap"><table class="envelope-table"><thead><tr><th>Pracovní režim</th><th>Nosnost</th><th>Pracovní výška</th><th>Dosah</th></tr></thead><tbody>${envelopes.length?envelopes.map(envelope=>`<tr><th>${escapeHtml(envelope.label || (envelope.mode==='restricted'?'Omezená obálka':'Uložená obálka'))}</th><td>${value(envelope.capacity,'kg')}</td><td>${value(envelope.workHeight,'m')}</td><td>${value(envelope.reach,'m')}</td></tr>`).join(''):`<tr><th>Základní uložené hodnoty</th><td>${value(values.capacity,'kg')}</td><td>${value(values.workHeight,'m')}</td><td>${value(values.reach,'m')}</td></tr>`}${secondFields.some(field=>record[field])?`<tr><th>Druhé hodnoty · ${escapeHtml(record.limitVariantKind || 'režim neurčen')}</th>${secondFields.map((field,index)=>`<td>${value(record[field],index?'m':'kg')}</td>`).join('')}</tr>`:''}</tbody></table>${!envelopes.length?'<p class="technical-note">Samostatné pracovní obálky nejsou v tomto záznamu uložené. Chybějící režimy se nedopočítávají.</p>':''}</div></div></section>`;
    const img=host.querySelector('img');if(img){img.addEventListener('error',()=>{img.replaceWith(Object.assign(document.createElement('div'),{className:'passport-no-photo',textContent:'Fotografie je evidovaná, ale není dostupná v tomto náhledu.'}));},{once:true});img.addEventListener('click',()=>openLightbox(img.src));}
    if(photo){const photos=['right','front','left','rear'].map(key=>photo.record.photos?.[key]).filter(item=>item && /^(https:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(item.url || item.dataUrl || ''));if(photos.length>1){const gallery=document.createElement('div');gallery.className='passport-gallery';gallery.innerHTML=photos.map((item,index)=>`<button type="button" aria-label="Otevřít fotografii ${index+1}"><img alt="Přehledový snímek ${index+1}" src="${escapeHtml(item.url || item.dataUrl)}"></button>`).join('');gallery.querySelectorAll('button').forEach((button,index)=>button.addEventListener('click',()=>openLightbox(photos[index].url || photos[index].dataUrl)));gallery.querySelectorAll('img').forEach(thumb=>thumb.addEventListener('error',()=>thumb.remove(),{once:true}));host.querySelector('.passport-photo').appendChild(gallery);}}
    host.querySelector('.envelope-table-wrap').innerHTML=machinePassportEnvelopeTable(ref,values);
    arrangeMachineTechnicalColumns(host,context,serial,ref);
    renderPassportSources(host,context,sources,conflicts);
    refreshPassportPhotoArea(host);
  };
  document.getElementById('machinePassportYear').addEventListener('change',render);render();
  const records=document.createElement('div');records.className='passport-records';host.after(records);
  [...host.parentElement.children].filter(node=>node!==host && node!==records).forEach(node=>records.appendChild(node));
  records.insertAdjacentHTML('afterbegin','<div class="document-section-title"><span class="document-index">03</span><h2>Provozní a servisní historie</h2><span class="technical-note">Původní zápisy a návazné akce</span></div>');
  records.querySelector('.document-index').textContent='05';
  records.querySelectorAll('[data-fault-open]').forEach(button=>{const fault=(rows.faults || []).find(item=>String(item.id)===button.dataset.faultOpen);if(fault?.repairNote){const target=button.closest('.machine-card-row').querySelector('span');target.insertAdjacentHTML('beforeend',`<p><strong>Způsob odstranění závady:</strong> ${escapeHtml(fault.repairNote)}</p>`);}});
  const revisionSection=document.createElement('section');revisionSection.className='machine-card-block';revisionSection.innerHTML='<h4>Historie revizí ZZ</h4>'+(ownRevisions.length?ownRevisions.map((record,index)=>`<div class="machine-card-row"><span>${escapeHtml(record.datum_kontroly || 'Datum neuvedeno')} · ${escapeHtml(record.protokol || 'Bez čísla')}</span><button type="button" data-passport-revision="${index}">Otevřít celou revizi</button></div>`).join(''):'<p class="technical-note">V načtené aplikaci nejsou dostupné revizní protokoly pro toto výrobní číslo. Importovaná evidence parametrů je označená svým zdrojem.</p>');revisionSection.querySelectorAll('[data-passport-revision]').forEach(button=>button.addEventListener('click',()=>{closeHistoryModal();printRevizeById(ownRevisions[Number(button.dataset.passportRevision)].id);}));records.appendChild(revisionSection);
  const repairs=(typeof loadLocalRepairs==='function'?loadLocalRepairs():[]).filter(record=>normalizeSerial(record.serial)===normalizeSerial(serial));
  const repairSection=document.createElement('section');repairSection.className='machine-card-block';
  repairSection.innerHTML='<h4>Servisní zápisy / opravy</h4>'+(repairs.length?repairs.map((record,index)=>`<div class="machine-card-row"><span><strong>${escapeHtml(record.finishedAt || record.savedAt || 'Datum neuvedeno')}</strong> · ${escapeHtml(record.tech || 'Technik neuveden')}<br>${escapeHtml(record.work || 'Popis není uveden')}</span><button type="button" data-passport-repair="${index}">Otevřít zápis opravy</button></div>`).join(''):'<p class="technical-note">Pro toto výrobní číslo nejsou dostupné samostatné servisní zápisy.</p>');
  repairSection.querySelectorAll('[data-passport-repair]').forEach(button=>button.addEventListener('click',()=>{closeHistoryModal();printRepairRecord(repairs[Number(button.dataset.passportRepair)]);}));records.appendChild(repairSection);
  host.querySelector('.passport-folio')?.remove();
  host.querySelector('.passport-document-head').insertAdjacentHTML('afterbegin','<span class="document-index">01</span>');
  const identity=host.querySelector('.passport-identity');host.querySelector('.passport-document-head').appendChild(identity);
  identity.insertAdjacentHTML('beforeend',`<div><span>Inventární číslo</span><strong>${escapeHtml(context.own.find(ref=>ref.record.evidencni || ref.record.evidencni_cislo || ref.record.evCislo)?.record.evidencni || context.own.find(ref=>ref.record.evidencni_cislo)?.record.evidencni_cislo || context.own.find(ref=>ref.record.evCislo)?.record.evCislo || 'Neuvedeno')}</strong></div><div><span>Stav stroje / evidence</span><strong>${escapeHtml(publicReference?'Referenční údaj — stav stroje neověřen':getMachineState(serial).txt)}</strong></div>`);
  const bottom=document.createElement('div');bottom.className='passport-bottom';records.before(bottom);bottom.appendChild(records);
  const support=document.createElement('aside');support.className='passport-support';support.innerHTML=`<section><div class="document-section-title"><span class="document-index">06</span><h2>Dokumentace</h2></div><p class="technical-note">Zdroj technických údajů je uveden u specifikace. Dostupné návody vyhledejte v existující agendě.</p><button type="button" id="passportManuals">Vyhledat dokumentaci ↗</button><a href="https://bartovaschranka-create.github.io/pomoc-infolince-plosiny/" target="_blank" rel="noopener noreferrer">Plošinový poradce ↗</a></section><section><div class="document-section-title"><span class="document-index">07</span><h2>Identifikace / QR</h2></div><p class="passport-id-label">${escapeHtml(serial)}</p><p class="technical-note">QR štítek pro tento stroj není v dostupné evidenci uložen. Žádný náhradní kód se nevytváří.</p></section></aside>`;bottom.appendChild(support);
  support.querySelector('#passportManuals').addEventListener('click',()=>{closeHistoryModal();openManualsModule();});
  installPassportSections(host,bottom);
  host.querySelectorAll('.document-index').forEach(node=>node.remove());
}
function arrangeMachineTechnicalColumns(host,context,serial,ref){
  const layout=host.querySelector('.passport-technical-layout'),photo=host.querySelector('.passport-photo'),sheet=host.querySelector('.passport-technical-sheet'),envelope=host.querySelector('.passport-envelope');
  const photoSection=document.createElement('section');photoSection.className='passport-photo-section';photo.before(photoSection);photoSection.innerHTML='<div class="document-section-title"><span class="document-index">02</span><h2>Fotografie stroje</h2></div>';photoSection.appendChild(photo);
  sheet.insertAdjacentHTML('afterbegin','<div class="document-section-title"><span class="document-index">03</span><h2>Technické údaje</h2></div>');
  const identityValue=field=>context.own.map(item=>item.record[field]).find(Boolean) || 'Neuvedeno';
  sheet.querySelector('.passport-specs').insertAdjacentHTML('afterbegin',`<div><dt>Výrobce</dt><dd>${escapeHtml(identityValue('maker')==='Neuvedeno'?identityValue('vyrobce'):identityValue('maker'))}</dd></div><div><dt>Typ / model</dt><dd>${escapeHtml(context.model || 'Neuvedeno')}</dd></div><div><dt>${context.own.length&&context.own.every(item=>item.record.referenceOnly)?'Anonymizovaná reference':'Výrobní číslo'}</dt><dd>${escapeHtml(serial)}</dd></div><div><dt>Rok výroby konkrétního stroje</dt><dd>${context.knownYear || (context.yearConflict?'Rozpor v evidenci — ověřit':'Neznámý — nedoložen')}</dd></div>`);
  envelope.querySelector('.document-index').textContent='04';envelope.querySelector('h2').textContent='Pracovní režimy a obálka';
  envelope.querySelector('.document-section-title').after(host.querySelector('.passport-reference-bar'));
  envelope.querySelector('.passport-reference-bar').after(host.querySelector('.passport-reference-notice'));
  const bar=envelope.querySelector('.passport-reference-bar');bar.querySelector('label').firstChild.textContent='Rok výroby (náhled) ';
  layout.appendChild(envelope);
}
function renderPassportSources(host,context,sources,conflicts){
  const labels={capacity:'Nosnost',workHeight:'Pracovní výška',floorHeight:'Výška podlahy',reach:'Dosah',weight:'Hmotnost',drive:'Pohon',persons:'Osoby',platform:'Plošina',wind:'Vítr',power:'Napájení',tilt:'Náklon'};
  const seen=new Set(),unique=sources.filter(ref=>{const key=[ref.kind,ref.id,ref.serial,ref.date].join('/');if(seen.has(key))return false;seen.add(key);return true});
  const details=document.createElement('details');details.className='passport-source-list';
  details.innerHTML='<summary>'+ (conflicts.length?'Rozdílné údaje — porovnat zdroje':'Zdroje a míra jistoty')+'</summary>'+
    (conflicts.length?'<p>Hodnoty ve zdrojích se liší. Žádná varianta není automaticky prohlášena za správnou.</p>':'')+
    unique.map(ref=>`<article><strong>${escapeHtml(ref.kind)} · ${escapeHtml(ref.id||'bez čísla')}</strong><p>${escapeHtml(ref.serial||'S/N neuvedeno')} · ${escapeHtml(ref.date||'datum neuvedeno')} · rok výroby ${escapeHtml(ref.year||'nedoložen')}</p><p>${normalizeSerial(ref.serial)===normalizeSerial(context.own[0]?.serial)?'Shoda výrobního čísla':'Orientační modelový zdroj — varianta a konkrétní stroj nejsou potvrzeny'}</p><dl>${Object.entries(ref.values).filter(([key,val])=>labels[key]&&val!==undefined&&String(val).trim()).map(([key,val])=>`<div><dt>${labels[key]}</dt><dd>${escapeHtml(String(val))}</dd></div>`).join('')}</dl></article>`).join('')+
    '<p>Transportní údaje a vítr se zobrazují jen při výslovném doložení. Obecný limit 12,5 m/s se automaticky nedoplňuje. Plošinový rádce se otevírá samostatným odkazem; jeho síťové API není v izolovaném TESTu zapojené.</p>';
  if(!unique.length)details.insertAdjacentHTML('beforeend','<p>V dostupných zdrojích nebyly nalezeny technické údaje pro zvolený rok.</p>');
  const pref=typeof getModelPref==='function'?getModelPref(context.model):{};
  if(pref.chargerPresent)details.insertAdjacentHTML('beforeend',`<p>Místní předvolba modelu: nabíječ ${escapeHtml(pref.chargerPresent)}. Orientační předvolba, nikoli potvrzený údaj stroje.</p>`);
  host.querySelector('#machinePassportReference').appendChild(details);
}
function machinePassportEnvelopeTable(ref,values){
  const record=ref?.record||{},read=(local,imported)=>record[local]??record[imported];
  let rows=[];try{const stored=typeof record.workingEnvelopes==='string'?JSON.parse(record.workingEnvelopes):record.workingEnvelopes;if(Array.isArray(stored))rows=stored.filter(r=>r&&typeof r==='object').map(r=>({...r,label:r.label||(r.mode==='restricted'?'Omezená pracovní obálka':r.mode==='unrestricted'?'Neomezená pracovní obálka':'Uložený režim')}))}catch(_invalidStoredEnvelope){}
  if(!rows.length)rows=[{label:'Základní uložené hodnoty',capacity:values.capacity,persons:values.persons,workHeight:values.workHeight,floorHeight:values.floorHeight,reach:values.reach,wind:values.wind}];
  const outdoor={label:record.limitVariantKind==='outdoor'?'Doložený venkovní režim':'Druhé hodnoty — ověřte režim',capacity:read('venkovni_nosnost','outdoorCapacity'),persons:read('venkovni_nosnost_osoby','outdoorCapacityPersons'),workHeight:read('venkovni_pracovni_vyska','outdoorWorkHeight'),floorHeight:read('venkovni_vyska_podlahy','outdoorFloorHeight'),reach:read('venkovni_bocni_dosah','outdoorReach'),wind:read('venkovni_vitr','outdoorWind')};
  if(Object.entries(outdoor).some(([k,v])=>k!=='label'&&k!=='wind'&&v!==undefined&&String(v).trim()))rows.push(outdoor);
  const fields=[['capacity','Nosnost'],['persons','Osoby'],['workHeight','Pracovní výška'],['floorHeight','Výška podlahy'],['reach','Dosah'],['wind','Vítr']];
  return '<table class="envelope-table"><thead><tr><th>Uložený režim</th>'+fields.map(([,label])=>`<th>${label}</th>`).join('')+'</tr></thead><tbody>'+rows.map(row=>`<tr><th>${escapeHtml(row.label)}</th>${fields.map(([key])=>`<td data-label="${fields.find(item=>item[0]===key)[1]}">${escapeHtml(String(row[key]??'Nedoloženo'))}</td>`).join('')}</tr>`).join('')+'</tbody></table><p class="technical-note">Pouze doložené hodnoty z uvedeného zdroje; režimy ani křivky se nedopočítávají. Nosnost v kg, výšky a dosah v m, vítr v m/s, pokud zdroj výslovně neurčuje jinak.</p>';
}
function refreshPassportPhotoArea(host){
  const docs=host.querySelector('[data-passport-area="documents"]'),photo=host.querySelector('#machinePassportReference .passport-photo-section');
  if(docs && photo){docs.querySelector(':scope > .passport-photo-section')?.remove();docs.prepend(photo)}
  host.querySelectorAll('.document-index').forEach(node=>node.remove());
}
function installPassportSections(host,bottom){
  const nav=document.createElement('nav');nav.className='passport-area-nav';nav.setAttribute('aria-label','Karta stroje');
  const definitions=[['parameters','Parametry a obálky'],['history','Historie'],['documents','Dokumentace a fotografie']];
  nav.innerHTML=definitions.map(([key,label])=>`<button type="button" data-passport-tab="${key}">${label}</button>`).join('');
  host.querySelector('.passport-document-head').after(nav);
  definitions.forEach(([key,label])=>{const area=document.createElement('section');area.dataset.passportArea=key;area.setAttribute('aria-label',label);host.appendChild(area)});
  host.querySelector('[data-passport-area="parameters"]').appendChild(host.querySelector('#machinePassportReference'));
  host.querySelector('[data-passport-area="history"]').appendChild(bottom.querySelector('.passport-records'));
  host.querySelector('[data-passport-area="documents"]').appendChild(bottom.querySelector('.passport-support'));
  bottom.remove();refreshPassportPhotoArea(host);
  const select=key=>{
    host.querySelectorAll('[data-passport-area]').forEach(node=>node.hidden=node.dataset.passportArea!==key);
    nav.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.passportTab===key)));
  };
  nav.addEventListener('click',event=>{const button=event.target.closest('button[data-passport-tab]');if(button)select(button.dataset.passportTab)});select('parameters');
}
