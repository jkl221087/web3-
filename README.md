# Escrow Fashion Store DApp

服裝電商風格的 DApp prototype。這個專案把 Web2 電商體驗和 Web3 資金託管流程拆開處理：

- 前端與本地 API 負責商品、購物車、會員中心、評價、物流節點
- 智能合約只負責 escrow 付款、買家確認收貨、賣家提領

整體定位是「可展示、可操作、可延伸」的作品集型 DApp 專案。

## Demo Features

- 首頁商店：主視覺、最新消息、滑動商品牆、熱門商品、高評分推薦
- 商品詳情頁：加入購物車、收藏、最近瀏覽、賣家評分
- 買家中心：訂單查詢、收貨確認、收藏、最近瀏覽、評價紀錄
- 賣家中心：物流節點更新、評論口碑、提領歷史、月報表
- 賣家後台：商品建立、上下架、賣家資格申請
- 賣家後台：商品建立、上下架、賣家資格申請、網站內圖片上傳
- Admin Center：賣家審核、商品管理、全店訂單與提領監控
- 本地 Store API：商品、賣家、訂單 metadata、評論、提領歷史
- Sepolia USDT Escrow 合約：付款、確認收貨、提領

## Why This Project

一般電商的商品與物流狀態，不一定適合全部上鏈；但付款與結算必須可信。  
這個專案採用「鏈上金流、鏈下營運資料」的分層方式，讓體驗更接近真實產品：

- 鏈上保留不可竄改的資金流程
- 鏈下保留高頻、展示型、營運型資料
- 前端體驗比純鏈上流程更順

## Architecture

```text
Frontend (HTML / CSS / JS)
├─ Storefront
├─ Product Detail
├─ Buyer Center
├─ Seller Center
├─ Seller Studio
└─ Admin Center

Local Store API (Rust / Axum + SQLite)
├─ /api/products
├─ /api/sellers
├─ /api/orders
├─ /api/reviews
└─ /api/payouts

Smart Contract (contracts/project_1.sol)
├─ create_and_fund_order
├─ confirm_order_received
├─ withdraw_order_funds
└─ get_order_info
```

## On-chain vs Off-chain

### On-chain

- `create_and_fund_order`
- `confirm_order_received`
- `withdraw_order_funds`
- `get_order_info`
- `get_contract_balance`

### Off-chain

- 商品資料與圖片
- 賣家申請 / 審核
- 物流節點狀態
- 評價 / 評分
- 提領歷史
- 收藏 / 最近瀏覽
- 首頁熱門與高評分推薦

## Pages

- `/`：首頁商店
- `/frontend/product.html?id=1`：商品詳情頁
- `/frontend/buyer-center.html`：買家中心
- `/frontend/seller-center.html`：賣家中心
- `/frontend/seller.html`：賣家商品後台
- `/frontend/admin.html`：Admin 管理後台

## Getting Started

### 1. Install JavaScript Dependencies

```powershell
npm install
```

### 2. Install Rust Toolchain

請先安裝 Rust：

```powershell
rustup --version
```

如果沒有安裝，可到 <https://rustup.rs/> 安裝。

### Admin API Guard

如果你要啟用後端 admin 權限檢查，請在 `.env` 設定：

```powershell
ADMIN_WALLET_ADDRESS="0x你的Owner地址"
```

目前後端已經對寫入型 API 補上基本限制：

- `create product`：只能由已核准賣家本人建立
- `toggle product`：只能由商品賣家或 admin 操作
- `seller approve`：只能由 `ADMIN_WALLET_ADDRESS` 指定地址操作
- `order flow update`：只能由賣家或 admin 更新
- `review`：只能由 buyer 自己送出
- `payout history`：只能由 seller 自己寫入

### 3. Configure Contract Address

編輯 `frontend/config.js`：

```js
window.APP_CONFIG = {
  DEFAULT_CONTRACT_ADDRESS: "",
  EXPECTED_CHAIN_ID: "0xaa36a7",
  PAYMENT_TOKEN_SYMBOL: "USDT",
  PAYMENT_TOKEN_DECIMALS: 6,
};
```

部署到 Sepolia 後，把 `DEFAULT_CONTRACT_ADDRESS` 換成你的合約地址。

注意：`contractName_order` 現在是 ERC20 / USDT escrow，部署時要傳入支付 token 地址。
本地測試可使用 [MockUSDT.sol](./contracts/mocks/MockUSDT.sol)。

### 4. Start Local Server

```powershell
npm run frontend
```

這個指令現在會啟動 Rust backend server。  
如果你要切回舊版 Node server 做比對，也可以執行：

```powershell
npm run frontend:node
```

開啟：

- `http://localhost:3000/`
- `http://localhost:3000/frontend/buyer-center.html`
- `http://localhost:3000/frontend/seller-center.html`
- `http://localhost:3000/frontend/seller.html`
- `http://localhost:3000/frontend/admin.html`

### 5. Compile Contract

```powershell
npm run compile:contract
```

### 6. Run Contract Tests

```powershell
npm run test:contract
```

目前已經有一套基礎 escrow 測試，會驗證：

- 下單付款
- buyer / owner 完成訂單權限
- seller 提領權限
- 重複提領與不存在訂單的失敗情境

### 7. Send a Test Transaction With Rust

如果 `.env` 已經設定好 `RPC_URL` 和 `PRIVATE_KEY`，可以用 Rust 工具送測試交易：

```powershell
npm run send:tx
```

## Project Structure

```text
web3-basics/
├─ artifacts/               # 合約編譯輸出
│  └─ contracts/
├─ contracts/               # Solidity 合約來源
│  ├─ project_1.sol
│  └─ experimental/         # 舊版 / 測試合約
├─ data/                    # JSON 種子資料與本地 SQLite
├─ frontend/                # 商店前端頁面、樣式、互動腳本
├─ legacy/                  # 舊版保留檔
│  ├─ frontend/
│  └─ node/
├─ src/                     # Rust server 與工具
│  ├─ main.rs
│  └─ bin/send_tx.rs
├─ Cargo.toml
├─ package.json
├─ .env.example
└─ README.md
```

## What Stayed Native

不是所有東西都適合硬改成 Rust，這個專案目前保留：

- Solidity：智能合約本體
- HTML / CSS / 瀏覽器 JavaScript：商店前端與 DApp 互動
- Node `solc` CLI：目前仍用來編譯 Solidity 合約

這樣的分工比較符合實務，也能避免為了 Rust 化而犧牲維護性。

## Data Layer

- 正式資料來源：`data/store.db`
- 相容種子資料：`data/*.json`
- 啟動 Rust server 時，如果 SQLite 還是空的，會自動匯入現有 JSON 內容

這樣可以在不打斷你目前開發流程的前提下，把商店資料層正式化。

## Security Notes

- `.env` 已被 `.gitignore` 排除，不會提交到 GitHub
- 如果你曾在本機 `.env` 中放過真實私鑰，建議立即更換那把私鑰
- `frontend/config.js` 公開版預設不帶合約地址
- `data/*.json` 已整理成乾淨初始狀態
- `legacy/` 內是保留做比對或回退的舊版檔案，不是主執行路徑

## Tech Stack

- Solidity
- Rust
- Axum
- Tokio
- SQLite
- Ethers.js v6
- Vanilla JavaScript
- HTML / CSS
- JSON seed files

## Launch Roadmap

真正要往上線推，建議先照這個優先順序做：

### P0 Must Have

- 合約測試補齊：付款、確認收貨、提領、重複提領、防呆失敗情境
- 權限正式化：buyer / seller / admin 的後端權限驗證與 session
- 支付正式化：改成 ERC20 / USDT escrow，降低 ETH 價格波動影響
- 正式資料庫：從本地 SQLite 規劃到 PostgreSQL 與 migration
- 圖片儲存正式化：改接 S3、Cloudinary 或 Supabase Storage
- 基本資安：輸入驗證、rate limit、CORS、錯誤處理、敏感資訊保護

### P1 Should Have

- 訂單系統完整化：取消訂單、退款、爭議處理、超時處理
- 物流流程正式化：狀態機、時間戳、操作紀錄
- 會員體驗：通知、地址簿、搜尋與篩選
- Admin 後台補強：審核紀錄、商品審核、異常訂單監控、營運報表
- 正式部署流程：環境變數、DB migration、備份與監控

### P2 Nice To Have

- 多圖商品、圖片排序、影片展示
- 商品推薦與評價聚合
- Swap / router 整合
- Embedded wallet 或 account abstraction
- 錯誤監控與營運分析面板

完整版本請看 [ROADMAP.md](./ROADMAP.md)。

## License

ISC
