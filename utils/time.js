/**
 * Application-level timestamp helpers.
 * All timestamps are generated in the app (not by the DB) for consistency
 * across distributed instances and easier testing/mocking.
 * Returns MySQL-compatible UTC strings: "YYYY-MM-DD HH:MM:SS"
 */

function toMySQLTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function nowUTC() {
  return toMySQLTimestamp(new Date());
}

function hoursFromNow(hours) {
  return toMySQLTimestamp(new Date(Date.now() + hours * 3_600_000));
}

function hoursAgo(hours) {
  return toMySQLTimestamp(new Date(Date.now() - hours * 3_600_000));
}

function daysAgo(days) {
  return toMySQLTimestamp(new Date(Date.now() - days * 86_400_000));
}

module.exports = { nowUTC, hoursFromNow, hoursAgo, daysAgo };
