import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

const STATUS_COLORS = {
  open: { background: '#fff3cd', color: '#856404' },
  under_review: { background: '#cce5ff', color: '#004085' },
  resolved: { background: '#d8f3dc', color: '#2d6a4f' },
};

const s = {
  page: { maxWidth: 1000, margin: '0 auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 8 },
  sub: { color: '#666', marginBottom: 24, fontSize: 14 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 16 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 },
  badge: (status) => ({ display: 'inline-block', fontSize: 11, borderRadius: 4, padding: '2px 8px', fontWeight: 600, ...STATUS_COLORS[status] }),
  select: { padding: '6px 10px', borderRadius: 6, border: '1px solid #ddd', fontSize: 13, background: '#fff' },
  textarea: { width: '100%', padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13, minHeight: 70, resize: 'vertical', marginTop: 8 },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontWeight: 600, fontSize: 13, marginTop: 8 },
  err: { color: '#c0392b', fontSize: 12, marginTop: 4 },
  empty: { textAlign: 'center', padding: 60, color: '#888' },
  filterRow: { display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' },
};

export default function AdminDashboard() {
  const [disputes, setDisputes] = useState([]);
  const [filter, setFilter] = useState('open');
  const [resolving, setResolving] = useState({}); // id → { status, resolution, error, loading }

  async function load() {
    try { setDisputes(await api.getDisputes()); } catch {}
  }

  useEffect(() => { load(); }, []);

  function setResolveField(id, field, value) {
    setResolving(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  async function handleResolve(dispute) {
    const state = resolving[dispute.id] || {};
    const status = state.status;
    const resolution = state.resolution || '';

    if (!status) return setResolveField(dispute.id, 'error', 'Select a new status');
    if (status === 'resolved' && !resolution.trim())
      return setResolveField(dispute.id, 'error', 'Resolution note is required');

    setResolveField(dispute.id, 'loading', true);
    setResolveField(dispute.id, 'error', '');
    try {
      await api.resolveDispute(dispute.id, { status, resolution });
      load();
      setResolving(prev => { const n = { ...prev }; delete n[dispute.id]; return n; });
    } catch (err) {
      setResolveField(dispute.id, 'error', err.message);
      setResolveField(dispute.id, 'loading', false);
    }
  }

  const nextStatuses = { open: ['under_review'], under_review: ['resolved'], resolved: [] };

  const visible = filter === 'all' ? disputes : disputes.filter(d => d.status === filter);

  return (
    <div style={s.page}>
      <div style={s.title}>🛡 Admin — Dispute Management</div>
      <div style={s.sub}>{disputes.filter(d => d.status === 'open').length} open · {disputes.filter(d => d.status === 'under_review').length} under review · {disputes.filter(d => d.status === 'resolved').length} resolved</div>

      <div style={s.filterRow}>
        <span style={{ fontSize: 13, color: '#555' }}>Filter:</span>
        {['open', 'under_review', 'resolved', 'all'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd', cursor: 'pointer', fontSize: 13,
              background: filter === f ? '#2d6a4f' : '#fff', color: filter === f ? '#fff' : '#333', fontWeight: filter === f ? 600 : 400 }}>
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {visible.length === 0 && <div style={s.empty}>No disputes found.</div>}

      {visible.map(dispute => {
        const state = resolving[dispute.id] || {};
        const options = nextStatuses[dispute.status] || [];

        return (
          <div key={dispute.id} style={s.card}>
            <div style={s.row}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700 }}>Dispute #{dispute.id}</span>
                  <span style={s.badge(dispute.status)}>{dispute.status.replace('_', ' ').toUpperCase()}</span>
                </div>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>
                  Order #{dispute.order_id} · {dispute.product_name} · {dispute.total_price} XLM
                </div>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 4 }}>
                  Buyer: {dispute.buyer_name} ({dispute.buyer_email})
                </div>
                <div style={{ fontSize: 13, color: '#333', marginTop: 8, padding: '8px 12px', background: '#f9f9f9', borderRadius: 6 }}>
                  <strong>Reason:</strong> {dispute.reason}
                </div>
                {dispute.resolution && (
                  <div style={{ fontSize: 13, color: '#2d6a4f', marginTop: 8, padding: '8px 12px', background: '#d8f3dc', borderRadius: 6 }}>
                    <strong>Resolution:</strong> {dispute.resolution}
                  </div>
                )}
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 8 }}>{new Date(dispute.created_at).toLocaleString()}</div>
              </div>

              {options.length > 0 && (
                <div style={{ minWidth: 220 }}>
                  <select style={s.select} value={state.status || ''} onChange={e => setResolveField(dispute.id, 'status', e.target.value)}>
                    <option value="">— Update status —</option>
                    {options.map(o => <option key={o} value={o}>{o.replace('_', ' ')}</option>)}
                  </select>
                  {state.status === 'resolved' && (
                    <textarea
                      style={s.textarea}
                      placeholder="Resolution note (required)..."
                      value={state.resolution || ''}
                      onChange={e => setResolveField(dispute.id, 'resolution', e.target.value)}
                    />
                  )}
                  {state.error && <div style={s.err}>{state.error}</div>}
                  <button style={s.btn} onClick={() => handleResolve(dispute)} disabled={state.loading}>
                    {state.loading ? 'Saving...' : 'Update'}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
