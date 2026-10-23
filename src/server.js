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

const KINDS = ['patch', 'switch', 'fiber', 'other'];
const DEV_STATUS = ['active', 'unused', 'remove'];
const PORT_STATUS = ['unknown', 'used', 'free', 'reserved', 'broken'];
const TEXT_FIELDS = { color: 40, length: 20, cord: 120, dest: 255, endpoint: 255, vlan: 40, plan: 255, notes: 5000 };
const STATUS_PL = { unknown: 'Do ustalenia', used: 'Zajęty', free: 'Wolny', reserved: 'Rezerwacja', broken: 'Uszkodzony' };

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

/* ---------- opcjonalne logowanie (HTTP Basic) ---------- */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
if (AUTH_USER && AUTH_PASSWORD) {
  app.use((req, res, next) => {
    const h = req.headers.authorization || '';
    if (h.startsWith('Basic ')) {
      const [u, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':');
      if (safeEqual(u, AUTH_USER) && safeEqual(rest.join(':'), AUTH_PASSWORD)) { req.user = u; return next(); }
    }
    res.set('WWW-Authenticate', 'Basic realm="Rack Inventory", charset="UTF-8"').status(401).send('Wymagane logowanie');
  });
}

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

/* ---------- pomocnicze ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const who = (req) => (req.user || req.headers['x-forwarded-for'] || req.ip || '').toString().slice(0, 64);

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
async function withTx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
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
async function getState(db = pool) {
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
    if (o && devices[p.device_id]) devices[p.device_id].ports[p.port_no] = o;
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
    model: txt(b.model, 120) || '',
    notes: b.notes == null ? '' : String(b.notes).slice(0, 5000),
  };
  return f;
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

app.put('/api/devices/:id', wrap(async (req, res) => {
  const d = await deviceOrThrow(pool, req.params.id);
  const f = deviceFields(req.body || {}, d);
  await pool.query('UPDATE devices SET name=?,short=?,kind=?,port_count=?,sfp=?,status=?,model=?,notes=? WHERE id=?',
    [f.name, f.short, f.kind, f.port_count, f.sfp, f.status, f.model, f.notes, d.id]);
  res.json(await getState());
}));

app.delete('/api/devices/:id', wrap(async (req, res) => {
  await withTx(async (c) => {
    const d = await deviceOrThrow(c, req.params.id);
    await c.query('UPDATE ports SET link_device=NULL, link_port=NULL WHERE link_device=?', [d.id]);
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
app.put('/api/ports/:dev/:n', wrap(async (req, res) => {
  const b = req.body || {};
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
    const same = (a, b2) => a && b2 && a.dev === b2.dev && Number(a.port) === Number(b2.port);
    const oldLink = old && old.link_device ? { dev: old.link_device, port: old.link_port } : null;

    if (oldLink && !same(oldLink, link)) {
      await c.query('UPDATE ports SET link_device=NULL, link_port=NULL WHERE device_id=? AND port_no=? AND link_device=? AND link_port=?',
        [oldLink.dev, oldLink.port, d.id, n]);
    }
    if (link) {
      await c.query('INSERT IGNORE INTO ports (device_id, port_no) VALUES (?,?)', [link.dev, link.port]);
      const [[t]] = await c.query('SELECT * FROM ports WHERE device_id=? AND port_no=? FOR UPDATE', [link.dev, link.port]);
      if (t.link_device && !(t.link_device === d.id && Number(t.link_port) === n)) {
        await c.query('UPDATE ports SET link_device=NULL, link_port=NULL WHERE device_id=? AND port_no=? AND link_device=? AND link_port=?',
          [t.link_device, t.link_port, link.dev, link.port]);
      }
      const tStatus = ['unknown', 'free'].includes(t.status) ? 'used' : t.status;
      await c.query('UPDATE ports SET link_device=?, link_port=?, status=?, color=COALESCE(?,color), length=COALESCE(?,length), cord=COALESCE(?,cord) WHERE device_id=? AND port_no=?',
        [d.id, n, tStatus, rec.color, rec.length, rec.cord, link.dev, link.port]);
    }

    await c.query(
      `INSERT INTO ports (device_id,port_no,status,link_device,link_port,color,length,cord,dest,endpoint,vlan,plan,notes,verified)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE status=VALUES(status), link_device=VALUES(link_device), link_port=VALUES(link_port),
         color=VALUES(color), length=VALUES(length), cord=VALUES(cord), dest=VALUES(dest), endpoint=VALUES(endpoint),
         vlan=VALUES(vlan), plan=VALUES(plan), notes=VALUES(notes), verified=VALUES(verified), updated_at=CURRENT_TIMESTAMP`,
      [d.id, n, rec.status, link ? link.dev : null, link ? link.port : null, rec.color, rec.length, rec.cord,
        rec.dest, rec.endpoint, rec.vlan, rec.plan, rec.notes, rec.verified]);

    const after = { ...rec, link };
    await c.query('INSERT INTO port_history (device_id,port_no,before_json,after_json,changed_by) VALUES (?,?,?,?,?)',
      [d.id, n, old ? JSON.stringify(portOut(old)) : null, JSON.stringify(after), who(req)]);
  });
  res.json(await getState());
}));

app.post('/api/ports/bulk', wrap(async (req, res) => {
  const b = req.body || {};
  const ports = Array.isArray(b.ports) ? b.ports.map((x) => parseInt(x, 10)) : [];
  const status = PORT_STATUS.includes(b.status) ? b.status : null;
  if (!status && !b.verified) throw new HttpError(400, 'Podaj status albo verified');
  await withTx(async (c) => {
    const d = await deviceOrThrow(c, String(b.dev));
    for (const n of ports) {
      checkPort(d, n);
      if (status) {
        await c.query('INSERT INTO ports (device_id,port_no,status) VALUES (?,?,?) ON DUPLICATE KEY UPDATE status=VALUES(status), updated_at=CURRENT_TIMESTAMP', [d.id, n, status]);
      } else {
        await c.query('INSERT INTO ports (device_id,port_no,verified) VALUES (?,?,1) ON DUPLICATE KEY UPDATE verified=1, updated_at=CURRENT_TIMESTAMP', [d.id, n]);
      }
      await c.query('INSERT INTO port_history (device_id,port_no,before_json,after_json,changed_by) VALUES (?,?,?,?,?)',
        [d.id, n, null, JSON.stringify(status ? { status } : { verified: true }), who(req)]);
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
  const { devices } = await getState();
  const cell = (v) => { v = String(v ?? ''); return /[";\n,]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
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
  const state = await getState();
  res.set('Content-Disposition', `attachment; filename="rack-kopia-${stamp()}.json"`);
  res.json({ exported: new Date().toISOString(), ...state });
}));

// Import kopii JSON (także z wersji-artefaktu Claude). Nadpisuje urządzenia o tych samych id.
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
        if (!Number.isInteger(n) || n < 1 || n > f.port_count + f.sfp || !p) continue;
        const lk = p.link && p.link.dev && p.link.port ? p.link : null;
        await c.query(
          'INSERT INTO ports (device_id,port_no,status,link_device,link_port,color,length,cord,dest,endpoint,vlan,plan,notes,verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          [id, n, PORT_STATUS.includes(p.status) ? p.status : 'unknown', lk ? String(lk.dev) : null, lk ? parseInt(lk.port, 10) || null : null,
            txt(p.color, 40), txt(p.length, 20), txt(p.cord, 120), txt(p.dest, 255), txt(p.endpoint, 255), txt(p.vlan, 40), txt(p.plan, 255),
            p.notes ? String(p.notes).slice(0, 5000) : null, p.verified ? 1 : 0]);
      }
    }
  });
  res.json({ imported: entries.length, ...(await getState()) });
}));

/* ---------- błędy ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Nie ma takiego adresu API' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Błąd serwera: ' + (err.code || err.message) : err.message });
});

app.listen(PORT, HOST, () => console.log(`Rack Inventory działa na http://${HOST}:${PORT}`));
