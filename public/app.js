(() => {
'use strict';
const STATUS = {
  unknown:{l:'Do ustalenia',v:'--st-unknown'},
  used:{l:'Zajęty',v:'--st-used'},
  free:{l:'Wolny',v:'--st-free'},
  reserved:{l:'Rezerwacja',v:'--st-reserved'},
  broken:{l:'Uszkodzony',v:'--st-broken'}
};
const KINDS = {patch:'Patchpanel',switch:'Switch',fiber:'Panel światłowodowy',other:'Inne'};
const DEVSTATUS = {active:'W użyciu',unused:'Nieużywany',remove:'Do demontażu'};
const COLORS = [
  ['czarny','#1c1d20'],['czerwony','#e5322d'],['niebieski','#2f6fd6'],['zielony','#1f8f5a'],
  ['pomarańczowy','#f07a1f'],['biały','#f2f2f2'],['żółty','#f5c518'],['szary','#8a8f98'],
  ['różowy','#e86fae'],['turkusowy (światłowód)','#2ab3b3']
];
const colorHex = n => (COLORS.find(c=>c[0]===n)||[])[1];

let devices = {};
let sel = {dev:null, port:null};
let loaded = false, online = true, busy = false;
let bulk = {on:false, set:new Set()};
let searchQ = '';
let devForm = null;          // null | 'new' | 'edit'
let devDraft = null;         // wartości wpisane w formularzu urządzenia (przetrwają przerysowanie)
let pendingImport = null;
let confirmDelete = false;
let history = null;          // {key, rows}

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
  if (!res.ok){ const err = new Error((data && data.error) || ('HTTP '+res.status)); err.status = res.status; throw err; }
  if (expired){ expired = false; renderHeader(); }
  return data;
}
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
  devices = s.devices; loaded = true; online = true;
  if (!sel.dev || !devices[sel.dev]) { sel.dev = sortedIds()[0] || null; sel.port = null; }
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
    if (!(onError && onError(e))) toast('Nie udało się: '+e.message);
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
function sortedIds(){ return Object.keys(devices).sort((a,b)=>(devices[a].order??0)-(devices[b].order??0) || a.localeCompare(b)); }
function totalPorts(d){ return (d.portCount||0) + (d.sfp||0); }
function portRec(devId, n){ return (devices[devId]?.ports||{})[String(n)] || {}; }
function label(devId, n){
  const d = devices[devId]; if (!d) return '?';
  const s = d.short || d.name;
  if (d.kind === 'patch' || d.kind === 'fiber') return s.length<=2 ? s+n : s+'-'+n;
  return s+':'+n;
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
    const t = portRec(r.link.dev, r.link.port);
    parts.push('⇄ <b>'+esc(label(r.link.dev,r.link.port))+'</b>' + (t.dest?' → '+esc(t.dest):'') + (t.endpoint?' ('+esc(t.endpoint)+')':''));
  }
  if (r.endpoint) parts.push('urządzenie: '+esc(r.endpoint));
  if (r.vlan) parts.push('VLAN '+esc(r.vlan));
  return parts.join('<br>');
}
let toastT;
function toast(msg){ const t=$('toast'); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }

/* ---------- render ---------- */
function render(){ renderHeader(); renderRack(); renderDevice(true); renderEditor(); renderResults(); }

function renderHeader(){
  $('modeLine').textContent = !loaded ? 'Łączenie z serwerem…' : online ? 'Dane w bazie MySQL · odświeżanie co 20 s' : 'Brak połączenia z serwerem';
  const all = {used:0,free:0,unknown:0,reserved:0,broken:0,verified:0,total:0};
  Object.values(devices).forEach(d => { const c=counts(d); for (const k in all) all[k]+=c[k]; });
  const pct = all.total ? Math.round(all.verified/all.total*100) : 0;
  $('stats').innerHTML =
    `<span class="stat">Porty <b>${all.total}</b></span>` +
    ['used','free','unknown','reserved','broken'].filter(k=>(k!=='reserved'&&k!=='broken')||all[k]).map(k=>`<span class="stat"><i class="dot" style="background:var(${STATUS[k].v})"></i>${STATUS[k].l} <b>${all[k]}</b></span>`).join('') +
    `<span class="stat">Zweryfikowane <b>${pct}%</b><span class="progress"><i style="width:${pct}%"></i></span></span>`;
  if (!pendingImport) $('banner').innerHTML = expired
    ? '<div class="banner glass">Sesja wygasła. <a href="login.html" target="_blank" rel="noopener">Zaloguj się w nowej karcie</a>, potem wróć tutaj i zapisz port.</div>'
    : (loaded && !online) ? '<div class="banner glass">Serwer nie odpowiada. Zmiany nie zostaną zapisane, dopóki połączenie nie wróci.</div>' : '';
}
function renderRack(){
  const ids = sortedIds();
  $('rackList').innerHTML = ids.length ? ids.map((id,i) => {
    const d = devices[id], c = counts(d), t = c.total||1;
    return `<li><button class="ru ${d.status==='unused'||d.status==='remove'?'unused':''}" data-dev="${esc(id)}" aria-current="${sel.dev===id}">
      <span class="u">${String(i+1).padStart(2,'0')}</span>
      <span><span class="nm"><span>${esc(d.name)}</span><span class="kd">${d.kind==='switch'?'SW':d.kind==='fiber'?'FO':d.kind==='other'?'–':'PP'} ${totalPorts(d)}</span></span>
      <span class="bar"><i style="width:${c.used/t*100}%;background:var(--st-used)"></i><i style="width:${c.reserved/t*100}%;background:var(--st-reserved)"></i><i style="width:${c.broken/t*100}%;background:var(--st-broken)"></i><i style="width:${c.free/t*100}%;background:var(--st-free)"></i></span></span>
    </button></li>`;
  }).join('') : '<li class="empty" style="padding:12px;text-align:left">Brak urządzeń</li>';
}
function isHit(id,n){
  if (!searchQ) return false;
  const r = portRec(id,n);
  return [label(id,n), r.dest, r.endpoint, r.vlan, r.cord, r.notes, r.plan, r.color].join(' ').toLowerCase().includes(searchQ);
}
function portBtn(id, n){
  const r = portRec(id,n), st = r.status||'unknown';
  const cls = ['port','s-'+st, r.verified?'verified':'', bulk.set.has(n)?'picked':'', isHit(id,n)?'hit':''].join(' ');
  const hex = colorHex(r.color);
  const tip = label(id,n)+' · '+STATUS[st].l + (r.dest?' · '+r.dest:'') + (r.link&&devices[r.link.dev]?' · ⇄ '+label(r.link.dev,r.link.port):'');
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
  d = d || {name:'',short:'',kind:'patch',portCount:24,sfp:0,status:'active',model:'',notes:''};
  return `<div class="dialog" data-form="${devForm}"><div class="eyebrow">${devForm==='new'?'Nowe urządzenie':'Edycja urządzenia'}</div>
  <div class="form">
    <div class="row2"><div class="field"><label for="f_name">Nazwa</label><input id="f_name" type="text" value="${esc(d.name)}"></div>
    <div class="field"><label for="f_short">Prefiks etykiet</label><input id="f_short" type="text" value="${esc(d.short)}" placeholder="np. B lub PKN01"></div></div>
    <div class="row2"><div class="field"><label for="f_kind">Typ</label><select id="f_kind">${Object.entries(KINDS).map(([k,v])=>`<option value="${k}" ${d.kind===k?'selected':''}>${v}</option>`).join('')}</select></div>
    <div class="field"><label for="f_status">Stan</label><select id="f_status">${Object.entries(DEVSTATUS).map(([k,v])=>`<option value="${k}" ${d.status===k?'selected':''}>${v}</option>`).join('')}</select></div></div>
    <div class="row2"><div class="field"><label for="f_ports">Porty RJ45 / LC</label><input id="f_ports" type="number" min="1" max="96" value="${Number.isFinite(d.portCount)?d.portCount:''}"></div>
    <div class="field"><label for="f_sfp">Porty SFP (uplink)</label><input id="f_sfp" type="number" min="0" max="8" value="${d.sfp||0}"></div></div>
    <div class="field"><label for="f_model">Model / producent</label><input id="f_model" type="text" value="${esc(d.model)}" placeholder="np. HPE Aruba 2530-48G"></div>
    <div class="field"><label for="f_dnotes">Notatki</label><textarea id="f_dnotes">${esc(d.notes)}</textarea></div>
    <div class="actions"><div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn primary" data-act="devSave">Zapisz</button><button class="btn" data-act="devCancel">Anuluj</button></div>
      ${devForm==='edit'?`<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="devUp">▲ Wyżej</button><button class="btn small" data-act="devDown">▼ Niżej</button>
      ${confirmDelete?`<button class="btn small danger" data-act="devDelYes">Usuń na pewno</button>`:`<button class="btn small danger" data-act="devDel">Usuń</button>`}</div>`:''}
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
  if (!loaded){ el.innerHTML = '<div class="empty">Wczytywanie racka…</div>'; return; }
  if (devForm==='new'){ el.innerHTML = deviceForm(devDraft); return; }
  const id = sel.dev, d = devices[id];
  if (!d){
    el.innerHTML = `<div class="empty"><h3>Rack jest pusty</h3><p>Wczytaj układ z inwentaryzacji (patchpanele A–H, switche PKN01–04, CAM patch, HPSW34, dwa żółte switche) albo dodaj urządzenia ręcznie.</p>
      <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px"><button class="btn primary" data-act="loadTemplate">Wczytaj układ racka</button><button class="btn" data-act="newDev">Dodaj urządzenie</button></div></div>`;
    return;
  }
  const c = counts(d);
  el.innerHTML = `
    <div class="dev-head"><div><div class="eyebrow">${KINDS[d.kind]||'Urządzenie'} · ${totalPorts(d)} portów</div><h2>${esc(d.name)}</h2>
      <div class="dev-meta">
        <span class="pill ${d.status==='unused'?'warn':d.status==='remove'?'off':''}">${DEVSTATUS[d.status]||'W użyciu'}</span>
        ${d.model?`<span class="pill">${esc(d.model)}</span>`:''}
        <span class="pill mono">zajęte ${c.used} · wolne ${c.free} · ? ${c.unknown}</span>
        <span class="pill mono">✓ ${c.verified}/${c.total}</span>
      </div>
      ${d.notes?`<p class="dev-notes">${esc(d.notes)}</p>`:''}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="bulk">${bulk.on?'Zakończ zaznaczanie':'Zaznacz wiele'}</button><button class="btn small" data-act="editDev">Edytuj urządzenie</button></div>
    </div>
    ${devForm==='edit'?deviceForm(devDraft||d):''}
    <div class="legend">${Object.entries(STATUS).map(([k,v])=>`<span><i class="dot" style="background:var(${v.v})"></i>${v.l}</span>`).join('')}<span><i class="dot" style="background:#fff;border-radius:50%;box-shadow:0 0 0 1.5px var(--stroke)"></i>zweryfikowany</span><span>pasek = kolor kabla</span></div>
    <div class="faceplate" style="overflow-x:auto">
      <div class="ears"><span>${esc(d.short||d.name)}</span><span>${d.kind==='switch'?'nieparzyste u góry · parzyste u dołu':'widok od frontu'}</span></div>
      <div class="groups" id="ports">${portsMarkup(id)}</div>
    </div>
    ${bulk.on?`<div class="bulk"><span class="mono">${bulk.set.size} zaznaczonych</span>
      ${Object.entries(STATUS).map(([k,v])=>`<button class="btn small" data-act="bulkSet" data-st="${k}" ${bulk.set.size?'':'disabled'}><i class="dot" style="background:var(${v.v})"></i>${v.l}</button>`).join('')}
      <button class="btn small" data-act="bulkVerify" ${bulk.set.size?'':'disabled'}>Oznacz jako zweryfikowane</button>
      <button class="btn small" data-act="bulkAll">Zaznacz wszystkie</button><button class="btn small" data-act="bulkNone">Wyczyść</button></div>`:''}
    <div class="port-table-wrap">${portTable(id)}</div>`;
}
function portTable(id){
  const d = devices[id]; const rows=[];
  for (let n=1;n<=totalPorts(d);n++){
    const r = portRec(id,n); if (!Object.keys(r).length) continue;
    rows.push(`<tr class="row" data-port="${n}"><td class="lbl">${esc(label(id,n))}</td><td><i class="dot" style="background:var(${STATUS[r.status||'unknown'].v})"></i> ${STATUS[r.status||'unknown'].l}</td>
      <td class="mono">${r.link&&devices[r.link.dev]?esc(label(r.link.dev,r.link.port)):''}</td><td>${esc(r.dest)}</td><td>${esc(r.endpoint)}</td><td class="mono">${esc(r.vlan)}</td><td>${r.color?`<i class="dot" style="background:${colorHex(r.color)};border:1px solid var(--stroke)"></i> `:''}${esc(r.cord)}</td><td>${r.verified?'✓':''}</td></tr>`);
  }
  if (!rows.length) return '<p class="empty" style="padding:14px">Żaden port nie jest jeszcze opisany. Kliknij port, żeby zacząć.</p>';
  return `<table><thead><tr><th>Port</th><th>Status</th><th>Patchcord do</th><th>Dokąd prowadzi</th><th>Urządzenie</th><th>VLAN</th><th>Kabel</th><th>✓</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

let draft = null;
function renderEditor(){
  const el = $('editor');
  const narrow = matchMedia('(max-width:1180px)').matches;
  if (!sel.dev || !devices[sel.dev] || !sel.port){
    el.hidden = narrow;
    el.innerHTML = `<div class="empty"><h3>Wybierz port</h3><p>Kliknij gniazdo na froncie urządzenia, żeby opisać kabel, trasę i stan.</p></div>`;
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
      const t = portRec(linkDev,k); const other = t.link && !(t.link.dev===id && t.link.port==n) && devices[t.link.dev];
      portOpts += `<option value="${k}" ${r.link?.port==k?'selected':''}>${esc(label(linkDev,k))} — ${STATUS[t.status||'unknown'].l}${other?' ⇄ '+esc(label(t.link.dev,t.link.port)):''}${t.dest?' · '+esc(t.dest):''}</option>`;
    }
  }
  const hist = history && history.key===key ? history.rows : null;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
      <div><div class="eyebrow">${esc(devices[id].name)} · port ${n}</div><h3>${esc(label(id,n))}</h3></div>
      <div style="display:flex;gap:6px"><button class="btn small" data-act="prev" aria-label="Poprzedni port">‹</button><button class="btn small" data-act="next" aria-label="Następny port">›</button><button class="btn small close-sheet" data-act="close">Zamknij</button></div>
    </div>
    <div class="route">${routeOf(id,n)}</div>
    ${r._conflict?`<div class="conflict">Ktoś inny zmienił ten port, kiedy go edytowałeś. Teraz w bazie: <b>${esc(summ(portRec(id,n))||'pusty port')}</b>. Poniżej są Twoje zmiany. Kliknij Zapisz, żeby je zachować zamiast tamtych.</div>`:''}
    <div class="form">
      <div class="field"><label>Status portu</label><div class="seg">${Object.entries(STATUS).map(([k,v])=>`<button type="button" data-st="${k}" aria-pressed="${r.status===k}"><i class="dot" style="background:var(${v.v})"></i>${v.l}</button>`).join('')}</div></div>
      <div class="field"><label for="e_ldev">Patchcord w racku — drugi koniec</label>
        <div class="row2"><select id="e_ldev"><option value="">— brak —</option>${sortedIds().map(o=>`<option value="${esc(o)}" ${linkDev===o?'selected':''}>${esc(devices[o].name)}</option>`).join('')}</select>
        <select id="e_lport" ${linkDev?'':'disabled'}><option value="">— port —</option>${portOpts}</select></div>
        <span class="hint">Połączenie zapisuje się po obu stronach.</span></div>
      <div class="field"><label for="e_dest">Dokąd prowadzi (lokalizacja / gniazdo)</label><input id="e_dest" type="text" value="${esc(r.dest)}" placeholder="np. Biuro 1.12, gniazdo 1.12-03"></div>
      <div class="row2"><div class="field"><label for="e_end">Urządzenie końcowe</label><input id="e_end" type="text" value="${esc(r.endpoint)}" placeholder="PC, drukarka, AP, kamera"></div>
      <div class="field"><label for="e_vlan">VLAN</label><input id="e_vlan" type="text" value="${esc(r.vlan)}" placeholder="np. 10"></div></div>
      <div class="field"><label>Kolor patchcorda</label><div class="swatches">
        <button type="button" class="sw none" data-color="" aria-pressed="${!r.color}" title="brak">–</button>
        ${COLORS.map(([nm,hex])=>`<button type="button" class="sw" data-color="${esc(nm)}" style="background:${hex}" aria-pressed="${r.color===nm}" title="${esc(nm)}" aria-label="${esc(nm)}"></button>`).join('')}
      </div></div>
      <div class="row2"><div class="field"><label for="e_len">Długość (m)</label><input id="e_len" type="text" inputmode="decimal" value="${esc(r.length)}" placeholder="np. 1,5"></div>
      <div class="field"><label for="e_cord">Etykieta na kablu</label><input id="e_cord" type="text" value="${esc(r.cord)}" placeholder="np. B07-PKN01-12"></div></div>
      <div class="field"><label for="e_plan">Plan po przebudowie</label><input id="e_plan" type="text" value="${esc(r.plan)}" placeholder="np. przenieść na PKN02:5, VLAN 20"></div>
      <div class="field"><label for="e_notes">Notatki</label><textarea id="e_notes">${esc(r.notes)}</textarea></div>
      <label class="check"><input id="e_ver" type="checkbox" ${r.verified?'checked':''}> Zweryfikowany fizycznie (test kabla / link)</label>
      ${r.updated?`<span class="hint">Ostatnia zmiana: ${esc(r.updated)}</span>`:''}
      <div class="actions"><div style="display:flex;gap:8px"><button class="btn primary" data-act="save">Zapisz</button><button class="btn" data-act="saveNext">Zapisz i dalej ›</button></div>
      <button class="btn small danger" data-act="clearPort">Wyczyść port</button></div>
      <div><button class="btn small" data-act="history">${hist?'Odśwież historię':'Historia zmian'}</button>
      ${hist?`<div class="history">${hist.length?hist.map(h=>`<div><div class="when">${esc(h.at)} · ${esc(h.by||'')}</div>${esc(summ(h.after))}</div>`).join(''):'<div>Brak zapisanych zmian.</div>'}</div>`:''}</div>
    </div>`;
}
function summ(a){
  if (!a) return '';
  const p = [];
  if (a.status) p.push(STATUS[a.status]?.l || a.status);
  if (a.link && a.link.dev) p.push('⇄ '+label(a.link.dev, a.link.port));
  ['dest','endpoint','vlan','color','length','cord','plan'].forEach(k=>{ if (a[k]) p.push(a[k]); });
  if (a.verified) p.push('zweryfikowany');
  return p.join(' · ');
}
function renderResults(){
  const el = $('results');
  if (!searchQ){ el.hidden = true; return; }
  const hits = [];
  sortedIds().forEach(id => { for (let n=1;n<=totalPorts(devices[id]);n++) if (isHit(id,n)) hits.push([id,n]); });
  el.hidden = false;
  el.innerHTML = `<div class="eyebrow">Wyniki: ${hits.length}</div>` + (hits.length ? `<ul>${hits.slice(0,60).map(([id,n])=>{ const r=portRec(id,n);
    return `<li><button data-goto="${esc(id)}#${n}"><span class="mono"><b>${esc(label(id,n))}</b></span><span>${esc([STATUS[r.status||'unknown'].l, r.dest, r.endpoint, r.vlan&&('VLAN '+r.vlan), r.link&&devices[r.link.dev]&&('⇄ '+label(r.link.dev,r.link.port))].filter(Boolean).join(' · '))}</span></button></li>`; }).join('')}</ul>` : '<p class="hint" style="margin:6px 0 0">Nic nie pasuje.</p>');
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
  const ok = await mutate('PUT', `api/ports/${encodeURIComponent(sel.dev)}/${sel.port}`, body, 'Zapisano '+label(sel.dev, sel.port),
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
  return !draftDirty() || confirm(`Port ${label(sel.dev, sel.port)} ma niezapisane zmiany. Porzucić je?`);
}
function step(dir){
  if (!canLeavePort()) return;
  const t = totalPorts(devices[sel.dev]); let n = Number(sel.port)+dir;
  if (n<1) n=t; if (n>t) n=1; sel.port = n; draft = null; render();
}
function openDevForm(mode){ devForm = mode; devDraft = null; confirmDelete = false; if (mode==='new') { sel.port = null; draft = null; } }
function closeDevForm(){ devForm = null; devDraft = null; confirmDelete = false; }
function devFromForm(){
  return {
    name: $('f_name').value.trim(), short: $('f_short').value.trim(), kind: $('f_kind').value, status: $('f_status').value,
    portCount: parseInt($('f_ports').value,10), sfp: parseInt($('f_sfp').value,10)||0,
    model: $('f_model').value.trim(), notes: $('f_dnotes').value
  };
}

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-dev],[data-port],[data-act],[data-st],[data-color],[data-goto]');
  if (!t) return;
  if (t.classList.contains('ru')){
    if (!canLeavePort()) return;
    sel.dev = t.dataset.dev; sel.port = null; draft=null; closeDevForm(); bulk={on:false,set:new Set()}; render(); return;
  }
  if (t.dataset.goto){
    const [id,n] = t.dataset.goto.split('#');
    if ((id!==sel.dev || Number(n)!==sel.port) && !canLeavePort()) return;
    sel.dev=id; sel.port=Number(n); draft=null; closeDevForm(); render(); return;
  }
  if (t.dataset.port !== undefined && t.closest('#device')){
    const n = Number(t.dataset.port);
    if (bulk.on){ bulk.set.has(n)?bulk.set.delete(n):bulk.set.add(n); renderDevice(true); return; }
    if (n === sel.port || !canLeavePort()) return;
    sel.port = n; draft = null; render(); return;
  }
  if (t.dataset.st && t.closest('#editor')){ readDraft(); draft.status = t.dataset.st; renderEditor(); return; }
  if (t.dataset.color !== undefined && t.closest('#editor')){ readDraft(); draft.color = t.dataset.color; renderEditor(); return; }
  const a = t.dataset.act;
  if (!a) return;
  switch (a){
    case 'save': if (await savePort()) render(); break;
    case 'saveNext': if (await savePort()) step(1); break;
    case 'clearPort': {
      const body = {status:'unknown', baseRev: portRec(sel.dev, sel.port).rev || null};
      const s = await mutate('PUT', `api/ports/${encodeURIComponent(sel.dev)}/${sel.port}`, body, 'Wyczyszczono port',
        e => { if (e.status !== 409) return false; toast('Ktoś inny właśnie zmienił ten port. Sprawdź dane przed wyczyszczeniem.'); return true; });
      if (s) { draft=null; render(); } else refresh(false);
      break;
    }
    case 'prev': step(-1); break;
    case 'next': step(1); break;
    case 'close': if (canLeavePort()) { sel.port=null; draft=null; render(); } break;
    case 'history':
      try { history = {key: sel.dev+'#'+sel.port, rows: await api('GET', `api/ports/${encodeURIComponent(sel.dev)}/${sel.port}/history`)}; readDraft(); renderEditor(); }
      catch(err){ toast('Nie udało się pobrać historii'); }
      break;
    case 'loadTemplate': if (await mutate('POST','api/seed',{},'Wczytano układ racka')) { sel.dev = sortedIds()[0]; render(); } break;
    case 'newDev': if (canLeavePort()) { openDevForm('new'); render(); } break;
    case 'editDev': if (devForm==='edit') closeDevForm(); else openDevForm('edit'); renderDevice(true); break;
    case 'devCancel': closeDevForm(); renderDevice(true); break;
    case 'devSave': {
      const body = devFromForm();
      if (devForm==='edit'){
        // Zmniejszenie liczby portów kasuje opis portów spoza nowego zakresu, więc najpierw pytamy.
        const d = devices[sel.dev];
        const pc = Number.isFinite(body.portCount) ? Math.min(96, Math.max(1, body.portCount)) : d.portCount;
        const total = pc + Math.min(8, Math.max(0, body.sfp));
        const lost = Object.keys(d.ports||{}).map(Number).filter(n => n > total).sort((a,b)=>a-b);
        if (lost.length && !confirm(`Po zmianie urządzenie będzie miało ${total} portów. Opis ${lost.length} portów zostanie usunięty (${lost.map(n=>label(sel.dev,n)).join(', ')}), a podłączone do nich patchcordy odpięte. Kontynuować?`)) break;
      }
      const s = devForm==='new' ? await mutate('POST','api/devices',body,'Dodano urządzenie') : await mutate('PUT','api/devices/'+encodeURIComponent(sel.dev),body,'Zapisano urządzenie');
      if (s){
        if (s.id) { sel.dev = s.id; sel.port=null; }
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
      if (await mutate('DELETE','api/devices/'+encodeURIComponent(sel.dev),null,'Usunięto urządzenie')){ sel.dev = sortedIds()[0]||null; sel.port=null; draft=null; closeDevForm(); render(); }
      break;
    case 'bulk': bulk = {on:!bulk.on, set:new Set()}; renderDevice(true); break;
    case 'bulkAll': for (let n=1;n<=totalPorts(devices[sel.dev]);n++) bulk.set.add(n); renderDevice(true); break;
    case 'bulkNone': bulk.set.clear(); renderDevice(true); break;
    case 'bulkSet': case 'bulkVerify': {
      const body = {dev: sel.dev, ports:[...bulk.set]};
      if (a==='bulkSet') body.status = t.dataset.st; else body.verified = true;
      if (await mutate('POST','api/ports/bulk',body,'Zmieniono '+bulk.set.size+' portów')){ bulk.set.clear(); render(); }
      break;
    }
    case 'importYes': {
      const data = pendingImport; pendingImport=null;
      const s = await mutate('POST','api/import',data);
      if (s){ toast('Zaimportowano '+s.imported+' urządzeń'); sel.dev = sortedIds()[0]||null; sel.port=null; draft=null; }
      render(); break;
    }
    case 'importNo': pendingImport=null; renderHeader(); break;
  }
});
document.addEventListener('change', e => {
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
      pendingImport = {devices: data};
      $('banner').innerHTML = `<div class="banner glass" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between"><span>Import nadpisze ${Object.keys(data).length} urządzeń o tych samych identyfikatorach razem z ich portami.</span><span style="display:flex;gap:8px"><button class="btn small primary" data-act="importYes">Importuj</button><button class="btn small" data-act="importNo">Anuluj</button></span></div>`;
    }catch(err){ toast('To nie jest poprawna kopia JSON'); }
    e.target.value = '';
  };
  rd.readAsText(f);
});
document.addEventListener('keydown', e => {
  if (!sel.port || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  if (e.key==='ArrowRight') step(1); else if (e.key==='ArrowLeft') step(-1); else if (e.key==='Escape' && canLeavePort()){ sel.port=null; draft=null; render(); }
});
matchMedia('(max-width:1180px)').addEventListener?.('change', () => { readDraft(); renderEditor(); });

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
