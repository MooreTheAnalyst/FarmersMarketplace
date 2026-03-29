const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const { err } = require('../middleware/error');
const { sanitizeText } = require('../utils/sanitize');
const { sendBackInStockEmail } = require('../utils/mailer');
const AutomaticOrderProcessor = require('../services/AutomaticOrderProcessor');

function normalizePreorderInput(body) {
  const isPreorder = body.is_preorder === true || body.is_preorder === 1 || body.is_preorder === '1';
  let preorderDeliveryDate = body.preorder_delivery_date || null;
  if (preorderDeliveryDate) preorderDeliveryDate = String(preorderDeliveryDate).trim();
  if (isPreorder && (!preorderDeliveryDate || !/^\d{4}-\d{2}-\d{2}$/.test(preorderDeliveryDate))) {
    return { error: 'preorder_delivery_date must be provided as YYYY-MM-DD' };
  }
  return { isPreorder, preorderDeliveryDate };
}

/**
 * @swagger
 * /api/products:
 *   get:
 *     summary: Browse products
 */
router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const { category, minPrice, maxPrice, seller, available = 'true' } = req.query;

  const conditions = [];
  const params = [];

  if (available === 'true') conditions.push('p.quantity > 0');
  if (category) {
    conditions.push(`p.category = $${params.length + 1}`);
    params.push(category);
  }
  if (minPrice !== undefined) {
    const min = parseFloat(minPrice);
    if (!Number.isNaN(min)) {
      conditions.push(`p.price >= $${params.length + 1}`);
      params.push(min);
    }
  }
  if (maxPrice !== undefined) {
    const max = parseFloat(maxPrice);
    if (!Number.isNaN(max)) {
      conditions.push(`p.price <= $${params.length + 1}`);
      params.push(max);
    }
  }
  if (seller) {
    conditions.push(`u.name LIKE $${params.length + 1}`);
    params.push(`%${seller}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows: countRows } = await db.query(`SELECT COUNT(*) as count FROM products p JOIN users u ON p.farmer_id = u.id ${where}`, params);
  const total = parseInt(countRows[0].count);

  const { rows: data } = await db.query(
    `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id
     ${where} ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  res.json({ success: true, data, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// GET /api/products/search
router.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    const { rows } = await db.query(
      `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id ORDER BY p.created_at DESC LIMIT 100`
    );
    return res.json({ success: true, data: rows });
  }
  const like = `%${q}%`;
  const { rows } = await db.query(
    `SELECT p.*, u.name as farmer_name FROM products p JOIN users u ON p.farmer_id = u.id
     WHERE p.name LIKE $1 OR p.description LIKE $2 ORDER BY p.created_at DESC LIMIT 100`,
    [like, like]
  );
  res.json({ success: true, data: rows });
});

// GET /api/products/mine/list
router.get('/mine/list', auth, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { rows } = await db.query(
    'SELECT * FROM products WHERE farmer_id = $1 ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({ success: true, data: rows });
});

// POST /api/products/upload-image
router.post('/upload-image', auth, (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Only farmers can upload images', 'forbidden');
  upload.single('image')(req, res, (uploadErr) => {
    if (uploadErr) {
       if (uploadErr.code === 'LIMIT_FILE_SIZE') return err(res, 400, 'Image too large', 'file_too_large');
       return err(res, 400, 'Upload failed', 'upload_error');
    }
    if (!req.file) return err(res, 400, 'No file provided', 'no_file');
    res.json({ success: true, imageUrl: `/uploads/${req.file.filename}` });
  });
});

// POST /api/products
router.post('/', auth, validate.product, async (req, res) => {
  if (req.user.role !== 'farmer') return err(res, 403, 'Farmers only', 'forbidden');
  const { name, description, unit, category, image_url, nutrition } = req.body;
  const price = parseFloat(req.body.price);
  const quantity = parseInt(req.body.quantity, 10);

  if (!name?.trim() || isNaN(price) || price <= 0 || isNaN(quantity) || quantity < 1) {
    return err(res, 400, 'Invalid product data', 'validation_error');
  }

  const preorder = normalizePreorderInput(req.body);
  if (preorder.error) return err(res, 400, preorder.error, 'validation_error');

  const { rows } = await db.query(
    'INSERT INTO products (farmer_id, name, description, category, price, quantity, unit, image_url, low_stock_threshold, nutrition, is_preorder, preorder_delivery_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
    [req.user.id, sanitizeText(name), sanitizeText(description||''), sanitizeText(category||''), price, quantity, sanitizeText(unit||'unit'), image_url, parseInt(req.body.low_stock_threshold) || 5, nutrition ? JSON.stringify(nutrition) : null, preorder.isPreorder ? 1 : 0, preorder.preorderDeliveryDate]
  );
  res.json({ success: true, id: rows[0].id, message: 'Product listed' });
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  const { rows } = await db.query(
    `SELECT p.*, u.name as farmer_name, u.stellar_public_key as farmer_wallet,
            ROUND(AVG(r.rating)::numeric, 1) as avg_rating,
            COUNT(r.id) as review_count
     FROM products p
     JOIN users u ON p.farmer_id = u.id
     LEFT JOIN reviews r ON r.product_id = p.id
     WHERE p.id = $1
     GROUP BY p.id, u.name, u.stellar_public_key`,
    [req.params.id]
  );
  if (!rows[0]) return err(res, 404, 'Product not found', 'not_found');
  res.json({ success: true, data: rows[0] });
});

// DELETE /api/products/:id
router.delete('/:id', auth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM products WHERE id = $1 AND farmer_id = $2', [req.params.id, req.user.id]);
  if (!rows[0]) return err(res, 404, 'Not found or not yours', 'not_found');
  await db.query('DELETE FROM products WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'Deleted' });
});

module.exports = router;
