// No DB interaction — payments/validate-card is pure card validation
jest.mock('../../db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../services/email', () => ({ sendVerificationEmail: jest.fn() }));

const request = require('supertest');
const express = require('express');
const paymentsRoutes = require('../../routes/payments');

const app = express();
app.use(express.json());
app.use('/api/v1/payments', paymentsRoutes);

const FUTURE_EXPIRY = '12/30';

const validVisa = {
  cardNumber: '4111111111111111',
  cardholderName: 'Jane Doe',
  expiryDate: FUTURE_EXPIRY,
  cvv: '123',
};

const validMastercard = {
  cardNumber: '5500005555555559',
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

describe('POST /api/v1/payments/validate-card', () => {
  test('valid Visa card returns 200 with cardType Visa', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send(validVisa);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.valid).toBe(true);
    expect(res.body.cardType).toBe('Visa');
    expect(res.body.message).toBe('Card details are structurally valid');
  });

  test('valid Mastercard returns 200 with cardType Mastercard', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send(validMastercard);

    expect(res.status).toBe(200);
    expect(res.body.cardType).toBe('Mastercard');
  });

  test('valid Amex returns 200 with cardType Amex', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send(validAmex);

    expect(res.status).toBe(200);
    expect(res.body.cardType).toBe('Amex');
  });

  test('card failing Luhn check returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({ ...validVisa, cardNumber: '4111111111111112' });

    expect(res.status).toBe(422);
    expect(res.body.status).toBe('error');
    expect(res.body.code).toBe('INVALID_CARD_DATA');
    const cardErr = res.body.errors.find((e) => e.field === 'cardNumber');
    expect(cardErr).toBeDefined();
  });

  test('card number too short returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({ ...validVisa, cardNumber: '4111111111' });

    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'cardNumber')).toBe(true);
  });

  test('expired card returns 422 with expiryDate error', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({ ...validVisa, expiryDate: '01/20' });

    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'expiryDate')).toBe(true);
  });

  test('invalid expiry format returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({ ...validVisa, expiryDate: 'invalid' });

    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'expiryDate')).toBe(true);
  });

  test('invalid cardholder name (too short) returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({ ...validVisa, cardholderName: 'J' });

    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'cardholderName')).toBe(true);
  });

  test('cardholder name with special characters returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({ ...validVisa, cardholderName: 'Jane@Doe' });

    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'cardholderName')).toBe(true);
  });

  test('wrong CVV length for Visa returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({ ...validVisa, cvv: '1234' });

    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'cvv')).toBe(true);
  });

  test('wrong CVV length for Amex (3 digits) returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({ ...validAmex, cvv: '123' });

    expect(res.status).toBe(422);
    expect(res.body.errors.some((e) => e.field === 'cvv')).toBe(true);
  });

  test('missing cardNumber returns 422', async () => {
    const { cardNumber, ...body } = validVisa;
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send(body);

    expect(res.status).toBe(422);
  });

  test('missing cvv returns 422', async () => {
    const { cvv, ...body } = validVisa;
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send(body);

    expect(res.status).toBe(422);
  });

  test('empty request body returns 422', async () => {
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({});

    expect(res.status).toBe(422);
  });

  test('multiple invalid fields returns errors array with multiple entries', async () => {
    // All fields are non-empty (pass express-validator) but invalid for validateCard
    const res = await request(app)
      .post('/api/v1/payments/validate-card')
      .send({
        cardNumber: '4111111111111112', // fails Luhn
        cardholderName: 'J',            // too short (passes express-validator, fails validateCard)
        expiryDate: '01/20',            // expired
        cvv: '1',                       // wrong length
      });

    expect(res.status).toBe(422);
    expect(res.body.errors.length).toBeGreaterThan(1);
  });
});