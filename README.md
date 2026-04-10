# Escrow Fashion Store DApp

服裝電商風格的 DApp prototype，前端提供商品展示、購物車、買家中心、賣家中心與賣家商品後台；鏈上合約專注處理 escrow 付款、買家確認收貨與賣家提領。

## 專案特色

- 服裝電商首頁：主視覺、最新消息、滑動商品牆、熱門商品、高評分推薦
- 商品詳情頁：加入購物車、收藏、最近瀏覽、賣家評分
- 買家中心：訂單查詢、收貨確認、收藏、最近瀏覽、評價紀錄
- 賣家中心：物流節點更新、提領、提領歷史、月報表、賣家評分
- 賣家後台：商品建立、上下架、賣家資格申請
- 本地 JSON API：商品、賣家、訂單 metadata、評論、提領歷史
- 智能合約：只處理資金關鍵流程

## 專案結構

```text
web3-basics/
├─ data/                    # 本地 JSON 資料
├─ frontend/                # 前端頁面與腳本
├─ project_1.sol            # 簡化後的 escrow 合約
├─ serve-frontend.mjs       # 本地靜態 + API server
├─ package.json
└─ README.md
```

## 鏈上 / 鏈下分工

### 鏈上

- `create_and_fund_order`
- `confirm_order_received`
- `withdraw_order_funds`
- `get_order_info`
- `get_contract_balance`

### 鏈下

- 商品資料與圖片
- 賣家申請 / 審核
- 物流節點狀態
- 評價 / 評分
- 提領歷史
- 收藏 / 最近瀏覽

## 安裝與啟動

### 1. 安裝依賴

```powershell
npm install
```

### 2. 設定前端合約地址

編輯 `frontend/config.js`：

```js
window.APP_CONFIG = {
  DEFAULT_CONTRACT_ADDRESS: "",
  EXPECTED_CHAIN_ID: "0xaa36a7",
};
```

部署合約後，把 `DEFAULT_CONTRACT_ADDRESS` 換成你的 Sepolia 合約地址。

### 3. 啟動本地網站

```powershell
npm run frontend
```

開啟：

- `http://localhost:3000/`
- `http://localhost:3000/frontend/buyer-center.html`
- `http://localhost:3000/frontend/seller-center.html`
- `http://localhost:3000/frontend/seller.html`

## 合約編譯

```powershell
node .\node_modules\solc\solc.js --bin .\project_1.sol
```

## GitHub 發布前注意事項

- `.env` 已加入 `.gitignore`，不要上傳真實私鑰
- 如果你曾把私鑰寫進 `.env`，請務必更換那把私鑰
- `frontend/config.js` 預設不帶合約地址，公開 repo 請自行填入或保持空白
- `data/*.json` 已整理成可提交的初始狀態

## 推到 GitHub

```powershell
git init -b main
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<your-name>/<your-repo>.git
git push -u origin main
```

## 目前狀態

這份專案屬於完整度很高的 DApp prototype：

- 前端 UI 已接近正式服裝電商
- 鏈上金流流程完整
- 鏈下商品 / 評價 / 提領資料完整
- 適合作為作品集專案、展示專案、或之後再升級成正式後端版本
