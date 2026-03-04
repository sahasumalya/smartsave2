jest.mock('../../db/pool', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../../services/email', () => ({
  sendVerificationEmail: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const { pool } = require('../../db/pool');
const investmentsRoutes = require('../../routes/investments');
const { signToken } = require('../../middleware/auth');

const app = express();
app.use(express.json());
app.use('/api/v1/investments', investmentsRoutes);

function authHeader(userId = 'user-uuid-123') {
  return `Bearer ${signToken({ userId })}`;
}

describe('POST /api/v1/investments/proportion', () => {
  let mockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClient = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(mockClient);
  });

  test('returns 200 for valid proportions summing to 100', async () => {
    mockClient.query
      .mockResolvedValueOnce({
        rows: [{ asset_id: 'EQUITY_FUND_01' }, { asset_id: 'GOVT_BOND_02' }, { asset_id: 'CRYPTO_INDEX' }],
      })                          // asset validation
      .mockResolvedValueOnce({ rows: [] })  // delete existing
      .mockResolvedValueOnce({ rows: [] })  // insert EQUITY_FUND_01
      .mockResolvedValueOnce({ rows: [] })  // insert GOVT_BOND_02
      .mockResolvedValueOnce({ rows: [] }); // insert CRYPTO_INDEX

    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({
        proportions: [
          { assetId: 'EQUITY_FUND_01', percentage: 60 },
          { assetId: 'GOVT_BOND_02', percentage: 30 },
          { assetId: 'CRYPTO_INDEX', percentage: 10 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.message).toBe('Investment proportions updated successfully');
    expect(res.body.data.totalAllocation).toBe(100);
    expect(res.body.data.updatedAt).toBeDefined();
    expect(mockClient.release).toHaveBeenCalled();
  });

  test('returns 200 for single asset at 100%', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ asset_id: 'EQUITY_FUND_01' }] })
      .mockResolvedValueOnce({ rows: [] })  // delete
      .mockResolvedValueOnce({ rows: [] }); // insert

    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({ proportions: [{ assetId: 'EQUITY_FUND_01', percentage: 100 }] });

    expect(res.status).toBe(200);
  });

  test('returns 200 for float percentages summing to 100 within tolerance', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ asset_id: 'EQUITY_FUND_01' }, { asset_id: 'GOVT_BOND_02' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({
        proportions: [
          { assetId: 'EQUITY_FUND_01', percentage: 33.34 },
          { assetId: 'GOVT_BOND_02', percentage: 66.66 },
        ],
      });

    // 33.34 + 66.66 = 100.00, within 0.01 tolerance
    expect(res.status).toBe(200);
  });

  test('returns 400 when proportions do not sum to 100', async () => {
    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({
        proportions: [
          { assetId: 'EQUITY_FUND_01', percentage: 60 },
          { assetId: 'GOVT_BOND_02', percentage: 20 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('100%');
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('returns 400 when proportions array is empty', async () => {
    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({ proportions: [] });

    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('returns 400 when proportions field is missing', async () => {
    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({});

    expect(res.status).toBe(400);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('returns 422 when an assetId does not exist in the portfolio', async () => {
    mockClient.query.mockResolvedValueOnce({
      rows: [{ asset_id: 'EQUITY_FUND_01' }], // only one asset found, UNKNOWN_ASSET is missing
    });

    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({
        proportions: [
          { assetId: 'EQUITY_FUND_01', percentage: 50 },
          { assetId: 'UNKNOWN_ASSET', percentage: 50 },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.message).toContain('UNKNOWN_ASSET');
    expect(res.body.message).toContain('does not exist');
  });

  test('returns 422 when all assetIds are invalid', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }); // no valid assets found

    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({ proportions: [{ assetId: 'FAKE_ASSET', percentage: 100 }] });

    expect(res.status).toBe(422);
  });

  test('returns 401 when Authorization header is missing', async () => {
    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .send({ proportions: [{ assetId: 'EQUITY_FUND_01', percentage: 100 }] });

    expect(res.status).toBe(401);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  test('returns 401 with invalid token', async () => {
    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', 'Bearer bad.token')
      .send({ proportions: [{ assetId: 'EQUITY_FUND_01', percentage: 100 }] });

    expect(res.status).toBe(401);
  });

  test('returns 400 when a percentage is negative', async () => {
    const res = await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({
        proportions: [
          { assetId: 'EQUITY_FUND_01', percentage: 110 },
          { assetId: 'GOVT_BOND_02', percentage: -10 },
        ],
      });

    expect(res.status).toBe(400);
  });

  test('deletes previous proportions before inserting new ones', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [{ asset_id: 'EQUITY_FUND_01' }] })
      .mockResolvedValueOnce({ rows: [] })  // DELETE
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    await request(app)
      .post('/api/v1/investments/proportion')
      .set('Authorization', authHeader())
      .send({ proportions: [{ assetId: 'EQUITY_FUND_01', percentage: 100 }] });

    // Second call on mockClient.query should be the DELETE statement
    const deleteSql = mockClient.query.mock.calls[1][0];
    expect(deleteSql).toContain('DELETE');
  });
});