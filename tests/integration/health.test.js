// Health endpoints have no DB dependencies — no mocking needed
jest.mock('../../db/pool', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../../services/email', () => ({ sendVerificationEmail: jest.fn() }));

const request = require('supertest');
const express = require('express');

const app = express();
app.use(express.json());
app.get('/', (req, res) => res.json({ message: 'Hello from Express' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

describe('GET /', () => {
  test('returns 200 with hello message', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'Hello from Express' });
  });
});

describe('GET /health', () => {
  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});