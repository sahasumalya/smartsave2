const { syncTransactions } = require('./plaid');
const bankTokenService = require('./bankToken');
const { debug, error: logError } = require('../utils/logger');

/**
 * Returns the first day of the current month as "YYYY-MM-DD".
 */
function getCurrentMonthStart() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Checks whether a transaction date (YYYY-MM-DD) falls within the current rolling month.
 */
function isInCurrentMonth(dateStr) {
  if (!dateStr) return false;
  const monthStart = getCurrentMonthStart();
  const nextMonth = new Date(monthStart);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const nextMonthStr = nextMonth.toISOString().slice(0, 10);
  return dateStr >= monthStart && dateStr < nextMonthStr;
}

/**
 * Aggregates transactions into per-account credits and debits.
 * Plaid convention: positive amount = money out (debit), negative = money in (credit).
 * Only non-pending transactions in the current month are counted.
 */
function aggregateByAccount(transactions) {
  const summary = {};

  for (const txn of transactions) {
    if (txn.pending) continue;
    if (!isInCurrentMonth(txn.date)) continue;

    const accountId = txn.account_id;
    if (!summary[accountId]) {
      summary[accountId] = { credits: 0, debits: 0 };
    }

    if (txn.amount < 0) {
      summary[accountId].credits += Math.abs(txn.amount);
    } else {
      summary[accountId].debits += txn.amount;
    }
  }

  return summary;
}

/**
 * Main orchestrator: syncs transactions for all items linked to a user,
 * calculates rolling-month credits/debits per account, and persists to DB.
 * Returns the aggregated summaries.
 */
async function syncUserTransactions(userId) {
  const tokenRows = await bankTokenService.getLatestTokensPerItem(userId);

  if (tokenRows.length === 0) {
    return { synced: false, message: 'No linked bank items found.' };
  }

  const allTransactions = [];

  for (const row of tokenRows) {
    const { itemId, accessToken } = bankTokenService.decryptTokenRow(row);

    try {
      const cursor = await bankTokenService.getTransactionCursor(userId, itemId);
      const result = await syncTransactions(accessToken, cursor);

      await bankTokenService.upsertTransactionCursor(userId, itemId, result.nextCursor);

      allTransactions.push(...result.added, ...result.modified);

      debug('transactionSync', {
        userId,
        itemId,
        added: result.added.length,
        modified: result.modified.length,
        removed: result.removed.length,
      });
    } catch (err) {
      logError('transactionSync', `Failed for item ${itemId}: ${err.message}`);
    }
  }

  const monthStart = getCurrentMonthStart();
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

  debug('transactionSync persisted', { userId, accountCount: Object.keys(accountSummaries).length });

  return {
    synced: true,
    month: monthStart,
    accounts: Object.entries(accountSummaries).map(([accountId, totals]) => ({
      account_id: accountId,
      total_credits: parseFloat(totals.credits.toFixed(2)),
      total_debits: parseFloat(totals.debits.toFixed(2)),
    })),
  };
}

module.exports = { syncUserTransactions, getCurrentMonthStart, isInCurrentMonth, aggregateByAccount };
