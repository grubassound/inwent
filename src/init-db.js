// Tworzy/aktualizuje tabele i opcjonalnie wczytuje układ racka: node src/init-db.js [--seed]
const mysql = require('mysql2/promise');
const { config } = require('./db');
const { runMigrations, ensureDefaultRack } = require('./migrate');
const TEMPLATE = require('./template');

async function main() {
  await runMigrations(config);
  console.log('✓ Tabele gotowe w bazie', config.database);

  if (process.argv.includes('--seed')) {
    const conn = await mysql.createConnection(config);
    try {
      const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM devices');
      if (n > 0) {
        console.log(`• Pomijam układ racka: w bazie jest już ${n} urządzeń.`);
      } else {
        const rackId = await ensureDefaultRack(conn);
        let order = 10;
        for (const [id, name, short, kind, pc, sfp, status, model, notes] of TEMPLATE) {
          await conn.query(
            'INSERT INTO devices (id,rack_id,name,short,kind,port_count,sfp,status,model,notes,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            [id, rackId, name, short, kind, pc, sfp, status, model, notes, order]
          );
          order += 10;
        }
        console.log(`✓ Wczytano układ racka: ${TEMPLATE.length} urządzeń`);
      }
    } finally {
      await conn.end();
    }
  }
}

main().catch((e) => {
  console.error('✗ Błąd inicjalizacji bazy:', e.message);
  process.exit(1);
});
