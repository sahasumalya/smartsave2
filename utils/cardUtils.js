/**
 * Luhn (mod 10) check for card number validity.
 * @param {string} cardNumber - Digits only
 * @returns {boolean}
 */
function luhnCheck(cardNumber) {
  const digits = String(cardNumber).replace(/\D/g, '');
  if (digits.length < 15 || digits.length > 16) return false;
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = parseInt(digits[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

/**
 * Detect card type from IIN/BIN (first 1-2 digits).
 * @param {string} cardNumber - Digits only
 * @returns {string} e.g. 'Visa', 'Mastercard', 'Amex', 'Unknown'
 */
function getCardType(cardNumber) {
  const digits = String(cardNumber).replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^5[1-5]/.test(digits) || /^2[2-7]/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  return 'Unknown';
}

/**
 * Validate expiry string MM/YY or MM/YYYY. Must be future.
 * @param {string} expiryDate
 * @returns {{ valid: boolean, message?: string }}
 */
function validateExpiry(expiryDate) {
  if (!expiryDate || typeof expiryDate !== 'string') {
    return { valid: false, message: 'Expiry date is required.' };
  }
  const match = expiryDate.trim().match(/^(\d{1,2})\/(\d{2,4})$/);
  if (!match) {
    return { valid: false, message: 'Expiry must be in MM/YY or MM/YYYY format.' };
  }
  let month = parseInt(match[1], 10);
  let year = parseInt(match[2], 10);
  if (match[2].length === 2) year += 2000; // 28 -> 2028
  if (month < 1 || month > 12) {
    return { valid: false, message: 'Invalid month in expiry date.' };
  }
  const now = new Date();
  const expiry = new Date(year, month, 0); // last day of that month
  if (expiry < now) {
    return { valid: false, message: 'Card has already expired.' };
  }
  return { valid: true };
}

/**
 * Validate cardholder name: min 2 chars, no special symbols (allow letters, spaces, hyphens).
 * @param {string} name
 * @returns {{ valid: boolean, message?: string }}
 */
function validateCardholderName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, message: 'Cardholder name is required.' };
  }
  const trimmed = name.trim();
  if (trimmed.length < 2) {
    return { valid: false, message: 'Cardholder name must be at least 2 characters.' };
  }
  if (!/^[a-zA-Z\s\-']+$/.test(trimmed)) {
    return { valid: false, message: 'Cardholder name must not contain special symbols.' };
  }
  return { valid: true };
}

/**
 * Validate CVV: 3 digits (4 for Amex).
 * @param {string} cvv
 * @param {string} cardType - e.g. 'Amex'
 * @returns {{ valid: boolean, message?: string }}
 */
function validateCvv(cvv, cardType) {
  if (!cvv || typeof cvv !== 'string') {
    return { valid: false, message: 'CVV is required.' };
  }
  const digits = cvv.replace(/\D/g, '');
  const expectedLen = cardType === 'Amex' ? 4 : 3;
  if (digits.length !== expectedLen) {
    return {
      valid: false,
      message: cardType === 'Amex' ? 'CVV must be 4 digits for Amex.' : 'CVV must be 3 digits.',
    };
  }
  return { valid: true };
}

/**
 * Full card validation for validate-card endpoint.
 * @param {{ cardNumber: string, cardholderName: string, expiryDate: string, cvv: string }} body
 * @returns {{ valid: boolean, cardType?: string, errors: Array<{ field: string, message: string }> }}
 */
function validateCard(body) {
  const errors = [];
  const cardNumber = String(body.cardNumber || '').replace(/\D/g, '');

  if (!cardNumber || cardNumber.length < 15 || cardNumber.length > 16) {
    errors.push({ field: 'cardNumber', message: 'Card number must be 15 or 16 digits.' });
  } else if (!luhnCheck(cardNumber)) {
    errors.push({
      field: 'cardNumber',
      message: 'Checksum failed (Luhn check). Please verify the card number.',
    });
  }

  const cardType = cardNumber.length >= 15 ? getCardType(cardNumber) : 'Unknown';
  const nameResult = validateCardholderName(body.cardholderName);
  if (!nameResult.valid) errors.push({ field: 'cardholderName', message: nameResult.message });

  const expiryResult = validateExpiry(body.expiryDate);
  if (!expiryResult.valid) errors.push({ field: 'expiryDate', message: expiryResult.message });

  const cvvResult = validateCvv(body.cvv, cardType);
  if (!cvvResult.valid) errors.push({ field: 'cvv', message: cvvResult.message });

  return {
    valid: errors.length === 0,
    cardType: errors.length === 0 ? cardType : undefined,
    errors,
  };
}

module.exports = {
  luhnCheck,
  getCardType,
  validateExpiry,
  validateCardholderName,
  validateCvv,
  validateCard,
};
