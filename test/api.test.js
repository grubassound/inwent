// Testy API na prawdziwej bazie MySQL/MariaDB. Uruchomienie:
//   TEST_DB_NAME=rack_test TEST_DB_USER=rack TEST_DB_PASSWORD=… npm test
// UWAGA: testy czyszczą wszystkie tabele w bazie TEST_DB_NAME, dlatego jej nazwa musi zawierać „test”.
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const { migrate } = require('../src/migrate');

const DB = {
  host: process.env.TEST_DB_HOST || '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT || 3306),
  user: process.env.TEST_DB_USER || 'rack',
  password: process.env.TEST_DB_PASSWORD || '',
  database: process.env.TEST_DB_NAME || '',
};
const skip = /test/i.test(DB.database) ? false : 'ustaw TEST_DB_NAME (nazwa bazy musi zawierać „test”)';
const it = (name, fn) => test(name, { skip }, fn);
const ROOT = path.join(__dirname, '..');
const BASE_PORT = Number(process.env.TEST_PORT || 39080);

let conn, server, base;

function startServer(port, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    env: {
      ...process.env, HOST: '127.0.0.1', PORT: String(port), DB_HOST: DB.host, DB_PORT: String(DB.port), DB_USER: DB.user,
      DB_PASSWORD: DB.password, DB_NAME: DB.database, DB_SOCKET: '', AUTH_USER: '', AUTH_PASSWORD: '', ...extraEnv,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return child;
}
async function waitUp(url, headers = {}) {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(url + '/api/health', { headers }); if (r.ok) return; } catch (e) { /* jeszcze startuje */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Serwer nie wystartował');
}
async function api(method, url, body) {
  const res = await fetch(base + url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch (e) { /* CSV */ }
  return { status: res.status, data };
}
async function addDevice(body) {
  const r = await api('POST', '/api/devices', body);
  assert.equal(r.status, 200);
  return r.data.id;
}
const state = async () => (await api('GET', '/api/state')).data.devices;
const port = async (dev, n) => (await state())[dev].ports[n];
const history = async (dev, n) => (await api('GET', `/api/ports/${dev}/${n}/history`)).data;

before(async () => {
  if (skip) return;
  conn = await mysql.createConnection({ ...DB, multipleStatements: true });
  await conn.query(fs.readFileSync(path.join(ROOT, 'sql', 'schema.sql'), 'utf8'));
  server = startServer(BASE_PORT);
  base = `http://127.0.0.1:${BASE_PORT}`;
  await waitUp(base);
});
after(async () => {
  if (server) server.kill();
  if (conn) await conn.end();
});
beforeEach(async () => {
  if (skip) return;
  await conn.query('DELETE FROM ports; DELETE FROM port_history; DELETE FROM devices; DELETE FROM racks;');
});

it('patchcord zapisuje się po obu stronach, a przepięcie zwalnia stary koniec', async () => {
  const a = await addDevice({ name: 'Patchpanel A', short: 'A', kind: 'patch', portCount: 24 });
  const sw = await addDevice({ name: 'Switch 1', short: 'SW1', kind: 'switch', portCount: 8, sfp: 2 });

  await api('PUT', `/api/ports/${a}/1`, { status: 'used', link: { dev: sw, port: '3' } });
  assert.deepEqual((await port(sw, 3)).link, { dev: a, port: '1' });
  assert.equal((await port(sw, 3)).status, 'used');

  await api('PUT', `/api/ports/${a}/1`, { status: 'used', link: { dev: sw, port: '4' } });
  const s = await state();
  assert.equal(s[sw].ports[3], undefined, 'stary koniec bez patchcorda i bez statusu „Zajęty”');
  assert.deepEqual(s[sw].ports[4].link, { dev: a, port: '1' });
  assert.equal((await history(sw, 3)).length, 2, 'odpięcie widać w historii drugiego końca');
});

it('opis kabla jest wspólny dla obu końców', async () => {
  const a = await addDevice({ name: 'A', short: 'A', portCount: 24 });
  const b = await addDevice({ name: 'B', short: 'B', portCount: 24 });
  await api('PUT', `/api/ports/${b}/5`, { status: 'used', color: 'czerwony', length: '2' });

  await api('PUT', `/api/ports/${a}/1`, { status: 'used', link: { dev: b, port: '5' } });
  assert.equal((await port(a, 1)).color, 'czerwony', 'nowy patchcord przejmuje kolor z drugiego końca');

  await api('PUT', `/api/ports/${a}/1`, { status: 'used', link: { dev: b, port: '5' }, length: '2' });
  assert.equal((await port(b, 5)).color, undefined, 'wyczyszczenie koloru przechodzi na drugi koniec');
  assert.equal((await port(b, 5)).length, '2');
});

it('zmniejszenie liczby portów usuwa porty spoza zakresu i odpina patchcordy', async () => {
  const a = await addDevice({ name: 'A', short: 'A', portCount: 24 });
  const sw = await addDevice({ name: 'SW', short: 'SW', kind: 'switch', portCount: 24 });
  await api('PUT', `/api/ports/${a}/20`, { status: 'used', dest: 'Biuro', link: { dev: sw, port: '1' } });
  await api('PUT', `/api/ports/${a}/2`, { status: 'used', dest: 'Pokój 2' });

  const r = await api('PUT', `/api/devices/${a}`, { portCount: 12 });
  assert.equal(r.status, 200);
  const s = await state();
  assert.equal(s[a].ports[20], undefined);
  assert.equal(s[a].ports[2].dest, 'Pokój 2', 'porty w zakresie zostają');
  assert.equal(s[sw].ports[1], undefined, 'patchcord do usuniętego portu odpięty');
  assert.equal(s[a].model, '', 'częściowa edycja nie wymaga wszystkich pól');

  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM ports WHERE device_id=? AND port_no>12', [a]);
  assert.equal(row.n, 0);
});

it('częściowa edycja urządzenia nie kasuje modelu ani notatek', async () => {
  const a = await addDevice({ name: 'A', short: 'A', model: 'Legrand', notes: 'góra szafy' });
  await api('PUT', `/api/devices/${a}`, { name: 'A nowy' });
  const d = (await state())[a];
  assert.equal(d.model, 'Legrand');
  assert.equal(d.notes, 'góra szafy');
});

it('usunięcie urządzenia odpina patchcordy po drugiej stronie', async () => {
  const a = await addDevice({ name: 'A', short: 'A' });
  const b = await addDevice({ name: 'B', short: 'B' });
  await api('PUT', `/api/ports/${a}/1`, { status: 'used', dest: 'Biuro', link: { dev: b, port: '1' } });
  await api('DELETE', `/api/devices/${b}`);
  const p = await port(a, 1);
  assert.equal(p.link, undefined);
  assert.equal(p.status, 'unknown');
  assert.equal(p.dest, 'Biuro');
});

it('import usuwa błędne patchcordy i uzupełnia jednostronne', async () => {
  const r = await api('POST', '/api/import', {
    devices: {
      a: { name: 'A', short: 'A', kind: 'patch', portCount: 24, ports: {
        1: { status: 'used', link: { dev: 'b', port: '2' } },       // jednostronny → dopisany w b:2
        2: { status: 'used', link: { dev: 'nie-ma', port: '1' } },  // nieistniejące urządzenie
        3: { status: 'used', link: { dev: 'b', port: '99' } },      // port poza zakresem
        4: { status: 'used', link: { dev: 'a', port: '4' } },       // sam ze sobą
      } },
      b: { name: 'B', short: 'B', kind: 'patch', portCount: 24, ports: {} },
    },
  });
  assert.equal(r.status, 200);
  const s = r.data.devices;
  assert.deepEqual(s.b.ports[2].link, { dev: 'a', port: '1' });
  for (const n of [2, 3, 4]) assert.equal(s.a.ports[n], undefined, `a:${n} bez patchcorda`);
});

it('import wygrywa z patchcordami spoza importu', async () => {
  const c = await addDevice({ name: 'C', short: 'C' });
  await api('POST', '/api/import', { devices: { a: { name: 'A', short: 'A', portCount: 24 } } });
  await api('PUT', `/api/ports/${c}/1`, { status: 'used', link: { dev: 'a', port: '1' } });

  // Kopia, w której a:1 nie ma patchcorda: c:1 ma zostać odpięty, a nie a:1 dopięty z powrotem.
  const r = await api('POST', '/api/import', { devices: { a: { name: 'A', short: 'A', portCount: 24, ports: {} } } });
  assert.equal(r.data.devices[c].ports[1], undefined);
  assert.equal(r.data.devices.a.ports[1], undefined);
});

it('równoczesna edycja portu kończy się 409, a zapis z aktualną wersją przechodzi', async () => {
  const a = await addDevice({ name: 'A', short: 'A' });
  await api('PUT', `/api/ports/${a}/1`, { status: 'used', dest: 'Biuro' });
  const rev = (await port(a, 1)).rev;
  assert.ok(rev);

  await conn.query('UPDATE ports SET dest=?, updated_at=updated_at + INTERVAL 1 SECOND WHERE device_id=? AND port_no=1', ['Magazyn', a]);
  const stale = await api('PUT', `/api/ports/${a}/1`, { status: 'used', dest: 'Biuro 2', baseRev: rev });
  assert.equal(stale.status, 409);
  assert.equal((await port(a, 1)).dest, 'Magazyn');

  const fresh = await api('PUT', `/api/ports/${a}/1`, { status: 'used', dest: 'Biuro 2', baseRev: (await port(a, 1)).rev });
  assert.equal(fresh.status, 200);
  assert.equal((await port(a, 2)), undefined);
  assert.equal((await api('PUT', `/api/ports/${a}/2`, { status: 'free', baseRev: null })).status, 200, 'nowy port: baseRev=null');
  assert.equal((await api('PUT', `/api/ports/${a}/3`, { status: 'free' })).status, 200, 'bez baseRev bez sprawdzania');
});

it('hurtowe „Wolny” odpina patchcordy i zapisuje stan sprzed zmiany', async () => {
  const a = await addDevice({ name: 'A', short: 'A' });
  const b = await addDevice({ name: 'B', short: 'B' });
  await api('PUT', `/api/ports/${a}/1`, { status: 'used', link: { dev: b, port: '1' } });

  const r = await api('POST', '/api/ports/bulk', { dev: a, ports: [1, 2], status: 'free' });
  assert.equal(r.status, 200);
  const s = r.data.devices;
  assert.equal(s[a].ports[1].status, 'free');
  assert.equal(s[a].ports[1].link, undefined);
  assert.equal(s[b].ports[1], undefined);
  const h = await history(a, 1);
  assert.equal(h[0].before.status, 'used');
  assert.equal(h[0].after.status, 'free');
});

it('eksport CSV neutralizuje formuły Excela', async () => {
  const a = await addDevice({ name: 'A', short: 'A' });
  await api('PUT', `/api/ports/${a}/1`, { status: 'used', dest: '=HYPERLINK("http://x")' });
  const { data } = await api('GET', '/api/export.csv');
  assert.ok(data.includes(`"'=HYPERLINK(""http://x"")"`));
});

it('błąd serwera nie ujawnia szczegółów bazy', async () => {
  await conn.query('RENAME TABLE port_history TO port_history_tmp');
  try {
    const a = await addDevice({ name: 'A', short: 'A' });
    const r = await api('PUT', `/api/ports/${a}/1`, { status: 'used' });
    assert.equal(r.status, 500);
    assert.doesNotMatch(r.data.error, /port_history|ER_/);
  } finally {
    await conn.query('RENAME TABLE port_history_tmp TO port_history');
  }
});

it('migracja: baza sprzed wielu racków dostaje rack-1 z wszystkimi urządzeniami', async () => {
  await conn.query('DROP TABLE ports; DROP TABLE port_history; DROP TABLE devices; DROP TABLE racks;');
  await conn.query(`CREATE TABLE devices (id VARCHAR(64) NOT NULL, name VARCHAR(120) NOT NULL, short VARCHAR(32) NOT NULL,
      kind ENUM('patch','switch','fiber','other') NOT NULL DEFAULT 'patch', port_count SMALLINT UNSIGNED NOT NULL DEFAULT 24,
      sfp TINYINT UNSIGNED NOT NULL DEFAULT 0, status ENUM('active','unused','remove') NOT NULL DEFAULT 'active',
      model VARCHAR(120) NOT NULL DEFAULT '', notes TEXT NULL, sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id), KEY idx_order (sort_order)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    INSERT INTO devices (id,name,short,sort_order) VALUES ('pp-a','Patchpanel A','A',10), ('pp-b','Patchpanel B','B',20);`);
  await migrate(conn);
  await migrate(conn); // drugi raz nic nie zmienia
  const [rows] = await conn.query('SELECT id, rack_id FROM devices ORDER BY id');
  assert.deepEqual(rows.map((r) => r.rack_id), ['rack-1', 'rack-1']);
  const s = (await api('GET', '/api/state')).data;
  assert.deepEqual(Object.keys(s.racks), ['rack-1']);
  assert.equal(s.devices['pp-a'].rack, 'rack-1');
  assert.equal((await api('PUT', '/api/ports/pp-a/1', { status: 'used', link: { dev: 'pp-b', port: '1' } })).status, 200);
});

it('racki: dodawanie, przenoszenie urządzeń, patchcord między rackami, usuwanie', async () => {
  const first = await addDevice({ name: 'A', short: 'A' });
  const r1 = (await state())[first].rack;
  const r = await api('POST', '/api/racks', { name: 'Serwerownia', location: 'Budynek B' });
  assert.equal(r.status, 200);
  assert.equal(r.data.id, 'serwerownia');
  assert.equal(r.data.racks.serwerownia.location, 'Budynek B');

  const sw = (await api('POST', '/api/devices', { name: 'Core', short: 'CORE', kind: 'switch', portCount: 24, rack: 'serwerownia' })).data.id;
  assert.equal((await state())[sw].rack, 'serwerownia');
  assert.equal((await api('POST', '/api/devices', { name: 'X', rack: 'nie-ma' })).status, 404);

  // patchcord między rackami
  await api('PUT', `/api/ports/${first}/1`, { status: 'used', link: { dev: sw, port: '1' } });
  assert.deepEqual((await port(sw, 1)).link, { dev: first, port: '1' });

  assert.equal((await api('DELETE', '/api/racks/serwerownia')).status, 409, 'rack z urządzeniami');
  await api('PUT', `/api/devices/${sw}`, { rack: r1 });
  const s = await state();
  assert.equal(s[sw].rack, r1);
  assert.ok(s[sw].order > s[first].order, 'przeniesione urządzenie na koniec racka');
  assert.deepEqual(s[sw].ports[1].link, { dev: first, port: '1' }, 'patchcordy zostają');

  assert.equal((await api('DELETE', '/api/racks/serwerownia')).status, 200);
  assert.equal((await api('DELETE', `/api/racks/${r1}`)).status, 409, 'ostatni rack zostaje');
});

it('import: kopia z rackami i stara kopia bez racków', async () => {
  const target = (await api('POST', '/api/racks', { name: 'Docelowy' })).data.id;
  const r = await api('POST', '/api/import', {
    racks: { 'r-a': { name: 'Rack A', order: 10 } },
    devices: { x: { name: 'X', short: 'X', rack: 'r-a', ports: {} }, y: { name: 'Y', short: 'Y', ports: {} } },
    rack: target,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.devices.x.rack, 'r-a');
  assert.equal(r.data.devices.y.rack, target, 'bez racka → rack wskazany przy imporcie');

  const exp = (await api('GET', '/api/export.json')).data;
  assert.equal(exp.racks['r-a'].name, 'Rack A');
  const { data: csv } = await api('GET', '/api/export.csv');
  assert.match(csv.split('\r\n')[0], /^\uFEFF?Rack;Urządzenie;Port/);
});

it('błędy mają kod do tłumaczenia, eksport CSV w wybranym języku', async () => {
  const r = await api('PUT', '/api/ports/nie-ma/1', { status: 'used' });
  assert.equal(r.status, 404);
  assert.equal(r.data.code, 'dev_not_found');
  assert.deepEqual(r.data.params, { id: 'nie-ma' });
  assert.equal((await api('GET', '/api/nie-ma')).data.code, 'api_not_found');

  const a = await addDevice({ name: 'A', short: 'A' });
  await api('PUT', `/api/ports/${a}/1`, { status: 'used', color: 'czerwony', verified: true });
  const { data: nl } = await api('GET', '/api/export.csv?lang=nl');
  assert.match(nl, /Rack;Apparaat;Poort/);
  assert.match(nl, /;In gebruik;/);
  assert.match(nl, /;rood;/);
  assert.match(nl, /;ja;/);
  const { data: pl } = await api('GET', '/api/export.csv');
  assert.match(pl, /;Zajęty;.*;czerwony;/);
});

it('za Cloudflare wejście przez http:// przenosi na https://', async () => {
  const viaHttp = { 'CF-Visitor': '{"scheme":"http"}' };
  const page = await fetch(base + '/', { headers: viaHttp, redirect: 'manual' });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /location\.replace\("https:\/\/"\+location\.host\+location\.pathname/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const login = await fetch(base + '/login', { method: 'POST', headers: { ...viaHttp, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=a&password=b', redirect: 'manual' });
  assert.equal(login.headers.get('location'), 'login.html');
  const apiPost = await fetch(base + '/api/racks', { method: 'POST', headers: { ...viaHttp, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal((await apiPost.json()).code, 'https_required');
  const viaHttps = await fetch(base + '/api/health', { headers: { 'CF-Visitor': '{"scheme":"https"}' } });
  assert.deepEqual(await viaHttps.json(), { ok: true }, 'przez https bez zmian');
});

it('logowanie przez stronę: przekierowania, sesja w ciasteczku, wylogowanie', async () => {
  const p = BASE_PORT + 2;
  const authed = startServer(p, { AUTH_USER: 'admin', AUTH_PASSWORD: 'tajne#1', SESSION_SECRET: 'x'.repeat(32) });
  const url = `http://127.0.0.1:${p}`;
  const get = (path, cookie) => fetch(url + path, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
  const login = (user, password, extra = '') => fetch(url + '/login', {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `user=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}${extra}`,
  });
  try {
    await waitUp(url, { Authorization: 'Basic ' + Buffer.from('admin:tajne#1').toString('base64') });

    const root = await get('/');
    assert.equal(root.status, 302);
    assert.equal(root.headers.get('location'), 'login.html', 'względne przekierowanie działa też pod /rack/');
    assert.equal(root.headers.get('www-authenticate'), null, 'bez okna logowania przeglądarki');
    assert.equal((await get('/login.html')).status, 200);
    assert.equal((await get('/style.css')).status, 200);
    assert.equal((await get('/app.js')).status, 401);
    const api401 = await get('/api/state');
    assert.equal(api401.status, 401);
    assert.equal((await api401.json()).login, true);

    const bad = await login('admin', 'zle');
    assert.equal(bad.headers.get('location'), 'login.html?blad=1');
    assert.equal(bad.headers.get('set-cookie'), null);

    const ok = await login('admin', 'tajne#1');
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), './');
    const setCookie = ok.headers.get('set-cookie');
    assert.match(setCookie, /^rack_session=[^;]+; HttpOnly; SameSite=Lax$/, 'bez Path i Max-Age (sesja do zamknięcia przeglądarki)');
    const cookie = setCookie.split(';')[0];
    assert.equal((await get('/', cookie)).status, 200);
    assert.equal((await get('/login.html', cookie)).headers.get('location'), './', 'zalogowany nie widzi strony logowania');
    assert.deepEqual(await (await get('/api/session', cookie)).json(), { auth: true, user: 'admin' });

    const remember = await login('admin', 'tajne#1', '&remember=1');
    assert.match(remember.headers.get('set-cookie'), /Max-Age=2592000/);

    const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    assert.equal((await get('/api/state', forged)).status, 401, 'podrobiony podpis nie przechodzi');

    const out = await fetch(url + '/logout', { method: 'POST', redirect: 'manual', headers: { Cookie: cookie } });
    assert.equal(out.headers.get('location'), 'login.html?wylogowano=1');
    assert.match(out.headers.get('set-cookie'), /^rack_session=; .*Max-Age=0/);
  } finally {
    authed.kill();
  }
});

it('logowanie blokuje adres po 10 nieudanych próbach', async () => {
  const p = BASE_PORT + 1;
  const authed = startServer(p, { AUTH_USER: 'admin', AUTH_PASSWORD: 'h#a s$ło' });
  const url = `http://127.0.0.1:${p}`;
  const basic = (u, pw) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${pw}`).toString('base64') });
  try {
    await waitUp(url, basic('admin', 'h#a s$ło'));
    assert.equal((await fetch(url + '/api/health')).status, 401);
    for (let i = 0; i < 10; i++) assert.equal((await fetch(url + '/api/health', { headers: basic('admin', 'zle') })).status, 401);
    assert.equal((await fetch(url + '/api/health', { headers: basic('admin', 'h#a s$ło') })).status, 429);
  } finally {
    authed.kill();
  }
});
