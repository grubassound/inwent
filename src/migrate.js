// Schemat bazy i migracje starszych baz. Uruchamiane przy starcie serwera i przez `npm run db:init`.
// Wszystko jest idempotentne: kolejne uruchomienia niczego nie psują.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DEFAULT_RACK = { id: 'rack-1', name: 'Rack 1' };

// Zwraca id pierwszego racka; gdy nie ma żadnego, tworzy domyślny.
async function ensureDefaultRack(db) {
  const [[r]] = await db.query('SELECT id FROM racks ORDER BY sort_order, id LIMIT 1');
  if (r) return r.id;
  await db.query('INSERT IGNORE INTO racks (id, name, sort_order) VALUES (?, ?, 10)', [DEFAULT_RACK.id, DEFAULT_RACK.name]);
  return DEFAULT_RACK.id;
}

async function hasColumn(conn, table, column) {
  const [[row]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]);
  return row.n > 0;
}

async function migrate(conn) {
  await conn.query(fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8'));

  // 2026-10: wiele racków. Urządzenia z bazy sprzed tej zmiany trafiają do domyślnego racka.
  if (!(await hasColumn(conn, 'devices', 'rack_id'))) {
    const rackId = await ensureDefaultRack(conn);
    await conn.query('ALTER TABLE devices ADD COLUMN rack_id VARCHAR(64) NULL AFTER id');
    await conn.query('UPDATE devices SET rack_id = ?', [rackId]);
    await conn.query(`ALTER TABLE devices MODIFY rack_id VARCHAR(64) NOT NULL,
      ADD KEY idx_rack (rack_id, sort_order),
      ADD CONSTRAINT fk_devices_rack FOREIGN KEY (rack_id) REFERENCES racks (id) ON UPDATE CASCADE`);
    console.log(`✓ Migracja: urządzenia przypisane do racka „${rackId}”`);
  }
  // 2026-10: wysokość szafy w U (rysunek techniczny).
  if (!(await hasColumn(conn, 'racks', 'height_u'))) {
    await conn.query('ALTER TABLE racks ADD COLUMN height_u SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER notes');
  }
  await ensureDefaultRack(conn);
}

// Osobne połączenie z multipleStatements tylko na czas migracji (pula aplikacji go nie ma).
async function runMigrations(config) {
  const conn = await mysql.createConnection({ ...config, multipleStatements: true });
  try {
    await migrate(conn);
  } finally {
    await conn.end();
  }
}

module.exports = { runMigrations, migrate, ensureDefaultRack, DEFAULT_RACK };
