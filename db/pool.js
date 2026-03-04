const mysql = require('mysql2/promise');

function parseConnectionString(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: u.port || 3306,
      user: u.username,
      password: u.password,
      database: u.pathname.replace(/^\//, '') || undefined,
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
    };
  } catch {
    return {};
  }
}

const config = process.env.DATABASE_URL
  ? parseConnectionString(process.env.DATABASE_URL)
  : {
      host: process.env.MYSQL_HOST || 'localhost',
      port: process.env.MYSQL_PORT || 3306,
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || 'new-password',
      database: process.env.MYSQL_DATABASE || 'smartsave',
      waitForConnections: true,
      connectionLimit: 20,
      queueLimit: 0,
    };

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