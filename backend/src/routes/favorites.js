const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// POST /api/favorites - Add product to favorites (buyer only)
router.post('/', auth, (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can add favorites', 'forbidden');

  const { product_id } = req.body;
  if (!product_id) return err(res, 400, 'Product ID is required', 'validation_error');

  // Check if product exists
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
  if (!product) return err(res, 404, 'Product not found', 'not_found');

  try {
    db.prepare('INSERT INTO favorites (buyer_id, product_id) VALUES (?, ?)').run(req.user.id, product_id);
    res.json({ success: true, message: 'Added to favorites' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return err(res, 409, 'Already in favorites', 'already_favorited');
    }
    return err(res, 500, 'Failed to add favorite', 'database_error');
  }
});

// DELETE /api/favorites/:product_id - Remove from favorites (buyer only)
router.delete('/:product_id', auth, (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can remove favorites', 'forbidden');

  const { product_id } = req.params;
  const result = db.prepare('DELETE FROM favorites WHERE buyer_id = ? AND product_id = ?').run(req.user.id, product_id);

  if (result.changes === 0) {
    return err(res, 404, 'Favorite not found', 'not_found');
  }

  res.json({ success: true, message: 'Removed from favorites' });
});

// GET /api/favorites - List buyer's favorite products (buyer only)
router.get('/', auth, (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can view favorites', 'forbidden');

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;

  const total = db.prepare(
    'SELECT COUNT(*) as count FROM favorites WHERE buyer_id = ?'
  ).get(req.user.id).count;

  const favorites = db.prepare(`
    SELECT p.*, u.id as farmer_id, u.name as farmer_name, u.bio as farmer_bio, u.location as farmer_location, u.avatar_url as farmer_avatar,
           ROUND(AVG(r.rating), 1) as avg_rating,
           COUNT(r.id) as review_count,
           f.created_at as favorited_at
    FROM favorites f
    JOIN products p ON f.product_id = p.id
    JOIN users u ON p.farmer_id = u.id
    LEFT JOIN reviews r ON r.product_id = p.id
    WHERE f.buyer_id = ?
    GROUP BY p.id
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).all(req.user.id, limit, offset);

  res.json({ success: true, data: favorites, total, page, limit, totalPages: Math.ceil(total / limit) });
});

// GET /api/favorites/check/:product_id - Check if product is favorited (buyer only)
router.get('/check/:product_id', auth, (req, res) => {
  if (req.user.role !== 'buyer') return err(res, 403, 'Only buyers can check favorites', 'forbidden');

  const { product_id } = req.params;
  const favorite = db.prepare('SELECT id FROM favorites WHERE buyer_id = ? AND product_id = ?').get(req.user.id, product_id);

  res.json({ success: true, isFavorited: !!favorite });
});

module.exports = router;
