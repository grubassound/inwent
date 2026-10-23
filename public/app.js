(() => {
'use strict';
const { t } = window.i18n;
// Klucze statusów i typów są stałe (zapisane w bazie); nazwy wyświetlane pochodzą z tłumaczeń (i18n.js).
const STATUS = {unknown:'--st-unknown', used:'--st-used', free:'--st-free', reserved:'--st-reserved', broken:'--st-broken'};
const stLabel = k => t('status.'+k);
const KINDS = ['patch','switch','fiber','other'];
const DEVSTATUS = ['active','unused','remove'];
// Kolor zapisywany jest pod polską nazwą (zgodność z istniejącymi danymi), wyświetlany w bieżącym języku.
const COLORS = [
  ['czarny','#1c1d20'],['czerwony','#e5322d'],['niebieski','#2f6fd6'],['zielony','#1f8f5a'],
  ['pomarańczowy','#f07a1f'],['biały','#f2f2f2'],['żółty','#f5c518'],['szary','#8a8f98'],
  ['różowy','#e86fae'],['turkusowy (światłowód)','#2ab3b3']
];
const colorHex = n => (COLORS.find(c=>c[0]===n)||[])[1];
const colorName = n => n ? t('color.'+n) : '';

let racks = {};
let devices = {};
let sel = {rack:null, dev:null, port:null};
let loaded = false, online = true, busy = false;
let bulk = {on:false, set:new Set()};
let searchQ = '';
let devForm = null;          // null | 'new' | 'edit'
let devDraft = null;         // wartości wpisane w formularzu urządzenia (przetrwają przerysowanie)
let pendingImport = null;
let confirmDelete = false;
let history = null;          // {key, rows}
let rackForm = null;         // null | 'new' | 'edit'
let rackDelConfirm = false;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o||{}));

/* ---------- API ---------- */
async function api(method, url, body){
  const res = await fetch(url, {
    method, headers: body ? {'Content-Type':'application/json'} : {},
    body: body ? JSON.stringify(body) : undefined, credentials:'same-origin'
  });
  let data = null;
  try { data = await res.json(); } catch(e) {}
  if (res.status === 401 && data && data.login) sessionExpired();
  if (!res.ok){
    const err = new Error((data && data.error) || ('HTTP '+res.status));
    err.status = res.status; err.code = data && data.code; err.params = data && data.params;
    throw err;
  }
  if (expired){ expired = false; renderHeader(); }
  return data;
}
// Komunikat błędu w bieżącym języku (serwer zwraca kod błędu i parametry).
const errMsg = e => e.code ? t('err.'+e.code, e.params) : e.message;
// Sesja wygasła: bez niezapisanych zmian od razu na stronę logowania,
// a z niezapisanymi zmianami portu tylko komunikat, żeby ich nie stracić.
let expired = false;
function sessionExpired(){
  if (expired) return;
  expired = true;
  if (!draftDirty()) { location.href = 'login.html?sesja=1'; return; }
  renderHeader();
}
function applyState(s){
  if (!s || !s.devices) return;
  devices = s.devices; racks = s.racks || {}; loaded = true; online = true;
  if (!sel.rack || !racks[sel.rack]) { const saved = loadPref(); sel.rack = racks[saved] ? saved : rackIds()[0] || null; }
  if (!sel.dev || !devices[sel.dev] || devices[sel.dev].rack !== sel.rack) { sel.dev = sortedIds()[0] || null; sel.port = null; }
}
// Ostatnio oglądany rack pamiętany w przeglądarce (tylko wygoda, nie dane).
const PREF_RACK = 'rack-inventory.rack';
function loadPref(){ try { return localStorage.getItem(PREF_RACK); } catch(e) { return null; } }
function savePref(id){ try { localStorage.setItem(PREF_RACK, id); } catch(e) {} }
function setRack(id){
  sel.rack = id; savePref(id);
  sel.dev = sortedIds()[0] || null; sel.port = null; draft = null;
  closeDevForm(); bulk = {on:false, set:new Set()};
}
// onError(e) może obsłużyć błąd sam i zwrócić true, żeby nie pokazywać ogólnego komunikatu.
async function mutate(method, url, body, okMsg, onError){
  if (busy) return null;
  busy = true;
  try {
    const s = await api(method, url, body);
    applyState(s);
    if (okMsg) toast(okMsg);
    return s;
  } catch(e) {
    if (!(onError && onError(e))) toast(t('toast.failed', {msg: errMsg(e)}));
    return null;
  } finally {
    busy = false;
  }
}
async function refresh(full){
  try {
    applyState(await api('GET','api/state'));
  } catch(e) {
    if (e.status !== 401) online = false;
  }
  if (full) render(); else { renderHeader(); renderRack(); renderDevice(); renderResults(); }
}

/* ---------- helpers ---------- */
function rackIds(){ return Object.keys(racks).sort((a,b)=>(racks[a].order??0)-(racks[b].order??0) || a.localeCompare(b)); }
// Urządzenia jednego racka (domyślnie oglądanego), od góry szafy.
function sortedIds(rack = sel.rack){
  return Object.keys(devices).filter(id => devices[id].rack === rack)
    .sort((a,b)=>(devices[a].order??0)-(devices[b].order??0) || a.localeCompare(b));
}
function allIds(){ return rackIds().flatMap(r => sortedIds(r)); }
function totalPorts(d){ return (d.portCount||0) + (d.sfp||0); }
function portRec(devId, n){ return (devices[devId]?.ports||{})[String(n)] || {}; }
function labelBase(devId, n){
  const d = devices[devId]; if (!d) return '?';
  const s = d.short || d.name;
  if (d.kind === 'patch' || d.kind === 'fiber') return s.length<=2 ? s+n : s+'-'+n;
  return s+':'+n;
}
// Port w innym racku dostaje nazwę tamtego racka: „Serwerownia › A5”.
function label(devId, n){
  const d = devices[devId], base = labelBase(devId, n);
  return d && d.rack !== sel.rack && racks[d.rack] ? racks[d.rack].name+' › '+base : base;
}
function counts(d){
  const c = {used:0,free:0,unknown:0,reserved:0,broken:0,verified:0,total:totalPorts(d)};
  for (let n=1;n<=c.total;n++){ const r=(d.ports||{})[n]||{}; c[r.status||'unknown']++; if (r.verified) c.verified++; }
  return c;
}
function routeOf(devId, n){
  const r = portRec(devId,n); const parts = [];
  parts.push('<b>'+esc(label(devId,n))+'</b>' + (r.dest?' → '+esc(r.dest):''));
  if (r.link && devices[r.link.dev]){
    const tp = portRec(r.link.dev, r.link.port);
    parts.push('⇄ <b>'+esc(label(r.link.dev,r.link.port))+'</b>' + (tp.dest?' → '+esc(tp.dest):'') + (tp.endpoint?' ('+esc(tp.endpoint)+')':''));
  }
  if (r.endpoint) parts.push(esc(t('route.device', {x: r.endpoint})));
  if (r.vlan) parts.push('VLAN '+esc(r.vlan));
  return parts.join('<br>');
}
let toastT;
function toast(msg){ const el=$('toast'); el.textContent=msg; el.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>el.hidden=true,2800); }
const dot = k => `<i class="dot" style="background:var(${STATUS[k]})"></i>`;

/* ---------- render ---------- */
function render(){ renderHeader(); renderRack(); renderDevice(true); renderEditor(); renderResults(); }

function renderHeader(){
  $('modeLine').textContent = t(!loaded ? 'mode.connecting' : online ? 'mode.online' : 'mode.offline');
  const all = {used:0,free:0,unknown:0,reserved:0,broken:0,verified:0,total:0};
  sortedIds().forEach(id => { const c=counts(devices[id]); for (const k in all) all[k]+=c[k]; });
  const pct = all.total ? Math.round(all.verified/all.total*100) : 0;
  $('stats').innerHTML =
    `<span class="stat">${esc(t('stats.ports'))} <b>${all.total}</b></span>` +
    Object.keys(STATUS).filter(k=>(k!=='reserved'&&k!=='broken')||all[k]).map(k=>`<span class="stat">${dot(k)}${esc(stLabel(k))} <b>${all[k]}</b></span>`).join('') +
    `<span class="stat">${esc(t('stats.verified'))} <b>${pct}%</b><span class="progress"><i style="width:${pct}%"></i></span></span>`;
  if (!pendingImport) $('banner').innerHTML = expired
    ? `<div class="banner card">${esc(t('banner.expired'))} <a href="login.html" target="_blank" rel="noopener">${esc(t('banner.expiredLink'))}</a></div>`
    : (loaded && !online) ? `<div class="banner card">${esc(t('banner.offline'))}</div>` : '';
}
function renderRack(){
  const opts = rackIds().map(r=>`<option value="${esc(r)}" ${r===sel.rack?'selected':''}>${esc(racks[r].name)}</option>`).join('');
  const sw = $('rackSel');
  if (sw.dataset.html !== opts){ sw.innerHTML = opts; sw.dataset.html = opts; } // nie zamykaj rozwiniętej listy bez potrzeby
  const rk = racks[sel.rack];
  $('rackHead').textContent = rk && rk.location ? rk.location : t('rack.top');
  $('rackHead').title = $('rackHead').textContent;
  const ids = sortedIds();
  $('rackList').innerHTML = ids.length ? ids.map((id,i) => {
    const d = devices[id], c = counts(d), tot = c.total||1;
    return `<li><button class="ru ${d.status==='unused'||d.status==='remove'?'unused':''}" data-dev="${esc(id)}" aria-current="${sel.dev===id}">
      <span class="u">${String(i+1).padStart(2,'0')}</span>
      <span><span class="nm"><span>${esc(d.name)}</span><span class="kd">${d.kind==='switch'?'SW':d.kind==='fiber'?'FO':d.kind==='other'?'–':'PP'} ${totalPorts(d)}</span></span>
      <span class="bar"><i style="width:${c.used/tot*100}%;background:var(--st-used)"></i><i style="width:${c.reserved/tot*100}%;background:var(--st-reserved)"></i><i style="width:${c.broken/tot*100}%;background:var(--st-broken)"></i><i style="width:${c.free/tot*100}%;background:var(--st-free)"></i></span></span>
    </button></li>`;
  }).join('') : `<li class="empty" style="padding:12px;text-align:left">${esc(t('rack.noDevices'))}</li>`;
}
// Formularz racka rysowany tylko na żądanie, żeby odświeżanie w tle nie kasowało wpisywanego tekstu.
function renderRackForm(focus){
  const el = $('rackForm');
  if (!rackForm){ el.innerHTML = ''; return; }
  const edit = rackForm === 'edit', r = edit ? racks[sel.rack] || {} : {name:'', location:'', notes:''};
  const n = edit ? sortedIds().length : 0, i = rackIds().indexOf(sel.rack);
  const del = !edit ? '' : n ? `<span class="hint">${esc(t('rack.delOnlyEmpty'))}</span>`
    : rackIds().length < 2 ? '' : rackDelConfirm ? `<button class="btn small danger" data-act="rackDelYes">${esc(t('btn.delSure'))}</button>`
    : `<button class="btn small danger" data-act="rackDel">${esc(t('rack.delete'))}</button>`;
  el.innerHTML = `<div class="dialog"><div class="eyebrow">${esc(t(edit?'rack.formEdit':'rack.formNew'))}</div><div class="form">
    <div class="field"><label for="r_name">${esc(t('f.name'))}</label><input id="r_name" type="text" value="${esc(r.name)}" placeholder="${esc(t('ph.rackName'))}"></div>
    <div class="field"><label for="r_loc">${esc(t('f.location'))}</label><input id="r_loc" type="text" value="${esc(r.location)}" placeholder="${esc(t('ph.rackLoc'))}"></div>
    <div class="field"><label for="r_notes">${esc(t('f.notes'))}</label><textarea id="r_notes">${esc(r.notes)}</textarea></div>
    <div class="actions"><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn primary small" data-act="rackSave">${esc(t('btn.save'))}</button><button class="btn small" data-act="rackCancel">${esc(t('btn.cancel'))}</button></div>
      ${edit && rackIds().length > 1 ? `<div style="display:flex;gap:6px"><button class="btn small" data-act="rackUp" ${i<=0?'disabled':''} aria-label="${esc(t('rack.up'))}" title="${esc(t('rack.up'))}">▲</button><button class="btn small" data-act="rackDown" ${i>=rackIds().length-1?'disabled':''} aria-label="${esc(t('rack.down'))}" title="${esc(t('rack.down'))}">▼</button></div>` : ''}
    </div>${del?`<div>${del}</div>`:''}
  </div></div>`;
  if (focus) $('r_name').focus();
}
function isHit(id,n){
  if (!searchQ) return false;
  const r = portRec(id,n);
  return [labelBase(id,n), r.dest, r.endpoint, r.vlan, r.cord, r.notes, r.plan, r.color, colorName(r.color)].join(' ').toLowerCase().includes(searchQ);
}
function portBtn(id, n){
  const r = portRec(id,n), st = r.status||'unknown';
  const cls = ['port','s-'+st, r.verified?'verified':'', bulk.set.has(n)?'picked':'', isHit(id,n)?'hit':''].join(' ');
  const hex = colorHex(r.color);
  const tip = label(id,n)+' · '+stLabel(st) + (r.dest?' · '+r.dest:'') + (r.link&&devices[r.link.dev]?' · ⇄ '+label(r.link.dev,r.link.port):'');
  return `<button class="${cls}" data-port="${n}" aria-pressed="${sel.dev===id&&sel.port==n}" title="${esc(tip)}" aria-label="${esc(tip)}"><span class="num">${n}</span>${hex?`<span class="cc" style="background:${hex}"></span>`:''}</button>`;
}
function portsMarkup(id){
  const d = devices[id]; const N = d.portCount||0; const groups = [];
  if (d.kind === 'switch'){
    for (let s=1; s<=N; s+=12){
      const end = Math.min(s+11,N); const cols = Math.ceil((end-s+1)/2);
      let top='', bot='';
      for (let n=s;n<=end;n+=2){ top+=portBtn(id,n); if (n+1<=end) bot+=portBtn(id,n+1); }
      groups.push(`<div class="group" style="grid-template-columns:repeat(${cols},38px)">${top}${bot}</div>`);
    }
  } else {
    for (let s=1; s<=N; s+=6){
      const end = Math.min(s+5,N); let h='';
      for (let n=s;n<=end;n++) h+=portBtn(id,n);
      groups.push(`<div class="group" style="grid-template-columns:repeat(${end-s+1},38px)">${h}</div>`);
    }
  }
  if (d.sfp){
    let top='', bot='';
    for (let n=N+1;n<=N+d.sfp;n+=2){ top+=portBtn(id,n); if (n+1<=N+d.sfp) bot+=portBtn(id,n+1); }
    groups.push(`<div class="group sfp" style="grid-template-columns:repeat(${Math.ceil(d.sfp/2)},46px)">${top}${bot}</div>`);
  }
  return groups.join('');
}
function deviceForm(d){
  d = d || {name:'',short:'',kind:'patch',portCount:24,sfp:0,status:'active',model:'',notes:'',rack:sel.rack};
  const opt = (v, cur, txt) => `<option value="${esc(v)}" ${cur===v?'selected':''}>${esc(txt)}</option>`;
  const rackField = rackIds().length > 1 ? `<div class="field"><label for="f_rack">${esc(t('f.rack'))}</label><select id="f_rack">${rackIds().map(r=>opt(r, d.rack||sel.rack, racks[r].name)).join('')}</select></div>` : '';
  return `<div class="dialog" data-form="${devForm}"><div class="eyebrow">${esc(t(devForm==='new'?'dev.formNew':'dev.formEdit'))}</div>
  <div class="form">
    <div class="row2"><div class="field"><label for="f_name">${esc(t('f.name'))}</label><input id="f_name" type="text" value="${esc(d.name)}"></div>
    <div class="field"><label for="f_short">${esc(t('f.prefix'))}</label><input id="f_short" type="text" value="${esc(d.short)}" placeholder="${esc(t('ph.prefix'))}"></div></div>
    ${rackField}
    <div class="row2"><div class="field"><label for="f_kind">${esc(t('f.kind'))}</label><select id="f_kind">${KINDS.map(k=>opt(k, d.kind, t('kind.'+k))).join('')}</select></div>
    <div class="field"><label for="f_status">${esc(t('f.state'))}</label><select id="f_status">${DEVSTATUS.map(k=>opt(k, d.status, t('devstatus.'+k))).join('')}</select></div></div>
    <div class="row2"><div class="field"><label for="f_ports">${esc(t('f.ports'))}</label><input id="f_ports" type="number" min="1" max="96" value="${Number.isFinite(d.portCount)?d.portCount:''}"></div>
    <div class="field"><label for="f_sfp">${esc(t('f.sfp'))}</label><input id="f_sfp" type="number" min="0" max="8" value="${d.sfp||0}"></div></div>
    <div class="field"><label for="f_model">${esc(t('f.model'))}</label><input id="f_model" type="text" value="${esc(d.model)}" placeholder="${esc(t('ph.model'))}"></div>
    <div class="field"><label for="f_dnotes">${esc(t('f.notes'))}</label><textarea id="f_dnotes">${esc(d.notes)}</textarea></div>
    <div class="actions"><div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary" data-act="devSave">${esc(t('btn.save'))}</button><button class="btn" data-act="devCancel">${esc(t('btn.cancel'))}</button></div>
      ${devForm==='edit'?`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="devUp">${esc(t('btn.up'))}</button><button class="btn small" data-act="devDown">${esc(t('btn.down'))}</button>
      ${confirmDelete?`<button class="btn small danger" data-act="devDelYes">${esc(t('btn.delSure'))}</button>`:`<button class="btn small danger" data-act="devDel">${esc(t('btn.delete'))}</button>`}</div>`:''}
    </div>
  </div></div>`;
}
// force=false (odświeżanie w tle, wyszukiwarka) nie przerysowuje otwartego formularza, żeby nie przerywać pisania.
// force=true przerysowuje, zachowując to, co już wpisano.
function renderDevice(force){
  const el = $('device');
  const open = el.querySelector('.dialog');
  if (devForm && open && !force) return;
  if (devForm && open && open.dataset.form === devForm) devDraft = devFromForm();
  if (!loaded){ el.innerHTML = `<div class="empty">${esc(t('loading'))}</div>`; return; }
  if (devForm==='new'){ el.innerHTML = deviceForm(devDraft); return; }
  const id = sel.dev, d = devices[id];
  if (!d && Object.keys(devices).length){
    el.innerHTML = `<div class="empty"><h3>${esc(t('empty.rackTitle'))}</h3><p>${esc(t('empty.rackText'))}</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px"><button class="btn primary" data-act="newDev">${esc(t('btn.addDeviceLong'))}</button></div></div>`;
    return;
  }
  if (!d){
    el.innerHTML = `<div class="empty"><h3>${esc(t('empty.dbTitle'))}</h3><p>${esc(t('empty.dbText'))}</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px"><button class="btn primary" data-act="loadTemplate">${esc(t('btn.loadTemplate'))}</button><button class="btn" data-act="newDev">${esc(t('btn.addDeviceLong'))}</button></div></div>`;
    return;
  }
  const c = counts(d);
  el.innerHTML = `
    <div class="dev-head"><div><div class="eyebrow">${esc(KINDS.includes(d.kind)?t('kind.'+d.kind):t('dev.device'))} · ${esc(t('dev.ports',{n:totalPorts(d)}))}</div><h2>${esc(d.name)}</h2>
      <div class="dev-meta">
        <span class="pill ${d.status==='unused'?'warn':d.status==='remove'?'off':''}">${esc(t('devstatus.'+(DEVSTATUS.includes(d.status)?d.status:'active')))}</span>
        ${d.model?`<span class="pill">${esc(d.model)}</span>`:''}
        <span class="pill mono">${esc(t('dev.summary',{used:c.used,free:c.free,unknown:c.unknown}))}</span>
        <span class="pill mono">✓ ${c.verified}/${c.total}</span>
      </div>
      ${d.notes?`<p class="dev-notes">${esc(d.notes)}</p>`:''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="bulk">${esc(t(bulk.on?'btn.bulkEnd':'btn.bulk'))}</button><button class="btn small" data-act="editDev">${esc(t('btn.editDevice'))}</button></div>
    </div>
    ${devForm==='edit'?deviceForm(devDraft||d):''}
    <div class="legend">${Object.keys(STATUS).map(k=>`<span>${dot(k)}${esc(stLabel(k))}</span>`).join('')}<span><i class="dot" style="background:#fff;border-radius:50%;box-shadow:0 0 0 1.5px var(--border-strong)"></i>${esc(t('legend.verified'))}</span><span>${esc(t('legend.cable'))}</span></div>
    <div class="faceplate" style="overflow-x:auto">
      <div class="ears"><span>${esc(d.short||d.name)}</span><span>${esc(t(d.kind==='switch'?'face.switch':'face.front'))}</span></div>
      <div class="groups" id="ports">${portsMarkup(id)}</div>
    </div>
    ${bulk.on?`<div class="bulk"><span class="mono">${esc(t('bulk.selected',{n:bulk.set.size}))}</span>
      ${Object.keys(STATUS).map(k=>`<button class="btn small" data-act="bulkSet" data-st="${k}" ${bulk.set.size?'':'disabled'}>${dot(k)}${esc(stLabel(k))}</button>`).join('')}
      <button class="btn small" data-act="bulkVerify" ${bulk.set.size?'':'disabled'}>${esc(t('bulk.verify'))}</button>
      <button class="btn small" data-act="bulkAll">${esc(t('bulk.all'))}</button><button class="btn small" data-act="bulkNone">${esc(t('bulk.none'))}</button></div>`:''}
    <div class="port-table-wrap">${portTable(id)}</div>`;
}
function portTable(id){
  const d = devices[id]; const rows=[];
  for (let n=1;n<=totalPorts(d);n++){
    const r = portRec(id,n); if (!Object.keys(r).length) continue;
    const st = r.status||'unknown';
    rows.push(`<tr class="row" data-port="${n}"><td class="lbl">${esc(label(id,n))}</td><td>${dot(st)} ${esc(stLabel(st))}</td>
      <td class="mono">${r.link&&devices[r.link.dev]?esc(label(r.link.dev,r.link.port)):''}</td><td>${esc(r.dest)}</td><td>${esc(r.endpoint)}</td><td class="mono">${esc(r.vlan)}</td><td>${r.color?`<i class="dot" style="background:${colorHex(r.color)};border:1px solid var(--border)" title="${esc(colorName(r.color))}"></i> `:''}${esc(r.cord)}</td><td>${r.verified?'✓':''}</td></tr>`);
  }
  if (!rows.length) return `<p class="empty" style="padding:14px">${esc(t('table.empty'))}</p>`;
  const th = ['table.port','table.status','table.link','table.dest','table.endpoint','table.vlan','table.cable'].map(k=>`<th>${esc(t(k))}</th>`).join('');
  return `<table><thead><tr>${th}<th>✓</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

let draft = null;
function renderEditor(){
  const el = $('editor');
  const narrow = matchMedia('(max-width:1180px)').matches;
  if (!sel.dev || !devices[sel.dev] || !sel.port){
    el.hidden = narrow;
    el.innerHTML = `<div class="empty"><h3>${esc(t('editor.pick'))}</h3><p>${esc(t('editor.pickText'))}</p></div>`;
    return;
  }
  el.hidden = false;
  const id = sel.dev, n = sel.port, key = id+'#'+n;
  if (!draft || draft._key !== key) { draft = clone(portRec(id,n)); draft._key = key; if(!draft.status) draft.status='unknown'; }
  const r = draft;
  const linkDev = r.link?.dev || '';
  let portOpts = '';
  if (linkDev && devices[linkDev]){
    for (let k=1;k<=totalPorts(devices[linkDev]);k++){
      if (linkDev===id && k==n) continue;
      const tp = portRec(linkDev,k); const other = tp.link && !(tp.link.dev===id && tp.link.port==n) && devices[tp.link.dev];
      portOpts += `<option value="${k}" ${r.link?.port==k?'selected':''}>${esc(label(linkDev,k))} — ${esc(stLabel(tp.status||'unknown'))}${other?' ⇄ '+esc(label(tp.link.dev,tp.link.port)):''}${tp.dest?' · '+esc(tp.dest):''}</option>`;
    }
  }
  const hist = history && history.key===key ? history.rows : null;
  // Urządzenia do patchcorda: najpierw ten rack, potem pozostałe (w grupach).
  const devOpt = o => `<option value="${esc(o)}" ${linkDev===o?'selected':''}>${esc(devices[o].name)}</option>`;
  const otherRacks = rackIds().filter(rk => rk !== sel.rack && sortedIds(rk).length);
  const ldevOpts = otherRacks.length
    ? `<optgroup label="${esc(racks[sel.rack]?.name||t('rack.this'))}">${sortedIds().map(devOpt).join('')}</optgroup>`
      + otherRacks.map(rk => `<optgroup label="${esc(racks[rk].name)}">${sortedIds(rk).map(devOpt).join('')}</optgroup>`).join('')
    : sortedIds().map(devOpt).join('');
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div><div class="eyebrow">${esc(devices[id].name)} · ${esc(t('editor.port',{n}))}</div><h3>${esc(label(id,n))}</h3></div>
      <div style="display:flex;gap:6px"><button class="btn small" data-act="prev" aria-label="${esc(t('editor.prev'))}" title="${esc(t('editor.prev'))}">‹</button><button class="btn small" data-act="next" aria-label="${esc(t('editor.next'))}" title="${esc(t('editor.next'))}">›</button><button class="btn small close-sheet" data-act="close">${esc(t('btn.close'))}</button></div>
    </div>
    <div class="route">${routeOf(id,n)}</div>
    ${r._conflict?`<div class="conflict">${esc(t('editor.conflict'))} <b>${esc(summ(portRec(id,n))||t('editor.emptyPort'))}</b>. ${esc(t('editor.conflict2'))}</div>`:''}
    <div class="form">
      <div class="field"><label>${esc(t('f.portStatus'))}</label><div class="seg">${Object.keys(STATUS).map(k=>`<button type="button" data-st="${k}" aria-pressed="${r.status===k}">${dot(k)}${esc(stLabel(k))}</button>`).join('')}</div></div>
      <div class="field"><label for="e_ldev">${esc(t('f.link'))}</label>
        <div class="row2"><select id="e_ldev"><option value="">${esc(t('opt.none'))}</option>${ldevOpts}</select>
        <select id="e_lport" ${linkDev?'':'disabled'}><option value="">${esc(t('opt.port'))}</option>${portOpts}</select></div>
        <span class="hint">${esc(t('hint.link'))}${otherRacks.length?' '+esc(t('hint.linkOther')):''}</span></div>
      <div class="field"><label for="e_dest">${esc(t('f.dest'))}</label><input id="e_dest" type="text" value="${esc(r.dest)}" placeholder="${esc(t('ph.dest'))}"></div>
      <div class="row2"><div class="field"><label for="e_end">${esc(t('f.endpoint'))}</label><input id="e_end" type="text" value="${esc(r.endpoint)}" placeholder="${esc(t('ph.endpoint'))}"></div>
      <div class="field"><label for="e_vlan">${esc(t('f.vlan'))}</label><input id="e_vlan" type="text" value="${esc(r.vlan)}" placeholder="${esc(t('ph.vlan'))}"></div></div>
      <div class="field"><label>${esc(t('f.color'))}</label><div class="swatches">
        <button type="button" class="sw none" data-color="" aria-pressed="${!r.color}" title="${esc(t('color.none'))}" aria-label="${esc(t('color.none'))}">–</button>
        ${COLORS.map(([nm,hex])=>`<button type="button" class="sw" data-color="${esc(nm)}" style="background:${hex}" aria-pressed="${r.color===nm}" title="${esc(colorName(nm))}" aria-label="${esc(colorName(nm))}"></button>`).join('')}
      </div></div>
      <div class="row2"><div class="field"><label for="e_len">${esc(t('f.length'))}</label><input id="e_len" type="text" inputmode="decimal" value="${esc(r.length)}" placeholder="${esc(t('ph.length'))}"></div>
      <div class="field"><label for="e_cord">${esc(t('f.cord'))}</label><input id="e_cord" type="text" value="${esc(r.cord)}" placeholder="${esc(t('ph.cord'))}"></div></div>
      <div class="field"><label for="e_plan">${esc(t('f.plan'))}</label><input id="e_plan" type="text" value="${esc(r.plan)}" placeholder="${esc(t('ph.plan'))}"></div>
      <div class="field"><label for="e_notes">${esc(t('f.notes'))}</label><textarea id="e_notes">${esc(r.notes)}</textarea></div>
      <label class="check"><input id="e_ver" type="checkbox" ${r.verified?'checked':''}> ${esc(t('f.verified'))}</label>
      ${r.updated?`<span class="hint">${esc(t('editor.lastChange',{d:r.updated}))}</span>`:''}
      <div class="actions"><div style="display:flex;gap:8px"><button class="btn primary" data-act="save">${esc(t('btn.save'))}</button><button class="btn" data-act="saveNext">${esc(t('btn.saveNext'))}</button></div>
      <button class="btn small danger" data-act="clearPort">${esc(t('btn.clearPort'))}</button></div>
      <div><button class="btn small" data-act="history">${esc(t(hist?'btn.historyRefresh':'btn.history'))}</button>
      ${hist?`<div class="history">${hist.length?hist.map(h=>`<div><div class="when">${esc(h.at)} · ${esc(h.by||'')}</div>${esc(summ(h.after))}</div>`).join(''):`<div>${esc(t('history.empty'))}</div>`}</div>`:''}</div>
    </div>`;
}
function summ(a){
  if (!a) return '';
  const p = [];
  if (a.status) p.push(STATUS[a.status] ? stLabel(a.status) : a.status);
  if (a.link && a.link.dev) p.push('⇄ '+label(a.link.dev, a.link.port));
  ['dest','endpoint','vlan','color','length','cord','plan'].forEach(k=>{ if (a[k]) p.push(k==='color' ? colorName(a[k]) : a[k]); });
  if (a.verified) p.push(t('legend.verified'));
  return p.join(' · ');
}
function renderResults(){
  const el = $('results');
  if (!searchQ){ el.hidden = true; return; }
  const hits = [];
  allIds().forEach(id => { for (let n=1;n<=totalPorts(devices[id]);n++) if (isHit(id,n)) hits.push([id,n]); });
  el.hidden = false;
  el.innerHTML = `<div class="eyebrow">${esc(t('results.count',{n:hits.length}))}</div>` + (hits.length ? `<ul>${hits.slice(0,60).map(([id,n])=>{ const r=portRec(id,n);
    return `<li><button data-goto="${esc(id)}#${n}"><span class="mono"><b>${esc(label(id,n))}</b></span><span>${esc([stLabel(r.status||'unknown'), r.dest, r.endpoint, r.vlan&&('VLAN '+r.vlan), r.link&&devices[r.link.dev]&&('⇄ '+label(r.link.dev,r.link.port))].filter(Boolean).join(' · '))}</span></button></li>`; }).join('')}</ul>` : `<p class="hint" style="margin:6px 0 0">${esc(t('results.none'))}</p>`);
}
function renderImportBanner(){
  if (!pendingImport) return;
  const n = Object.keys(pendingImport.devices).length, nr = pendingImport.racks ? Object.keys(pendingImport.racks).length : 0;
  const what = t('import.devices',{n}) + (nr ? ' '+t('import.racks',{n:nr}) : '');
  const where = nr ? '' : ' '+t('import.where',{x: racks[sel.rack]?.name||''});
  $('banner').innerHTML = `<div class="banner card" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between"><span>${esc(t('import.summary',{what}))}${esc(where)}</span><span style="display:flex;gap:8px"><button class="btn small primary" data-act="importYes">${esc(t('btn.importYes'))}</button><button class="btn small" data-act="importNo">${esc(t('btn.cancel'))}</button></span></div>`;
}

/* ---------- akcje ---------- */
function readDraft(){
  if (!draft || !$('e_dest')) return;
  const g = id => $(id) ? $(id).value.trim() : '';
  draft.dest = g('e_dest'); draft.endpoint = g('e_end'); draft.vlan = g('e_vlan');
  draft.length = g('e_len'); draft.cord = g('e_cord'); draft.plan = g('e_plan'); draft.notes = $('e_notes').value;
  draft.verified = $('e_ver').checked;
}
function draftDirty(){
  if (!draft || !sel.port) return false;
  readDraft();
  const a = clone(draft); delete a._key; delete a._conflict; delete a.updated; delete a.rev;
  const b = clone(portRec(sel.dev, sel.port)); delete b.updated; delete b.rev; if (!b.status) b.status='unknown';
  const norm = o => JSON.stringify(Object.keys(o).sort().reduce((m,k)=>{ if (o[k]!=='' && o[k]!==false && o[k]!=null) m[k]=o[k]; return m; },{}));
  return norm(a) !== norm(b);
}
// Zapis z wykrywaniem konfliktu: serwer odrzuca zapis (409), jeśli port zmienił się od otwarcia edycji.
// Wtedy szkic zostaje, a kolejne „Zapisz” nadpisuje aktualną wersję.
async function savePort(){
  readDraft();
  const body = clone(draft); delete body._key; delete body._conflict; delete body.updated; delete body.rev;
  body.baseRev = draft.rev || null;
  if (body.link && (!body.link.dev || !body.link.port)) delete body.link;
  let conflict = false;
  const ok = await mutate('PUT', `api/ports/${encodeURIComponent(sel.dev)}/${sel.port}`, body, t('toast.saved',{x:label(sel.dev, sel.port)}),
    e => (conflict = e.status === 409));
  if (ok){ draft = null; return ok; }
  if (conflict){
    const d = draft;
    await refresh(false);
    d.rev = portRec(sel.dev, sel.port).rev; d._conflict = true;
    renderEditor();
  }
  return null;
}
// Pyta przed porzuceniem niezapisanych zmian w karcie portu.
function canLeavePort(){
  return !draftDirty() || confirm(t('confirm.leave',{x:label(sel.dev, sel.port)}));
}
function step(dir){
  if (!canLeavePort()) return;
  const tot = totalPorts(devices[sel.dev]); let n = Number(sel.port)+dir;
  if (n<1) n=tot; if (n>tot) n=1; sel.port = n; draft = null; render();
}
function openDevForm(mode){ devForm = mode; devDraft = null; confirmDelete = false; if (mode==='new') { sel.port = null; draft = null; } }
function closeDevForm(){ devForm = null; devDraft = null; confirmDelete = false; }
function devFromForm(){
  return {
    name: $('f_name').value.trim(), short: $('f_short').value.trim(), kind: $('f_kind').value, status: $('f_status').value,
    portCount: parseInt($('f_ports').value,10), sfp: parseInt($('f_sfp').value,10)||0,
    model: $('f_model').value.trim(), notes: $('f_dnotes').value,
    rack: $('f_rack') ? $('f_rack').value : (devForm==='edit' && devices[sel.dev] ? devices[sel.dev].rack : sel.rack)
  };
}

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-dev],[data-port],[data-act],[data-st],[data-color],[data-goto]');
  if (!el) return;
  if (el.classList.contains('ru')){
    if (!canLeavePort()) return;
    sel.dev = el.dataset.dev; sel.port = null; draft=null; closeDevForm(); bulk={on:false,set:new Set()}; render(); return;
  }
  if (el.dataset.goto){
    const [id,n] = el.dataset.goto.split('#');
    if (!devices[id]) return;
    if ((id!==sel.dev || Number(n)!==sel.port) && !canLeavePort()) return;
    if (devices[id].rack !== sel.rack){ rackForm = null; renderRackForm(); setRack(devices[id].rack); }
    sel.dev=id; sel.port=Number(n); draft=null; closeDevForm(); render(); return;
  }
  if (el.dataset.port !== undefined && el.closest('#device')){
    const n = Number(el.dataset.port);
    if (bulk.on){ bulk.set.has(n)?bulk.set.delete(n):bulk.set.add(n); renderDevice(true); return; }
    if (n === sel.port || !canLeavePort()) return;
    sel.port = n; draft = null; render(); return;
  }
  if (el.dataset.st && el.closest('#editor')){ readDraft(); draft.status = el.dataset.st; renderEditor(); return; }
  if (el.dataset.color !== undefined && el.closest('#editor')){ readDraft(); draft.color = el.dataset.color; renderEditor(); return; }
  const a = el.dataset.act;
  if (!a) return;
  switch (a){
    case 'save': if (await savePort()) render(); break;
    case 'saveNext': if (await savePort()) step(1); break;
    case 'clearPort': {
      const body = {status:'unknown', baseRev: portRec(sel.dev, sel.port).rev || null};
      const s = await mutate('PUT', `api/ports/${encodeURIComponent(sel.dev)}/${sel.port}`, body, t('toast.cleared'),
        err => { if (err.status !== 409) return false; toast(t('toast.clearConflict')); return true; });
      if (s) { draft=null; render(); } else refresh(false);
      break;
    }
    case 'prev': step(-1); break;
    case 'next': step(1); break;
    case 'close': if (canLeavePort()) { sel.port=null; draft=null; render(); } break;
    case 'history':
      try { history = {key: sel.dev+'#'+sel.port, rows: await api('GET', `api/ports/${encodeURIComponent(sel.dev)}/${sel.port}/history`)}; readDraft(); renderEditor(); }
      catch(err){ toast(t('toast.historyFail')); }
      break;
    case 'loadTemplate': if (await mutate('POST','api/seed',{rack: sel.rack},t('toast.templateLoaded'))) { sel.dev = sortedIds()[0]; render(); } break;
    case 'newDev': if (canLeavePort()) { openDevForm('new'); render(); } break;
    case 'editDev': if (devForm==='edit') closeDevForm(); else openDevForm('edit'); renderDevice(true); break;
    case 'devCancel': closeDevForm(); renderDevice(true); break;
    case 'devSave': {
      const body = devFromForm(), editedId = devForm==='edit' ? sel.dev : null;
      if (devForm==='edit'){
        // Zmniejszenie liczby portów kasuje opis portów spoza nowego zakresu, więc najpierw pytamy.
        const d = devices[sel.dev];
        const pc = Number.isFinite(body.portCount) ? Math.min(96, Math.max(1, body.portCount)) : d.portCount;
        const total = pc + Math.min(8, Math.max(0, body.sfp));
        const lost = Object.keys(d.ports||{}).map(Number).filter(n => n > total).sort((x,y)=>x-y);
        if (lost.length && !confirm(t('confirm.shrink',{total, n:lost.length, list:lost.map(n=>label(sel.dev,n)).join(', ')}))) break;
      }
      const s = devForm==='new' ? await mutate('POST','api/devices',body,t('toast.devAdded')) : await mutate('PUT','api/devices/'+encodeURIComponent(sel.dev),body,t('toast.devSaved'));
      if (s){
        if (s.id) {
          // Nowe urządzenie w innym racku: przełącz na ten rack.
          if (devices[s.id] && devices[s.id].rack !== sel.rack) setRack(devices[s.id].rack);
          sel.dev = s.id; sel.port=null;
        } else if (editedId && devices[editedId] && devices[editedId].rack !== sel.rack) {
          toast(t('toast.moved',{x: racks[devices[editedId].rack]?.name||''}));
          sel.dev = sortedIds()[0]||null; sel.port=null; draft=null;
        }
        if (sel.port && devices[sel.dev] && sel.port > totalPorts(devices[sel.dev])) { sel.port=null; draft=null; }
        closeDevForm(); render();
      }
      break;
    }
    case 'devUp': case 'devDown': {
      const ids = sortedIds(); const i = ids.indexOf(sel.dev); const j = i + (a==='devUp'?-1:1);
      if (j<0 || j>=ids.length) break;
      [ids[i],ids[j]] = [ids[j],ids[i]];
      if (await mutate('POST','api/devices/reorder',{ids})) renderRack();
      break;
    }
    case 'devDel': confirmDelete=true; renderDevice(true); break;
    case 'devDelYes':
      if (await mutate('DELETE','api/devices/'+encodeURIComponent(sel.dev),null,t('toast.devDeleted'))){ sel.dev = sortedIds()[0]||null; sel.port=null; draft=null; closeDevForm(); render(); }
      break;
    case 'bulk': bulk = {on:!bulk.on, set:new Set()}; renderDevice(true); break;
    case 'bulkAll': for (let n=1;n<=totalPorts(devices[sel.dev]);n++) bulk.set.add(n); renderDevice(true); break;
    case 'bulkNone': bulk.set.clear(); renderDevice(true); break;
    case 'bulkSet': case 'bulkVerify': {
      const body = {dev: sel.dev, ports:[...bulk.set]};
      if (a==='bulkSet') body.status = el.dataset.st; else body.verified = true;
      if (await mutate('POST','api/ports/bulk',body,t('toast.bulkChanged',{n:bulk.set.size}))){ bulk.set.clear(); render(); }
      break;
    }
    case 'importYes': {
      const data = pendingImport; pendingImport=null;
      const s = await mutate('POST','api/import',data);
      if (s){ toast(t('toast.imported',{n:s.imported})); sel.port=null; draft=null; }
      render(); break;
    }
    case 'importNo': pendingImport=null; renderHeader(); break;
    case 'rackNew': case 'rackEdit': {
      const mode = a==='rackNew' ? 'new' : 'edit';
      rackForm = rackForm===mode ? null : mode; rackDelConfirm = false; renderRackForm(true);
      break;
    }
    case 'rackCancel': rackForm = null; renderRackForm(); break;
    case 'rackSave': {
      const body = {name: $('r_name').value.trim(), location: $('r_loc').value.trim(), notes: $('r_notes').value};
      if (!body.name){ toast(t('toast.rackName')); $('r_name').focus(); break; }
      if (rackForm==='new'){
        if (!canLeavePort()) break;
        const s = await mutate('POST','api/racks',body,t('toast.rackAdded',{x:body.name}));
        if (s){ rackForm = null; setRack(s.id); renderRackForm(); render(); }
      } else {
        const s = await mutate('PUT','api/racks/'+encodeURIComponent(sel.rack),body,t('toast.rackSaved'));
        if (s){ rackForm = null; renderRackForm(); render(); }
      }
      break;
    }
    case 'rackDel': rackDelConfirm = true; renderRackForm(); break;
    case 'rackDelYes': {
      const s = await mutate('DELETE','api/racks/'+encodeURIComponent(sel.rack),null,t('toast.rackDeleted'));
      if (s){ rackForm = null; rackDelConfirm = false; setRack(rackIds()[0]); renderRackForm(); render(); }
      break;
    }
    case 'rackUp': case 'rackDown': {
      const ids = rackIds(), i = ids.indexOf(sel.rack), j = i + (a==='rackUp'?-1:1);
      if (j<0 || j>=ids.length) break;
      [ids[i],ids[j]] = [ids[j],ids[i]];
      if (await mutate('POST','api/racks/reorder',{ids})){ renderRack(); renderRackForm(); }
      break;
    }
  }
});
document.addEventListener('change', e => {
  if (e.target.id==='rackSel'){
    const v = e.target.value;
    if (v === sel.rack) return;
    if (!canLeavePort()){ e.target.value = sel.rack; return; }
    rackForm = null; renderRackForm(); setRack(v); render();
    return;
  }
  if (e.target.id==='e_ldev'){ readDraft(); const v = e.target.value; if (v) draft.link = {dev:v, port:''}; else delete draft.link; renderEditor(); }
  if (e.target.id==='e_lport'){ readDraft(); if (draft.link) draft.link.port = e.target.value; }
});
let qT;
$('q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(()=>{ searchQ = e.target.value.trim().toLowerCase(); renderDevice(); renderResults(); }, 150); });
$('btnAddDev').addEventListener('click', () => { if (canLeavePort()) { openDevForm('new'); render(); } });
$('importFile').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try{
      const j = JSON.parse(rd.result); const data = j.devices || j;
      if (!data || typeof data!=='object' || Array.isArray(data)) throw 0;
      const jr = j.racks && typeof j.racks==='object' ? j.racks : null;
      pendingImport = {devices: data, racks: jr || undefined, rack: sel.rack};
      renderImportBanner();
    }catch(err){ toast(t('toast.badJson')); }
    e.target.value = '';
  };
  rd.readAsText(f);
});
document.addEventListener('keydown', e => {
  if (!sel.port || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key==='ArrowRight') step(1); else if (e.key==='ArrowLeft') step(-1); else if (e.key==='Escape' && canLeavePort()){ sel.port=null; draft=null; render(); }
});
matchMedia('(max-width:1180px)').addEventListener?.('change', () => { readDraft(); renderEditor(); });

/* ---------- język i motyw ---------- */
function applyLang(){
  document.title = t('app.title');
  $('csvLink').href = 'api/export.csv?lang=' + window.i18n.lang;
}
window.i18n.apply();
window.i18n.bindLangSelect($('langSel'));
window.i18n.bindThemeButton($('themeBtn'));
applyLang();
document.addEventListener('langchange', () => {
  readDraft();
  applyLang(); render(); renderRackForm(); renderImportBanner();
});

// Odświeżanie: zmiany z innych urządzeń (telefon przy szafie, komputer w biurze).
setInterval(() => { if (document.visibilityState === 'visible' && !busy) refresh(false); }, 20000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !busy) refresh(false); });
window.addEventListener('beforeunload', e => { if (draftDirty()) { e.preventDefault(); e.returnValue = ''; } });

render();
refresh(true);
api('GET','api/session').then(s => {
  if (s && s.auth && s.user){ $('who').textContent = s.user; $('logoutForm').hidden = false; }
}).catch(() => {});
})();
