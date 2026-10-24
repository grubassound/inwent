// Rysunki szafy (SVG): grafika „jak żywa” (strona główna, PNG) i rysunek techniczny (A4, SVG/PDF).
// Czyste funkcje: dostają dane racka i urządzeń, zwracają tekst SVG. Kolory są w atrybutach,
// więc pobrany plik SVG/PNG wygląda tak samo jak na stronie; klasy służą tylko animacji i zaznaczeniu.
(() => {
'use strict';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cut = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const total = (d) => (d.portCount || 0) + (d.sfp || 0);
// Pseudolosowe, ale stałe dla portu tempo migania diody (różne porty migają w różnym rytmie).
const rnd = (seed) => { const x = Math.sin(seed * 12.9898) * 43758.5453; return x - Math.floor(x); };
const ST_FILL = { used: '#2fbf71', reserved: '#5b95ff', broken: '#ef5a5a' };

// Liczba U szafy: zapisana wysokość, ale nie mniej niż liczba urządzeń (każde zajmuje 1U).
function rackUnits(rack, devices) { return Math.max(rack.heightU || 0, devices.length, 1); }

/* ---------- grafika szafy ---------- */
// opts: {selected, colorHex(name), static (bez animacji, do PNG), title}
function graphic(rack, devices, opts = {}) {
  const U = 22, DW = 240, RAIL = 26, FR = 8, TOP = 16;
  const H = rackUnits(rack, devices);
  const W = DW + 2 * RAIL + 2 * FR, HT = TOP * 2 + H * U;
  const x0 = FR + RAIL, anim = !opts.static;
  const hex = opts.colorHex || (() => null);
  const parts = [];

  // obudowa i szyny z otworami oraz numeracją U (U1 na dole)
  parts.push(`<rect x="0" y="0" width="${W}" height="${HT}" rx="7" fill="#1d2127"/>`,
    `<rect x="${FR}" y="${TOP - 6}" width="${W - 2 * FR}" height="${H * U + 12}" rx="3" fill="#0b0d10"/>`);
  for (const rx of [FR, W - FR - RAIL]) {
    parts.push(`<rect x="${rx}" y="${TOP - 6}" width="${RAIL}" height="${H * U + 12}" fill="#2b3037"/>`);
    for (let u = 0; u < H; u++) {
      const y = TOP + u * U;
      for (const k of [4, 11, 18]) parts.push(`<rect x="${rx + (rx === FR ? RAIL - 7 : 3)}" y="${y + k - 1.5}" width="4" height="3" rx=".6" fill="#111418"/>`);
      if (rx === FR) parts.push(`<text x="${rx + 9}" y="${y + U / 2 + 3}" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="7.5" fill="#8d96a1" text-anchor="middle">${H - u}</text>`);
    }
  }

  for (let u = 0; u < H; u++) {
    const y = TOP + u * U, d = devices[u];
    if (!d) { // zaślepka
      parts.push(`<rect x="${x0}" y="${y + 1}" width="${DW}" height="${U - 2}" rx="1.5" fill="#20242a"/><line x1="${x0 + 8}" y1="${y + 8}" x2="${x0 + DW - 8}" y2="${y + 8}" stroke="#2a2f36"/><line x1="${x0 + 8}" y1="${y + 14}" x2="${x0 + DW - 8}" y2="${y + 14}" stroke="#2a2f36"/>`);
      continue;
    }
    const g = [];
    const sw = d.kind === 'switch', pp = d.kind === 'patch' || d.kind === 'fiber';
    const body = sw ? 'url(#rgsw)' : pp ? '#15181c' : '#3a3f46';
    g.push(`<rect x="${x0}" y="${y + 1}" width="${DW}" height="${U - 2}" rx="1.5" fill="${body}" stroke="#000" stroke-opacity=".5"/>`);
    g.push(`<text x="${x0 + 5}" y="${y + 9.5}" font-family="system-ui,Segoe UI,Arial,sans-serif" font-size="6.6" font-weight="700" fill="#eef1f4">${esc(cut(d.short || d.name, 8))}</text>`);
    if (sw) {
      g.push(`<circle cx="${x0 + 7}" cy="${y + 15}" r="1.4" fill="#3ddc84"/>`,
        `<circle cx="${x0 + 12}" cy="${y + 15}" r="1.4" fill="#3ddc84"${anim ? ' class="rg-led" style="animation-duration:2.4s"' : ''}/>`);
    }
    // porty: switch w dwóch rzędach (nieparzyste u góry), patchpanel w jednym (do 24) albo dwóch
    const N = d.portCount || 0, S = d.sfp || 0;
    const rows = sw || N > 24 ? 2 : 1;
    const cols = Math.max(1, Math.ceil(N / rows));
    const px0 = x0 + 46, sfpW = S ? Math.ceil(S / 2) * 9 + 4 : 0;
    const avail = DW - 46 - 6 - sfpW;
    const pitch = Math.min(8, avail / cols), pw = Math.max(2.5, pitch - 1.6), ph = rows === 2 ? 5.5 : 7;
    const ys = rows === 2 ? [y + 4, y + 11.5] : [y + 7.5];
    const port = (n, x, yy, w, h, isSfp) => {
      const r = (d.ports || {})[n] || {}, st = r.status || 'unknown', c = hex(r.color);
      let fill = '#0f1216', stroke = '#59616b', so = 1;
      if (st === 'used') { fill = c || ST_FILL.used; stroke = 'none'; }
      else if (ST_FILL[st]) { fill = ST_FILL[st]; stroke = 'none'; }
      else if (st === 'unknown') { stroke = '#e3a634'; so = .7; }
      if (isSfp && st !== 'used') { fill = '#9aa2ab'; stroke = 'none'; }
      g.push(`<rect x="${x.toFixed(1)}" y="${yy}" width="${w.toFixed(1)}" height="${h}" rx=".6" fill="${fill}" stroke="${stroke}" stroke-width=".6" stroke-opacity="${so}"/>`);
      if (st === 'used' && anim) {
        g.push(`<rect class="rg-led" x="${(x + w - 1.6).toFixed(1)}" y="${yy - 1.4}" width="1.4" height="1" fill="#7dffb4" style="animation-duration:${(0.5 + rnd(n + total(d)) * 1.6).toFixed(2)}s;animation-delay:-${(rnd(n * 7) * 2).toFixed(2)}s"/>`);
      }
    };
    for (let n = 1; n <= N; n++) {
      const i = n - 1, col = rows === 2 ? Math.floor(i / 2) : i, row = rows === 2 ? i % 2 : 0;
      port(n, px0 + col * pitch, ys[row], pw, ph, false);
    }
    for (let k = 0; k < S; k++) {
      port(N + 1 + k, x0 + DW - 6 - sfpW + 4 + Math.floor(k / 2) * 9, y + (k % 2 ? 11.5 : 4), 8, 5.5, true);
    }
    if (d.status === 'unused' || d.status === 'remove') {
      g.push(`<rect x="${x0}" y="${y + 1}" width="${DW}" height="${U - 2}" rx="1.5" fill="#0b0d10" fill-opacity=".55"/>`);
      if (d.status === 'remove') g.push(`<rect x="${x0 + DW - 4}" y="${y + 1}" width="4" height="${U - 2}" fill="#ef5a5a"/>`);
    }
    const sel = opts.selected === d.id;
    if (sel) g.push(`<rect class="rg-sel" x="${x0 - 1.5}" y="${y - 0.5}" width="${DW + 3}" height="${U + 1}" rx="2.5" fill="none" stroke="#3ddc84" stroke-width="2"/>`);
    const tip = `${d.name}${d.model ? ' · ' + d.model : ''} · ${total(d)}`;
    parts.push(anim
      ? `<g class="rg-dev" data-dev="${esc(d.id)}" role="button" tabindex="0" aria-pressed="${sel}" aria-label="${esc(tip)}"><title>${esc(tip)}</title>${g.join('')}</g>`
      : g.join(''));
  }
  const title = opts.title ? `<title>${esc(opts.title)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="rack-graphic" viewBox="0 0 ${W} ${HT}" width="${W}" height="${HT}" data-w="${W}" data-h="${HT}">${title}
<defs><linearGradient id="rgsw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c535b"/><stop offset="1" stop-color="#2c3035"/></linearGradient></defs>
${parts.join('\n')}</svg>`;
}

/* ---------- rysunek techniczny (A4 poziomo, jednostki: mm) ---------- */
// opts: {t(key, params), kindLabel(kind), statusLabel(status), date}
function drawing(rack, devices, opts) {
  const t = opts.t, H = rackUnits(rack, devices);
  const F = 'Arial,Helvetica,sans-serif', M = 'Consolas,Menlo,monospace';
  const L = '#111', thin = 0.18, mid = 0.35, thick = 0.6;
  const out = [];
  const txt = (x, y, s, size, extra = '') => `<text x="${x}" y="${y}" font-family="${F}" font-size="${size}" fill="${L}" ${extra}>${esc(s)}</text>`;
  const line = (x1, y1, x2, y2, w = thin, extra = '') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${L}" stroke-width="${w}" ${extra}/>`;

  // ramka arkusza
  out.push(`<rect x="0" y="0" width="297" height="210" fill="#fff"/>`,
    `<rect x="10" y="10" width="277" height="190" fill="none" stroke="${L}" stroke-width="${thick}"/>`);

  // widok szafy z przodu
  const areaTop = 40, areaH = 150, maxW = 104;
  let u = Math.min(areaH / H, 9);
  let rw = u * (482.6 / 44.45);
  if (rw > maxW) { rw = maxW; u = rw / (482.6 / 44.45); }
  const rh = u * H, rx = 32, ry = areaTop + (areaH - rh) / 2, rail = rw * 0.035;
  out.push(txt(rx, 22, t('drawing.view'), 3.4, 'font-weight="700"'));
  out.push(`<rect x="${rx - 3}" y="${ry - 3}" width="${rw + 6}" height="${rh + 6}" fill="none" stroke="${L}" stroke-width="${thick}"/>`,
    `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="${L}" stroke-width="${mid}"/>`,
    line(rx + rail, ry, rx + rail, ry + rh, thin), line(rx + rw - rail, ry, rx + rw - rail, ry + rh, thin));
  const fs = Math.min(2.6, u * 0.42);
  for (let i = 0; i < H; i++) {
    const y = ry + i * u, d = devices[i], un = H - i;
    out.push(line(rx - 3, y, rx, y, thin));
    out.push(`<text x="${rx - 4.5}" y="${(y + u / 2 + fs * 0.35).toFixed(2)}" font-family="${M}" font-size="${(fs * 0.9).toFixed(2)}" fill="${L}" text-anchor="end">${un}</text>`);
    if (d) {
      out.push(`<rect x="${rx + rail + 0.6}" y="${(y + 0.35).toFixed(2)}" width="${(rw - 2 * rail - 1.2).toFixed(2)}" height="${(u - 0.7).toFixed(2)}" fill="${d.status === 'remove' ? '#f3f3f3' : '#fff'}" stroke="${L}" stroke-width="${mid}"/>`);
      out.push(`<text x="${(rx + rw / 2).toFixed(2)}" y="${(y + u / 2 + fs * 0.35).toFixed(2)}" font-family="${F}" font-size="${fs.toFixed(2)}" fill="${L}" text-anchor="middle">${esc(cut(`${d.short ? d.short + ' · ' : ''}${d.name}`, Math.floor(rw / (fs * 0.55))))}</text>`);
      if (d.status === 'remove') out.push(line(rx + rail + 0.6, y + 0.35, rx + rw - rail - 0.6, y + u - 0.35, thin));
    } else {
      out.push(`<rect x="${rx + rail + 0.6}" y="${(y + 0.35).toFixed(2)}" width="${(rw - 2 * rail - 1.2).toFixed(2)}" height="${(u - 0.7).toFixed(2)}" fill="none" stroke="${L}" stroke-width="${thin}" stroke-dasharray="1 0.8"/>`);
    }
  }
  // wymiary: szerokość 19″ u góry, wysokość z prawej
  const dimY = ry - 8, dimX = rx + rw + 9;
  const arrow = (x, y, dir) => `<path d="M${x} ${y} l${dir * 1.6} -0.6 v1.2 z" fill="${L}"/>`;
  const arrowV = (x, y, dir) => `<path d="M${x} ${y} l-0.6 ${dir * 1.6} h1.2 z" fill="${L}"/>`;
  out.push(line(rx - 3, ry - 3, rx - 3, dimY - 1.5, thin), line(rx + rw + 3, ry - 3, rx + rw + 3, dimY - 1.5, thin),
    line(rx - 3, dimY, rx + rw + 3, dimY, thin), arrow(rx - 3, dimY, 1), arrow(rx + rw + 3, dimY, -1),
    `<text x="${(rx + rw / 2).toFixed(2)}" y="${(dimY - 1.2).toFixed(2)}" font-family="${F}" font-size="2.6" fill="${L}" text-anchor="middle">482,6 mm (19″)</text>`);
  const hmm = (H * 44.45).toFixed(1).replace('.', ',');
  out.push(line(rx + rw + 3, ry, dimX + 1.5, ry, thin), line(rx + rw + 3, ry + rh, dimX + 1.5, ry + rh, thin),
    line(dimX, ry, dimX, ry + rh, thin), arrowV(dimX, ry, 1), arrowV(dimX, ry + rh, -1),
    `<text x="${dimX + 2.2}" y="${(ry + rh / 2).toFixed(2)}" font-family="${F}" font-size="2.6" fill="${L}" transform="rotate(90 ${dimX + 2.2} ${(ry + rh / 2).toFixed(2)})" text-anchor="middle">${H} U · ${hmm} mm</text>`);

  // tabela urządzeń
  const tx = 158, tw = 124, ty = 18;
  const cols = [[0, 'U', 8], [8, t('drawing.colDevice'), 40], [48, t('drawing.colType'), 21], [69, t('drawing.colModel'), 28], [97, t('drawing.colPorts'), 11], [108, t('drawing.colState'), 16]];
  const rowsMax = Math.max(devices.length, 1);
  const rhT = Math.min(5, 132 / (rowsMax + 1)), tfs = Math.min(2.5, rhT * 0.55);
  out.push(txt(tx, 22, t('drawing.list'), 3.4, 'font-weight="700"'));
  const tTop = ty + 8;
  out.push(`<rect x="${tx}" y="${tTop}" width="${tw}" height="${(rhT * (devices.length + 1)).toFixed(2)}" fill="none" stroke="${L}" stroke-width="${mid}"/>`,
    `<rect x="${tx}" y="${tTop}" width="${tw}" height="${rhT.toFixed(2)}" fill="#eee" stroke="${L}" stroke-width="${mid}"/>`);
  for (const [cx, head] of cols) {
    out.push(`<text x="${tx + cx + 1}" y="${(tTop + rhT * 0.7).toFixed(2)}" font-family="${F}" font-size="${tfs.toFixed(2)}" font-weight="700" fill="${L}">${esc(head)}</text>`);
    if (cx) out.push(line(tx + cx, tTop, tx + cx, tTop + rhT * (devices.length + 1), thin));
  }
  devices.forEach((d, i) => {
    const y = tTop + rhT * (i + 1);
    if (i) out.push(line(tx, y, tx + tw, y, thin));
    const cells = [String(H - i), `${d.short ? d.short + ' · ' : ''}${d.name}`, opts.kindLabel(d.kind), d.model || '–', `${d.portCount || 0}${d.sfp ? '+' + d.sfp : ''}`, opts.statusLabel(d.status)];
    cells.forEach((v, k) => {
      const [cx, , w] = cols[k];
      out.push(`<text x="${tx + cx + 1}" y="${(y + rhT * 0.7).toFixed(2)}" font-family="${k === 0 ? M : F}" font-size="${tfs.toFixed(2)}" fill="${L}">${esc(cut(v, Math.floor((w - 1.5) / (tfs * 0.6))))}</text>`);
    });
  });

  // tabliczka rysunkowa
  const bx = 187, by = 164, bw = 100, bh = 36;
  const used = devices.reduce((a, d) => a + Object.values(d.ports || {}).filter((p) => p.status === 'used').length, 0);
  const ports = devices.reduce((a, d) => a + total(d), 0);
  out.push(`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="#fff" stroke="${L}" stroke-width="${thick}"/>`,
    line(bx, by + 6, bx + bw, by + 6, thin), line(bx, by + 17, bx + bw, by + 17, mid), line(bx, by + 24, bx + bw, by + 24, thin),
    line(bx, by + 30, bx + bw, by + 30, thin), line(bx + 50, by + 17, bx + 50, by + bh, thin));
  out.push(txt(bx + 2, by + 4.3, 'RACK INVENTORY · ' + t('drawing.sheet'), 2.3, 'letter-spacing=".2"'),
    txt(bx + 2, by + 12, cut(rack.name, 30), 5, 'font-weight="700"'),
    txt(bx + 2, by + 15.6, cut(rack.location || '', 60), 2.3),
    txt(bx + 2, by + 21.6, `${t('drawing.height')}: ${H} U (${hmm} mm)`, 2.3),
    txt(bx + 52, by + 21.6, `${t('drawing.width')}: 19″ (482,6 mm)`, 2.3),
    txt(bx + 2, by + 28, `${t('drawing.devices')}: ${devices.length} · ${t('drawing.ports')}: ${used}/${ports}`, 2.3),
    txt(bx + 52, by + 28, `${t('drawing.date')}: ${opts.date}`, 2.3),
    txt(bx + 2, by + 34, t('drawing.scale'), 2.3),
    txt(bx + 52, by + 34, t('drawing.sheetNo'), 2.3));

  return `<svg xmlns="http://www.w3.org/2000/svg" class="rack-drawing" viewBox="0 0 297 210" width="297mm" height="210mm"><title>${esc(rack.name)}</title>${out.join('')}</svg>`;
}

window.RackArt = { graphic, drawing, rackUnits };
})();
