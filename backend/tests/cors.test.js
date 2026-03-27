const request = require('supertest');
const app = require('../src/app');

describe('CORS Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it('should allow requests from allowed origins', async () => {
    process.env.CORS_ORIGIN = 'http://localhost:3000,http://localhost:5173';

    const res = await request(app)
      .get('/api/products')
      .set('Origin', 'http://localhost:3000');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('should allow requests from second allowed origin', async () => {
    process.env.CORS_ORIGIN = 'http://localhost:3000,http://localhost:5173';

    const res = await request(app)
      .get('/api/products')
      .set('Origin', 'http://localhost:5173');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('should reject requests from unauthorized origins', async () => {
    process.env.CORS_ORIGIN = 'http://localhost:3000';

    const res = await request(app)
      .get('/api/products')
      .set('Origin', 'http://malicious-site.com');

    expect(res.status).toBe(500);
    expect(res.text).toContain('Not allowed by CORS');
  });

  it('should default to FRONTEND_ORIGIN when CORS_ORIGIN is not set', async () => {
    delete process.env.CORS_ORIGIN;
    process.env.FRONTEND_ORIGIN = 'http://localhost:5173';

    const res = await request(app)
      .get('/api/products')
      .set('Origin', 'http://localhost:5173');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('should default to http://localhost:3000 when neither CORS_ORIGIN nor FRONTEND_ORIGIN is set', async () => {
    delete process.env.CORS_ORIGIN;
    delete process.env.FRONTEND_ORIGIN;

    const res = await request(app)
      .get('/api/products')
      .set('Origin', 'http://localhost:3000');

    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  it('should allow requests with no origin header', async () => {
    process.env.CORS_ORIGIN = 'http://localhost:3000';

    const res = await request(app)
      .get('/api/products');

    expect(res.status).toBe(200);
  });
});
