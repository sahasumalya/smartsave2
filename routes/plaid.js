const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');
const { pool } = require('../db/pool');
const { encrypt } = require('../utils/encryption');
const { debug, error: logError } = require('../utils/logger');
const { nowUTC, toMySQLTimestamp } = require('../utils/time');

const router = express.Router();

const PLAID_BASE_URL = process.env.PLAID_BASE_URL || 'https://sandbox.plaid.com';
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_SECRET;
const PLAID_CLIENT_NAME = process.env.PLAID_CLIENT_NAME || 'SmartSave';

/**
 * POST /api/v1/plaid/link-token
 * Creates a temporary Plaid link token for the authenticated user.
 * Requires Bearer JWT in Authorization header.
 */
router.post(
  '/link-token',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { userId } = req.user;

    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      logError('plaid/link-token', 'Missing PLAID_CLIENT_ID or PLAID_SECRET env vars');
      return res.status(500).json({
        status: 'error',
        message: 'Plaid integration is not configured.',
      });
    }

    const body = {
      client_id: PLAID_CLIENT_ID,
      secret: PLAID_SECRET,
      client_name: PLAID_CLIENT_NAME,
      country_codes: ['US'],
      language: 'en',
      user: {
        client_user_id: String(userId),
      },
      products: ['transactions'],
      additional_consented_products: ['auth'],
    };

    const response = await fetch(`${PLAID_BASE_URL}/link/token/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      logError('plaid/link-token', JSON.stringify(data));
      return res.status(response.status).json({
        status: 'error',
        message: data.error_message || 'Failed to create Plaid link token.',
      });
    }

    const tokenId = crypto.randomUUID();
    const encryptedLinkToken = encrypt(data.link_token);
    const now = nowUTC();

    await pool.query(
      `INSERT INTO bank_tokens (token_id, user_id, link_token, link_token_expiry, link_request_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tokenId, userId, encryptedLinkToken, toMySQLTimestamp(new Date(data.expiration)), data.request_id, now, now]
    );

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
 * Exchanges a public token for a Plaid access token, then stores the
 * access token (AES-encrypted) in the bank_tokens table for the user.
 * Requires Bearer JWT in Authorization header.
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

    const existing = await pool.query(
      'SELECT id, access_token FROM bank_tokens WHERE token_id = ? AND user_id = ?',
      [tokenId, userId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Bank token record not found.',
      });
    }
    if (existing.rows[0].access_token) {
      return res.status(409).json({
        status: 'error',
        message: 'This token has already been exchanged.',
      });
    }

    if (!PLAID_CLIENT_ID || !PLAID_SECRET) {
      logError('plaid/exchange-token', 'Missing PLAID_CLIENT_ID or PLAID_SECRET env vars');
      return res.status(500).json({
        status: 'error',
        message: 'Plaid integration is not configured.',
      });
    }

    const response = await fetch(`${PLAID_BASE_URL}/item/public_token/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: PLAID_CLIENT_ID,
        secret: PLAID_SECRET,
        public_token: publicToken,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      logError('plaid/exchange-token', JSON.stringify(data));
      return res.status(response.status).json({
        status: 'error',
        message: data.error_message || 'Failed to exchange public token.',
      });
    }

    const encryptedAccessToken = encrypt(data.access_token);
    const encryptedItemId = encrypt(data.item_id);
    const now = nowUTC();

    await pool.query(
      `UPDATE bank_tokens SET item_id = ?, access_token = ?, exchange_request_id = ?, updated_at = ? WHERE token_id = ? AND user_id = ?`,
      [encryptedItemId, encryptedAccessToken, data.request_id, now, tokenId, userId]
    );

    debug('plaid/exchange-token stored', { userId, tokenId });

    return res.status(200).json({
      status: 'success',
      message: 'Bank account linked successfully.',
    });
  })
);

module.exports = router;
