// Presentation only. Never resolve defaults into a record or persist a year selection.
function machinePassportReferences(rows){
  return [
    ...(rows.revize || []).map(record=>({record,kind:'Revize ZZ',date:String(record.datum_kontroly || ''),model:record.model || record.typ,year:record.rok_vyroby})),
    ...rows.protocols.map(record=>({record,kind:'Čtvrtletní kontrola',date:String(record.datum || ''),model:record.typ,year:record.rok}))
  ].sort((a,b)=>b.date.localeCompare(a.date));
}
function machinePassportPhoto(serial,model,year,protocols){
  const photoOf=record=>['right','front','left','rear'].map(key=>record.photos?.[key]).find(photo=>photo && /^(https:\/\/|data:image\/(?:jpeg|png|webp);base64,)/i.test(photo.url || photo.dataUrl || ''));
  const exact=protocols.filter(record=>normalizeSerial(record.vc)===normalizeSerial(serial)).sort((a,b)=>String(b.datum || '').localeCompare(String(a.datum || ''))).find(photoOf);
  if(exact) return {record:exact,photo:photoOf(exact),illustrative:false};
  const wantedYear=Number(year);
  if(!model || !Number.isInteger(wantedYear) || wantedYear<1900) return null;
  const candidates=protocols.filter(record=>normalizeSearchText(record.typ)===normalizeSearchText(model) && /^\d{4}$/.test(String(record.rok)) && photoOf(record));
  candidates.sort((a,b)=>Math.abs(Number(a.rok)-wantedYear)-Math.abs(Number(b.rok)-wantedYear) || String(b.datum || '').localeCompare(String(a.datum || '')));
  const record=candidates[0];
  return record ? {record,photo:photoOf(record),illustrative:true} : null;
}
function renderMachinePassport(serial,rows){
  const host=document.getElementById('machinePassport');
  if(!host) return;
  const references=machinePassportReferences({...rows,revize:rows.revize || (revizeData || []).filter(record=>normalizeSerial(record.vyrobni_cislo)===normalizeSerial(serial))});
  const years=[...new Set(references.map(ref=>/^\d{4}/.exec(ref.date)?.[0]).filter(Boolean))];
  host.innerHTML=`<div class="passport-kicker">LiftControl CZ / technický atlas</div><div class="passport-title">Pasport stroje <span>${escapeHtml(serial)}</span></div><label class="passport-reference">Referenční rok kontroly <select id="machinePassportYear" ${years.length?'':'disabled'}>${years.length?years.map(year=>`<option>${year}</option>`).join(''):'<option>Bez dat</option>'}</select></label><p class="passport-notice">Orientační náhled uložených kontrol. Přepnutí roku nic neukládá. Pro provoz platí štítek, návod a platná revize konkrétního stroje.</p><div id="machinePassportReference" aria-live="polite"></div>`;
  const render=()=>{
    const ref=references.find(item=>item.date.startsWith(document.getElementById('machinePassportYear').value)) || references[0];
    const record=ref?.record || {};
    const photo=machinePassportPhoto(serial,ref?.model,ref?.year,data || []);
    const value=(field,unit='')=>record[field]===undefined || record[field]===null || String(record[field]).trim()===''?'Neuvedeno':escapeHtml(String(record[field]))+(unit && !String(record[field]).includes(unit)?' '+unit:'');
    // Show stored fields verbatim, with no catalogue inference or inferred curves.
    const metric=(label,field,unit)=>`<div><dt>${label}</dt><dd>${value(field,unit)}</dd></div>`;
    let envelopes=[];
    if(ref?.kind==='Revize ZZ'){
      try{const stored=typeof record.workingEnvelopes==='string'?JSON.parse(record.workingEnvelopes):record.workingEnvelopes;envelopes=Array.isArray(stored)?stored.filter(item=>item && typeof item==='object'):[];}catch(_invalidStoredEnvelopes){}
    }
    const source=ref?`${ref.kind} · ${ref.date} · ${record.protokol || record.id || 'bez čísla'}`:'Bez uložené kontroly';
    document.getElementById('machinePassportReference').innerHTML=`<div class="passport-layout"><figure class="passport-photo">${photo?`<img alt="${photo.illustrative?'Ilustrační fotografie stejného typu':'Fotografie stroje podle výrobního čísla'}" src="${escapeHtml(photo.photo.url || photo.photo.dataUrl)}"><figcaption>${photo.illustrative?'ILUSTRAČNÍ · stejný typ, rok výroby '+escapeHtml(photo.record.rok):'SHODA VÝROBNÍHO ČÍSLA · '+escapeHtml(serial)}<br>Čtvrtletní kontrola ${escapeHtml(photo.record.datum || 'bez data')}</figcaption>`:'<div class="passport-no-photo">Fotografie stroje není dostupná</div>'}</figure><div><h3>${escapeHtml(ref?.model || 'Typ neuveden')}</h3><p class="passport-source">Zdroj: ${escapeHtml(source)}</p><dl class="passport-specs">${metric('Rok výroby',ref?.kind==='Revize ZZ'?'rok_vyroby':'rok')}${metric('Nosnost','nosnost','kg')}${metric('Pracovní výška','pracovni_vyska','m')}${metric('Boční dosah','bocni_dosah','m')}</dl><details class="passport-envelope"><summary>Nosnosti, dosahy a pracovní obálky — informace</summary><p>Hodnoty jsou převzaté pouze z uvedeného záznamu. Chybějící parametry ani křivky se nedopočítávají.</p>${envelopes.length?envelopes.map(envelope=>`<p><strong>${escapeHtml(envelope.label)}</strong><br>${[['Nosnost',envelope.capacity,'kg'],['Dosah',envelope.reach,'m'],['Pracovní výška',envelope.workHeight,'m']].map(([label,val,unit])=>`${label}: ${val?escapeHtml(val)+' '+unit:'neuvedeno'}`).join(' · ')}</p>`).join(''):'<p>Samostatné pracovní obálky nejsou v tomto záznamu uložené.</p>'}${record.venkovni_nosnost || record.venkovni_bocni_dosah?`<p>Druhé uložené hodnoty (režim: ${escapeHtml(record.limitVariantKind || 'neurčen')}): nosnost ${value('venkovni_nosnost','kg')}, dosah ${value('venkovni_bocni_dosah','m')}. Význam ověřte v původní revizi.</p>`:''}</details></div></div>`;
    host.querySelector('.passport-envelope').insertAdjacentHTML('beforeend','<p><a href="https://bartovaschranka-create.github.io/pomoc-infolince-plosiny/" target="_blank" rel="noopener noreferrer">Otevřít Plošinového poradce — infolinku</a><br>Samostatný zdroj. Ověřte typ, výrobní řadu a rok; jeho údaje se do stroje nepřenášejí.</p>');
    const img=host.querySelector('img');
    if(img) img.addEventListener('error',()=>{img.replaceWith(Object.assign(document.createElement('div'),{className:'passport-no-photo',textContent:'Fotografii se nepodařilo načíst'}));},{once:true});
  };
  document.getElementById('machinePassportYear').addEventListener('change',render);
  render();
}
