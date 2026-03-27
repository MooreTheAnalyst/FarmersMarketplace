'use strict';

const { request, app, mockDb } = require('./setup');
const stellar = require('../src/utils/stellar');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-jest';

const buyerToken  = jwt.sign({ id: 1, role: 'buyer' },  JWT_SECRET, { expiresIn: '1h' });
const farmerToken = jwt.sign({ id: 2, role: 'farmer' }, JWT_SECRET, { expiresIn: '1h' });
const otherBuyer  = jwt.sign({ id: 99, role: 'buyer' }, JWT_SECRET, { expiresIn: '1h' });

const baseOrder = {
  id: 10, buyer_id: 1, product_id: 5, quantity: 2, total_price: 20,
  status: 'paid', escrow_status: 'none', escrow_balance_id: null,
  farmer_id: 2, farmer_wallet: 'GFARMER',
};

function twoGetStmt(first, second) {
  const runMock = jest.fn();
  let calls = 0;
  const stmt = {
    get: jest.fn(() => calls++ === 0 ? first : second),
    run: runMock,
    all: jest.fn(() => []),
  };
  mockDb.prepare.mockReturnValue(stmt);
  return { stmt, runMock };
}

beforeEach(() => {
  jest.clearAllMocks();
  stellar.getBalance.mockResolvedValue(1000);
  stellar.createClaimableBalance.mockResolvedValue({ txHash: 'ESCROW_TX', balanceId: 'BALANCE_ID_001' });
  stellar.claimBalance.mockResolvedValue('CLAIM_TX_001');
});

// ─── POST /api/orders/:id/escrow ────────────────────────────────────────────

describe('POST /api/orders/:id/escrow', () => {
  test('403 if caller is not a buyer', async () => {
    const res = await request(app)
      .post('/api/orders/10/escrow')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  test('403 if order belongs to a different buyer', async () => {
    twoGetStmt({ ...baseOrder, buyer_id: 1 }, null);
    const res = await request(app)
      .post('/api/orders/10/escrow')
      .set('Authorization', `Bearer ${otherBuyer}`);
    expect(res.status).toBe(403);
  });

  test('404 if order not found', async () => {
    twoGetStmt(undefined, null);
    const res = await request(app)
      .post('/api/orders/10/escrow')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(404);
  });

  test('400 if escrow already initiated', async () => {
    twoGetStmt(
      { ...baseOrder, escrow_status: 'funded' },
      { stellar_public_key: 'GBUYER', stellar_secret_key: 'SBUYER' }
    );
    const res = await request(app)
      .post('/api/orders/10/escrow')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_state');
  });

  test('402 if buyer has insufficient balance', async () => {
    twoGetStmt(
      baseOrder,
      { stellar_public_key: 'GBUYER', stellar_secret_key: 'SBUYER' }
    );
    stellar.getBalance.mockResolvedValue(0.5);
    const res = await request(app)
      .post('/api/orders/10/escrow')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('insufficient_balance');
  });

  test('200 — creates claimable balance and saves to DB', async () => {
    const { runMock } = twoGetStmt(
      baseOrder,
      { stellar_public_key: 'GBUYER', stellar_secret_key: 'SBUYER' }
    );
    const res = await request(app)
      .post('/api/orders/10/escrow')
      .set('Authorization', `Bearer ${buyerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.balanceId).toBe('BALANCE_ID_001');
    expect(stellar.createClaimableBalance).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 20 })
    );
    expect(runMock).toHaveBeenCalledWith('BALANCE_ID_001', 'funded', 'ESCROW_TX', 10);
  });

  test('402 — Stellar SDK failure is handled gracefully', async () => {
    twoGetStmt(
      baseOrder,
      { stellar_public_key: 'GBUYER', stellar_secret_key: 'SBUYER' }
    );
    stellar.createClaimableBalance.mockRejectedValue(new Error('op_underfunded'));
    const res = await request(app)
      .post('/api/orders/10/escrow')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('escrow_failed');
    expect(res.body.message).toMatch('op_underfunded');
  });
});

// ─── POST /api/orders/:id/claim ─────────────────────────────────────────────

describe('POST /api/orders/:id/claim', () => {
  const fundedOrder = {
    ...baseOrder, status: 'delivered',
    escrow_status: 'funded', escrow_balance_id: 'BALANCE_ID_001',
  };

  test('403 if caller is not a farmer', async () => {
    const res = await request(app)
      .post('/api/orders/10/claim')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  test('404 if order not found or not this farmer\'s', async () => {
    twoGetStmt(undefined, null);
    const res = await request(app)
      .post('/api/orders/10/claim')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });

  test('400 if escrow_status is not funded', async () => {
    twoGetStmt(
      { ...fundedOrder, escrow_status: 'none' },
      { stellar_secret_key: 'SFARMER' }
    );
    const res = await request(app)
      .post('/api/orders/10/claim')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_state');
  });

  test('400 if order is not delivered yet', async () => {
    twoGetStmt(
      { ...fundedOrder, status: 'shipped' },
      { stellar_secret_key: 'SFARMER' }
    );
    const res = await request(app)
      .post('/api/orders/10/claim')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_state');
  });

  test('200 — claims balance and updates DB', async () => {
    const { runMock } = twoGetStmt(
      fundedOrder,
      { stellar_secret_key: 'SFARMER' }
    );
    const res = await request(app)
      .post('/api/orders/10/claim')
      .set('Authorization', `Bearer ${farmerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.txHash).toBe('CLAIM_TX_001');
    expect(stellar.claimBalance).toHaveBeenCalledWith({
      claimantSecret: 'SFARMER',
      balanceId: 'BALANCE_ID_001',
    });
    expect(runMock).toHaveBeenCalledWith('claimed', 'CLAIM_TX_001', 10);
  });

  test('402 — Stellar claim failure is handled gracefully', async () => {
    twoGetStmt(
      fundedOrder,
      { stellar_secret_key: 'SFARMER' }
    );
    stellar.claimBalance.mockRejectedValue(new Error('op_does_not_exist'));
    const res = await request(app)
      .post('/api/orders/10/claim')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('claim_failed');
    expect(res.body.message).toMatch('op_does_not_exist');
  });
});
