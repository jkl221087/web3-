const core = window.FashionStoreCore;
const dom = {
  connectButton: document.getElementById("connectButton"),
  switchNetworkButton: document.getElementById("switchNetworkButton"),
  walletAddress: document.getElementById("walletAddress"),
  chainId: document.getElementById("chainId"),
  contractAddressLabel: document.getElementById("contractAddressLabel"),
  escrowBalance: document.getElementById("escrowBalance"),
  buyerMetrics: document.getElementById("buyerMetrics"),
  buyerFocusList: document.getElementById("buyerFocusList"),
  favoriteGrid: document.getElementById("favoriteGrid"),
  recentlyViewedGrid: document.getElementById("recentlyViewedGrid"),
  buyerReviewHistory: document.getElementById("buyerReviewHistory"),
  orderSearchInput: document.getElementById("orderSearchInput"),
  orderStageFilter: document.getElementById("orderStageFilter"),
  refreshOrdersButton: document.getElementById("refreshOrdersButton"),
  ordersSummary: document.getElementById("ordersSummary"),
  ordersGrid: document.getElementById("ordersGrid"),
  toastStack: document.getElementById("toastStack")
};
const state = { account:null, chainId:null, session:null, products:[], orders:[], reviews:[], orderSearch:"", orderStageFilter:"all", expanded:new Set() };
const bootstrap = core.createPageBootstrap({ dom, state, setHeader, hydrate });
const toast = bootstrap.toast;


const normalizeError = bootstrap.normalizeError;

//更新頁面上方的錢包 / 鏈 / 合約資訊
function setHeader() {
  core.applyWalletHeader(dom, state);
}

async function refreshEscrowBalance() {
  if (!dom.escrowBalance) return;
  if (!core.getConfiguredContractAddress()) {
    dom.escrowBalance.textContent = "-";
    return;
  }

  try {
    const contract = await core.ensureContract();
    const balance = await contract.get_contract_balance();
    dom.escrowBalance.textContent = core.formatEth(balance);
  } catch {
    dom.escrowBalance.textContent = "-";
  }
}

function normalizeOrder(order) {
  const stage = Number(order?.stage ?? order?.flowStage ?? 0);
  const buyer = String(order?.buyer || "");
  const productName = String(order?.productName || "");
  const stageMeta = core.getOrderStageMeta(stage);

  return {
    ...order,
    stage,
    buyer,
    buyerLower: buyer.toLowerCase(),
    productName,
    productNameLower: productName.toLowerCase(),
    orderIdText: String(order?.orderId ?? ""),
    stageLabel: order?.stageLabel || stageMeta.label,
    amountDisplayValue: order?.amountWei ?? order?.priceWei ?? 0
  };
}

function buildProductMap(products) {
  return new Map(products.map((product) => [Number(product.productId), product]));
}

//// 依照目前帳號、搜尋字串、狀態篩選，取得這個買家的訂單

function getCurrentOrders() {
  if (!state.account) return [];

  const accountLower = state.account.toLowerCase();
  const keyword = state.orderSearch.trim().toLowerCase();
  const stageFilter = state.orderStageFilter;

  return state.normalizedOrders.filter((order) => {
    if (order.buyerLower !== accountLower) return false;
    if (stageFilter !== "all" && String(order.stage) !== stageFilter) return false;
    if (!keyword) return true;

    return (
      order.orderIdText.includes(keyword) ||
      order.productNameLower.includes(keyword)
    );
  });
}

function summarizeOrders(orders) {
  const summary = {
    total: orders.length,
    inProgress: 0,
    awaiting: 0,
    completed: 0,
    moving: 0,
    finished: 0
  };

  for (const order of orders) {
    const stage = Number(order.stage || 0);

    if ([1, 2, 3, 4].includes(stage)) summary.inProgress += 1;
    if (stage === 4) summary.awaiting += 1;
    if (stage === 6) summary.completed += 1;
    if ([2, 3].includes(stage)) summary.moving += 1;
    if (stage === 6) summary.finished += 1;
  }

  return summary;
}


// 渲染上方統計卡片
function renderMetrics(summary) {
  if (!dom.buyerMetrics) return;

  dom.buyerMetrics.innerHTML = `
    <article class="metric-card"><span>全部訂單</span><strong>${summary.total}</strong><p>你目前作為買家的所有鏈上訂單。</p></article>
    <article class="metric-card"><span>進行中</span><strong>${summary.inProgress}</strong><p>仍在履約與物流流程中的訂單。</p></article>
    <article class="metric-card"><span>待你確認</span><strong>${summary.awaiting}</strong><p>可直接完成收貨確認的訂單。</p></article>
    <article class="metric-card"><span>已完成</span><strong>${summary.completed}</strong><p>已完成整個 escrow 流程的訂單。</p></article>
  `;
}

// 渲染待辦提醒區
function renderFocus(summary) {
  if (!dom.buyerFocusList) return;

  dom.buyerFocusList.innerHTML = `
    <article class="member-focus-card">
      <h3>確認可取貨訂單</h3>
      <p>${summary.awaiting ? `目前有 ${summary.awaiting} 筆等待你確認的訂單。` : "目前沒有等待你確認的訂單。"}</p>
      <div class="status-badge ${summary.awaiting ? "warn" : "success"}">${summary.awaiting ? "待確認" : "已清空"}</div>
    </article>
    <article class="member-focus-card">
      <h3>追蹤物流進度</h3>
      <p>${summary.moving ? `目前有 ${summary.moving} 筆運送中的訂單。` : "目前沒有運送中的訂單。"}</p>
      <div class="status-badge ${summary.moving ? "info" : "success"}">${summary.moving ? "進行中" : "穩定"}</div>
    </article>
    <article class="member-focus-card">
      <h3>回看已完成訂單</h3>
      <p>${summary.finished ? `目前已有 ${summary.finished} 筆完成的買家訂單。` : "還沒有完成的買家訂單。"}</p>
      <div class="status-badge neutral">歷史紀錄</div>
    </article>
  `;
}

function stepTrack(order) {
  return [1, 2, 3, 4, 5, 6]
    .map((stage) => {
      const stageMeta = core.getOrderStageMeta(stage);
      const isDone = order.stage >= stage ? "done" : "";
      const isCurrent = order.stage === stage ? "current" : "";
      return `<span class="step-pill ${isDone} ${isCurrent}">${stageMeta.label}</span>`;
    })
    .join("");
}

function renderOrdersSummary(summary) {
  if (!dom.ordersSummary) return;

  dom.ordersSummary.innerHTML = `
    <span class="summary-pill"><strong>${summary.total}</strong> 筆訂單</span>
    <span class="summary-pill"><strong>${summary.awaiting}</strong> 待確認</span>
  `;
}

function renderOrderCard(order) {
  return `
    <article class="order-card">
      <div class="price-row">
        <h3>訂單 #${order.orderId}</h3>
        <strong>${core.formatEth(order.amountDisplayValue)}</strong>
      </div>
      <p>${order.productName || `商品 #${order.productId}`}</p>
      <div class="detail-tags">
        <span class="tag-pill">${order.stageLabel}</span>
      </div>
      <div class="step-track">${stepTrack(order)}</div>
    </article>
  `;
}

// 渲染訂單列表
function renderOrders() {
  const orders = getCurrentOrders();
  const summary = summarizeOrders(orders);

  renderMetrics(summary);
  renderFocus(summary);
  renderOrdersSummary(summary);

  if (!dom.ordersGrid) return;

  if (!orders.length) {
    dom.ordersGrid.innerHTML = `
      <article class="panel-card">
        <strong>目前沒有符合條件的訂單</strong>
        <p>完成下單後，這裡會顯示買家流程與收貨確認。</p>
      </article>
    `;
    return;
  }

  dom.ordersGrid.innerHTML = orders.map(renderOrderCard).join("");
}


function renderCompactProductCard(product) {
  return `
    <article class="compact-product-card">
      <img src="${product.image}" alt="${product.name}">
      <div class="compact-product-copy">
        <h3>${product.name}</h3>
        <p>${product.meta.description || product.meta.style}</p>
        <div class="price-row">
          <strong>${core.formatEth(product.priceWei)}</strong>
          <a class="button ghost link-button" href="/frontend/product.html?id=${product.productId}">查看</a>
        </div>
      </div>
    </article>
  `;
}


// 渲染收藏 / 最近瀏覽 / 評價紀錄
function renderCollections() {
  const favorites = new Set(core.getFavoriteProductIds());
  const recentIds = core.getRecentlyViewedProductIds();

  if (dom.favoriteGrid) {
    const favoriteProducts = state.products
      .filter((product) => favorites.has(product.productId))
      .slice(0, 4);

    dom.favoriteGrid.innerHTML = favoriteProducts.length
      ? favoriteProducts.map(renderCompactProductCard).join("")
      : `<article class="panel-card"><strong>目前沒有收藏商品</strong><p>在商品頁加入收藏後，這裡會顯示你的清單。</p></article>`;
  }

  if (dom.recentlyViewedGrid) {
    const recentProducts = recentIds
      .map((id) => state.productMap.get(Number(id)))
      .filter(Boolean)
      .slice(0, 4);

    dom.recentlyViewedGrid.innerHTML = recentProducts.length
      ? recentProducts.map(renderCompactProductCard).join("")
      : `<article class="panel-card"><strong>目前沒有最近瀏覽</strong><p>瀏覽商品後，這裡會顯示最近看過的商品。</p></article>`;
  }

  if (dom.buyerReviewHistory) {
    dom.buyerReviewHistory.innerHTML = state.buyerReviews.length
      ? state.buyerReviews.slice(0, 6).map((review) => `
          <article class="member-focus-card">
            <span>訂單 #${review.orderId}</span>
            <h3>${review.productName || `商品 #${review.productId}`}</h3>
            <p>${"★".repeat(Number(review.rating || 0))}${"☆".repeat(5 - Number(review.rating || 0))}</p>
            <p>${review.comment || "只有星等評分"}</p>
          </article>
        `).join("")
      : `<article class="member-focus-card"><span>Reviews</span><h3>目前還沒有評論紀錄</h3><p>完成收貨並評價後，這裡會顯示你的評論歷史。</p></article>`;
  }
}

// 載入這頁需要的資料並刷新畫面
async function hydrate(force = false) {
  try {
    await bootstrap.sync(force);

    const [products, orders, reviews] = await Promise.all([
      core.getProducts(force),
      core.getOrders(force),
      core.getReviews(force)
    ]);

    state.products = products;
    state.productMap = buildProductMap(products);
    state.orders = orders;
    state.normalizedOrders = orders.map(normalizeOrder);
    state.reviews = reviews;

    const accountLower = String(state.account || "").toLowerCase();
    state.buyerReviews = reviews.filter((review) => String(review.buyer || "").toLowerCase() === accountLower);

    setHeader();
    await refreshEscrowBalance();
    renderCollections();
    renderOrders();
  } catch (error) {
    toast("error", normalizeError(error));
  }
}

function debounce(fn, delay = 250) {
  let timer = null;

  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

bootstrap.bind();

core.on(dom.refreshOrdersButton, "click", () => hydrate(true));

core.on(
  dom.orderSearchInput,
  "input",
  debounce((event) => {
    state.orderSearch = event.target.value;
    renderOrders();
  }, 250)
);

core.on(dom.orderStageFilter, "change", (event) => {
  state.orderStageFilter = event.target.value;
  renderOrders();
});