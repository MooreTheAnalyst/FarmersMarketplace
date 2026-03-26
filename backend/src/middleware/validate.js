const { body, validationResult } = require('express-validator');

// Common weak passwords to block outright
const WEAK_PASSWORDS = new Set([
  'password', 'password1', 'Password1', 'Password1!',
  '12345678', '123456789', 'qwerty123', 'iloveyou',
  'admin123', 'letmein1', 'welcome1', 'monkey123',
]);

const handle = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({
    success: false,
    message: errors.array()[0].msg,
    code: 'validation_error',
    errors: errors.array(),
  });
  next();
};

const schemas = {
  register: [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('email').isEmail().withMessage('valid email required'),
    body('password')
      .isLength({ min: 8 }).withMessage('password must be at least 8 characters')
      .matches(/[A-Z]/).withMessage('password must contain at least one uppercase letter')
      .matches(/[0-9]/).withMessage('password must contain at least one number')
      .custom((value) => {
        if (WEAK_PASSWORDS.has(value)) {
          throw new Error('password is too common, choose a stronger one');
        }
        return true;
      }),
    body('role').isIn(['farmer', 'buyer']).withMessage('role must be farmer or buyer'),
    handle,
  ],
  login: [
    body('email').isEmail().withMessage('valid email required'),
    body('password').notEmpty().withMessage('password is required'),
    handle,
  ],
  product: [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('price').isFloat({ gt: 0 }).withMessage('price must be a positive number'),
    body('quantity').isInt({ gt: 0 }).withMessage('quantity must be a positive integer'),
    body('unit').optional().trim().notEmpty().withMessage('unit cannot be blank'),
    handle,
  ],
  order: [
    body('product_id').isInt({ gt: 0 }).withMessage('product_id must be a positive integer'),
    body('quantity').isInt({ gt: 0 }).withMessage('quantity must be a positive integer'),
    handle,
  ],
};

module.exports = schemas;
