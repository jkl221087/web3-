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
- 本地 JSON API：商品、賣家、訂單 metadata、評論、提領歷史
- Sepolia Escrow 合約：付款、確認收貨、提領

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
└─ Seller Studio

Local JSON API (serve-frontend.mjs)
├─ /api/products
├─ /api/sellers
├─ /api/orders
├─ /api/reviews
└─ /api/payouts

Smart Contract (project_1.sol)
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

## Getting Started

### 1. Install

```powershell
npm install
```

### 2. Configure Contract Address

編輯 `frontend/config.js`：

```js
window.APP_CONFIG = {
  DEFAULT_CONTRACT_ADDRESS: "",
  EXPECTED_CHAIN_ID: "0xaa36a7",
};
```

部署到 Sepolia 後，把 `DEFAULT_CONTRACT_ADDRESS` 換成你的合約地址。

### 3. Start Local Server

```powershell
npm run frontend
```

開啟：

- `http://localhost:3000/`
- `http://localhost:3000/frontend/buyer-center.html`
- `http://localhost:3000/frontend/seller-center.html`
- `http://localhost:3000/frontend/seller.html`

### 4. Compile Contract

```powershell
npm run compile:contract
```

## Project Structure

```text
web3-basics/
├─ data/                    # 本地 JSON 資料
├─ frontend/                # 前端頁面、樣式、互動腳本
├─ project_1.sol            # Escrow 合約
├─ serve-frontend.mjs       # 本地靜態 + JSON API server
├─ package.json
├─ .env.example
└─ README.md
```

## Security Notes

- `.env` 已被 `.gitignore` 排除，不會提交到 GitHub
- 如果你曾在本機 `.env` 中放過真實私鑰，建議立即更換那把私鑰
- `frontend/config.js` 公開版預設不帶合約地址
- `data/*.json` 已整理成乾淨初始狀態

## Tech Stack

- Solidity
- Ethers.js v6
- Vanilla JavaScript
- HTML / CSS
- Node.js HTTP Server
- JSON file storage

## Next Steps

- 改成正式資料庫與後端 API
- 改成 ERC20 / USDT 結算
- 接入 swap router
- 增加部署腳本與測試
- 補齊商品圖片上傳與真實媒體資產

## License

ISC
