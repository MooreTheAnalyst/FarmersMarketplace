const StellarSdk = require("@stellar/stellar-sdk");

const STELLAR_NETWORK = (
  process.env.STELLAR_NETWORK || "testnet"
).toLowerCase();

if (!["testnet", "mainnet"].includes(STELLAR_NETWORK)) {
  throw new Error(
    `Invalid STELLAR_NETWORK "${STELLAR_NETWORK}". Must be "testnet" or "mainnet".`,
  );
}

if (
  STELLAR_NETWORK === "mainnet" &&
  process.env.STELLAR_MAINNET_CONFIRMED !== "true"
) {
  throw new Error(
    "Mainnet use requires STELLAR_MAINNET_CONFIRMED=true in your environment. " +
      "This guard prevents accidental real-fund transactions.",
  );
}

const isTestnet = STELLAR_NETWORK === "testnet";

const horizonUrl =
  process.env.STELLAR_HORIZON_URL ||
  (isTestnet
    ? "https://horizon-testnet.stellar.org"
    : "https://horizon.stellar.org");

const server = new StellarSdk.Horizon.Server(horizonUrl);
const networkPassphrase = isTestnet
  ? StellarSdk.Networks.TESTNET
  : StellarSdk.Networks.PUBLIC;

function createWallet() {
  const keypair = StellarSdk.Keypair.random();
  return { publicKey: keypair.publicKey(), secretKey: keypair.secret() };
}

async function fundTestnetAccount(publicKey) {
  const response = await fetch(
    `https://friendbot.stellar.org?addr=${publicKey}`,
  );
  return response.json();
}

async function getBalance(publicKey) {
  try {
    const account = await server.loadAccount(publicKey);
    const xlm = account.balances.find((b) => b.asset_type === "native");
    return xlm ? parseFloat(xlm.balance) : 0;
  } catch {
    return 0;
  }
}

async function sendPayment({ senderSecret, receiverPublicKey, amount, memo }) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);
  
  let senderAccount;
  try {
    senderAccount = await server.loadAccount(senderKeypair.publicKey());
  } catch (error) {
    // Check if account is not found (unfunded)
    if (error.response && error.response.status === 404) {
      const err = new Error('Stellar account not found. Please fund your wallet to activate it.');
      err.code = 'account_not_found';
      throw err;
    }
    throw error;
  }

  const transaction = new StellarSdk.TransactionBuilder(senderAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: receiverPublicKey,
        asset: StellarSdk.Asset.native(),
        amount: amount.toFixed(7),
      }),
    )
    .addMemo(StellarSdk.Memo.text(memo || "FarmersMarket"))
    .setTimeout(30)
    .build();

  transaction.sign(senderKeypair);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

async function getTransactions(publicKey) {
  try {
    const payments = await server
      .payments()
      .forAccount(publicKey)
      .order("desc")
      .limit(20)
      .call();

    return payments.records
      .filter((p) => p.type === "payment" && p.asset_type === "native")
      .map((p) => ({
        id: p.id,
        type: p.from === publicKey ? "sent" : "received",
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

module.exports = { isTestnet, server, createWallet, fundTestnetAccount, getBalance, sendPayment, getTransactions };
async function createClaimableBalance({
  senderSecret,
  farmerPublicKey,
  buyerPublicKey,
  amount,
}) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const senderAccount = await server.loadAccount(senderKeypair.publicKey());

  const farmerClaimant = new StellarSdk.Claimant(
    farmerPublicKey,
    StellarSdk.Claimant.predicateUnconditional(),
  );
  const buyerClaimant = new StellarSdk.Claimant(
    buyerPublicKey,
    StellarSdk.Claimant.predicateNot(
      StellarSdk.Claimant.predicateBeforeRelativeTime("1209600"),
    ),
  );

  const transaction = new StellarSdk.TransactionBuilder(senderAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.createClaimableBalance({
        asset: StellarSdk.Asset.native(),
        amount: amount.toFixed(7),
        claimants: [farmerClaimant, buyerClaimant],
      }),
    )
    .setTimeout(30)
    .build();

  transaction.sign(senderKeypair);
  const result = await server.submitTransaction(transaction);

  const claimableBalances = await server
    .claimableBalances()
    .claimant(farmerPublicKey)
    .order("desc")
    .limit(5)
    .call();

  const balance = claimableBalances.records.find(
    (b) =>
      b.amount === amount.toFixed(7) &&
      b.claimants.some((c) => c.destination === buyerPublicKey),
  );
  if (!balance) throw new Error("Claimable balance not found after creation");

  return { txHash: result.hash, balanceId: balance.id };
}

async function claimBalance({ claimantSecret, balanceId }) {
  const claimantKeypair = StellarSdk.Keypair.fromSecret(claimantSecret);
  const claimantAccount = await server.loadAccount(claimantKeypair.publicKey());

  const transaction = new StellarSdk.TransactionBuilder(claimantAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.claimClaimableBalance({ balanceID: balanceId }),
    )
    .setTimeout(30)
    .build();

  transaction.sign(claimantKeypair);
  const result = await server.submitTransaction(transaction);
  return result.hash;
}

async function createPreorderClaimableBalance({
  senderSecret,
  farmerPublicKey,
  amount,
  unlockAtUnix,
}) {
  const senderKeypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const senderAccount = await server.loadAccount(senderKeypair.publicKey());

  const farmerClaimant = new StellarSdk.Claimant(
    farmerPublicKey,
    StellarSdk.Claimant.predicateNot(
      StellarSdk.Claimant.predicateBeforeAbsoluteTime(String(unlockAtUnix)),
    ),
  );

  const transaction = new StellarSdk.TransactionBuilder(senderAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.createClaimableBalance({
        asset: StellarSdk.Asset.native(),
        amount: amount.toFixed(7),
        claimants: [farmerClaimant],
      }),
    )
    .setTimeout(30)
    .build();

  transaction.sign(senderKeypair);
  const result = await server.submitTransaction(transaction);

  const claimableBalances = await server
    .claimableBalances()
    .claimant(farmerPublicKey)
    .order("desc")
    .limit(5)
    .call();

  const balance = claimableBalances.records.find(
    (b) => b.amount === amount.toFixed(7),
  );
  if (!balance) throw new Error("Claimable balance not found after creation");

  return { txHash: result.hash, balanceId: balance.id };
}

async function getContractState(contractId, prefix = null) {
  const sorobanRpcUrl =
    process.env.SOROBAN_RPC_URL ||
    (isTestnet
      ? "https://soroban-testnet.stellar.org"
      : "https://soroban.stellar.org");
  const sorobanServer = new StellarSdk.SorobanRpc.Server(sorobanRpcUrl);

  const entries = [];
  let hasMore = true;
  let cursor = null;

  while (hasMore) {
    const response = await sorobanServer.getContractData(contractId, cursor);
    if (response.data) {
      const entry = {
        key: StellarSdk.scValToNative(response.data.key, { asString: true }),
        val: StellarSdk.scValToNative(response.data.val, { asString: true }),
        durability: response.data.durability || "Persistent",
      };
      if (!prefix || entry.key.startsWith(prefix)) entries.push(entry);
    }
    hasMore = response.latestLedger;
    cursor = response.pagingToken;
  }

  return entries;
}

async function invokeEscrowContract({
  action,
  senderSecret,
  orderId,
  buyerPublicKey,
  farmerPublicKey,
  amount,
  timeoutUnix,
}) {
  const contractId = process.env.SOROBAN_ESCROW_CONTRACT_ID;
  const xlmTokenContractId = process.env.SOROBAN_XLM_TOKEN_CONTRACT_ID;
  if (!contractId) {
    throw new Error('SOROBAN_ESCROW_CONTRACT_ID is not configured');
  }
  if (!xlmTokenContractId) {
    throw new Error('SOROBAN_XLM_TOKEN_CONTRACT_ID is not configured');
  }

  const keypair = StellarSdk.Keypair.fromSecret(senderSecret);
  const source = await server.loadAccount(keypair.publicKey());
  const sorobanRpcUrl =
    process.env.SOROBAN_RPC_URL ||
    (isTestnet ? 'https://soroban-testnet.stellar.org' : 'https://soroban.stellar.org');
  const sorobanServer = new StellarSdk.SorobanRpc.Server(sorobanRpcUrl);
  const contract = new StellarSdk.Contract(contractId);

  let operation;
  if (action === 'deposit') {
    const amountStroops = BigInt(Math.round(Number(amount) * 10_000_000));
    operation = contract.call(
      'deposit',
      StellarSdk.nativeToScVal(xlmTokenContractId, { type: 'address' }),
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' }),
      StellarSdk.nativeToScVal(buyerPublicKey, { type: 'address' }),
      StellarSdk.nativeToScVal(farmerPublicKey, { type: 'address' }),
      StellarSdk.nativeToScVal(amountStroops, { type: 'i128' }),
      StellarSdk.nativeToScVal(Number(timeoutUnix), { type: 'u64' })
    );
  } else if (action === 'release') {
    operation = contract.call(
      'release',
      StellarSdk.nativeToScVal(xlmTokenContractId, { type: 'address' }),
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' })
    );
  } else if (action === 'refund') {
    operation = contract.call(
      'refund',
      StellarSdk.nativeToScVal(xlmTokenContractId, { type: 'address' }),
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' })
    );
  } else if (action === 'dispute') {
    operation = contract.call(
      'dispute',
      StellarSdk.nativeToScVal(Number(orderId), { type: 'u64' }),
      StellarSdk.nativeToScVal(keypair.publicKey(), { type: 'address' })
    );
  } else {
    throw new Error(`Unsupported Soroban escrow action: ${action}`);
  }

  let tx = new StellarSdk.TransactionBuilder(source, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(60)
    .build();

  tx = await sorobanServer.prepareTransaction(tx);
  tx.sign(keypair);

  const sendResult = await sorobanServer.sendTransaction(tx);
  if (sendResult.status === 'ERROR') {
    throw new Error(sendResult.errorResultXdr || 'Soroban transaction submission failed');
  }

  const hash = sendResult.hash || tx.hash().toString('hex');
  for (let i = 0; i < 15; i += 1) {
    const txResult = await sorobanServer.getTransaction(hash);
    if (txResult.status === 'SUCCESS') {
      return { txHash: hash, contractId };
    }
    if (txResult.status === 'FAILED') {
      throw new Error('Soroban transaction failed');
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('Soroban transaction confirmation timed out');
}

// Resolve a federation address (e.g. farmer*farmersmarket.io) to a Stellar public key.
// Pass the db instance for local domain lookups.
async function resolveFederationAddress(address, db) {
  if (!address || !address.includes("*")) return address; // already a raw key

  const [username, domain] = address.split("*");
  const rawLocal = (
    process.env.FEDERATION_DOMAIN ||
    process.env.FRONTEND_URL ||
    "localhost"
  )
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "")
    .split(":")[0];

  if (domain === rawLocal || domain === "localhost") {
    const user = db
      .prepare("SELECT stellar_public_key FROM users WHERE federation_name = ?")
      .get(username.toLowerCase());
    if (!user || !user.stellar_public_key)
      throw new Error(`Federation address not found: ${address}`);
    return user.stellar_public_key;
  }

  // External domain — use Stellar SDK federation resolution
  try {
    const record = await StellarSdk.Federation.Server.resolve(address);
    if (!record.account_id)
      throw new Error("No account_id in federation response");
    return record.account_id;
  } catch (e) {
    throw new Error(
      `Could not resolve federation address "${address}": ${e.message}`,
    );
  }
}

module.exports = {
  isTestnet,
  server,
  createWallet,
  fundTestnetAccount,
  getBalance,
  sendPayment,
  getTransactions,
  createClaimableBalance,
  createPreorderClaimableBalance,
  claimBalance,
  invokeEscrowContract,
  getContractState,
  resolveFederationAddress,
};
