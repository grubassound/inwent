const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const config = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'rack',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rack_inventory',
  charset: 'utf8mb4',
};
if (process.env.DB_SOCKET) config.socketPath = process.env.DB_SOCKET;

const pool = mysql.createPool({
  ...config,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL || 10),
  dateStrings: true,
});

module.exports = { pool, config };
