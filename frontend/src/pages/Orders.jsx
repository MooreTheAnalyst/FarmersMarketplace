import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

const s = {
  page: { maxWidth: 800, margin: '0 auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 16 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 },
  label: { fontSize: 12, color: '#888', marginBottom: 2 },
  val: { fontWeight: 600, fontSize: 15 },
  badge: (status) => ({
    display: 'inline-block', fontSize: 11, borderRadius: 4, padding: '2px 8px', fontWeight: 600,
    background: status === 'paid' ? '#d8f3dc' : status === 'failed' ? '#fee' : '#fff3cd',
    color: status === 'paid' ? '#2d6a4f' : status === 'failed' ? '#c0392b' : '#856404',
  }),
  disputeBtn: { background: '#fff3cd', color: '#856404', border: '1px solid #ffc107', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  disabledBtn: { background: '#f5f5f5', color: '#aaa', border: '1px solid #ddd', borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'default' },
  modal: { position: 'fixed', inset: 0, background: '#0005', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modalCard: { background: '#fff', borderRadius: 12, padding: 32, width: 420, boxShadow: '0 4px 24px #0002' },
  textarea: { width: '100%', padding: '10px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 14, minHeight: 100, resize: 'vertical', marginBottom: 16 },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginRight: 8 },
  cancelBtn: { background: '#f5f5f5', color: '#555', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600 },
  err: { color: '#c0392b', fontSize: 13, marginBottom: 12 },
  empty: { textAlign: 'center', padding: 60, color: '#888' },
};

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [disputes, setDisputes] = useState({}); // order_id → dispute
  const [modal, setModal] = useState(null); // { orderId }
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [orderList] = await Promise.all([api.getOrders()]);
      setOrders(orderList);
    } catch {}
  }

  // Load existing disputes so we can disable the button for already-disputed orders
  async function loadDisputes() {
    // Buyers can't call GET /api/disputes (admin only), so we track locally via localStorage
    const stored = (() => { try { return JSON.parse(localStorage.getItem('my_disputes') || '{}'); } catch { return {}; } })();
    setDisputes(stored);
  }

  useEffect(() => { load(); loadDisputes(); }, []);

  function openModal(orderId) {
    setModal({ orderId });
    setReason('');
    setError('');
  }

  function closeModal() {
    setModal(null);
    setReason('');
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!reason.trim()) return setError('Please describe the issue');
    setSubmitting(true);
    setError('');
    try {
      await api.fileDispute({ order_id: modal.orderId, reason });
      // Track locally so the button disables
      const updated = { ...disputes, [modal.orderId]: true };
      localStorage.setItem('my_disputes', JSON.stringify(updated));
      setDisputes(updated);
      closeModal();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.title}>📦 My Orders</div>

      {orders.length === 0 && <div style={s.empty}>No orders yet. Head to the marketplace to buy something.</div>}

      {orders.map(order => (
        <div key={order.id} style={s.card}>
          <div style={s.row}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{order.product_name}</div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
                by {order.farmer_name} · {order.quantity} {order.unit} · {order.total_price} XLM
              </div>
              <div style={{ fontSize: 12, color: '#aaa' }}>{new Date(order.created_at).toLocaleString()}</div>
              {order.stellar_tx_hash && (
                <div style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 4, wordBreak: 'break-all' }}>
                  TX: {order.stellar_tx_hash}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <span style={s.badge(order.status)}>{order.status.toUpperCase()}</span>
              {order.status === 'paid' && (
                disputes[order.id]
                  ? <span style={s.disabledBtn}>⚠ Dispute Filed</span>
                  : <button style={s.disputeBtn} onClick={() => openModal(order.id)}>⚠ File Dispute</button>
              )}
            </div>
          </div>
        </div>
      ))}

      {modal && (
        <div style={s.modal} onClick={closeModal}>
          <div style={s.modalCard} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#2d6a4f' }}>File a Dispute</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
              Order #{modal.orderId} — Describe what went wrong with your order.
            </div>
            <form onSubmit={handleSubmit}>
              {error && <div style={s.err}>{error}</div>}
              <textarea
                style={s.textarea}
                placeholder="e.g. Goods were never delivered after payment was made..."
                value={reason}
                onChange={e => setReason(e.target.value)}
                required
              />
              <div>
                <button style={s.btn} type="submit" disabled={submitting}>
                  {submitting ? 'Submitting...' : 'Submit Dispute'}
                </button>
                <button style={s.cancelBtn} type="button" onClick={closeModal}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
