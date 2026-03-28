const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { pool } = require('../db/pool');
const { signToken, requireAuth } = require('../middleware/auth');
const { getCardType, validateCard } = require('../utils/cardUtils');
const { encrypt, decrypt } = require('../utils/encryption');
const { sendVerificationEmail } = require('../services/email');
const { asyncHandler } = require('../middleware/asyncHandler');
const { debug, error: logError } = require('../utils/logger');

const router = express.Router();

const SALT_ROUNDS = 10;
const REASON_SIGN_IN = 'SIGN_IN';

function generateOtp(length = 4) {
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

  const { fullName, phoneNumber, email, emailVerificationToken, password } = req.body;

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

  const client = await pool.connect();
  try {
    const existing = await client.query('SELECT user_id FROM user_profile WHERE email = ?', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ status: 'error', message: 'User with same email id already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = crypto.randomUUID();
    const phoneNumberEncrypted = phoneNumber ? encrypt(phoneNumber) : null;
    await client.query(
      `INSERT INTO user_profile (user_id, full_name, email, phone_number, password_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, fullName, email, phoneNumberEncrypted, passwordHash]
    );

    const token = signToken({ userId }, '1h');
    return res.status(201).json({
      status: 'success',
      message: 'User created successfully',
      data: { token },
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

  const otp = generateOtp(4);
  const verificationToken = crypto.randomUUID();

  await pool.query(
    `INSERT INTO email_validation (email, otp_code, is_used, reason, verification_token, updated_at)
     VALUES (?, ?, 0, ?, ?, NOW())`,
    [email, otp, REASON_SIGN_IN, verificationToken]
  );

  try {
    await sendVerificationEmail(email, otp, 'sign_in');
    debug('login OTP sent', { email });
  } catch (err) {
    logError('login email failed', err.message);
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

const changePasswordValidators = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .custom((value) => /[A-Za-z]/.test(value) && /\d/.test(value))
    .withMessage('New password must contain at least one letter and one number'),
  body('confirmNewPassword')
    .notEmpty()
    .withMessage('Confirm new password is required')
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('newPassword and confirmNewPassword do not match'),
];

/**
 * PATCH /api/v1/users/change-password
 * Auth required. Validates current password; on wrong password returns 403 with generic message.
 */
router.patch(
  '/change-password',
  requireAuth(),
  changePasswordValidators,
  asyncHandler(async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      const firstMsg = errs.array()[0]?.msg;
      return res.status(400).json({
        status: 'error',
        message: firstMsg || 'Validation failed',
        errors: errs.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const userId = req.user.userId;
    const { currentPassword, newPassword } = req.body;

    const userRow = await pool.query(
      'SELECT password_hash FROM user_profile WHERE user_id = ?',
      [userId]
    );
    if (userRow.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User profile not found.' });
    }

    const match = await bcrypt.compare(currentPassword, userRow.rows[0].password_hash);
    if (!match) {
      return res.status(403).json({
        status: 'error',
        message: 'Access denied. Please check your request and try again.',
      });
    }

    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE user_profile SET password_hash = ?, updated_at = NOW() WHERE user_id = ?', [
      newHash,
      userId,
    ]);

    return res.status(200).json({
      status: 'success',
      message: 'Password updated successfully',
    });
  })
);

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

const addCardValidators = [
  body('verificationToken').isString().trim().notEmpty().withMessage('Verification token is required'),
  body('cardNumber').isString().trim().notEmpty().withMessage('Card number is required'),
  body('cardholderName').isString().trim().notEmpty().withMessage('Cardholder name is required'),
  body('expiryDate').isString().trim().notEmpty().withMessage('Expiry date is required'),
  body('cvv').isString().trim().notEmpty().withMessage('CVV is required'),
  body('isDefault').optional().isBoolean().withMessage('isDefault must be true or false'),
];

const OTP_EXPIRY_MINUTES = 10;

/**
 * POST /api/v1/users/card
 * Add card with verification. Requires prior POST /payments/verify-card-initiate and same verify-email API (email + code) to get verificationToken.
 */
router.post(
  '/card',
  requireAuth('Please log in to add a payment method.'),
  addCardValidators,
  asyncHandler(async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(422).json({
        status: 'error',
        message: 'Card validation failed. Please check your details.',
        errors: errs.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const userId = req.user.userId;
    const isDefault = req.body.isDefault === true || req.body.isDefault === 'true';
    const { verificationToken, cardNumber, cardholderName, expiryDate, cvv } = req.body;

    const userRow = await pool.query(
      'SELECT email FROM user_profile WHERE user_id = ?',
      [userId]
    );
    if (userRow.rows.length === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Please log in to add a payment method.',
      });
    }
    const userEmail = userRow.rows[0].email;

    const tokenRow = await pool.query(
      `SELECT id, email, is_used, created_at FROM email_validation
       WHERE verification_token = ? AND reason = 'CARD_VERIFICATION' ORDER BY created_at DESC LIMIT 1`,
      [verificationToken.trim()]
    );
    if (tokenRow.rows.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'The verification token is invalid or has expired.',
      });
    }
    const rec = tokenRow.rows[0];
    if (Number(rec.is_used) === 1) {
      return res.status(400).json({
        status: 'error',
        message: 'The verification token is invalid or has expired.',
      });
    }
    if (rec.email !== userEmail) {
      return res.status(400).json({
        status: 'error',
        message: 'The verification token is invalid or has expired.',
      });
    }
    const createdAt = new Date(rec.created_at);
    const expiry = new Date(createdAt.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000);
    if (new Date() > expiry) {
      return res.status(400).json({
        status: 'error',
        message: 'The verification token is invalid or has expired.',
      });
    }

    const pendingRow = await pool.query(
      'SELECT id FROM card_verification_initiated WHERE user_id = ? AND expires_at > NOW() AND is_used = 0 ORDER BY initiated_at DESC LIMIT 1',
      [userId]
    );
    if (pendingRow.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No pending card validation found for this user.',
      });
    }
    const initiatedRowId = pendingRow.rows[0].id;

    const cardResult = validateCard({
      cardNumber,
      cardholderName,
      expiryDate,
      cvv,
    });
    if (!cardResult.valid) {
      return res.status(422).json({
        status: 'error',
        message: 'Card validation failed. Please check your details.',
        errors: cardResult.errors,
      });
    }

    const digits = String(cardNumber).replace(/\D/g, '');
    const lastFour = digits.slice(-4);
    const existingCards = await pool.query(
      'SELECT card_number_encrypted, last_four FROM user_card_information WHERE user_id = ?',
      [userId]
    );
    for (const row of existingCards.rows) {
      let existingLastFour;
      if (row.card_number_encrypted) {
        try {
          existingLastFour = decrypt(row.card_number_encrypted).slice(-4);
        } catch {
          existingLastFour = row.last_four;
        }
      } else {
        existingLastFour = row.last_four;
      }
      if (existingLastFour === lastFour) {
        return res.status(409).json({
          status: 'error',
          message: 'This card is already linked to your account.',
        });
      }
    }

    const cardType = getCardType(digits);
    const cardId = crypto.randomUUID();
    const cardNumberEncrypted = encrypt(digits);
    const cvvEncrypted = encrypt(String(cvv).trim());
    const cardholderNameEncrypted = encrypt(cardholderName.trim());
    const expiryDateEncrypted = encrypt(expiryDate.trim());

    const isOnlyCard = existingCards.rows.length === 0;
    const setAsDefault = isOnlyCard || isDefault;

    const client = await pool.connect();
    try {
      if (setAsDefault) {
        await client.query(
          'UPDATE user_card_information SET is_default = 0 WHERE user_id = ?',
          [userId]
        );
      }
      await client.query(
        `INSERT INTO user_card_information (card_id, user_id, card_number_encrypted, cvv_encrypted, card_type, cardholder_name_encrypted, expiry_date_encrypted, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [cardId, userId, cardNumberEncrypted, cvvEncrypted, cardType, cardholderNameEncrypted, expiryDateEncrypted, setAsDefault ? 1 : 0]
      );
      await client.query(
        'UPDATE email_validation SET is_used = 1, updated_at = NOW() WHERE id = ?',
        [rec.id]
      );
      await client.query(
        'UPDATE card_verification_initiated SET is_used = 1 WHERE id = ?',
        [initiatedRowId]
      );
    } finally {
      client.release();
    }

    return res.status(201).json({
      status: 'success',
      message: 'Payment method added and verified successfully.',
      data: { lastFour, cardType, isDefault: setAsDefault },
    });
  })
);

const editProfileValidators = [
  body('fullName')
    .optional()
    .isString().trim().notEmpty().withMessage('Full name cannot be empty')
    .isLength({ max: 100 }).withMessage('Full name must be at most 100 characters'),
  body('phoneNumber')
    .optional()
    .isString().trim().notEmpty().withMessage('Phone number cannot be empty'),
  body('dateOfBirth')
    .optional()
    .isISO8601({ strict: true }).withMessage('Date of birth must be a valid date (YYYY-MM-DD)')
    .custom((value) => {
      const dob = new Date(value);
      if (dob >= new Date()) throw new Error('Date of birth must be in the past');
      return true;
    }),
];

/**
 * POST /api/v1/users/profile/edit
 * Auth required. Update name, phone number, and/or date of birth.
 * At least one field must be provided.
 */
router.post(
  '/profile/edit',
  requireAuth(),
  editProfileValidators,
  asyncHandler(async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: errs.array()[0]?.msg || 'Validation failed',
        errors: errs.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const { fullName, phoneNumber, dateOfBirth } = req.body;

    if (fullName === undefined && phoneNumber === undefined && dateOfBirth === undefined) {
      return res.status(400).json({
        status: 'error',
        message: 'At least one field (fullName, phoneNumber, dateOfBirth) is required.',
      });
    }

    const userId = req.user.userId;

    const userRow = await pool.query(
      'SELECT user_id FROM user_profile WHERE user_id = ?',
      [userId]
    );
    if (userRow.rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User profile not found.' });
    }

    const setClauses = [];
    const params = [];

    if (fullName !== undefined) {
      setClauses.push('full_name = ?');
      params.push(fullName.trim());
    }
    if (phoneNumber !== undefined) {
      setClauses.push('phone_number = ?');
      params.push(encrypt(phoneNumber.trim()));
    }
    if (dateOfBirth !== undefined) {
      setClauses.push('date_of_birth = ?');
      params.push(encrypt(dateOfBirth));
    }

    setClauses.push('updated_at = NOW()');
    params.push(userId);

    await pool.query(
      `UPDATE user_profile SET ${setClauses.join(', ')} WHERE user_id = ?`,
      params
    );

    return res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
    });
  })
);

/**
 * GET /api/v1/users/profile
 * Requires auth. Returns user, investments, masked card.
 */
router.get('/profile', requireAuth(), asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  try {
    const userRow = await pool.query(
      'SELECT user_id, full_name, email, phone_number, date_of_birth FROM user_profile WHERE user_id = ?',
      [userId]
    );
    if (userRow.rows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'User profile not found.',
      });
    }
    const u = userRow.rows[0];
    let phoneNumber = null;
    if (u.phone_number) {
      try {
        phoneNumber = decrypt(u.phone_number);
      } catch (err) {
        logError('profile decrypt phone_number failed', err.message);
      }
    }
    let dateOfBirth = null;
    if (u.date_of_birth) {
      try {
        dateOfBirth = decrypt(u.date_of_birth);
      } catch (err) {
        logError('profile decrypt date_of_birth failed', err.message);
      }
    }

    const invRows = await pool.query(
      `SELECT uip.asset_id, a.name, uip.percentage
       FROM user_investments_proportion uip
       JOIN assets a ON a.asset_id = uip.asset_id
       WHERE uip.user_id = ?`,
      [userId]
    );

    let paymentMethod = null;
    const cardRow = await pool.query(
      `SELECT card_number_encrypted, cardholder_name_encrypted, expiry_date_encrypted, card_type, last_four, cardholder_name, expiry_date, is_default
       FROM user_card_information WHERE user_id = ? ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
      [userId]
    );
    if (cardRow.rows.length > 0) {
      const c = cardRow.rows[0];
      let cardholderName, lastFour, expiryDate;
      if (c.card_number_encrypted) {
        try {
          const fullNumber = decrypt(c.card_number_encrypted);
          lastFour = fullNumber.slice(-4);
          cardholderName = c.cardholder_name_encrypted ? decrypt(c.cardholder_name_encrypted) : null;
          expiryDate = c.expiry_date_encrypted ? decrypt(c.expiry_date_encrypted) : null;
        } catch (err) {
          logError('profile decrypt card data failed', err.message);
          lastFour = c.last_four;
          cardholderName = c.cardholder_name;
          expiryDate = c.expiry_date;
        }
      } else {
        lastFour = c.last_four;
        cardholderName = c.cardholder_name;
        expiryDate = c.expiry_date;
      }
      paymentMethod = {
        cardholderName: cardholderName ?? null,
        cardType: c.card_type ?? null,
        lastFour: lastFour ?? null,
        expiryDate: expiryDate ?? null,
        isDefault: Number(c.is_default) === 1,
      };
    }

    return res.status(200).json({
      status: 'success',
      data: {
        user: {
          fullName: u.full_name,
          email: u.email,
          phoneNumber,
          dateOfBirth,
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
    logError('profile', err.message);
    throw err;
  }
}));

module.exports = router;
