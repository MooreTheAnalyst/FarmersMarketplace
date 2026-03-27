const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { err } = require('../middleware/error');

// GET /api/addresses - list buyer's addresses
router.get('/', auth, (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');

  const addresses = db.prepare(
    'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC'
  ).all(req.user.id);

  res.json({ success: true, data: addresses });
});

// POST /api/addresses - create a new address
router.post('/', auth, (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');

  const { label, street, city, country, postal_code, is_default } = req.body;

  if (!label || !street || !city || !country) {
    return err(res, 400, 'label, street, city, and country are required', 'validation_error');
  }

  // If setting as default, unset any existing default
  if (is_default) {
    db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  }

  const result = db.prepare(
    'INSERT INTO addresses (user_id, label, street, city, country, postal_code, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.id, label.trim(), street.trim(), city.trim(), country.trim(), postal_code?.trim() || null, is_default ? 1 : 0);

  const address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, data: address });
});

// PUT /api/addresses/:id - update an address
router.put('/:id', auth, (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');

  const { label, street, city, country, postal_code, is_default } = req.body;

  if (!label || !street || !city || !country) {
    return err(res, 400, 'label, street, city, and country are required', 'validation_error');
  }

  // Verify ownership
  const existing = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return err(res, 404, 'Address not found', 'not_found');

  // If setting as default, unset any existing default
  if (is_default) {
    db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);
  }

  db.prepare(
    'UPDATE addresses SET label = ?, street = ?, city = ?, country = ?, postal_code = ?, is_default = ? WHERE id = ?'
  ).run(label.trim(), street.trim(), city.trim(), country.trim(), postal_code?.trim() || null, is_default ? 1 : 0, req.params.id);

  const address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: address });
});

// PATCH /api/addresses/:id/default - set address as default
router.patch('/:id/default', auth, (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');

  // Verify ownership
  const existing = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return err(res, 404, 'Address not found', 'not_found');

  // Unset any existing default
  db.prepare('UPDATE addresses SET is_default = 0 WHERE user_id = ?').run(req.user.id);

  // Set this address as default
  db.prepare('UPDATE addresses SET is_default = 1 WHERE id = ?').run(req.params.id);

  const address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(req.params.id);
  res.json({ success: true, data: address });
});

// DELETE /api/addresses/:id - delete an address
router.delete('/:id', auth, (req, res) => {
  if (req.user.role !== 'buyer')
    return err(res, 403, 'Only buyers can manage addresses', 'forbidden');

  // Verify ownership
  const existing = db.prepare('SELECT * FROM addresses WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!existing) return err(res, 404, 'Address not found', 'not_found');

  // Check if address is used in any orders
  const orderCount = db.prepare('SELECT COUNT(*) as count FROM orders WHERE address_id = ?').get(req.params.id).count;
  if (orderCount > 0) {
    return err(res, 400, 'Cannot delete address that has been used in orders', 'address_in_use');
  }

  db.prepare('DELETE FROM addresses WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Address deleted' });
});

module.exports = router;
