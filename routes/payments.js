const express = require('express');
const { body, validationResult } = require('express-validator');
const { validateCard } = require('../utils/cardUtils');
const { asyncHandler } = require('../middleware/asyncHandler');

const router = express.Router();

const validateCardBody = [
  body('cardNumber').isString().trim().notEmpty().withMessage('Card number is required'),
  body('cardholderName').isString().trim().notEmpty().withMessage('Cardholder name is required'),
  body('expiryDate').isString().trim().notEmpty().withMessage('Expiry date is required'),
  body('cvv').isString().trim().notEmpty().withMessage('CVV is required'),
];

/**
 * POST /api/v1/payments/validate-card
 * Validates card using Luhn, cardholder name, expiry, CVV.
 */
router.post('/validate-card', validateCardBody, asyncHandler((req, res) => {
  const errs = validationResult(req);
  if (!errs.isEmpty()) {
    return res.status(422).json({
      status: 'error',
      code: 'INVALID_CARD_DATA',
      errors: errs.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  const result = validateCard(req.body);
  if (!result.valid) {
    return res.status(422).json({
      status: 'error',
      code: 'INVALID_CARD_DATA',
      errors: result.errors,
    });
  }
  return res.status(200).json({
    status: 'success',
    valid: true,
    cardType: result.cardType,
    message: 'Card details are structurally valid',
  });
}));

module.exports = router;
