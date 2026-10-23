// Rack Inventory · serwer HTTP + REST API (Express + MySQL)
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { pool, config } = require('./db');
const { runMigrations, ensureDefaultRack } = require('./migrate');
const TEMPLATE = require('./template');

const PORT = Number(process.env.PORT || 3080);
const HOST = process.env.HOST || '127.0.0.1';
const AUTH_USER = process.env.AUTH_USER || '';
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || '';
const HISTORY_DAYS = Number(process.env.HISTORY_DAYS || 0);

const KINDS = ['patch', 'switch', 'fiber', 'other'];
const DEV_STATUS = ['active', 'unused', 'remove'];
const PORT_STATUS = ['unknown', 'used', 'free', 'reserved', 'broken'];
const TEXT_FIELDS = { color: 40, length: 20, cord: 120, dest: 255, endpoint: 255, vlan: 40, plan: 255, notes: 5000 };
const CORD_FIELDS = ['color', 'length', 'cord']; // opis patchcorda, wspólny dla obu końców
const STATUS_PL = { unknown: 'Do ustalenia', used: 'Zajęty', free: 'Wolny', reserved: 'Rezerwacja', broken: 'Uszkodzony' };

const app = express();
app.disable('x-powered-by');
// X-Forwarded-For ustawia tylko nginx na tym samym serwerze; od innych klientów nagłówek jest ignorowany.
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '10mb' }));

/* ---------- opcjonalne logowanie: strona logowania + sesja w podpisanym ciasteczku ---------- */
const AUTH_ON = Boolean(AUTH_USER && AUTH_PASSWORD);
const AUTH_MAX_FAILS = 10;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const SESSION_COOKIE = 'rack_session';
const SESSION_MS = 12 * 60 * 60 * 1000;        // bez „Zapamiętaj mnie”
const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;  // z „Zapamiętaj mnie”
const PUBLIC_FILES = new Set(['/login.html', '/style.css', '/favicon.svg']);
const authFails = new Map(); // ip -> { n, reset }

let SESSION_SECRET = process.env.SESSION_SECRET || '';
if (AUTH_ON && !SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('Brak SESSION_SECRET w .env: po każdym restarcie aplikacji trzeba będzie zalogować się ponownie.');
}
// Klucz zależy też od loginu i hasła, więc ich zmiana unieważnia wszystkie sesje.
const sessionKey = crypto.createHash('sha256').update(`${SESSION_SECRET}\0${AUTH_USER}\0${AUTH_PASSWORD}`).digest();
const sign = (data) => crypto.createHmac('sha256', sessionKey).update(data).digest('base64url');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function credentialsOk(u, p) {
  const okUser = safeEqual(u ?? '', AUTH_USER), okPass = safeEqual(p ?? '', AUTH_PASSWORD);
  return okUser && okPass;
}
function authBlocked(ip) {
  const f = authFails.get(ip);
  return Boolean(f && f.n >= AUTH_MAX_FAILS && Date.now() < f.reset);
}
function authFailed(ip) {
  const now = Date.now(), f = authFails.get(ip);
  if (!f || now >= f.reset) authFails.set(ip, { n: 1, reset: now + AUTH_WINDOW_MS });
  else f.n++;
}
function readSession(req) {
  const m = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  if (!m) return null;
  const [data, sig] = m[1].split('.');
  if (!data || !sig || !safeEqual(sig, sign(data))) return null;
  try {
    const s = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    return s.exp > Date.now() ? s : null;
  } catch (e) {
    return null;
  }
}
// Ciasteczko celowo bez atrybutu Path: przeglądarka przypisuje je do katalogu adresu /login,
// czyli do katalogu aplikacji, także gdy działa ona pod podkatalogiem (np. /rack/ za Apache).
function setSessionCookie(req, res, value, maxAgeMs) {
  const parts = [`${SESSION_COOKIE}=${value}`, 'HttpOnly', 'SameSite=Lax'];
  if (req.secure) parts.push('Secure');
  if (maxAgeMs !== undefined) parts.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  res.append('Set-Cookie', parts.join('; '));
}

if (AUTH_ON) {
  app.post('/login', express.urlencoded({ extended: false, limit: '10kb' }), (req, res) => {
    if (authBlocked(req.ip)) return res.redirect(303, 'login.html?blad=limit');
    const b = req.body || {};
    if (!credentialsOk(b.user, b.password)) {
      authFailed(req.ip);
      return res.redirect(303, 'login.html?blad=1');
    }
    authFails.delete(req.ip);
    const remember = b.remember === '1';
    const ttl = remember ? REMEMBER_MS : SESSION_MS;
    const data = Buffer.from(JSON.stringify({ u: AUTH_USER, exp: Date.now() + ttl })).toString('base64url');
    setSessionCookie(req, res, `${data}.${sign(data)}`, remember ? ttl : undefined);
    res.redirect(303, './');
  });
  app.post('/logout', (req, res) => {
    setSessionCookie(req, res, '', 0);
    res.redirect(303, 'login.html?wylogowano=1');
  });

  app.use((req, res, next) => {
    const s = readSession(req);
    if (s) {
      if (req.path === '/login.html') return res.redirect(302, './');
      req.user = s.u;
      return next();
    }
    // Skrypty (np. curl) mogą logować się nagłówkiem HTTP Basic.
    const h = req.headers.authorization || '';
    if (h.startsWith('Basic ')) {
      if (authBlocked(req.ip)) return res.status(429).json({ error: 'Za dużo nieudanych prób logowania. Spróbuj ponownie za kilka minut.' });
      const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
      if (credentialsOk(u, rest.join(':'))) {
        authFails.delete(req.ip);
        req.user = u;
        return next();
      }
      authFailed(req.ip);
    }
    if (PUBLIC_FILES.has(req.path)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Nie jesteś zalogowany albo sesja wygasła', login: true });
    if (req.method === 'GET' && ['/', '/index.html', '/login'].includes(req.path)) return res.redirect(302, 'login.html');
    res.status(401).send('Wymagane logowanie');
  });
}

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

/* ---------- pomocnicze ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const who = (req) => (req.user || req.ip || '').toString().slice(0, 64);

function txt(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}
function int(v, min, max, def) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return def;
  return Math.max(min, Math.min(max, n));
}
function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 56) || 'dev';
}
// Transakcja; przy zakleszczeniu (dwie osoby łączą te same porty naraz) próbuje ponownie.
async function withTx(fn, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const out = await fn(conn);
      await conn.commit();
      return out;
    } catch (e) {
      await conn.rollback().catch(() => {});
      if (attempt < tries && (e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT')) continue;
      throw e;
    } finally {
      conn.release();
    }
  }
}

function portOut(r) {
  const o = {};
  if (r.status && r.status !== 'unknown') o.status = r.status;
  if (r.link_device) o.link = { dev: r.link_device, port: String(r.link_port) };
  for (const k of Object.keys(TEXT_FIELDS)) if (r[k]) o[k] = r[k];
  if (r.verified) o.verified = true;
  if (!Object.keys(o).length) return null;
  if (!o.status) o.status = 'unknown';
  if (r.updated_at) o.updated = String(r.updated_at).slice(0, 10);
  return o;
}
// withRev: dokładny czas ostatniej zmiany portu, którym frontend wykrywa równoczesną edycję.
async function getState(db = pool, withRev = true) {
  const [rks] = await db.query('SELECT * FROM racks ORDER BY sort_order, id');
  const [devs] = await db.query('SELECT * FROM devices ORDER BY sort_order, id');
  const [ports] = await db.query('SELECT * FROM ports');
  const racks = {};
  for (const r of rks) racks[r.id] = { name: r.name, location: r.location || '', notes: r.notes || '', order: r.sort_order };
  const devices = {};
  for (const d of devs) {
    devices[d.id] = {
      rack: d.rack_id, name: d.name, short: d.short, kind: d.kind, portCount: d.port_count, sfp: d.sfp,
      status: d.status, model: d.model || '', notes: d.notes || '', order: d.sort_order, ports: {},
    };
  }
  for (const p of ports) {
    const o = portOut(p);
    if (!o || !devices[p.device_id]) continue;
    if (withRev) o.rev = String(p.updated_at);
    devices[p.device_id].ports[p.port_no] = o;
  }
  return { racks, devices };
}
async function rackOrThrow(db, id) {
  const [[r]] = await db.query('SELECT * FROM racks WHERE id=?', [String(id)]);
  if (!r) throw new HttpError(404, `Nie ma racka „${id}”`);
  return r;
}
function rackFields(b, base = {}) {
  return {
    name: txt(b.name, 120) || base.name || 'Rack',
    location: b.location === undefined ? base.location || '' : txt(b.location, 255) || '',
    notes: b.notes === undefined ? base.notes || '' : b.notes == null ? '' : String(b.notes).slice(0, 5000),
  };
}
// Wolne id na podstawie nazwy: „Serwerownia” → serwerownia, serwerownia-2, …
async function freeId(c, table, name) {
  const base = slug(name);
  for (let id = base, i = 2; ; id = `${base}-${i++}`) {
    const [[x]] = await c.query(`SELECT id FROM ${table} WHERE id=?`, [id]);
    if (!x) return id;
  }
}
async function nextOrder(c, rackId) {
  const [[{ m }]] = await c.query('SELECT COALESCE(MAX(sort_order),0) AS m FROM devices WHERE rack_id=?', [rackId]);
  return m + 10;
}
async function deviceOrThrow(db, id) {
  const [[d]] = await db.query('SELECT * FROM devices WHERE id=?', [id]);
  if (!d) throw new HttpError(404, `Nie ma urządzenia „${id}”`);
  return d;
}
function checkPort(d, n) {
  if (!Number.isInteger(n) || n < 1 || n > d.port_count + d.sfp) throw new HttpError(400, `Port ${n} nie istnieje w ${d.name}`);
}
function deviceFields(b, base = {}) {
  const f = {
    name: txt(b.name, 120) || base.name || 'Bez nazwy',
    short: txt(b.short, 32) || base.short || txt(b.name, 32) || 'DEV',
    kind: KINDS.includes(b.kind) ? b.kind : base.kind || 'patch',
    port_count: int(b.portCount, 1, 96, base.port_count || 24),
    sfp: int(b.sfp, 0, 8, base.sfp || 0),
    status: DEV_STATUS.includes(b.status) ? b.status : base.status || 'active',
    model: b.model === undefined ? base.model || '' : txt(b.model, 120) || '',
    notes: b.notes === undefined ? base.notes || '' : b.notes == null ? '' : String(b.notes).slice(0, 5000),
  };
  return f;
}
async function logHistory(c, dev, n, before, after, by) {
  await c.query('INSERT INTO port_history (device_id,port_no,before_json,after_json,changed_by) VALUES (?,?,?,?,?)',
    [dev, n, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, by]);
}
// Odpina patchcord na porcie dev:n, o ile prowadzi do fromDev:fromN.
// Port zajęty tylko tym patchcordem wraca do „Do ustalenia”, żeby ktoś go sprawdził.
async function detach(c, dev, n, fromDev, fromN, by) {
  const [[r]] = await c.query('SELECT * FROM ports WHERE device_id=? AND port_no=? AND link_device=? AND link_port=? FOR UPDATE',
    [dev, n, fromDev, fromN]);
  if (!r) return;
  const status = r.status === 'used' ? 'unknown' : r.status;
  await c.query('UPDATE ports SET link_device=NULL, link_port=NULL, status=? WHERE device_id=? AND port_no=?', [status, dev, n]);
  await logHistory(c, dev, n, portOut(r), portOut({ ...r, link_device: null, link_port: null, status }), by);
}
// Porządkuje patchcordy po imporcie: usuwa połączenia do nieistniejących portów i dba o to,
// żeby każde było zapisane po obu stronach. Porty urządzeń z `primary` (importowanych) mają pierwszeństwo.
async function normalizeLinks(c, primary = new Set()) {
  const [devs] = await c.query('SELECT id, port_count + sfp AS total FROM devices');
  const total = new Map(devs.map((d) => [d.id, Number(d.total)]));
  const [rows] = await c.query('SELECT device_id, port_no, link_device, link_port FROM ports WHERE link_device IS NOT NULL');
  const key = (d, n) => `${d}#${n}`;
  const links = new Map(rows.map((r) => [key(r.device_id, r.port_no), { dev: r.link_device, port: Number(r.link_port) }]));
  const clear = async (dev, n) => {
    links.delete(key(dev, n));
    await c.query("UPDATE ports SET link_device=NULL, link_port=NULL, status=IF(status='used','unknown',status) WHERE device_id=? AND port_no=?", [dev, n]);
  };
  const connect = async (dev, n, to) => {
    links.set(key(dev, n), to);
    await c.query(`INSERT INTO ports (device_id,port_no,status,link_device,link_port) VALUES (?,?,'used',?,?)
      ON DUPLICATE KEY UPDATE link_device=VALUES(link_device), link_port=VALUES(link_port), status=IF(status IN ('unknown','free'),'used',status)`,
      [dev, n, to.dev, to.port]);
  };

  for (const r of rows) {
    const l = links.get(key(r.device_id, r.port_no));
    const t = l && total.get(l.dev);
    if (l && (!t || l.port < 1 || l.port > t || (l.dev === r.device_id && l.port === r.port_no))) await clear(r.device_id, r.port_no);
  }
  rows.sort((a, b) => primary.has(b.device_id) - primary.has(a.device_id));
  for (const r of rows) {
    const me = { dev: r.device_id, port: r.port_no };
    const l = links.get(key(me.dev, me.port));
    if (!l) continue;
    const back = links.get(key(l.dev, l.port));
    if (back && back.dev === me.dev && back.port === me.port) continue;
    const mine = primary.has(me.dev), theirs = primary.has(l.dev);
    // Drugi koniec wolny: dopisz połączenie, chyba że to on pochodzi z importu i go nie ma.
    // Drugi koniec zajęty innym patchcordem: wygrywa strona z importu, w razie remisu ten port jest odpinany.
    if (back ? !(mine && !theirs) : (theirs && !mine)) { await clear(me.dev, me.port); continue; }
    if (back) {
      const bb = links.get(key(back.dev, back.port));
      if (bb && bb.dev === l.dev && bb.port === l.port) await clear(back.dev, back.port);
    }
    await connect(l.dev, l.port, me);
  }
}

/* ---------- API ---------- */
app.get('/api/health', wrap(async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

app.get('/api/state', wrap(async (req, res) => res.json(await getState())));

app.get('/api/session', (req, res) => res.json({ auth: AUTH_ON, user: req.user || null }));

// Układ z inwentaryzacji (src/template.js). Tylko do zupełnie pustej bazy, bo id urządzeń są stałe.
app.post('/api/seed', wrap(async (req, res) => {
  const b = req.body || {};
  await withTx(async (c) => {
    const [[{ n }]] = await c.query('SELECT COUNT(*) AS n FROM devices');
    if (n > 0) throw new HttpError(409, 'Układ z inwentaryzacji można wczytać tylko do pustej bazy');
    const rackId = b.rack ? (await rackOrThrow(c, b.rack)).id : await ensureDefaultRack(c);
    let order = 10;
    for (const [id, name, short, kind, pc, sfp, status, model, notes] of TEMPLATE) {
      await c.query('INSERT INTO devices (id,rack_id,name,short,kind,port_count,sfp,status,model,notes,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [id, rackId, name, short, kind, pc, sfp, status, model, notes, order]);
      order += 10;
    }
  });
  res.json(await getState());
}));

/* racki */
app.post('/api/racks', wrap(async (req, res) => {
  const f = rackFields(req.body || {});
  const id = await withTx(async (c) => {
    const id = await freeId(c, 'racks', f.name);
    const [[{ m }]] = await c.query('SELECT COALESCE(MAX(sort_order),0) AS m FROM racks');
    await c.query('INSERT INTO racks (id,name,location,notes,sort_order) VALUES (?,?,?,?,?)', [id, f.name, f.location, f.notes, m + 10]);
    return id;
  });
  res.json({ id, ...(await getState()) });
}));

app.put('/api/racks/:id', wrap(async (req, res) => {
  const r = await rackOrThrow(pool, req.params.id);
  const f = rackFields(req.body || {}, r);
  await pool.query('UPDATE racks SET name=?, location=?, notes=? WHERE id=?', [f.name, f.location, f.notes, r.id]);
  res.json(await getState());
}));

// Usuwa tylko pusty rack i nigdy ostatniego. Urządzenia trzeba najpierw przenieść albo usunąć.
app.delete('/api/racks/:id', wrap(async (req, res) => {
  await withTx(async (c) => {
    const r = await rackOrThrow(c, req.params.id);
    const [[{ n }]] = await c.query('SELECT COUNT(*) AS n FROM devices WHERE rack_id=?', [r.id]);
    if (n > 0) throw new HttpError(409, `W racku „${r.name}” są urządzenia (${n}). Przenieś je albo usuń.`);
    const [[{ all }]] = await c.query('SELECT COUNT(*) AS `all` FROM racks');
    if (all <= 1) throw new HttpError(409, 'Musi zostać co najmniej jeden rack');
    await c.query('DELETE FROM racks WHERE id=?', [r.id]);
  });
  res.json(await getState());
}));

app.post('/api/racks/reorder', wrap(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  await withTx(async (c) => {
    for (let i = 0; i < ids.length; i++) await c.query('UPDATE racks SET sort_order=? WHERE id=?', [(i + 1) * 10, String(ids[i])]);
  });
  res.json(await getState());
}));

/* urządzenia */
app.post('/api/devices', wrap(async (req, res) => {
  const b = req.body || {};
  const f = deviceFields(b);
  const id = await withTx(async (c) => {
    const rackId = b.rack ? (await rackOrThrow(c, b.rack)).id : await ensureDefaultRack(c);
    const id = await freeId(c, 'devices', f.short || f.name);
    await c.query('INSERT INTO devices (id,rack_id,name,short,kind,port_count,sfp,status,model,notes,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [id, rackId, f.name, f.short, f.kind, f.port_count, f.sfp, f.status, f.model, f.notes, await nextOrder(c, rackId)]);
    return id;
  });
  res.json({ id, ...(await getState()) });
}));

// Zmniejszenie liczby portów usuwa opis portów poza zakresem i odpina prowadzące do nich patchcordy.
// `rack` przenosi urządzenie do innego racka (na koniec listy); patchcordy zostają.
app.put('/api/devices/:id', wrap(async (req, res) => {
  const b = req.body || {};
  const by = who(req);
  await withTx(async (c) => {
    const d = await deviceOrThrow(c, req.params.id);
    const f = deviceFields(b, d);
    let rackId = d.rack_id, order = d.sort_order;
    if (b.rack !== undefined && String(b.rack) !== d.rack_id) {
      rackId = (await rackOrThrow(c, b.rack)).id;
      order = await nextOrder(c, rackId);
    }
    await c.query('UPDATE devices SET rack_id=?,name=?,short=?,kind=?,port_count=?,sfp=?,status=?,model=?,notes=?,sort_order=? WHERE id=?',
      [rackId, f.name, f.short, f.kind, f.port_count, f.sfp, f.status, f.model, f.notes, order, d.id]);
    const total = f.port_count + f.sfp;
    if (total < d.port_count + d.sfp) {
      const [gone] = await c.query('SELECT port_no, link_device, link_port FROM ports WHERE device_id=? AND port_no>? AND link_device IS NOT NULL',
        [d.id, total]);
      for (const g of gone) await detach(c, g.link_device, g.link_port, d.id, g.port_no, by);
      await c.query('DELETE FROM ports WHERE device_id=? AND port_no>?', [d.id, total]);
    }
  });
  res.json(await getState());
}));

app.delete('/api/devices/:id', wrap(async (req, res) => {
  const by = who(req);
  await withTx(async (c) => {
    const d = await deviceOrThrow(c, req.params.id);
    const [linked] = await c.query('SELECT device_id, port_no, link_port FROM ports WHERE link_device=? AND device_id<>?', [d.id, d.id]);
    for (const p of linked) await detach(c, p.device_id, p.port_no, d.id, p.link_port, by);
    await c.query('DELETE FROM devices WHERE id=?', [d.id]);
  });
  res.json(await getState());
}));

app.post('/api/devices/reorder', wrap(async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
  await withTx(async (c) => {
    for (let i = 0; i < ids.length; i++) await c.query('UPDATE devices SET sort_order=? WHERE id=?', [(i + 1) * 10, String(ids[i])]);
  });
  res.json(await getState());
}));

// Zapis jednego portu. Patchcord (link) zapisuje się po obu stronach w jednej transakcji.
// baseRev (opcjonalnie): wersja portu, od której zaczęła się edycja. Inna wersja w bazie = 409.
app.put('/api/ports/:dev/:n', wrap(async (req, res) => {
  const b = req.body || {};
  const by = who(req);
  await withTx(async (c) => {
    const d = await deviceOrThrow(c, req.params.dev);
    const n = parseInt(req.params.n, 10);
    checkPort(d, n);

    const rec = { status: PORT_STATUS.includes(b.status) ? b.status : 'unknown', verified: b.verified ? 1 : 0 };
    for (const [k, max] of Object.entries(TEXT_FIELDS)) rec[k] = k === 'notes' ? (b.notes ? String(b.notes).slice(0, max) : null) : txt(b[k], max);

    let link = null;
    if (b.link && b.link.dev && b.link.port) {
      const td = await deviceOrThrow(c, String(b.link.dev));
      const tp = parseInt(b.link.port, 10);
      checkPort(td, tp);
      if (td.id === d.id && tp === n) throw new HttpError(400, 'Port nie może być połączony sam ze sobą');
      link = { dev: td.id, port: tp };
    }

    const [[old]] = await c.query('SELECT * FROM ports WHERE device_id=? AND port_no=? FOR UPDATE', [d.id, n]);
    if (b.baseRev !== undefined) {
      const cur = old && portOut(old) ? String(old.updated_at) : null;
      if ((b.baseRev || null) !== cur) {
        throw new HttpError(409, 'Ktoś inny zmienił ten port, kiedy go edytowałeś. Sprawdź aktualne dane i zapisz ponownie.');
      }
    }
    const same = (a, b2) => a && b2 && a.dev === b2.dev && Number(a.port) === Number(b2.port);
    const oldLink = old && old.link_device ? { dev: old.link_device, port: old.link_port } : null;
    const sameLink = same(oldLink, link);

    if (oldLink && !sameLink) await detach(c, oldLink.dev, oldLink.port, d.id, n, by);
    if (link) {
      await c.query('INSERT IGNORE INTO ports (device_id, port_no) VALUES (?,?)', [link.dev, link.port]);
      const [[t]] = await c.query('SELECT * FROM ports WHERE device_id=? AND port_no=? FOR UPDATE', [link.dev, link.port]);
      if (t.link_device && !(t.link_device === d.id && Number(t.link_port) === n)) {
        await detach(c, t.link_device, t.link_port, link.dev, link.port, by);
      }
      // Nowy patchcord przejmuje opis kabla z drugiego końca, jeśli tu go nie podano.
      // Przy istniejącym patchcordzie zmiana (także wyczyszczenie) przechodzi na drugi koniec.
      if (!sameLink) for (const k of CORD_FIELDS) if (rec[k] == null) rec[k] = t[k] || null;
      const tAfter = { ...t, link_device: d.id, link_port: n, status: ['unknown', 'free'].includes(t.status) ? 'used' : t.status };
      for (const k of CORD_FIELDS) tAfter[k] = rec[k];
      await c.query('UPDATE ports SET link_device=?, link_port=?, status=?, color=?, length=?, cord=? WHERE device_id=? AND port_no=?',
        [d.id, n, tAfter.status, rec.color, rec.length, rec.cord, link.dev, link.port]);
      const tb = portOut(t), ta = portOut(tAfter);
      if (JSON.stringify(tb) !== JSON.stringify(ta)) await logHistory(c, link.dev, link.port, tb, ta, by);
    }

    await c.query(
      `INSERT INTO ports (device_id,port_no,status,link_device,link_port,color,length,cord,dest,endpoint,vlan,plan,notes,verified)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status), link_device=VALUES(link_device), link_port=VALUES(link_port),
         color=VALUES(color), length=VALUES(length), cord=VALUES(cord), dest=VALUES(dest), endpoint=VALUES(endpoint),
         vlan=VALUES(vlan), plan=VALUES(plan), notes=VALUES(notes), verified=VALUES(verified), updated_at=CURRENT_TIMESTAMP`,
      [d.id, n, rec.status, link ? link.dev : null, link ? link.port : null, rec.color, rec.length, rec.cord,
        rec.dest, rec.endpoint, rec.vlan, rec.plan, rec.notes, rec.verified]);

    await logHistory(c, d.id, n, old ? portOut(old) : null, { ...rec, link }, by);
  });
  res.json(await getState());
}));

// Hurtowa zmiana statusu albo weryfikacji. Status „Wolny” odpina patchcord po obu stronach.
app.post('/api/ports/bulk', wrap(async (req, res) => {
  const b = req.body || {};
  const ports = Array.isArray(b.ports) ? [...new Set(b.ports.map((x) => parseInt(x, 10)))] : [];
  const status = PORT_STATUS.includes(b.status) ? b.status : null;
  if (!status && !b.verified) throw new HttpError(400, 'Podaj status albo verified');
  const by = who(req);
  await withTx(async (c) => {
    const d = await deviceOrThrow(c, String(b.dev));
    for (const n of ports) {
      checkPort(d, n);
      const [[old]] = await c.query('SELECT * FROM ports WHERE device_id=? AND port_no=? FOR UPDATE', [d.id, n]);
      const base = old || { device_id: d.id, port_no: n };
      let after;
      if (status) {
        const unlink = status === 'free' && old && old.link_device;
        if (unlink) await detach(c, old.link_device, old.link_port, d.id, n, by);
        await c.query(`INSERT INTO ports (device_id,port_no,status) VALUES (?,?,?)
          ON DUPLICATE KEY UPDATE status=VALUES(status)${unlink ? ', link_device=NULL, link_port=NULL' : ''}, updated_at=CURRENT_TIMESTAMP`,
          [d.id, n, status]);
        after = { ...base, status, ...(unlink ? { link_device: null, link_port: null } : {}) };
      } else {
        await c.query('INSERT INTO ports (device_id,port_no,verified) VALUES (?,?,1) ON DUPLICATE KEY UPDATE verified=1, updated_at=CURRENT_TIMESTAMP', [d.id, n]);
        after = { ...base, verified: 1 };
      }
      await logHistory(c, d.id, n, old ? portOut(old) : null, portOut(after), by);
    }
  });
  res.json(await getState());
}));

app.get('/api/ports/:dev/:n/history', wrap(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT before_json, after_json, changed_by, changed_at FROM port_history WHERE device_id=? AND port_no=? ORDER BY id DESC LIMIT 30',
    [req.params.dev, parseInt(req.params.n, 10)]);
  res.json(rows.map((r) => ({ before: r.before_json ? JSON.parse(r.before_json) : null, after: r.after_json ? JSON.parse(r.after_json) : null, by: r.changed_by, at: r.changed_at })));
}));

/* ---------- eksport / import ---------- */
function label(devs, id, n) {
  const d = devs[id]; if (!d) return '?';
  const s = d.short || d.name;
  return (d.kind === 'patch' || d.kind === 'fiber') ? (s.length <= 2 ? s + n : `${s}-${n}`) : `${s}:${n}`;
}
const stamp = () => new Date().toISOString().slice(0, 10);

app.get('/api/export.csv', wrap(async (req, res) => {
  const { racks, devices } = await getState(pool, false);
  const rackName = (id) => (racks[id] ? racks[id].name : '');
  // Patchcord do innego racka: z nazwą tamtego racka.
  const linkLabel = (fromDev, l) => {
    const t = devices[l.dev];
    const s = label(devices, l.dev, l.port);
    return t && t.rack !== devices[fromDev].rack ? `${rackName(t.rack)} › ${s}` : s;
  };
  const cell = (v) => {
    v = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; // Excel nie potraktuje tekstu jak formuły
    return /[";\n\r,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const rows = [['Rack', 'Urządzenie', 'Port', 'Etykieta', 'Status', 'Patchcord do', 'Dokąd prowadzi', 'Urządzenie końcowe', 'VLAN', 'Kolor', 'Długość', 'Etykieta kabla', 'Zweryfikowany', 'Plan', 'Notatki', 'Zmiana']];
  for (const [id, d] of Object.entries(devices)) {
    for (let n = 1; n <= d.portCount + d.sfp; n++) {
      const r = d.ports[n] || {};
      rows.push([rackName(d.rack), d.name, n, label(devices, id, n), STATUS_PL[r.status || 'unknown'], r.link ? linkLabel(id, r.link) : '',
        r.dest, r.endpoint, r.vlan, r.color, r.length, r.cord, r.verified ? 'tak' : '', r.plan, r.notes, r.updated]);
    }
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="rack-inwentaryzacja-${stamp()}.csv"`);
  res.send('﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n'));
}));

app.get('/api/export.json', wrap(async (req, res) => {
  const state = await getState(pool, false);
  res.set('Content-Disposition', `attachment; filename="rack-kopia-${stamp()}.json"`);
  res.json({ exported: new Date().toISOString(), ...state });
}));

// Import kopii JSON (także z wersji-artefaktu Claude). Nadpisuje racki i urządzenia o tych samych id,
// a potem porządkuje patchcordy (oba końce, istniejące porty).
// Urządzenie bez racka (kopie sprzed wielu racków) zostaje w swoim racku albo trafia do `rack` z zapytania.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
app.post('/api/import', wrap(async (req, res) => {
  const body = req.body || {};
  const data = body.devices || body;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Niepoprawna kopia JSON');
  const entries = Object.entries(data).filter(([id, d]) => ID_RE.test(id) && d && typeof d === 'object' && id !== 'racks');
  const rackEntries = body.racks && typeof body.racks === 'object' && !Array.isArray(body.racks)
    ? Object.entries(body.racks).filter(([id, r]) => ID_RE.test(id) && r && typeof r === 'object') : [];
  await withTx(async (c) => {
    for (const [id, r] of rackEntries) {
      const f = rackFields(r);
      await c.query(`INSERT INTO racks (id,name,location,notes,sort_order) VALUES (?,?,?,?,?)
        ON DUPLICATE KEY UPDATE name=VALUES(name), location=VALUES(location), notes=VALUES(notes), sort_order=VALUES(sort_order)`,
        [id, f.name, f.location, f.notes, Number.isFinite(r.order) ? r.order : 0]);
    }
    const [rks] = await c.query('SELECT id FROM racks');
    const rackIds = new Set(rks.map((r) => r.id));
    const fallback = rackIds.has(String(body.rack)) ? String(body.rack) : await ensureDefaultRack(c);
    let i = 0;
    for (const [id, d] of entries) {
      const f = deviceFields(d);
      const order = Number.isFinite(d.order) ? d.order : (++i) * 10;
      const [[cur]] = await c.query('SELECT rack_id FROM devices WHERE id=?', [id]);
      const rackId = rackIds.has(String(d.rack)) ? String(d.rack) : cur ? cur.rack_id : fallback;
      await c.query(
        `INSERT INTO devices (id,rack_id,name,short,kind,port_count,sfp,status,model,notes,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE rack_id=VALUES(rack_id), name=VALUES(name), short=VALUES(short), kind=VALUES(kind), port_count=VALUES(port_count),
           sfp=VALUES(sfp), status=VALUES(status), model=VALUES(model), notes=VALUES(notes), sort_order=VALUES(sort_order)`,
        [id, rackId, f.name, f.short, f.kind, f.port_count, f.sfp, f.status, f.model, f.notes, order]);
      await c.query('DELETE FROM ports WHERE device_id=?', [id]);
      for (const [pn, p] of Object.entries(d.ports || {})) {
        const n = parseInt(pn, 10);
        if (!Number.isInteger(n) || n < 1 || n > f.port_count + f.sfp || !p || typeof p !== 'object') continue;
        const lk = p.link && p.link.dev && p.link.port ? p.link : null;
        await c.query(
          'INSERT INTO ports (device_id,port_no,status,link_device,link_port,color,length,cord,dest,endpoint,vlan,plan,notes,verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [id, n, PORT_STATUS.includes(p.status) ? p.status : 'unknown', lk ? String(lk.dev).slice(0, 64) : null, lk ? int(lk.port, 0, 65535, null) : null,
            txt(p.color, 40), txt(p.length, 20), txt(p.cord, 120), txt(p.dest, 255), txt(p.endpoint, 255), txt(p.vlan, 40), txt(p.plan, 255),
            p.notes ? String(p.notes).slice(0, 5000) : null, p.verified ? 1 : 0]);
      }
    }
    await normalizeLinks(c, new Set(entries.map(([id]) => id)));
  });
  res.json({ imported: entries.length, importedRacks: rackEntries.length, ...(await getState()) });
}));

/* ---------- błędy ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Nie ma takiego adresu API' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Błąd serwera. Szczegóły są w logu aplikacji.' : err.message });
});

/* ---------- porządki w tle ---------- */
async function housekeeping() {
  const now = Date.now();
  for (const [ip, f] of authFails) if (now >= f.reset) authFails.delete(ip);
  if (HISTORY_DAYS > 0) {
    await pool.query('DELETE FROM port_history WHERE changed_at < NOW() - INTERVAL ? DAY', [HISTORY_DAYS])
      .catch((e) => console.error('Czyszczenie historii nie powiodło się:', e.message));
  }
}
setInterval(housekeeping, 60 * 60 * 1000).unref();

// Najpierw schemat i migracje bazy, potem nasłuch.
runMigrations(config).then(() => {
  app.listen(PORT, HOST, () => {
    console.log(`Rack Inventory działa na http://${HOST}:${PORT}`);
    housekeeping();
  });
}).catch((e) => {
  console.error('Nie udało się przygotować bazy danych:', e.message);
  process.exit(1);
});
