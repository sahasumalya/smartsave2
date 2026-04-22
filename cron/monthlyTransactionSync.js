const cron = require('node-cron');
const { runMonthlyCron } = require('../services/transactionCron');
const { info, error: logError } = require('../utils/logger');

/**
 * Schedules the monthly transaction sync cron job.
 * Runs at 00:05 UTC on the 1st of every month.
 * Cron expression: "5 0 1 * *"
 */
function scheduleMonthlyTransactionSync() {
  const task = cron.schedule('5 0 1 * *', async () => {
    info('[cron] Monthly transaction sync triggered');

    try {
      const result = await runMonthlyCron();
      info('[cron] Monthly transaction sync result', result);
    } catch (err) {
      logError('[cron] Monthly transaction sync unexpected error', err.message);
    }
  }, {
    scheduled: true,
    timezone: 'UTC',
  });

  info('[cron] Monthly transaction sync scheduled (1st of every month at 00:05 UTC)');
  return task;
}

module.exports = { scheduleMonthlyTransactionSync };
