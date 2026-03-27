/**
 * Issue #100: Integration tests for product CRUD endpoints.
 * Uses an in-memory SQLite database — fully isolated from production.
 */

process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.NODE_ENV = 'test';

const Database = require('better-sqlite3');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ── in-memory DB ──────────────────────────────────────────────────────────────
let testDb;

jest.mock('../db/schema', () => new Proxy({}, { get: (_, prop) => testDb[prop] }));
jest.mock('../utils/stellar', () => ({
  createWallet: jest.fn(() => ({ publicKey: 'GPUBKEY', secretKey: 'SSECRET' })),
}));
jest.mock('../utils/mailer', () => ({ sendOrderEmails: jest.fn() }));

const app = require('../app');

const SECRET = process.env.JWT_SECRET;
const token = (id, role) => jwt.sign({ id, role }, SECRET);

beforeAll(() => {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL, role TEXT NOT NULL,
      stellar_public_key TEXT, stellar_secret_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id INTEGER NOT NULL,
      name TEXT NOT NULL, description TEXT, category TEXT DEFAULT 'other',
      price REAL NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
      unit TEXT DEFAULT 'unit', image_url TEXT,
      low_stock_threshold INTEGER DEFAULT 5, low_stock_alerted INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (farmer_id) REFERENCES users(id)
    );
    CREATE TABLE reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER, rating INTEGER
    );
  `);

  // Seed farmer and buyer
  const hash = bcrypt.hashSync('Password1!', 10);
  testDb.prepare(
    'INSERT INTO users (name, email, password, role, stellar_public_key) VALUES (?, ?, ?, ?, ?)'
  ).run('Farmer Joe', 'farmer@test.com', hash, 'farmer', 'GPUB1');
  testDb.prepare(
    'INSERT INTO users (name, email, password, role, stellar_public_key) VALUES (?, ?, ?, ?, ?)'
  ).run('Buyer Bob', 'buyer@test.com', hash, 'buyer', 'GPUB2');
});

afterAll(() => testDb.close());

beforeEach(() => {
  testDb.exec('DELETE FROM products');
});

// ── helpers ───────────────────────────────────────────────────────────────────
const FARMER_ID = 1;
const BUYER_ID  = 2;
const farmerToken = token(FARMER_ID, 'farmer');
const buyerToken  = token(BUYER_ID,  'buyer');

const VALID_PRODUCT = { name: 'Tomatoes', price: 2.5, quantity: 100, category: 'vegetables' };

function createProduct(overrides = {}) {
  return request(app)
    .post('/api/products')
    .set('Authorization', `Bearer ${farmerToken}`)
    .send({ ...VALID_PRODUCT, ...overrides });
}

function seedProduct(farmerId = FARMER_ID) {
  const result = testDb.prepare(
    'INSERT INTO products (farmer_id, name, price, quantity, category) VALUES (?, ?, ?, ?, ?)'
  ).run(farmerId, 'Tomatoes', 2.5, 100, 'vegetables');
  return result.lastInsertRowid;
}

// ── GET /api/products ─────────────────────────────────────────────────────────
describe('GET /api/products', () => {
  it('returns in-stock products', async () => {
    seedProduct();
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('excludes out-of-stock products by default', async () => {
    testDb.prepare(
      'INSERT INTO products (farmer_id, name, price, quantity) VALUES (?, ?, ?, ?)'
    ).run(FARMER_ID, 'Out of Stock Item', 1.0, 0);
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    const names = res.body.data.map(p => p.name);
    expect(names).not.toContain('Out of Stock Item');
  });

  it('returns empty array when no products exist', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

// ── POST /api/products ────────────────────────────────────────────────────────
describe('POST /api/products', () => {
  it('farmer can create a product', async () => {
    const res = await createProduct();
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.id).toBeDefined();
  });

  it('buyer receives 403', async () => {
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send(VALID_PRODUCT);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request receives 401', async () => {
    const res = await request(app).post('/api/products').send(VALID_PRODUCT);
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const res = await createProduct({ name: '' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when price is invalid', async () => {
    const res = await createProduct({ price: -1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when quantity is zero', async () => {
    const res = await createProduct({ quantity: 0 });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/products/:id ─────────────────────────────────────────────────────
describe('GET /api/products/:id', () => {
  it('returns product when found', async () => {
    const id = seedProduct();
    const res = await request(app).get(`/api/products/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
  });

  it('returns 404 for non-existent product', async () => {
    const res = await request(app).get('/api/products/99999');
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/products/:id ──────────────────────────────────────────────────
describe('DELETE /api/products/:id', () => {
  it('farmer can delete their own product', async () => {
    const id = seedProduct(FARMER_ID);
    const res = await request(app)
      .delete(`/api/products/${id}`)
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('farmer cannot delete another farmer\'s product', async () => {
    // Seed a second farmer
    testDb.prepare(
      'INSERT OR IGNORE INTO users (id, name, email, password, role, stellar_public_key) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(99, 'Other Farmer', 'other@test.com', 'hash', 'farmer', 'GPUB99');
    const id = seedProduct(99);

    const res = await request(app)
      .delete(`/api/products/${id}`)
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-existent product', async () => {
    const res = await request(app)
      .delete('/api/products/99999')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(404);
  });

  it('unauthenticated request receives 401', async () => {
    const id = seedProduct();
    const res = await request(app).delete(`/api/products/${id}`);
    expect(res.status).toBe(401);
  });
});

// ── GET /api/products/mine/list ───────────────────────────────────────────────
describe('GET /api/products/mine/list', () => {
  it('farmer gets their own products', async () => {
    seedProduct(FARMER_ID);
    const res = await request(app)
      .get('/api/products/mine/list')
      .set('Authorization', `Bearer ${farmerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('buyer receives 403', async () => {
    const res = await request(app)
      .get('/api/products/mine/list')
      .set('Authorization', `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
  });

  it('unauthenticated request receives 401', async () => {
    const res = await request(app).get('/api/products/mine/list');
    expect(res.status).toBe(401);
  });
});
