const request = require('supertest');
const app = require('../src/app');
const db = require('../src/db/schema');
const { createWallet } = require('../src/utils/stellar');

describe('Security - Sensitive field exposure', () => {
  let buyerToken, farmerToken, buyerId, farmerId, productId;

  beforeAll(() => {
    // Create test users
    const buyerWallet = createWallet();
    const farmerWallet = createWallet();

    const buyer = db.prepare(
      'INSERT INTO users (name, email, password, role, stellar_public_key, stellar_secret_key) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('Test Buyer', 'buyer@test.com', '$2a$12$dummyhash', 'buyer', buyerWallet.publicKey, buyerWallet.secretKey);

    const farmer = db.prepare(
      'INSERT INTO users (name, email, password, role, stellar_public_key, stellar_secret_key) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('Test Farmer', 'farmer@test.com', '$2a$12$dummyhash', 'farmer', farmerWallet.publicKey, farmerWallet.secretKey);

    buyerId = buyer.lastInsertRowid;
    farmerId = farmer.lastInsertRowid;

    // Create a test product
    const product = db.prepare(
      'INSERT INTO products (farmer_id, name, description, price, quantity, unit) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(farmerId, 'Test Product', 'Test description', 10.0, 100, 'kg');

    productId = product.lastInsertRowid;

    // Generate tokens
    const jwt = require('jsonwebtoken');
    buyerToken = jwt.sign({ id: buyerId, role: 'buyer' }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
    farmerToken = jwt.sign({ id: farmerId, role: 'farmer' }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
  });

  afterAll(() => {
    // Cleanup
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM users WHERE id IN (?, ?)').run(buyerId, farmerId);
  });

  const SENSITIVE_FIELDS = ['stellar_secret_key', 'password'];

  function checkNoSensitiveFields(obj, path = '') {
    if (obj === null || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item, index) => checkNoSensitiveFields(item, `${path}[${index}]`));
      return;
    }

    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_FIELDS.includes(key)) {
        throw new Error(`Sensitive field '${key}' found at path '${path}.${key}'`);
      }
      checkNoSensitiveFields(value, `${path}.${key}`);
    }
  }

  describe('Auth endpoints', () => {
    it('POST /api/auth/register should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'New User',
          email: `newuser${Date.now()}@test.com`,
          password: 'password123',
          role: 'buyer',
        });

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('POST /api/auth/login should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'buyer@test.com',
          password: 'password123',
        });

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });

  describe('Wallet endpoints', () => {
    it('GET /api/wallet should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .get('/api/wallet')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('GET /api/wallet/transactions should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .get('/api/wallet/transactions')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });

  describe('Product endpoints', () => {
    it('GET /api/products should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .get('/api/products');

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('GET /api/products/:id should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .get(`/api/products/${productId}`);

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('GET /api/products/mine/list should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .get('/api/products/mine/list')
        .set('Authorization', `Bearer ${farmerToken}`);

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });

  describe('Order endpoints', () => {
    it('GET /api/orders should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .get('/api/orders')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });

    it('GET /api/orders/sales should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .get('/api/orders/sales')
        .set('Authorization', `Bearer ${farmerToken}`);

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });

  describe('Review endpoints', () => {
    it('GET /api/reviews/product/:productId should not expose stellar_secret_key', async () => {
      const res = await request(app)
        .get(`/api/reviews/product/${productId}`);

      expect(res.status).toBe(200);
      checkNoSensitiveFields(res.body);
    });
  });
});
