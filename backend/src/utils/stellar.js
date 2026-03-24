const StellarSdk = require('@stellar/stellar-sdk');

const isTestnet = (process.env.STELLAR_NETWORK || 'testnet') === 'testnet';
const server = new StellarSdk.Horizon.Server(
  isTestnet ? 'https://horizon-testnet.stellar.org' : 'https://horizon.stellar.org'
);
const networkPassphrase = isTestnet
  ? StellarSdk.Networks.TESTNET
  : StellarSdk.Networks.PUBLIC;

// Create a new Stellar keypair (wallet)
function createWallet() {
  const keypair = StellarSdk.Keypair.random();
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

// Fund testnet account via Friendbot
async function fundTestnetAccount(publicKey) {
  const response = await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
  return response.json();
}

// Get account balance
async function getBalance(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);
    const xlm = account.balances.find(b => b.asset_type === 'native');
    return xlm ? parseFloat(xlm.balance) : 0;
  } catch {
    return 0; // account not yet funded
  }
}

// Send XLM payment from buyer to farmer
async function sendPayment({ senderSecret, receiverPublicKey, amount, memo }) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const senderAccount = await server.loadAccount(senderKeypair.publicKey());

  const transaction = new StellarSdk.TransactionBuilder(senderAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: receiverPublicKey,
        asset: StellarSdk.Asset.native(),
        amount: amount.toFixed(7),
      })
    )
    .addMemo(StellarSdk.Memo.text(memo || 'FarmersMarket'))
    .setTimeout(30)
    .build();

  transaction.sign(senderKeypair);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

// Get transaction history for a public key
async function getTransactions(publicKey) {
  try {
    const payments = await server
      .payments()
      .forAccount(publicKey)
      .order('desc')
      .limit(20)
      .call();

    return payments.records
      .filter(p => p.type === 'payment' && p.asset_type === 'native')
      .map(p => ({
        id: p.id,
        type: p.from === publicKey ? 'sent' : 'received',
        amount: p.amount,
        from: p.from,
        to: p.to,
        created_at: p.created_at,
        transaction_hash: p.transaction_hash,
      }));
  } catch {
    return [];
  }
}

module.exports = { createWallet, fundTestnetAccount, getBalance, sendPayment, getTransactions };
