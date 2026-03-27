'use strict';

const { request, app, mockDb } = require('./setup');
const mailer = require('../src/utils/mailer');
const jwt = require('jsonwebtoken');

const SECRET      = process.env.JWT_SECRET || 'test-secret-for-jest';
const buyerToken  = jwt.sign({ id: 1, role: 'buyer'  }, SECRET, { expiresIn: '1h' });
const farmerToken = jwt.sign({ id: 2, role: 'farmer' }, SECRET, { expiresIn: '1h' });

// Mock mailer
jest.mock('../src/utils/mailer', () => ({
  sendOrderEmails:      jest.fn().mockResolvedValue({}),
  sendLowStockAlert:    jest.fn().mockResolvedValue({}),
  sendStatusUpdateEmail: jest.fn().mockResolvedValue({}),
  sendBackInStockEmail: jest.fn().mockResolvedValue({}),
}));

function stmt(getVal, runVal = { changes: 1, lastInsertRowid: 1 }, allVal = []) {
  return { get: jest.fn().mockReturnValue(getVal), run: jest.fn().mockReturnValue(runVal), all: jest.fn().mockReturnValue(allVal) };
}

beforeEach(() => jest.clearAllMocks());

// ─── POST /api/products/:id/alert ───────────────────────────────────────────

describe('POST /api/products/:id/alert', () => {
  test('403 if caller is not a buyer', async () => {
    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(403);
  });

  test('404 if product not found', async () => {
    mockDb.prepare.mockReturnValue(stmt(undefined));
    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(404);
  });

  test('400 if product is in stock', async () => {
    mockDb.prepare.mockReturnValue(stmt({ id: 5, quantity: 10 }));
    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('in_stock');
  });

  test('200 — inserts alert for out-of-stock product', async () => {
    const runMock = jest.fn().mockReturnValue({ lastInsertRowid: 1 });
    mockDb.prepare.mockReturnValue({ get: jest.fn().mockReturnValue({ id: 5, quantity: 0 }), run: runMock, all: jest.fn() });
  test('201/200 — inserts alert for out-of-stock product', async () => {
    const runMock = jest.fn().mockReturnValue({ lastInsertRowid: 1 });
    const s = { get: jest.fn().mockReturnValue({ id: 5, quantity: 0 }), run: runMock, all: jest.fn() };
    mockDb.prepare.mockReturnValue(s);

    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(runMock).toHaveBeenCalledWith(1, '5');
  });

  test('409 on duplicate subscription', async () => {
    mockDb.prepare.mockReturnValue({
      get: jest.fn().mockReturnValue({ id: 5, quantity: 0 }),
      run: jest.fn().mockImplementation(() => { throw new Error('UNIQUE constraint failed'); }),
      all: jest.fn(),
    });
    const s = {
      get: jest.fn().mockReturnValue({ id: 5, quantity: 0 }),
      run: jest.fn().mockImplementation(() => { throw new Error('UNIQUE constraint failed'); }),
      all: jest.fn(),
    };
    mockDb.prepare.mockReturnValue(s);

    const res = await request(app).post('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('conflict');
  });
});

// ─── DELETE /api/products/:id/alert ─────────────────────────────────────────

describe('DELETE /api/products/:id/alert', () => {
  test('401 if not authenticated', async () => {
    const res = await request(app).delete('/api/products/5/alert');
    expect(res.status).toBe(401);
  });

  test('200 — removes alert for authenticated user', async () => {
    const runMock = jest.fn().mockReturnValue({ changes: 1 });
    mockDb.prepare.mockReturnValue({ run: runMock, get: jest.fn(), all: jest.fn() });

    const res = await request(app).delete('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(runMock).toHaveBeenCalledWith(1, '5');
  });

  test('200 even if no alert existed (idempotent)', async () => {
    mockDb.prepare.mockReturnValue({ run: jest.fn().mockReturnValue({ changes: 0 }), get: jest.fn(), all: jest.fn() });
    const res = await request(app).delete('/api/products/5/alert').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/products/:id/alert/status ─────────────────────────────────────

describe('GET /api/products/:id/alert/status', () => {
  test('200 subscribed=true when alert exists', async () => {
    mockDb.prepare.mockReturnValue(stmt({ id: 1 }));
    const res = await request(app).get('/api/products/5/alert/status').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(true);
  });

  test('200 subscribed=false when no alert', async () => {
    mockDb.prepare.mockReturnValue(stmt(undefined));
    const res = await request(app).get('/api/products/5/alert/status').set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.subscribed).toBe(false);
  });
});

// ─── PATCH /api/products/:id/restock — alert trigger ────────────────────────

describe('PATCH /api/products/:id/restock — back-in-stock alerts', () => {
  test('notifies subscribers and deletes alerts when restocking from 0', async () => {
    const subscribers = [
      { email: 'alice@example.com', name: 'Alice' },
      { email: 'bob@example.com',   name: 'Bob'   },
    ];
    const runMock = jest.fn().mockReturnValue({ changes: 1 });
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 5, name: 'Tomatoes', quantity: 0, farmer_id: 2 }), run: runMock, all: jest.fn() })
      .mockReturnValueOnce({ get: jest.fn(), run: runMock, all: jest.fn() })
      .mockReturnValueOnce({ get: jest.fn(), run: runMock, all: jest.fn().mockReturnValue(subscribers) })
      .mockReturnValueOnce({ get: jest.fn(), run: runMock, all: jest.fn() });
    // prepare() is called multiple times; we need different behaviour per call
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 5, name: 'Tomatoes', quantity: 0, farmer_id: 2 }), run: runMock, all: jest.fn() }) // SELECT product
      .mockReturnValueOnce({ get: jest.fn(), run: runMock, all: jest.fn() })  // UPDATE quantity
      .mockReturnValueOnce({ get: jest.fn(), run: runMock, all: jest.fn().mockReturnValue(subscribers) }) // SELECT subscribers
      .mockReturnValueOnce({ get: jest.fn(), run: runMock, all: jest.fn() }); // DELETE alerts

    const res = await request(app)
      .patch('/api/products/5/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 10 });

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 30));
    expect(mailer.sendBackInStockEmail).toHaveBeenCalledTimes(2);
    expect(mailer.sendBackInStockEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice@example.com', productName: 'Tomatoes' })
    );
  });

  test('does not notify when product was already in stock', async () => {
  test('does not notify when restocking a product that was already in stock', async () => {
    mockDb.prepare.mockReturnValue({
      get:  jest.fn().mockReturnValue({ id: 5, name: 'Tomatoes', quantity: 5, farmer_id: 2 }),
      run:  jest.fn(),
      all:  jest.fn().mockReturnValue([]),
    });

    const res = await request(app)
      .patch('/api/products/5/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 10 });

    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 20));
    expect(mailer.sendBackInStockEmail).not.toHaveBeenCalled();
  });

  test('does not fail if email send throws', async () => {
    mailer.sendBackInStockEmail.mockRejectedValueOnce(new Error('SMTP down'));
    mockDb.prepare
      .mockReturnValueOnce({ get: jest.fn().mockReturnValue({ id: 5, name: 'Tomatoes', quantity: 0, farmer_id: 2 }), run: jest.fn(), all: jest.fn() })
      .mockReturnValueOnce({ get: jest.fn(), run: jest.fn(), all: jest.fn() })
      .mockReturnValueOnce({ get: jest.fn(), run: jest.fn(), all: jest.fn().mockReturnValue([{ email: 'x@x.com', name: 'X' }]) })
      .mockReturnValueOnce({ get: jest.fn(), run: jest.fn(), all: jest.fn() });
    mockDb.prepare.mockReturnValue({
      get:  jest.fn().mockReturnValue({ id: 5, name: 'Tomatoes', quantity: 0, farmer_id: 2 }),
      run:  jest.fn(),
      all:  jest.fn().mockReturnValue([{ email: 'x@x.com', name: 'X' }]),
    });

    const res = await request(app)
      .patch('/api/products/5/restock')
      .set('Authorization', `Bearer ${farmerToken}`)
      .send({ quantity: 5 });
    expect(res.status).toBe(200);

    expect(res.status).toBe(200); // request succeeds regardless
  });
});
