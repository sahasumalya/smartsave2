const crypto = require('crypto');
const { pool } = require('../db/pool');
const { syncTransactions } = require('./plaid');
const bankTokenService = require('./bankToken');
const { getCurrentMonthStart, aggregateByAccount } = require('./transactionSync');
const { nowUTC } = require('../utils/time');
const { debug, info, error: logError } = require('../utils/logger');

/**
 * Fetches all distinct user_ids that have at least one linked item.
 */
async function getUsersWithLinkedItems() {
  const result = await pool.query(
    `SELECT DISTINCT user_id FROM bank_tokens WHERE item_id IS NOT NULL AND access_token IS NOT NULL`
  );
  return result.rows.map((r) => r.user_id);
}

async function createUserJob(runId, userId) {
  const now = nowUTC();
  const result = await pool.query(
    `INSERT INTO cron_transaction_jobs (run_id, user_id, status, created_at)
     VALUES (?, ?, 'pending', ?)`,
    [runId, userId, now]
  );
  return result.insertId;
}

async function markJobInProgress(jobId) {
  const now = nowUTC();
  await pool.query(
    `UPDATE cron_transaction_jobs SET status = 'in_progress', started_at = ? WHERE id = ?`,
    [now, jobId]
  );
}

async function markJobCompleted(jobId) {
  const now = nowUTC();
  await pool.query(
    `UPDATE cron_transaction_jobs SET status = 'completed', completed_at = ? WHERE id = ?`,
    [now, jobId]
  );
}

async function markJobFailed(jobId, errorMessage) {
  const now = nowUTC();
  await pool.query(
    `UPDATE cron_transaction_jobs SET status = 'failed', error_message = ?, completed_at = ? WHERE id = ?`,
    [errorMessage, now, jobId]
  );
}

/**
 * Runs the monthly transaction sync cron for all eligible users.
 * Lifecycle per user: pending → in_progress (before Plaid call) → completed/failed.
 */
async function runMonthlyCron() {
  const runId = crypto.randomUUID();
  info(`[cron] Monthly transaction sync started. run_id=${runId}`);

  const userIds = await getUsersWithLinkedItems();
  if (userIds.length === 0) {
    info('[cron] No users with linked items. Skipping.');
    return { runId, usersProcessed: 0 };
  }

  const monthStart = getCurrentMonthStart();
  let usersCompleted = 0;

  // Pre-populate job table with all users as pending
  const userJobs = {};
  for (const userId of userIds) {
    const jobId = await createUserJob(runId, userId);
    userJobs[userId] = jobId;
  }

  for (const userId of userIds) {
    const jobId = userJobs[userId];

    try {
      const tokenRows = await bankTokenService.getLatestTokensPerItem(userId);
      const allTransactions = [];

      // Mark in_progress just before hitting Plaid
      await markJobInProgress(jobId);

      for (const row of tokenRows) {
        const { itemId, accessToken } = bankTokenService.decryptTokenRow(row);

        const cursor = await bankTokenService.getTransactionCursor(userId, itemId);
        const result = await syncTransactions(accessToken, cursor);
        await bankTokenService.upsertTransactionCursor(userId, itemId, result.nextCursor);

        allTransactions.push(...result.added, ...result.modified);
        debug('[cron] synced item', { runId, userId, itemId, txnCount: result.added.length + result.modified.length });
      }

      // Aggregate and persist monthly summary
      const accountSummaries = aggregateByAccount(allTransactions);

      for (const [accountId, totals] of Object.entries(accountSummaries)) {
        await bankTokenService.upsertMonthlySummary(
          userId,
          accountId,
          monthStart,
          parseFloat(totals.credits.toFixed(2)),
          parseFloat(totals.debits.toFixed(2))
        );
      }

      await markJobCompleted(jobId);
      usersCompleted++;
      debug('[cron] user completed', { runId, userId, accountCount: Object.keys(accountSummaries).length });
    } catch (err) {
      await markJobFailed(jobId, err.message);
      logError('[cron] user sync failed', { runId, userId, error: err.message });
    }
  }

  info(`[cron] Monthly transaction sync completed. run_id=${runId}, users=${userIds.length}, completed=${usersCompleted}`);
  return { runId, usersProcessed: userIds.length, usersCompleted };
}

module.exports = { runMonthlyCron };
