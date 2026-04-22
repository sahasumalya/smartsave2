const { error: logError } = require('../utils/logger');

const PLAID_BASE_URL = process.env.PLAID_BASE_URL || 'https://sandbox.plaid.com';
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_SECRET;
const PLAID_CLIENT_NAME = process.env.PLAID_CLIENT_NAME || 'SmartSave';

function assertConfigured() {
  if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
    throw Object.assign(new Error('Plaid integration is not configured.'), { statusCode: 500 });
  }
}

async function callPlaid(endpoint, body, context) {
  const response = await fetch(`${PLAID_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: PLAID_CLIENT_ID, secret: PLAID_SECRET, ...body }),
  });

  const data = await response.json();

  if (!response.ok) {
    logError(context, JSON.stringify(data));
    const err = new Error(data.error_message || `Plaid ${endpoint} failed`);
    err.statusCode = response.status;
    err.plaidData = data;
    throw err;
  }

  return data;
}

async function createLinkToken(userId) {
  assertConfigured();
  return callPlaid('/link/token/create', {
    client_name: PLAID_CLIENT_NAME,
    country_codes: ['US'],
    language: 'en',
    user: { client_user_id: String(userId) },
    products: ['transactions'],
    additional_consented_products: ['auth'],
  }, 'plaid/link-token');
}

async function exchangePublicToken(publicToken) {
  assertConfigured();
  return callPlaid('/item/public_token/exchange', {
    public_token: publicToken,
  }, 'plaid/exchange-token');
}

async function getAccounts(accessToken) {
  assertConfigured();
  return callPlaid('/accounts/get', {
    access_token: accessToken,
  }, 'plaid/accounts');
}

/**
 * Fetches all transaction updates from Plaid using /transactions/sync.
 * Handles pagination internally — keeps calling until has_more is false.
 * Returns { added, modified, removed, nextCursor, accounts }.
 */
async function syncTransactions(accessToken, cursor = null) {
  assertConfigured();

  const added = [];
  const modified = [];
  const removed = [];
  let accounts = [];
  let currentCursor = cursor || '';
  let hasMore = true;

  while (hasMore) {
    const body = { access_token: accessToken, count: 500 };
    if (currentCursor) {
      body.cursor = currentCursor;
    }

    const data = await callPlaid('/transactions/sync', body, 'plaid/transactions-sync');

    added.push(...(data.added || []));
    modified.push(...(data.modified || []));
    removed.push(...(data.removed || []));

    if (data.accounts && data.accounts.length > 0) {
      accounts = data.accounts;
    }

    currentCursor = data.next_cursor;
    hasMore = data.has_more;
  }

  return { added, modified, removed, nextCursor: currentCursor, accounts };
}

module.exports = { createLinkToken, exchangePublicToken, getAccounts, syncTransactions };
