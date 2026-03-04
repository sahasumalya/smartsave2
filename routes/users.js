const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db/pool');
const { signToken, requireAuth } = require('../middleware/auth');
const { getCardType, validateCard } = require('../utils/cardUtils');
const { sendVerificationEmail } = require('../services/email');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

const SALT_ROUNDS = 10;
const REASON_SIGN_IN = 'SIGN_IN';

function generateOtp(length = 6) {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * digits.length)];
  }
  return otp;
}

const signupValidators = [
  body('fullName').isString().trim().notEmpty().withMessage('Full name is required').isLength({ max: 100 }),
  body('phoneNumber').optional().isString().trim(),
  body('email').isEmail().normalizeEmail(),
  body('emailVerificationToken').isString().trim().notEmpty().withMessage('Email must be verified'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('cardNumber').optional().isString().trim(),
  body('cardholderName').optional().isString().trim(),
  body('expiryDate').optional().isString().trim(),
  body('cvv').optional().isString().trim(),
];

/**
 * POST /api/v1/users/signup
 */
router.post('/signup', signupValidators, asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) {
    return res.status(400).json({
      status: 'error',
      errors: errs.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }

  const {
    fullName,
    phoneNumber,
    email,
    emailVerificationToken,
    password,
    cardNumber,
    cardholderName,
    expiryDate,
    cvv,
  } = req.body;

  // Verify email was verified (verification token from /auth/verification/verify)
  const tokenCheck = await pool.query(
    'SELECT 1 FROM email_validation WHERE email = ? AND verification_token = ? AND is_used = 1 ORDER BY created_at DESC LIMIT 1',
    [email, emailVerificationToken]
  );
  if (tokenCheck.rows.length === 0) {
    return res.status(400).json({
      status: 'error',
      message: 'Email must be verified. Complete verification first.',
    });
  }

  // Optional card validation if card data provided
  if (cardNumber || cardholderName || expiryDate || cvv) {
    const cardResult = validateCard({
      cardNumber: cardNumber || '',
      cardholderName: cardholderName || '',
      expiryDate: expiryDate || '',
      cvv: cvv || '',
    });
    if (!cardResult.valid) {
      return res.status(422).json({
        status: 'error',
        code: 'INVALID_CARD_DATA',
        errors: cardResult.errors,
      });
    }
  }

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT user_id FROM user_profile WHERE email = ?', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ status: 'error', message: 'User with same email id already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = crypto.randomUUID();
    await client.query(
      `INSERT INTO user_profile (user_id, full_name, email, phone_number, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, fullName, email, phoneNumber || null, passwordHash]
    );

    if (cardNumber && cardholderName && expiryDate) {
      const lastFour = String(cardNumber).replace(/\D/g, '').slice(-4);
      const cardType = getCardType(String(cardNumber).replace(/\D/g, ''));
      const cardId = crypto.randomUUID();
      await client.query(
        `INSERT INTO user_card_information (card_id, user_id, last_four, card_type, cardholder_name, expiry_date)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [cardId, userId, lastFour, cardType, cardholderName, expiryDate]
      );
    }

    const token = signToken({ userId }, '1h');
    return res.status(201).json({
      status: 'success',
      message: 'User created successfully',
      data: { userId: String(userId), token },
    });
  } finally {
    client.release();
  }
}));

const loginValidators = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

/**
 * POST /api/v1/users/login
 * Multi-step auth: validates credentials, sends OTP to email, returns Verification_token.
 * Client must call POST /api/v1/auth/verification/verify with email, code, verificationToken to get accessToken (JWT).
 */
router.post('/login', loginValidators, asyncHandler(async (req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) {
    return res.status(400).json({ status: 'error', message: 'Invalid email or password.' });
  }
  const { email, password } = req.body;

  const result = await pool.query(
    'SELECT user_id, full_name, email, password_hash FROM user_profile WHERE email = ?',
    [email]
  );
  if (result.rows.length === 0) {
    return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
  }
  const user = result.rows[0];
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) {
    return res.status(401).json({ status: 'error', message: 'Invalid email or password.' });
  }

  const otp = generateOtp(6);
  const verificationToken = crypto.randomUUID();

  await pool.query(
    `INSERT INTO email_validation (email, otp_code, is_used, reason, verification_token, updated_at)
     VALUES (?, ?, 0, ?, ?, NOW())`,
    [email, otp, REASON_SIGN_IN, verificationToken]
  );

  try {
    await sendVerificationEmail(email, otp, 'sign_in');
  } catch (err) {
    console.error('[login] Failed to send OTP email:', err.message);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to send verification code. Please try again later.',
    });
  }

  return res.status(200).json({
    status: 'success',
    message: 'valid credentials',
    data: {
      user: {
        Verification_token: verificationToken,
        email: user.email,
      },
    },
  });
}));

/**
 * POST /api/v1/users/logout
 * Client should discard the stored token.
 */
router.post('/logout', (req, res, next) => {
  try {
    return res.status(200).json({ status: 'success', message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/users/profile
 * Requires auth. Returns user, investments, masked card.
 */
router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  try {
    const userRow = await pool.query(
      'SELECT user_id, full_name, email, phone_number FROM user_profile WHERE user_id = ?',
      [userId]
    );
    if (userRow.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'User profile not found.',
      });
    }
    const u = userRow.rows[0];

    const invRows = await pool.query(
      `SELECT uip.asset_id, a.name, uip.percentage
       FROM user_investments_proportion uip
       JOIN assets a ON a.asset_id = uip.asset_id
       WHERE uip.user_id = ?`,
      [userId]
    );

    let paymentMethod = null;
    const cardRow = await pool.query(
      'SELECT cardholder_name, card_type, last_four, expiry_date FROM user_card_information WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1',
      [userId]
    );
    if (cardRow.rows.length > 0) {
      const c = cardRow.rows[0];
      paymentMethod = {
        cardholderName: c.cardholder_name,
        cardType: c.card_type,
        lastFour: c.last_four,
        expiryDate: c.expiry_date,
      };
    }

    return res.status(200).json({
      status: 'success',
      data: {
        user: {
          userId: String(u.user_id),
          fullName: u.full_name,
          email: u.email,
          phoneNumber: u.phone_number,
        },
        investments: invRows.rows.map((r) => ({
          assetId: r.asset_id,
          name: r.name,
          percentage: parseFloat(r.percentage),
        })),
        paymentMethod,
      },
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
}));

module.exports = router;
