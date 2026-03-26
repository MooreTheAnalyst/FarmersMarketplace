import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getStellarErrorMessage } from '../utils/stellarErrors';

const s = {
  page: { maxWidth: 800, margin: '0 auto', padding: 24 },
  title: { fontSize: 24, fontWeight: 700, color: '#2d6a4f', marginBottom: 24 },
  card: { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 8px #0001', marginBottom: 24 },
  balance: { fontSize: 40, fontWeight: 700, color: '#2d6a4f' },
  key: { fontSize: 12, color: '#888', wordBreak: 'break-all', marginTop: 8, fontFamily: 'monospace' },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 600, marginTop: 16 },
  tx: { borderBottom: '1px solid #eee', padding: '12px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  sent: { color: '#c0392b', fontWeight: 600 },
  recv: { color: '#2d6a4f', fontWeight: 600 },
  hash: { fontSize: 11, color: '#aaa', fontFamily: 'monospace', marginTop: 2 },
  msg: { padding: '10px 14px', borderRadius: 8, marginTop: 12, fontSize: 14 },
};

export default function Wallet() {
  const { user } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [txs, setTxs] = useState([]);
  const [funding, setFunding] = useState(false);
  const [fundMsg, setFundMsg] = useState(null);
  const [loadError, setLoadError] = useState(null);

  async function load() {
    setLoadError(null);
    try {
      const [w, t] = await Promise.all([api.getWallet(), api.getTransactions()]);
      setWallet(w);
      setTxs(t);
    } catch (err) {
      setLoadError(getStellarErrorMessage(err));
    }
  }

  useEffect(() => { load(); }, []);

  async function handleFund() {
    setFunding(true);
    setFundMsg(null);
    try {
      const res = await api.fundWallet();
      setFundMsg({ type: 'ok', text: res.message });
      load();
    } catch (err) {
      setFundMsg({ type: 'err', text: getStellarErrorMessage(err) });
    } finally {
      setFunding(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.title}>💳 My Wallet</div>

      {loadError && (
        <div style={{ ...s.msg, background: '#fee', color: '#c0392b', marginBottom: 16 }}>
          ⚠️ {loadError}
        </div>
      )}

      <div style={s.card}>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>XLM Balance</div>
        <div style={s.balance}>{wallet ? wallet.balance.toFixed(2) : '—'} XLM</div>
        <div style={s.key}>Public Key: {wallet?.publicKey}</div>

        <button style={s.btn} onClick={handleFund} disabled={funding}>
          {funding ? 'Funding...' : '🚰 Fund with Testnet XLM'}
        </button>
        {fundMsg && (
          <div style={{ ...s.msg, background: fundMsg.type === 'ok' ? '#d8f3dc' : '#fee', color: fundMsg.type === 'ok' ? '#2d6a4f' : '#c0392b' }}>
            {fundMsg.text}
          </div>
        )}
      </div>

      <div style={s.card}>
        <h3 style={{ marginBottom: 16, color: '#333' }}>Transaction History</h3>
        {txs.length === 0 && <p style={{ color: '#888', fontSize: 14 }}>No transactions yet. Fund your wallet and make a purchase.</p>}
        {txs.map(tx => (
          <div key={tx.id} style={s.tx}>
            <div>
              <div style={tx.type === 'sent' ? s.sent : s.recv}>
                {tx.type === 'sent' ? '↑ Sent' : '↓ Received'} {parseFloat(tx.amount).toFixed(2)} XLM
              </div>
              <div style={{ fontSize: 12, color: '#888' }}>{new Date(tx.created_at).toLocaleString()}</div>
              <div style={s.hash}>{tx.transaction_hash}</div>
            </div>
            <a href={`https://stellar.expert/explorer/testnet/tx/${tx.transaction_hash}`}
              target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: '#2d6a4f' }}>View ↗</a>
          </div>
        ))}
      </div>
    </div>
  );
}
