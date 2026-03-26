const router = require('express').Router();
const db = require('../db/schema');
const auth = require('../middleware/auth');
const { getBalance, getTransactions, fundTestnetAccount, isTestnet } = require('../utils/stellar');

// GET /api/wallet - get balance + info
router.get('/', auth, async (req, res) => {
  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(req.user.id);
  const balance = await getBalance(user.stellar_public_key);
  res.json({ publicKey: user.stellar_public_key, balance });
});

// GET /api/wallet/transactions
router.get('/transactions', auth, async (req, res) => {
  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(req.user.id);
  const txs = await getTransactions(user.stellar_public_key);
  res.json(txs);
});

// POST /api/wallet/fund - testnet only, fund via Friendbot
router.post('/fund', auth, async (req, res) => {
  if (!isTestnet)
    return res.status(400).json({ error: 'Only available on testnet' });

  const user = db.prepare('SELECT stellar_public_key FROM users WHERE id = ?').get(req.user.id);
  try {
    await fundTestnetAccount(user.stellar_public_key);
    const balance = await getBalance(user.stellar_public_key);
    res.json({ message: 'Account funded with 10,000 XLM (testnet)', balance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
