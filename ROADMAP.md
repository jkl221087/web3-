# Store Launch Roadmap

這份文件整理了目前專案從 prototype 推到正式上線前，最值得優先完成的工作。

## Current Stage

目前專案已具備：

- 前台商店、商品詳情頁、購物車
- 買家中心、賣家中心、Admin Center
- Rust + SQLite 本地後端
- 商品圖片網站內上傳
- Sepolia 上的 escrow 合約流程
- 評論、提領歷史、訂單 metadata

目前定位比較接近：

- 作品集等級：高完整度
- 測試版等級：中高完整度
- 正式商用：仍需補齊安全、支付、資料與權限治理

## P0 Must Have

### 1. Smart Contract Tests

- 補齊付款、確認收貨、提領流程測試
- 測試重複提領、非授權呼叫、錯誤訂單狀態
- 增加失敗情境與 revert 驗證
- 建議加入單元測試與端對端流程測試

### 2. Role and Access Control

- buyer / seller / admin 權限邏輯從前端判斷提升為後端驗證
- 補上登入 session 或 wallet-based backend session
- API 每個敏感操作都要做角色驗證
- seller 審核紀錄要可追蹤

### 3. Stablecoin Payments

- 將 ETH 結算改為 ERC20 / USDT escrow
- 明確定義 token address、decimals、approve / transferFrom 流程
- 規劃匯率與價格顯示策略
- 如果要做 swap，再在 ERC20 穩定後整合 router

### 4. Production Database

- 開發期可維持 SQLite
- 正式環境建議切 PostgreSQL
- 加入 migration 機制
- 明確定義 products、orders、reviews、payouts、sellers schema

### 5. Media Storage

- 圖片從本機 uploads 遷移到正式 object storage
- 例如 S3、Cloudinary、Supabase Storage
- 補上圖片刪除、替換、排序
- 設計縮圖與預覽圖策略

### 6. Security and Hardening

- API 輸入驗證
- CORS 與 rate limiting
- 更完整的錯誤處理
- 敏感設定與私鑰保護
- 日誌與異常追蹤

## P1 Should Have

### 1. Order Lifecycle

- 取消訂單
- 退款流程
- 爭議處理
- 超時未完成訂單的處理策略

### 2. Logistics and Notifications

- 更完整的物流狀態機
- 每個節點的操作時間記錄
- 買家 / 賣家通知提醒
- 可追蹤的物流事件歷史

### 3. Member Experience

- 通知中心
- 地址簿
- 訂單搜尋、篩選、排序
- 更完整的會員資料管理

### 4. Admin Operations

- 商品審核
- 異常訂單監控
- 賣家審核紀錄
- 營收、提領、評論儀表板

### 5. Deployment and Ops

- 正式環境部署腳本
- DB migration / seed
- 自動備份
- 監控與警報

## P2 Nice To Have

### 1. Store Experience

- 多圖商品
- 商品影片
- 圖片排序
- 更完整推薦模組

### 2. Web3 UX

- Swap / router 整合
- Embedded wallet
- Account abstraction
- 降低重複簽名次數的 session 設計

### 3. Analytics

- 錯誤監控
- 使用者行為分析
- 銷售分析
- 留存與轉換率面板

## Recommended Next 3 Steps

如果要用最有效率的方式往正式化推進，建議先做：

1. 合約測試與安全整理
2. ERC20 / USDT 支付流程
3. 角色與 API 權限正式化
