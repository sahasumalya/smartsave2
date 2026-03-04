const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db/pool');
const { sendVerificationEmail } = require('../services/email');
const { signToken } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

const OTP_EXPIRY_MINUTES = 10;
const RATE_LIMIT_WINDOW_MINUTES = 1;
const RATE_LIMIT_MAX_REQUESTS = 3;
const RETRY_AFTER_SECONDS = 60;

const REASON_SIGN_UP = 'SIGN_UP';
const REASON_SIGN_IN = 'SIGN_IN';

function generateOtp(length = 6) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

function normalizeReason(reason) {
  if (!reason || typeof reason !== 'string') return REASON_SIGN_UP;
  const r = reason.trim().toUpperCase();
  if (r === 'SIGN_IN' || r === 'SIGNIN') return REASON_SIGN_IN;
  if (r === 'SIGN_UP' || r === 'SIGNUP' || r === 'SIGNUP') return REASON_SIGN_UP;
  return reason.trim() || REASON_SIGN_UP;
}

/**
 * POST /api/v1/auth/verification/send
 * Generate OTP and store in email_validation. Rate limit via email_validation_limit (per-minute).
 * In production you would send email via nodemailer etc.; here we only store OTP.
 */
router.post(
  '/verification/send',
  [
    body('email').isEmail().normalizeEmail().withMessage('Invalid email format'),
    body('reason').optional().isString(),
  ],
  asyncHandler(async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({ status: 'error', message: 'Invalid email format.' });
    }
    const email = req.body.email;
    const reason = normalizeReason(req.body.reason);

    if (reason === REASON_SIGN_UP) {
      const existingUser = await pool.query('SELECT 1 FROM user_profile WHERE email = ?', [email]);
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ status: 'error', message: 'Email already registered.' });
      }
    }

    const client = await pool.connect();
    try {
      const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);
      const limitRow = await client.query(
        'SELECT request_count, last_request_at FROM email_validation_limit WHERE email = ?',
        [email]
      );
      if (limitRow.rows.length > 0) {
        const row = limitRow.rows[0];
        const lastAt = new Date(row.last_request_at);
        if (lastAt >= windowStart && row.request_count >= RATE_LIMIT_MAX_REQUESTS) {
          return res.status(429).json({
            status: 'error',
            message: 'Too many requests. Please try again later.',
            retryAfterSeconds: RETRY_AFTER_SECONDS,
          });
        }
        if (lastAt < windowStart) {
          await client.query(
            'UPDATE email_validation_limit SET request_count = 1, last_request_at = NOW(), updated_at = NOW(), reset_at = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE email = ?',
            [email]
          );
        } else {
          await client.query(
            'UPDATE email_validation_limit SET request_count = request_count + 1, last_request_at = NOW(), updated_at = NOW() WHERE email = ?',
            [email]
          );
        }
      } else {
        await client.query(
          `INSERT INTO email_validation_limit (email, request_count, last_request_at, reset_at, updated_at)
           VALUES (?, 1, NOW(), DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW())
           ON DUPLICATE KEY UPDATE request_count = 1, last_request_at = NOW(), reset_at = DATE_ADD(NOW(), INTERVAL 24 HOUR), updated_at = NOW()`,
          [email]
        );
      }

      const otp = generateOtp(6);
      await client.query(
        'INSERT INTO email_validation (email, otp_code, is_used, reason, updated_at) VALUES (?, ?, 0, ?, NOW())',
        [email, otp, reason]
      );

      try {
        await sendVerificationEmail(email, otp, req.body.reason);
      } catch (err) {
        console.error('[verification/send] Failed to send email:', err.message);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to send verification email. Please try again later.',
        });
      }

      return res.status(200).json({
        status: 'success',
        message: `Verification code sent to ${email}`,
        retryAfterSeconds: RETRY_AFTER_SECONDS,
      });
    } finally {
      client.release();
    }
  })
);

/**
 * POST /api/v1/auth/verification/verify
 * Signup flow: email + code → return verificationToken (for signup API).
 * Login flow: email + code + verificationToken (from login response) → return accessToken (JWT).
 */
router.post(
  '/verification/verify',
  [
    body('email').isEmail().normalizeEmail(),
    body('code').isString().trim().notEmpty().withMessage('Code is required'),
    body('verificationToken').optional().isString().trim(),
  ],
  asyncHandler(async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({ status: 'error', message: 'Invalid request.' });
    }
    const { email, code, verificationToken: loginVerificationToken } = req.body;
    const isLoginFlow = Boolean(loginVerificationToken && loginVerificationToken.length > 0);

    const client = await pool.connect();
    try {
      let row;
      if (isLoginFlow) {
        row = await client.query(
          `SELECT id, otp_code, is_used, created_at, reason FROM email_validation
           WHERE email = ? AND verification_token = ? ORDER BY created_at DESC LIMIT 1`,
          [email, loginVerificationToken]
        );
      } else {
        row = await client.query(
          `SELECT id, otp_code, is_used, created_at, verification_token FROM email_validation
           WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
          [email]
        );
      }

      if (row.rows.length === 0) {
        return res.status(400).json({ status: 'error', message: 'Incorrect or expired code.' });
      }
      const rec = row.rows[0];
      if (Number(rec.is_used) === 1) {
        return res.status(400).json({ status: 'error', message: 'Incorrect or expired code.' });
      }
      const createdAt = new Date(rec.created_at);
      const expiry = new Date(createdAt.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
      if (new Date() > expiry) {
        return res.status(410).json({
          status: 'error',
          message: 'Verification session expired.',
        });
      }
      if (rec.otp_code !== String(code).trim()) {
        return res.status(400).json({ status: 'error', message: 'Incorrect or expired code.' });
      }

      if (isLoginFlow) {
        const userRow = await client.query(
          'SELECT user_id FROM user_profile WHERE email = ?',
          [email]
        );
        if (userRow.rows.length === 0) {
          return res.status(400).json({ status: 'error', message: 'Incorrect or expired code.' });
        }
        const userId = userRow.rows[0].user_id;
        await client.query(
          'UPDATE email_validation SET is_used = 1, updated_at = NOW() WHERE id = ?',
          [rec.id]
        );
        const accessToken = signToken({ userId }, '1h');
        return res.status(200).json({
          status: 'success',
          message: 'Email verified successfully',
          accessToken,
        });
      }

      const verificationToken = 'v_tok_' + crypto.randomBytes(12).toString('hex');
      await client.query(
        'UPDATE email_validation SET is_used = 1, verification_token = ?, updated_at = NOW() WHERE id = ?',
        [verificationToken, rec.id]
      );
      return res.status(200).json({
        status: 'success',
        message: 'Email verified successfully',
        verificationToken,
      });
    } finally {
      client.release();
    }
  })
);

module.exports = router;
