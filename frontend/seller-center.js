const core = window.FashionStoreCore;

const dom = {
  connectButton: document.getElementById("connectButton"),
  walletAddress: document.getElementById("walletAddress"),
  chainId: document.getElementById("chainId"),
  contractAddressLabel: document.getElementById("contractAddressLabel"),
  sellerMetrics: document.getElementById("sellerMetrics"),
  sellerMonthlyReport: document.getElementById("sellerMonthlyReport"),
  sellerFocusList: document.getElementById("sellerFocusList"),
  sellerReviewSummary: document.getElementById("sellerReviewSummary"),
  sellerReviewList: document.getElementById("sellerReviewList"),
  sellerPayoutSummary: document.getElementById("sellerPayoutSummary"),
  sellerPayoutList: document.getElementById("sellerPayoutList"),
  orderSearchInput: document.getElementById("orderSearchInput"),
  orderStageFilter: document.getElementById("orderStageFilter"),
  refreshOrdersButton: document.getElementById("refreshOrdersButton"),
  ordersSummary: document.getElementById("ordersSummary"),
  ordersGrid: document.getElementById("ordersGrid"),
  toastStack: document.getElementById("toastStack")
};

const state = {
  account: null,
  chainId: null,
  session: null,
  products: [],
  orders: [],
  normalizedOrders: [],
  sellerOrders: [],
  sellerOrderSummary: null,
  reviews: [],
  sellerReviews: [],
  reviewSummary: null,
  payouts: [],
  sellerPayouts: [],
  payoutSummary: null,
  monthlySummary: null,
  orderSearch: "",
  orderStageFilter: "all"
};

const bootstrap = core.createPageBootstrap({ dom, state, setHeader, hydrate });
const toast = bootstrap.toast;
const normalizeError = bootstrap.normalizeError;

function setHeader() {
  core.applyWalletHeader(dom, state);
}

function normalizeOrder(order) {
  const seller = String(order?.seller || order?.productSeller || "");
  const buyer = String(order?.buyer || "");
  const stage = Number(order?.stage ?? order?.flowStage ?? 0);
  const productName = String(order?.productName || "");
  const stageMeta = core.getOrderStageMeta(stage);

  return {
    ...order,
    seller,
    buyer,
    sellerLower: seller.toLowerCase(),
    buyerLower: buyer.toLowerCase(),
    stage,
    stageLabel: order?.stageLabel || stageMeta.label,
    productName,
    productNameLower: productName.toLowerCase(),
    orderIdText: String(order?.orderId ?? ""),
    amountDisplayValue: order?.amountWei ?? order?.priceWei ?? 0,
    isRestricted: typeof core.isOrderRestricted === "function" ? !!core.isOrderRestricted(order) : false
  };
}

function getCurrentOrders() {
  if (!state.account) return [];

  const accountLower = state.account.toLowerCase();
  const keyword = state.orderSearch.trim().toLowerCase();
  const stageFilter = state.orderStageFilter;

  return state.normalizedOrders.filter((order) => {
    if (order.sellerLower !== accountLower) return false;
    if (stageFilter !== "all" && String(order.stage) !== stageFilter) return false;
    if (!keyword) return true;

    return (
      order.orderIdText.includes(keyword) ||
      order.productNameLower.includes(keyword)
    );
  });
}

function summarizeSellerOrders(orders) {
  const summary = {
    total: orders.length,
    active: 0,
    payoutReady: 0,
    completed: 0,
    restricted: 0,
    shipment: 0,
    payout: 0,
    moving: 0
  };

  for (const order of orders) {
    const stage = Number(order.stage || 0);
    const isRestricted = !!order.isRestricted;
    const sellerWithdrawn = !!order.sellerWithdrawn;

    if ([1, 2, 3, 4].includes(stage)) summary.active += 1;
    if (stage === 5 && !sellerWithdrawn) summary.payoutReady += 1;
    if (stage === 6) summary.completed += 1;
    if (isRestricted) summary.restricted += 1;

    if (stage === 1 && !isRestricted) summary.shipment += 1;
    if (stage === 5 && !isRestricted) summary.payout += 1;
    if ([2, 3, 4].includes(stage)) summary.moving += 1;
  }

  return summary;
}

function summarizeReviews(reviews) {
  const reviewCount = reviews.length;
  const averageRating = reviewCount
    ? (reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviewCount).toFixed(1)
    : "-";

  return {
    reviewCount,
    averageRating
  };
}

function summarizePayouts(payouts) {
  const payoutCount = payouts.length;
  const totalWei = payouts.reduce((sum, payout) => sum + BigInt(payout.amountWei || "0"), 0n);
  const latestPayout = payouts[0] || null;

  return {
    payoutCount,
    totalWei,
    latestPayout
  };
}

function summarizeMonthlyReport(payoutSummary, reviewSummary) {
  return {
    monthWei: 0n,
    totalWei: payoutSummary.totalWei,
    payoutCount: payoutSummary.payoutCount,
    averageRating: reviewSummary.averageRating,
    reviewCount: reviewSummary.reviewCount,
    latestPayout: payoutSummary.latestPayout
  };
}

function renderMetrics(summary) {
  if (!dom.sellerMetrics || !summary) return;

  dom.sellerMetrics.innerHTML = `
   <article class="metric-card"><span>全部接單</span><strong>${summary.total}</strong><p>你目前作為賣家的全部鏈上訂單。</p></article>
   <article class="metric-card"><span>履約中</span><strong>${summary.active}</strong><p>仍在出貨、到貨或取貨流程中的訂單。</p></article>
   <article class="metric-card"><span>可提領</span><strong>${summary.payoutReady}</strong><p>買家已完成確認，可進入提領流程的訂單。</p></article>
   <article class="metric-card"><span>受限制</span><strong>${summary.restricted}</strong><p>包含凍結、禁止提領或風控阻擋。</p></article>
  `;
}

function renderMonthlyReport(summary) {
  if (!dom.sellerMonthlyReport || !summary) return;

  dom.sellerMonthlyReport.innerHTML = `
    <article class="metric-card"><span>本月提領</span><strong>${core.formatEth(summary.monthWei)}</strong><p>目前尚未統計到本月提領紀錄。</p></article>
    <article class="metric-card"><span>累計提領</span><strong>${core.formatEth(summary.totalWei)}</strong><p>${summary.payoutCount} 筆提領已寫入帳務歷史。</p></article>
    <article class="metric-card"><span>賣家評價</span><strong>${summary.averageRating}</strong><p>${summary.reviewCount ? `${summary.reviewCount} 筆評論形成目前口碑。` : "目前還沒有買家評價。"}</p></article>
    <article class="metric-card"><span>最近提領</span><strong>${summary.latestPayout ? core.formatEth(BigInt(summary.latestPayout.amountWei || "0")) : "-"}</strong><p>${summary.latestPayout ? new Date(summary.latestPayout.createdAt).toLocaleDateString("zh-TW") : "尚未有提領紀錄。"}</p></article>
  `;
}

function renderFocus(summary) {
  if (!dom.sellerFocusList || !summary) return;

  dom.sellerFocusList.innerHTML = `
    <article class="member-focus-card"><h3>立即安排出貨</h3><p>${summary.shipment ? `目前有 ${summary.shipment} 筆待出貨訂單。` : "目前沒有待出貨訂單。"}</p></article>
    <article class="member-focus-card"><h3>關注合規限制</h3><p>${summary.restricted ? `目前有 ${summary.restricted} 筆被限制的訂單。` : "目前沒有被限制的訂單。"}</p></article>
    <article class="member-focus-card"><h3>完成結算</h3><p>${summary.payout ? `目前有 ${summary.payout} 筆可立即提領的訂單。` : "目前沒有可立即提領的訂單。"}</p></article>
    <article class="member-focus-card"><h3>物流中訂單</h3><p>${summary.moving ? `目前有 ${summary.moving} 筆物流中的訂單。` : "目前沒有物流中的訂單。"}</p></article>
  `;
}

function renderReviews() {
  if (!dom.sellerReviewSummary || !dom.sellerReviewList || !state.reviewSummary) return;

  dom.sellerReviewSummary.innerHTML = `<span class="summary-pill"><strong>${state.reviewSummary.reviewCount}</strong> 筆評論</span>`;

  dom.sellerReviewList.innerHTML = state.sellerReviews.length
    ? state.sellerReviews.slice(0, 4).map((review) => `
        <article class="member-focus-card">
          <span>訂單 #${review.orderId}</span>
          <h3>${review.productName || `商品 #${review.productId}`}</h3>
          <p>${"★".repeat(Number(review.rating || 0))}${"☆".repeat(5 - Number(review.rating || 0))}</p>
          <p>${review.comment || "買家只留下星等評分。"}</p>
        </article>
      `).join("")
    : `<article class="member-focus-card full-width-card"><span>Reputation</span><h3>目前還沒有評論</h3><p>當買家完成收貨並留下評價後，這裡會自動顯示最近的文字評論與星等。</p></article>`;
}

function renderPayouts() {
  if (!dom.sellerPayoutSummary || !dom.sellerPayoutList || !state.payoutSummary) return;

  dom.sellerPayoutSummary.innerHTML = `
    <span class="summary-pill"><strong>${state.payoutSummary.payoutCount}</strong> 筆提領</span>
    <span class="summary-pill"><strong>${core.formatEth(state.payoutSummary.totalWei)}</strong> 累計提領</span>
  `;

  dom.sellerPayoutList.innerHTML = state.sellerPayouts.length
    ? state.sellerPayouts.slice(0, 6).map((payout) => `
        <article class="payout-card">
          <div class="price-row"><h3>訂單 #${payout.orderId}</h3><strong>${core.formatEth(BigInt(payout.amountWei || "0"))}</strong></div>
          <p>${payout.productName || `商品 #${payout.productId}`}</p>
          <p>買家：${core.formatAddress(payout.buyer)}</p>
          <p>提領時間：${new Date(payout.createdAt).toLocaleString("zh-TW")}</p>
        </article>
      `).join("")
    : `<article class="member-focus-card full-width-card"><span>Payouts</span><h3>目前還沒有提領紀錄</h3><p>完成買家收貨確認後提領，這裡會留下每一筆實際請款時間與金額。</p></article>`;
}

function renderOrdersSummary(summary) {
  if (!dom.ordersSummary || !summary) return;

  dom.ordersSummary.innerHTML = `
    <span class="summary-pill"><strong>${summary.total}</strong> 筆賣家訂單</span>
    <span class="summary-pill"><strong>${summary.completed}</strong> 筆已完成</span>
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
    </article>
  `;
}

function renderOrders() {
  const orders = getCurrentOrders();
  const summary = summarizeSellerOrders(orders);

  state.sellerOrders = orders;
  state.sellerOrderSummary = summary;

  renderMetrics(summary);
  renderMonthlyReport(state.monthlySummary);
  renderFocus(summary);
  renderReviews();
  renderPayouts();
  renderOrdersSummary(summary);

  if (!dom.ordersGrid) return;

  dom.ordersGrid.innerHTML = orders.length
    ? orders.map(renderOrderCard).join("")
    : `<article class="panel-card"><strong>目前沒有符合條件的訂單</strong><p>完成下單後，這裡會顯示賣家履約與提領流程。</p></article>`;
}

async function hydrate(force = false) {
  try {
    await bootstrap.sync(force);

    const [products, orders, reviews, payouts] = await Promise.all([
      core.getProducts(force),
      core.getOrders(force),
      core.getReviews(force),
      core.getPayouts(force)
    ]);

    state.products = products;
    state.orders = orders;
    state.normalizedOrders = orders.map(normalizeOrder);
    state.reviews = reviews;
    state.payouts = payouts;

    const accountLower = String(state.account || "").toLowerCase();
    state.sellerReviews = reviews.filter((review) => String(review.seller || "").toLowerCase() === accountLower);
    state.sellerPayouts = payouts.filter((payout) => String(payout.seller || "").toLowerCase() === accountLower);

    state.reviewSummary = summarizeReviews(state.sellerReviews);
    state.payoutSummary = summarizePayouts(state.sellerPayouts);
    state.monthlySummary = summarizeMonthlyReport(state.payoutSummary, state.reviewSummary);

    setHeader();
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
