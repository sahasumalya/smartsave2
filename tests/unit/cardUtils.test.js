const {
  luhnCheck,
  getCardType,
  validateExpiry,
  validateCardholderName,
  validateCvv,
  validateCard,
} = require('../../utils/cardUtils');

// Future expiry for all tests (well beyond current date)
const FUTURE_EXPIRY = '12/30';

describe('luhnCheck', () => {
  test('valid Visa (16 digits) passes', () => {
    expect(luhnCheck('4111111111111111')).toBe(true);
  });

  test('valid Mastercard (16 digits) passes', () => {
    expect(luhnCheck('5500005555555559')).toBe(true);
  });

  test('valid Amex (15 digits) passes', () => {
    expect(luhnCheck('371449635398431')).toBe(true);
  });

  test('invalid card number (bad checksum) fails', () => {
    expect(luhnCheck('4111111111111112')).toBe(false);
  });

  test('card number too short (< 15 digits) fails', () => {
    expect(luhnCheck('41111111111111')).toBe(false);
  });

  test('card number too long (> 16 digits) fails', () => {
    expect(luhnCheck('41111111111111111')).toBe(false);
  });

  test('strips hyphens and spaces before checking', () => {
    expect(luhnCheck('4111-1111-1111-1111')).toBe(true);
  });

  test('strips spaces before checking', () => {
    expect(luhnCheck('4111 1111 1111 1111')).toBe(true);
  });

  test('modified Amex number with wrong last digit fails Luhn', () => {
    // 371449635398431 is valid; changing last digit to 2 makes it invalid
    expect(luhnCheck('371449635398432')).toBe(false);
  });
});

describe('getCardType', () => {
  test('returns Visa for card starting with 4', () => {
    expect(getCardType('4111111111111111')).toBe('Visa');
  });

  test('returns Mastercard for card starting with 51', () => {
    expect(getCardType('5100000000000000')).toBe('Mastercard');
  });

  test('returns Mastercard for card starting with 55', () => {
    expect(getCardType('5500005555555559')).toBe('Mastercard');
  });

  test('returns Mastercard for card starting with 22 (new range)', () => {
    expect(getCardType('2221000000000000')).toBe('Mastercard');
  });

  test('returns Mastercard for card starting with 27', () => {
    expect(getCardType('2720000000000000')).toBe('Mastercard');
  });

  test('returns Amex for card starting with 34', () => {
    expect(getCardType('341111111111111')).toBe('Amex');
  });

  test('returns Amex for card starting with 37', () => {
    expect(getCardType('371449635398431')).toBe('Amex');
  });

  test('returns Unknown for unrecognised prefix', () => {
    expect(getCardType('6011111111111117')).toBe('Unknown');
  });

  test('strips non-digit characters before detecting', () => {
    expect(getCardType('4111-1111-1111-1111')).toBe('Visa');
  });
});

describe('validateExpiry', () => {
  test('valid MM/YY format in future returns valid', () => {
    expect(validateExpiry('12/30')).toEqual({ valid: true });
  });

  test('valid MM/YYYY format in future returns valid', () => {
    expect(validateExpiry('06/2030')).toEqual({ valid: true });
  });

  test('expired card returns invalid', () => {
    const result = validateExpiry('01/20');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('expired');
  });

  test('invalid month 0 returns invalid', () => {
    const result = validateExpiry('00/30');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('month');
  });

  test('invalid month 13 returns invalid', () => {
    const result = validateExpiry('13/30');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('month');
  });

  test('wrong format (no slash) returns invalid', () => {
    const result = validateExpiry('1230');
    expect(result.valid).toBe(false);
  });

  test('null input returns invalid', () => {
    const result = validateExpiry(null);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('required');
  });

  test('empty string returns invalid', () => {
    const result = validateExpiry('');
    expect(result.valid).toBe(false);
  });

  test('MM/YY format with year 2000 offset applies correctly', () => {
    // 12/99 → December 2099, definitely in future
    expect(validateExpiry('12/99')).toEqual({ valid: true });
  });
});

describe('validateCardholderName', () => {
  test('valid full name returns valid', () => {
    expect(validateCardholderName('Jane Doe')).toEqual({ valid: true });
  });

  test('name with hyphen returns valid', () => {
    expect(validateCardholderName('Mary-Jane Watson')).toEqual({ valid: true });
  });

  test('name with apostrophe returns valid', () => {
    expect(validateCardholderName("O'Brien")).toEqual({ valid: true });
  });

  test('single character name returns invalid', () => {
    const result = validateCardholderName('J');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('2 characters');
  });

  test('name with numbers returns invalid', () => {
    const result = validateCardholderName('Jane123');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('special symbols');
  });

  test('name with special symbols (@) returns invalid', () => {
    const result = validateCardholderName('Jane@Doe');
    expect(result.valid).toBe(false);
  });

  test('null input returns invalid', () => {
    const result = validateCardholderName(null);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('required');
  });

  test('empty string returns invalid', () => {
    const result = validateCardholderName('');
    expect(result.valid).toBe(false);
  });

  test('whitespace-only string returns invalid', () => {
    const result = validateCardholderName('   ');
    expect(result.valid).toBe(false);
  });
});

describe('validateCvv', () => {
  test('3-digit CVV for Visa returns valid', () => {
    expect(validateCvv('123', 'Visa')).toEqual({ valid: true });
  });

  test('3-digit CVV for Mastercard returns valid', () => {
    expect(validateCvv('456', 'Mastercard')).toEqual({ valid: true });
  });

  test('4-digit CVV for Amex returns valid', () => {
    expect(validateCvv('1234', 'Amex')).toEqual({ valid: true });
  });

  test('4-digit CVV for non-Amex returns invalid', () => {
    const result = validateCvv('1234', 'Visa');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('3 digits');
  });

  test('3-digit CVV for Amex returns invalid', () => {
    const result = validateCvv('123', 'Amex');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('4 digits');
  });

  test('2-digit CVV returns invalid', () => {
    const result = validateCvv('12', 'Visa');
    expect(result.valid).toBe(false);
  });

  test('null CVV returns invalid', () => {
    const result = validateCvv(null, 'Visa');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('required');
  });
});

describe('validateCard', () => {
  const validVisa = {
    cardNumber: '4111111111111111',
    cardholderName: 'Jane Doe',
    expiryDate: FUTURE_EXPIRY,
    cvv: '123',
  };

  const validAmex = {
    cardNumber: '371449635398431',
    cardholderName: 'Jane Doe',
    expiryDate: FUTURE_EXPIRY,
    cvv: '1234',
  };

  test('valid Visa card returns valid with cardType Visa', () => {
    const result = validateCard(validVisa);
    expect(result.valid).toBe(true);
    expect(result.cardType).toBe('Visa');
    expect(result.errors).toHaveLength(0);
  });

  test('valid Amex card returns valid with cardType Amex', () => {
    const result = validateCard(validAmex);
    expect(result.valid).toBe(true);
    expect(result.cardType).toBe('Amex');
    expect(result.errors).toHaveLength(0);
  });

  test('invalid Luhn adds cardNumber error', () => {
    const result = validateCard({ ...validVisa, cardNumber: '4111111111111112' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'cardNumber')).toBe(true);
  });

  test('short card number adds cardNumber error', () => {
    const result = validateCard({ ...validVisa, cardNumber: '41111' });
    expect(result.valid).toBe(false);
    const cardErr = result.errors.find((e) => e.field === 'cardNumber');
    expect(cardErr).toBeDefined();
    expect(cardErr.message).toContain('15 or 16 digits');
  });

  test('expired expiry adds expiryDate error', () => {
    const result = validateCard({ ...validVisa, expiryDate: '01/20' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'expiryDate')).toBe(true);
  });

  test('invalid cardholder name adds cardholderName error', () => {
    const result = validateCard({ ...validVisa, cardholderName: 'J' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'cardholderName')).toBe(true);
  });

  test('wrong CVV length adds cvv error', () => {
    const result = validateCard({ ...validVisa, cvv: '12' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === 'cvv')).toBe(true);
  });

  test('multiple invalid fields returns multiple errors', () => {
    const result = validateCard({
      cardNumber: 'invalid',
      cardholderName: '',
      expiryDate: '01/20',
      cvv: '1',
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });

  test('cardType is undefined when card is invalid', () => {
    const result = validateCard({ ...validVisa, cardNumber: '4111111111111112' });
    expect(result.cardType).toBeUndefined();
  });

  test('valid Mastercard returns correct cardType', () => {
    const result = validateCard({
      cardNumber: '5500005555555559',
      cardholderName: 'Jane Doe',
      expiryDate: FUTURE_EXPIRY,
      cvv: '123',
    });
    expect(result.valid).toBe(true);
    expect(result.cardType).toBe('Mastercard');
  });
});