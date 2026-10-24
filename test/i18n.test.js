// Kompletność tłumaczeń: każdy klucz użyty w kodzie istnieje we wszystkich językach.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function loadI18n() {
  const store = {};
  const ctx = {
    window: {}, navigator: { languages: ['pl-PL'] },
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    document: { documentElement: { dataset: {} }, querySelectorAll: () => [], addEventListener() {}, dispatchEvent() {} },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    CustomEvent: class {},
  };
  vm.runInNewContext(read('public/i18n.js'), ctx);
  return ctx.window.i18n;
}

test('wszystkie języki mają te same klucze co polski', () => {
  const { dict } = loadI18n();
  const pl = Object.keys(dict.pl).sort();
  for (const lang of ['en', 'nl', 'cs']) {
    const keys = Object.keys(dict[lang]).sort();
    assert.deepEqual(keys.filter((k) => !pl.includes(k)), [], `${lang}: klucze spoza pl`);
    assert.deepEqual(pl.filter((k) => !keys.includes(k)), [], `${lang}: brakujące klucze`);
    for (const k of pl) {
      const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
      assert.equal(ph(dict[lang][k]), ph(dict.pl[k]), `${lang}.${k}: inne parametry {…}`);
    }
  }
});

test('każdy klucz z kodu ma tłumaczenie', () => {
  const { dict } = loadI18n();
  const used = new Set();
  const src = read('public/app.js') + read('public/rack-art.js') + read('public/login.html') + read('public/index.html');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z]+\.[\w.]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/t\(\s*\w+\s*\?\s*'([\w.]+)'\s*:\s*'([\w.]+)'/g)) { used.add(m[1]); used.add(m[2]); }
  for (const m of src.matchAll(/data-i18n(?:-ph|-title|-aria)?="([\w.]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/'((?:login|btn|banner|mode|editor|dev|face|art)\.[\w]+)'/g)) used.add(m[1]);
  // klucze składane dynamicznie
  for (const k of ['unknown', 'used', 'free', 'reserved', 'broken']) used.add('status.' + k);
  for (const k of ['patch', 'switch', 'fiber', 'other']) used.add('kind.' + k);
  for (const k of ['active', 'unused', 'remove']) used.add('devstatus.' + k);
  for (const m of read('public/app.js').matchAll(/\['([^']+)','#[0-9a-f]{6}'\]/g)) used.add('color.' + m[1]);
  for (const m of read('src/server.js').matchAll(/code: '(\w+)'|HttpError\([^)]*?, '(\w+)'/g)) used.add('err.' + (m[1] || m[2]));
  for (const k of ['too_large', 'bad_json']) used.add('err.' + k);
  assert.ok(used.size > 150, `znaleziono tylko ${used.size} kluczy`);
  for (const lang of ['pl', 'en', 'nl', 'cs']) {
    const missing = [...used].filter((k) => !(k in dict[lang]));
    assert.deepEqual(missing, [], `${lang}: brak tłumaczeń`);
  }
});

test('t() podstawia parametry i wraca do polskiego', () => {
  const i = loadI18n();
  assert.equal(i.lang, 'pl');
  assert.equal(i.t('dev.ports', { n: 24 }), '24 portów');
  assert.equal(i.t('nie.ma.takiego'), 'nie.ma.takiego');
});
