const express = require('express');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { debug, error: logError } = require('../utils/logger');
const plaidService = require('../services/plaid');
const bankTokenService = require('../services/bankToken');
const { syncUserTransactions } = require('../services/transactionSync');

const router = express.Router();

/**
 * POST /api/v1/plaid/link-token
 * Creates a temporary Plaid link token for the authenticated user.
 */
router.post(
  '/link-token',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { userId } = req.user;

    const data = await plaidService.createLinkToken(userId);
    const tokenId = await bankTokenService.insertLinkToken(userId, data.link_token, data.expiration, data.request_id);

    debug('plaid/link-token created', { userId, tokenId });

    return res.status(200).json({
      status: 'success',
      token_id: tokenId,
      link_token: data.link_token,
      expiration: data.expiration,
      request_id: data.request_id,
    });
  })
);

/**
 * POST /api/v1/plaid/exchange-token
 * Exchanges a public token for a Plaid access token and stores it encrypted.
 */
router.post(
  '/exchange-token',
  requireAuth(),
  [
    body('public_token').isString().trim().notEmpty().withMessage('public_token is required'),
    body('token_id').isUUID().withMessage('token_id is required'),
  ],
  asyncHandler(async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      const first = errs.array()[0];
      return res.status(400).json({ status: 'error', message: first.msg });
    }

    const { userId } = req.user;
    const { public_token: publicToken, token_id: tokenId } = req.body;

    const existing = await bankTokenService.findByTokenAndUser(tokenId, userId);
    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Bank token record not found.' });
    }
    if (existing.access_token) {
      return res.status(409).json({ status: 'error', message: 'This token has already been exchanged.' });
    }

    const data = await plaidService.exchangePublicToken(publicToken);
    await bankTokenService.storeAccessToken(tokenId, userId, data.item_id, data.access_token, data.request_id);

    const accountsData = await plaidService.getAccounts(data.access_token);
    if (accountsData.accounts && accountsData.accounts.length > 0) {
      await bankTokenService.insertUserBankAccounts(userId, data.item_id, accountsData.accounts);
    }

    await bankTokenService.markBankLinked(userId);

    debug('plaid/exchange-token stored', { userId, tokenId, accountCount: accountsData.accounts?.length || 0 });

    return res.status(200).json({
      status: 'success',
      message: 'Bank account linked successfully.',
    });
  })
);

/**
 * GET /api/v1/plaid/accounts
 * Retrieves account details for all items linked to the authenticated user.
 */
router.get(
  '/accounts',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { userId } = req.user;

    const tokenRows = await bankTokenService.getLatestTokensPerItem(userId);

    if (tokenRows.length === 0) {
      return res.status(200).json({
        status: 'success',
        accounts: [],
        message: 'No linked bank accounts found.',
      });
    }

    const accounts = [];

    for (const row of tokenRows) {
      const { itemId, accessToken } = bankTokenService.decryptTokenRow(row);

      try {
        const data = await plaidService.getAccounts(accessToken);
        if (data.accounts) {
          accounts.push(...data.accounts);
        }
      } catch (err) {
        logError('plaid/accounts', `Failed for item ${itemId}: ${err.message}`);
      }
    }

    debug('plaid/accounts retrieved', { userId, accountCount: accounts.length });

    return res.status(200).json({
      status: 'success',
      accounts,
    });
  })
);

/**
 * GET /api/v1/plaid/linked-accounts
 * Returns all linked bank accounts for the authenticated user from our DB.
 */
router.get(
  '/linked-accounts',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { userId } = req.user;

    const accounts = await bankTokenService.getLinkedAccounts(userId);

    debug('plaid/linked-accounts fetched', { userId, count: accounts.length });

    return res.status(200).json({
      status: 'success',
      accounts,
    });
  })
);

/**
 * POST /api/v1/plaid/investment-account
 * Marks a specific account as the investment account for the user.
 * Any previously marked investment account is unset.
 */
router.post(
  '/investment-account',
  requireAuth(),
  [
    body('account_id').isString().trim().notEmpty().withMessage('account_id is required'),
  ],
  asyncHandler(async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      const first = errs.array()[0];
      return res.status(400).json({ status: 'error', message: first.msg });
    }

    const { userId } = req.user;
    const { account_id: accountId } = req.body;

    const updated = await bankTokenService.setInvestmentAccount(userId, accountId);

    if (!updated) {
      return res.status(404).json({
        status: 'error',
        message: 'Account not found for this user.',
      });
    }

    debug('plaid/investment-account set', { userId });

    return res.status(200).json({
      status: 'success',
      message: 'Investment account updated successfully.',
    });
  })
);

/**
 * POST /api/v1/plaid/transactions/sync
 * Syncs transactions for all linked items, calculates rolling-month
 * credits/debits per account, and persists summaries to DB.
 */
router.post(
  '/transactions/sync',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { userId } = req.user;

    const result = await syncUserTransactions(userId);

    if (!result.synced) {
      return res.status(200).json({
        status: 'success',
        accounts: [],
        message: result.message,
      });
    }

    return res.status(200).json({
      status: 'success',
      month: result.month,
      accounts: result.accounts,
    });
  })
);

module.exports = router;
