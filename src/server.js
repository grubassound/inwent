// Rack Inventory · serwer HTTP + REST API (Express + MySQL)
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { pool } = require('./db');
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

/* ---------- opcjonalne logowanie (HTTP Basic) ---------- */
const AUTH_MAX_FAILS = 10;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const authFails = new Map(); // ip -> { n, reset }

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
if (AUTH_USER && AUTH_PASSWORD) {
  app.use((req, res, next) => {
    const now = Date.now();
    const f = authFails.get(req.ip);
    if (f && f.n >= AUTH_MAX_FAILS && now < f.reset) {
      res.set('Retry-After', String(Math.ceil((f.reset - now) / 1000)));
      return res.status(429).send('Za dużo nieudanych prób logowania. Spróbuj ponownie za kilka minut.');
    }
    const h = req.headers.authorization || '';
    if (h.startsWith('Basic ')) {
      const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
      if (safeEqual(u, AUTH_USER) && safeEqual(rest.join(':'), AUTH_PASSWORD)) {
        authFails.delete(req.ip);
        req.user = u;
        return next();
      }
      if (!f || now >= f.reset) authFails.set(req.ip, { n: 1, reset: now + AUTH_WINDOW_MS });
      else f.n++;
    }
    res.set('WWW-Authenticate', 'Basic realm="Rack Inventory", charset="UTF-8"').status(401).send('Wymagane logowanie');
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
  const [devs] = await db.query('SELECT * FROM devices ORDER BY sort_order, id');
  const [ports] = await db.query('SELECT * FROM ports');
  const devices = {};
  for (const d of devs) {
    devices[d.id] = {
      name: d.name, short: d.short, kind: d.kind, portCount: d.port_count, sfp: d.sfp,
      status: d.status, model: d.model || '', notes: d.notes || '', order: d.sort_order, ports: {},
    };
  }
  for (const p of ports) {
    const o = portOut(p);
    if (!o || !devices[p.device_id]) continue;
    if (withRev) o.rev = String(p.updated_at);
    devices[p.device_id].ports[p.port_no] = o;
  }
  return { devices };
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

app.post('/api/seed', wrap(async (req, res) => {
  await withTx(async (c) => {
    const [[{ n }]] = await c.query('SELECT COUNT(*) AS n FROM devices');
    if (n > 0) throw new HttpError(409, 'Rack nie jest pusty');
    let order = 10;
    for (const [id, name, short, kind, pc, sfp, status, model, notes] of TEMPLATE) {
      await c.query('INSERT INTO devices (id,name,short,kind,port_count,sfp,status,model,notes,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [id, name, short, kind, pc, sfp, status, model, notes, order]);
      order += 10;
    }
  });
  res.json(await getState());
}));

app.post('/api/devices', wrap(async (req, res) => {
  const f = deviceFields(req.body || {});
  const id = await withTx(async (c) => {
    let id = slug(f.short || f.name), i = 2;
    for (;;) {
      const [[x]] = await c.query('SELECT id FROM devices WHERE id=?', [id]);
      if (!x) break;
      id = `${slug(f.short || f.name)}-${i++}`;
    }
    const [[{ m }]] = await c.query('SELECT COALESCE(MAX(sort_order),0) AS m FROM devices');
    await c.query('INSERT INTO devices (id,name,short,kind,port_count,sfp,status,model,notes,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, f.name, f.short, f.kind, f.port_count, f.sfp, f.status, f.model, f.notes, m + 10]);
    return id;
  });
  res.json({ id, ...(await getState()) });
}));

// Zmniejszenie liczby portów usuwa opis portów poza zakresem i odpina prowadzące do nich patchcordy.
app.put('/api/devices/:id', wrap(async (req, res) => {
  const by = who(req);
  await withTx(async (c) => {
    const d = await deviceOrThrow(c, req.params.id);
    const f = deviceFields(req.body || {}, d);
    await c.query('UPDATE devices SET name=?,short=?,kind=?,port_count=?,sfp=?,status=?,model=?,notes=? WHERE id=?',
      [f.name, f.short, f.kind, f.port_count, f.sfp, f.status, f.model, f.notes, d.id]);
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
  const { devices } = await getState(pool, false);
  const cell = (v) => {
    v = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; // Excel nie potraktuje tekstu jak formuły
    return /[";\n\r,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const rows = [['Urządzenie', 'Port', 'Etykieta', 'Status', 'Patchcord do', 'Dokąd prowadzi', 'Urządzenie końcowe', 'VLAN', 'Kolor', 'Długość', 'Etykieta kabla', 'Zweryfikowany', 'Plan', 'Notatki', 'Zmiana']];
  for (const [id, d] of Object.entries(devices)) {
    for (let n = 1; n <= d.portCount + d.sfp; n++) {
      const r = d.ports[n] || {};
      rows.push([d.name, n, label(devices, id, n), STATUS_PL[r.status || 'unknown'], r.link ? label(devices, r.link.dev, r.link.port) : '',
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

// Import kopii JSON (także z wersji-artefaktu Claude). Nadpisuje urządzenia o tych samych id,
// a potem porządkuje patchcordy (oba końce, istniejące porty).
app.post('/api/import', wrap(async (req, res) => {
  const data = (req.body && (req.body.devices || req.body)) || {};
  if (typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Niepoprawna kopia JSON');
  const entries = Object.entries(data).filter(([id, d]) => /^[A-Za-z0-9_-]{1,64}$/.test(id) && d && typeof d === 'object');
  await withTx(async (c) => {
    let i = 0;
    for (const [id, d] of entries) {
      const f = deviceFields(d);
      const order = Number.isFinite(d.order) ? d.order : (++i) * 10;
      await c.query(
        `INSERT INTO devices (id,name,short,kind,port_count,sfp,status,model,notes,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE name=VALUES(name), short=VALUES(short), kind=VALUES(kind), port_count=VALUES(port_count),
           sfp=VALUES(sfp), status=VALUES(status), model=VALUES(model), notes=VALUES(notes), sort_order=VALUES(sort_order)`,
        [id, f.name, f.short, f.kind, f.port_count, f.sfp, f.status, f.model, f.notes, order]);
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
  res.json({ imported: entries.length, ...(await getState()) });
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

app.listen(PORT, HOST, () => {
  console.log(`Rack Inventory działa na http://${HOST}:${PORT}`);
  housekeeping();
});
