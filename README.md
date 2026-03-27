# 🌿 Farmers Marketplace

A minimal MVP marketplace where farmers list products and buyers pay using the **Stellar Network (XLM)**.

## Stack

- Frontend: React + Vite
- Backend: Node.js + Express
- Database: SQLite (via better-sqlite3)
- Payments: Stellar Testnet (XLM)

## Project Structure

```
FarmersMarketplace/
├── backend/
│   ├── src/
│   │   ├── index.js          # Express app entry
│   │   ├── stellar.js        # Stellar SDK helpers
│   │   ├── middleware/auth.js
│   │   ├── db/schema.js      # SQLite schema + connection
│   │   └── routes/
│   │       ├── auth.js       # register, login
│   │       ├── products.js   # CRUD listings
│   │       ├── orders.js     # place order + pay
│   │       └── wallet.js     # balance, transactions, fund
│   └── package.json
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── api/client.js     # API wrapper
    │   ├── context/AuthContext.jsx
    │   ├── components/Navbar.jsx
    │   └── pages/
    │       ├── Auth.jsx      # Login + Register
    │       ├── Dashboard.jsx # Farmer: add/view products
    │       ├── Marketplace.jsx # Buyer: browse
    │       ├── ProductDetail.jsx # Buy flow
    │       └── Wallet.jsx    # Balance + transactions
    └── package.json
```

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Runs on http://localhost:4000

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on http://localhost:3000

## Payment Flow

1. Register as a **buyer** and a **farmer** (two separate accounts)
2. Go to **Wallet** → click "Fund with Testnet XLM" (uses Stellar Friendbot, free testnet tokens)
3. As a farmer, go to **Dashboard** and list a product priced in XLM
4. As a buyer, browse the **Marketplace**, open a product, set quantity, click **Buy Now**
5. The backend signs and submits a real Stellar transaction on testnet
6. View the transaction hash in **Wallet → Transaction History** or on [stellar.expert](https://stellar.expert/explorer/testnet)

## API Endpoints

| Method | Path                                     | Auth   | Description                                                        |
| ------ | ---------------------------------------- | ------ | ------------------------------------------------------------------ |
| POST   | /api/auth/register                       | —      | Register user                                                      |
| POST   | /api/auth/login                          | —      | Login                                                              |
| GET    | /api/products                            | —      | Browse all products                                                |
| GET    | /api/products/:id                        | —      | Product detail                                                     |
| POST   | /api/products                            | farmer | Create listing                                                     |
| GET    | /api/products/mine/list                  | farmer | My listings                                                        |
| DELETE | /api/products/:id                        | farmer | Remove listing                                                     |
| POST   | /api/orders                              | buyer  | Place + pay order                                                  |
| GET    | /api/orders                              | buyer  | Order history                                                      |
| GET    | /api/orders/sales                        | farmer | Incoming sales                                                     |
| GET    | /api/wallet                              | auth   | Balance                                                            |
| GET    | /api/wallet/transactions                 | auth   | TX history                                                         |
| POST   | /api/wallet/fund                         | auth   | Fund via Friendbot (testnet)                                       |
| GET    | /api/contracts/:contractId/state?prefix= | auth   | View Soroban contract storage entries (JSON: key, val, durability) |

## Notes

- Stellar wallets are auto-created on registration
- All payments use **XLM on Stellar Testnet** — no real money involved
- SQLite database file (`market.db`) is created automatically on first run
- To reset: delete `backend/market.db`
