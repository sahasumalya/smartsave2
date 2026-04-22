const crypto = require('crypto');
const { pool } = require('../db/pool');
const { encrypt, decrypt } = require('../utils/encryption');
const { nowUTC, toMySQLTimestamp } = require('../utils/time');

async function insertLinkToken(userId, linkToken, expiration, requestId) {
  const tokenId = crypto.randomUUID();
  const now = nowUTC();

  await pool.query(
    `INSERT INTO bank_tokens (token_id, user_id, link_token, link_token_expiry, link_request_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tokenId, userId, encrypt(linkToken), toMySQLTimestamp(new Date(expiration)), requestId, now, now]
  );

  return tokenId;
}

async function findByTokenAndUser(tokenId, userId) {
  const result = await pool.query(
    'SELECT id, access_token FROM bank_tokens WHERE token_id = ? AND user_id = ?',
    [tokenId, userId]
  );
  return result.rows[0] || null;
}

async function storeAccessToken(tokenId, userId, itemId, accessToken, requestId) {
  const now = nowUTC();
  await pool.query(
    `UPDATE bank_tokens SET item_id = ?, access_token = ?, exchange_request_id = ?, updated_at = ? WHERE token_id = ? AND user_id = ?`,
    [encrypt(itemId), encrypt(accessToken), requestId, now, tokenId, userId]
  );
}

async function getLatestTokensPerItem(userId) {
  const result = await pool.query(
    `SELECT bt.item_id, bt.access_token
     FROM bank_tokens bt
     INNER JOIN (
       SELECT item_id, MAX(id) AS max_id
       FROM bank_tokens
       WHERE user_id = ? AND item_id IS NOT NULL AND access_token IS NOT NULL
       GROUP BY item_id
     ) latest ON bt.id = latest.max_id`,
    [userId]
  );
  return result.rows;
}

function decryptTokenRow(row) {
  return {
    itemId: decrypt(row.item_id),
    accessToken: decrypt(row.access_token),
  };
}

async function insertUserBankAccounts(userId, itemId, accounts) {
  const now = nowUTC();
  const encryptedItemId = encrypt(itemId);

  for (const acct of accounts) {
    await pool.query(
      `INSERT INTO user_bank_accounts (user_id, item_id, account_id, name, account_type, account_subtype, mask, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        encryptedItemId,
        encrypt(acct.account_id),
        encrypt(acct.name),
        acct.type,
        acct.subtype || null,
        encrypt(acct.mask),
        now,
        now,
      ]
    );
  }
}

async function getTransactionCursor(userId, itemId) {
  const result = await pool.query(
    'SELECT cursor_value FROM transaction_cursors WHERE user_id = ? AND item_id = ?',
    [userId, itemId]
  );
  return result.rows[0]?.cursor_value || null;
}

async function upsertTransactionCursor(userId, itemId, cursorValue) {
  const now = nowUTC();
  await pool.query(
    `INSERT INTO transaction_cursors (user_id, item_id, cursor_value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE cursor_value = ?, updated_at = ?`,
    [userId, itemId, cursorValue, now, now, cursorValue, now]
  );
}

async function upsertMonthlySummary(userId, accountId, monthStart, totalCredits, totalDebits) {
  const now = nowUTC();
  await pool.query(
    `INSERT INTO monthly_account_summary (user_id, account_id, month_start, total_credits, total_debits, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE total_credits = ?, total_debits = ?, updated_at = ?`,
    [userId, accountId, monthStart, totalCredits, totalDebits, now, now, totalCredits, totalDebits, now]
  );
}

async function getMonthlySummaries(userId, monthStart) {
  const result = await pool.query(
    'SELECT account_id, total_credits, total_debits FROM monthly_account_summary WHERE user_id = ? AND month_start = ?',
    [userId, monthStart]
  );
  return result.rows;
}

async function getLinkedAccounts(userId) {
  const result = await pool.query(
    'SELECT account_id, name, account_type, account_subtype, mask, is_investment_account FROM user_bank_accounts WHERE user_id = ?',
    [userId]
  );
  return result.rows.map((row) => ({
    accountId: row.account_id,
    name: decrypt(row.name),
    accountType: row.account_type,
    accountSubtype: row.account_subtype || null,
    mask: decrypt(row.mask),
    isInvestmentAccount: Number(row.is_investment_account) === 1,
  }));
}

async function setInvestmentAccount(userId, encryptedAccountId) {
  const now = nowUTC();

  const match = await pool.query(
    'SELECT id FROM user_bank_accounts WHERE user_id = ? AND account_id = ?',
    [userId, encryptedAccountId]
  );
  if (match.rows.length === 0) {
    return false;
  }

  await pool.query(
    'UPDATE user_bank_accounts SET is_investment_account = 0, updated_at = ? WHERE user_id = ?',
    [now, userId]
  );
  await pool.query(
    'UPDATE user_bank_accounts SET is_investment_account = 1, updated_at = ? WHERE user_id = ? AND account_id = ?',
    [now, userId, encryptedAccountId]
  );

  return true;
}

async function markBankLinked(userId) {
  const now = nowUTC();
  await pool.query(
    'UPDATE user_profile SET is_bank_linked = 1, updated_at = ? WHERE user_id = ?',
    [now, userId]
  );
}

module.exports = {
  insertLinkToken,
  findByTokenAndUser,
  storeAccessToken,
  getLatestTokensPerItem,
  decryptTokenRow,
  insertUserBankAccounts,
  getLinkedAccounts,
  setInvestmentAccount,
  markBankLinked,
  getTransactionCursor,
  upsertTransactionCursor,
  upsertMonthlySummary,
  getMonthlySummaries,
};
