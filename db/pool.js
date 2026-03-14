const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

/**
 * Build SSL options for MySQL. Use MYSQL_SSL_CA (path to .pem) when the server cert
 * is signed by a CA not in the system store (e.g. Aiven). Place your ca.pem in
 * project/certs/ and set MYSQL_SSL_CA=certs/ca.pem or an absolute path.
 */
function getSslOptions() {
  const caPath = process.env.MYSQL_SSL_CA || process.env.MYSQL_SSL_CA_PATH;
  if (caPath) {
    const resolved = path.isAbsolute(caPath) ? caPath : path.resolve(process.cwd(), caPath);
    return { ca: fs.readFileSync(resolved), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: true };
}

function parseConnectionString(url) {
  try {
    const u = new URL(url);
    const database = u.pathname.replace(/^\//, '').replace(/\/$/, '') || undefined;
    const config = {
      host: u.hostname,
      port: u.port || 3306,
      user: u.username,
      password: u.password,
      database: database === '' ? undefined : database,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
    };
    const sslMode = u.searchParams.get('ssl-mode') || u.searchParams.get('ssl_mode');
    if (sslMode && String(sslMode).toUpperCase() === 'REQUIRED' && process.env.NODE_ENV === 'development') {
      config.ssl = getSslOptions();
    }
    return config;
  } catch {
    return {};
  }
}

const config = process.env.DATABASE_URL
  ? parseConnectionString(process.env.DATABASE_URL)
  : (() => {
      const c = {
        host: process.env.MYSQL_HOST || 'localhost',
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || 'new-password',
        database: process.env.MYSQL_DATABASE || 'smartsave',
        waitForConnections: true,
        connectionLimit: 20,
        queueLimit: 0,
      };
      if (process.env.MYSQL_SSL_MODE === 'REQUIRED') {
        c.ssl = getSslOptions();
      }
      return c;
    })();

const rawPool = mysql.createPool(config);

const pool = {
  async query(sql, params = []) {
    const [rows] = await rawPool.execute(sql, params);
    return { rows: Array.isArray(rows) ? rows : [] };
  },

  async getConnection() {
    const conn = await rawPool.getConnection();
    return {
      async query(sql, params = []) {
        const [rows] = await conn.execute(sql, params);
        return { rows: Array.isArray(rows) ? rows : [] };
      },
      release() {
        conn.release();
      },
    };
  },

  connect() {
    return this.getConnection();
  },
};

module.exports = { pool };