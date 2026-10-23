// Tworzy tabele (sql/schema.sql) i opcjonalnie wczytuje układ racka: node src/init-db.js [--seed]
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { config } = require('./db');
const TEMPLATE = require('./template');

async function main() {
  const conn = await mysql.createConnection({ ...config, multipleStatements: true });
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  await conn.query(sql);
  console.log('✓ Tabele gotowe w bazie', config.database);

  if (process.argv.includes('--seed')) {
    const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM devices');
    if (n > 0) {
      console.log(`• Pomijam układ racka: w bazie jest już ${n} urządzeń.`);
    } else {
      let order = 10;
      for (const [id, name, short, kind, pc, sfp, status, model, notes] of TEMPLATE) {
        await conn.query(
          'INSERT INTO devices (id,name,short,kind,port_count,sfp,status,model,notes,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id, name, short, kind, pc, sfp, status, model, notes, order]
        );
        order += 10;
      }
      console.log(`✓ Wczytano układ racka: ${TEMPLATE.length} urządzeń`);
    }
  }
  await conn.end();
}

main().catch((e) => {
  console.error('✗ Błąd inicjalizacji bazy:', e.message);
  process.exit(1);
});
