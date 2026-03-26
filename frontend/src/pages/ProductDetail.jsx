import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getStellarErrorMessage } from '../utils/stellarErrors';

const s = {
  page: { maxWidth: 600, margin: '40px auto', padding: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 32, boxShadow: '0 1px 8px #0001' },
  name: { fontSize: 28, fontWeight: 700, color: '#2d6a4f', marginBottom: 4 },
  farmer: { color: '#888', marginBottom: 16 },
  desc: { color: '#555', marginBottom: 24, lineHeight: 1.6 },
  price: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  input: { width: 80, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 16, textAlign: 'center' },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '12px 28px', cursor: 'pointer', fontWeight: 600, fontSize: 16 },
  total: { background: '#f0faf4', borderRadius: 8, padding: '12px 16px', marginBottom: 20, fontSize: 15 },
  err: { color: '#c0392b', fontSize: 14, marginTop: 8 },
  success: { background: '#d8f3dc', borderRadius: 8, padding: 16, color: '#2d6a4f' },
};

export default function ProductDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [product, setProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { api.getProduct(id).then(setProduct).catch(() => navigate('/marketplace')); }, [id]);

  if (!product) return <div style={{ padding: 40, textAlign: 'center' }}>Loading...</div>;

  const total = (product.price * qty).toFixed(2);

  async function handleBuy() {
    if (!user) return navigate('/login');
    if (user.role === 'farmer') return setError('Farmers cannot place orders');
    setLoading(true);
    setError('');
    try {
      const res = await api.placeOrder({ product_id: product.id, quantity: qty });
      setResult(res);
    } catch (err) {
      setError(getStellarErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={s.success}>
            <strong>Payment successful!</strong>
            <p style={{ marginTop: 8, fontSize: 14 }}>Order #{result.orderId} · {result.totalPrice} XLM paid</p>
            <p style={{ marginTop: 4, fontSize: 12, wordBreak: 'break-all', color: '#555' }}>TX: {result.txHash}</p>
          </div>
          <button style={{ ...s.btn, marginTop: 20, background: '#555' }} onClick={() => navigate('/marketplace')}>Back to Marketplace</button>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🥬</div>
        <div style={s.name}>{product.name}</div>
        <div style={s.farmer}>Sold by {product.farmer_name}</div>
        <div style={s.desc}>{product.description || 'Fresh from the farm.'}</div>
        <div style={s.price}>{product.price} XLM <span style={{ fontSize: 14, fontWeight: 400 }}>/ {product.unit}</span></div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>{product.quantity} {product.unit} in stock</div>

        <div style={s.row}>
          <label style={{ fontSize: 14 }}>Quantity:</label>
          <input style={s.input} type="number" min={1} max={product.quantity} value={qty}
            onChange={e => setQty(Math.max(1, Math.min(product.quantity, parseInt(e.target.value) || 1)))} />
          <span style={{ fontSize: 13, color: '#888' }}>{product.unit}</span>
        </div>

        <div style={s.total}>Total: <strong>{total} XLM</strong></div>

        {error && <div style={s.err}>{error}</div>}

        <button style={s.btn} onClick={handleBuy} disabled={loading}>
          {loading ? 'Processing payment...' : `Buy Now · ${total} XLM`}
        </button>
      </div>
    </div>
  );
}
