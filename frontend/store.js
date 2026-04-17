const core = window.FashionStoreCore;

function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const dom = {
  searchInput: document.getElementById("searchInput"),
  categoryFilters: document.getElementById("categoryFilters"),
  catalogGrid: document.getElementById("catalogGrid"),
  catalogViewport: document.getElementById("catalogViewport"),
  popularProductsGrid: document.getElementById("popularProductsGrid"),
  topRatedProductsGrid: document.getElementById("topRatedProductsGrid"),
  heroFeaturedProduct: document.getElementById("heroFeaturedProduct"),
  floatingStack: document.getElementById("storeFloatingStack"),
  cartToggleButton: document.getElementById("cartToggleButton"),
  ordersToggleButton: document.getElementById("ordersToggleButton"),
  cartDrawer: document.getElementById("cartDrawer"),
  cartCloseButton: document.getElementById("cartCloseButton"),
  cartItems: document.getElementById("cartItems"),
  cartQuantity: document.getElementById("cartQuantity"),
  cartTotal: document.getElementById("cartTotal"),
  checkoutButton: document.getElementById("checkoutButton"),
  clearCartButton: document.getElementById("clearCartButton"),
  ordersPopover: document.getElementById("ordersPopover"),
  ordersCloseButton: document.getElementById("ordersCloseButton"),
  orderRoleTabs: document.getElementById("orderRoleTabs"),
  orderSearchInput: document.getElementById("orderSearchInput"),
  orderStageFilter: document.getElementById("orderStageFilter"),
  refreshOrdersButton: document.getElementById("refreshOrdersButton"),
  ordersSummary: document.getElementById("ordersSummary"),
  ordersGrid: document.getElementById("ordersGrid"),
  drawerBackdrop: document.getElementById("drawerBackdrop"),
  cartCount: document.getElementById("cartCount"),
  toastStack: document.getElementById("toastStack")
};

const state = {
  products: [],
  orders: [],
  reviews: [],
  account: null,
  chainId: null,
  session: null,
  activeFilter: "all",
  search: "",
  orderRoleFilter: "all",
  orderSearch: "",
  orderStage: "all",
  cartOpen: false,
  ordersOpen: false,
  autoScrollPaused: false,
  railFrame: null
};

const bootstrap = core.createPageBootstrap({ dom, state, setHeader: setHeaderState, hydrate });
const toast = bootstrap.toast;
const normalizeError = bootstrap.normalizeError;

function setHeaderState() {
  // 商店首頁已不再顯示錢包 / 鏈 / 合約資訊，這些資訊改由 entry 頁面接管。
}

async function refreshEscrowBalance() {
  // Escrow 狀態改由 entry 頁面顯示，商店首頁不再重複渲染。
}

function matchesFilter(product) {
  if (state.activeFilter === "all") return true;
  if (state.activeFilter === "mens") return product.meta.department === "男裝";
  if (state.activeFilter === "womens") return product.meta.department === "女裝";
  if (state.activeFilter === "kids") return product.meta.department === "孩童";
  if (state.activeFilter === "summer") return product.meta.season === "夏季";
  if (state.activeFilter === "autumn") return product.meta.season === "秋季";
  if (state.activeFilter === "winter") return product.meta.season === "冬季";
  return true;
}

function renderHeroProduct() {
  if (!dom.heroFeaturedProduct) return;
  const active = state.products.filter((p) => p.isActive);
  if (!active.length) return;
  // Pick the newest product (highest productId)
  const featured = [...active].sort((a, b) => b.productId - a.productId)[0];
  const descFallback = `${featured.meta.style} / ${featured.meta.department}`;
  dom.heroFeaturedProduct.innerHTML = `
    <a href="/frontend/product.html?id=${featured.productId}">
      <img src="${escapeHtml(featured.image)}" alt="${escapeHtml(featured.name)}" />
    </a>
    <div class="hero-product-inner">
      <div class="detail-tags">
        <span class="tag-pill">${escapeHtml(featured.meta.department)}</span>
        <span class="tag-pill">${escapeHtml(featured.meta.season)}</span>
        <span class="tag-pill">NEW</span>
      </div>
      <h3>${escapeHtml(featured.name)}</h3>
      <p>${escapeHtml(featured.meta.description || descFallback)}</p>
      <p>尺寸：${escapeHtml(featured.meta.sizes.join(" / "))} ・ 庫存：${featured.meta.stock}</p>
      <div class="price-row">
        <strong>${escapeHtml(core.formatEth(featured.priceWei))}</strong>
        <a href="/frontend/product.html?id=${featured.productId}" class="button primary link-button">立即查看</a>
      </div>
    </div>
  `;
}

function renderFilterChips() {
  if (!dom.categoryFilters) return;
  dom.categoryFilters.innerHTML = "";
  (core.CATEGORY_OPTIONS || []).forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `category-chip ${state.activeFilter === option.id ? "active" : ""}`;
    button.textContent = option.label;
    button.addEventListener("click", () => {
      state.activeFilter = option.id;
      renderFilterChips();
      renderCatalog();
    });
    dom.categoryFilters.append(button);
  });
}

function startAutoScroll() {
  if (!dom.catalogViewport) return;
  if (state.railFrame) window.cancelAnimationFrame(state.railFrame);
  const tick = () => {
    if (!state.autoScrollPaused && dom.catalogViewport.scrollWidth > dom.catalogViewport.clientWidth) {
      const endReached = dom.catalogViewport.scrollLeft + dom.catalogViewport.clientWidth >= dom.catalogViewport.scrollWidth - 1;
      dom.catalogViewport.scrollLeft = endReached ? 0 : dom.catalogViewport.scrollLeft + 0.55;
    }
    state.railFrame = window.requestAnimationFrame(tick);
  };
  state.railFrame = window.requestAnimationFrame(tick);
}

function renderCatalog() {
  if (!dom.catalogGrid) return;
  dom.catalogGrid.innerHTML = "";
  const keyword = state.search.trim().toLowerCase();
  const filtered = state.products.filter((product) => {
    if (!product.isActive) return false;
    const inSearch = !keyword ||
      product.name.toLowerCase().includes(keyword) ||
      product.meta.department.toLowerCase().includes(keyword) ||
      product.meta.style.toLowerCase().includes(keyword);
    return inSearch && matchesFilter(product);
  });

  if (!filtered.length) {
    dom.catalogGrid.innerHTML = '<article class="panel-card"><strong>目前沒有符合條件的商品</strong><p>可以先切換分類或重新調整搜尋條件。</p></article>';
    return;
  }

  filtered.forEach((product) => {
    const card = document.createElement("article");
    card.className = "product-card rail-card";
    const descFallback = `${product.meta.style} / ${core.formatAddress(product.seller)}`;
    card.innerHTML = `
      <a href="/frontend/product.html?id=${product.productId}">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" />
      </a>
      <div class="product-meta">
        <span>#${product.productId}</span>
        <div class="detail-tags">
          <span class="tag-pill">${escapeHtml(product.meta.department)}</span>
          <span class="tag-pill">${escapeHtml(product.meta.season)}</span>
        </div>
      </div>
      <div>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.meta.description || descFallback)}</p>
        <p>尺寸：${escapeHtml(product.meta.sizes.join(" / "))} ・ 顏色：${escapeHtml(product.meta.colors.join(" / "))} ・ 庫存：${product.meta.stock}</p>
      </div>
      <div class="price-row">
        <strong>${escapeHtml(core.formatEth(product.priceWei))}</strong>
        <a href="/frontend/product.html?id=${product.productId}" class="button primary link-button">查看</a>
      </div>
    `;
    dom.catalogGrid.append(card);
  });
}

function renderCompactRecommendations(target, products, emptyTitle, emptyDescription, extraBuilder) {
  if (!target) return;
  if (!products.length) {
    target.innerHTML = `<article class="panel-card"><strong>${emptyTitle}</strong><p>${emptyDescription}</p></article>`;
    return;
  }
  target.innerHTML = "";
  products.forEach((product) => {
    const card = document.createElement("article");
    card.className = "compact-product-card";
    const descFallback = `${product.meta.style} / ${core.formatAddress(product.seller)}`;
    card.innerHTML = `
      <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" />
      <div class="compact-product-copy">
        <div class="detail-tags">
          <span class="tag-pill">${escapeHtml(product.meta.department)}</span>
          <span class="tag-pill">${escapeHtml(product.meta.season)}</span>
        </div>
        <h3>${escapeHtml(product.name)}</h3>
        <p>${escapeHtml(product.meta.description || descFallback)}</p>
        <p>尺寸：${escapeHtml(product.meta.sizes.join(" / "))} ・ 庫存：${product.meta.stock}</p>
        ${extraBuilder(product)}
        <div class="price-row">
          <strong>${escapeHtml(core.formatEth(product.priceWei))}</strong>
          <a href="/frontend/product.html?id=${product.productId}" class="button ghost link-button">查看</a>
        </div>
      </div>
    `;
    target.append(card);
  });
}

function renderRecommendations() {
  const orderCountMap = new Map();
  state.orders.forEach((order) => {
    const key = Number(order.productId || 0);
    if (!key) return;
    orderCountMap.set(key, (orderCountMap.get(key) || 0) + 1);
  });

  const productRatingMap = new Map();
  state.reviews.forEach((review) => {
    const key = Number(review.productId || 0);
    if (!key) return;
    const current = productRatingMap.get(key) || { count: 0, total: 0 };
    current.count += 1;
    current.total += Number(review.rating || 0);
    productRatingMap.set(key, current);
  });

  const popularProducts = [...state.products]
    .filter((product) => product.isActive)
    .sort((a, b) => (orderCountMap.get(b.productId) || 0) - (orderCountMap.get(a.productId) || 0))
    .slice(0, 4);

  const topRatedProducts = [...state.products]
    .filter((product) => {
      const rating = productRatingMap.get(product.productId);
      return product.isActive && rating?.count;
    })
    .sort((a, b) => {
      const ratingA = productRatingMap.get(a.productId);
      const ratingB = productRatingMap.get(b.productId);
      return (ratingB.total / ratingB.count) - (ratingA.total / ratingA.count);
    })
    .slice(0, 4);

  renderCompactRecommendations(
    dom.popularProductsGrid,
    popularProducts,
    "目前還沒有熱門商品資料",
    "完成更多訂單後，這裡會自動整理最常被購買的單品。",
    (product) => `<p>成交 ${orderCountMap.get(product.productId) || 0} 次</p>`
  );

  renderCompactRecommendations(
    dom.topRatedProductsGrid,
    topRatedProducts,
    "目前還沒有高評分商品",
    "當買家完成評價後，這裡會顯示平均評分最高的商品。",
    (product) => {
      const rating = productRatingMap.get(product.productId);
      const average = rating ? (rating.total / rating.count).toFixed(1) : "-";
      return `<p>平均評分 ${average} / 5.0</p>`;
    }
  );
}

function getCartEntries() {
  const cart = core.getCart();
  return cart.map((item) => {
    const product = state.products.find((entry) => Number(entry.productId) === Number(item.productId));
    return { ...item, product };
  });
}

function renderCart() {
  if (!dom.cartItems) return;
  const entries = getCartEntries();
  const totalQuantity = entries.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalWei = entries.reduce((sum, item) => {
    const price = item.product?.priceWei || 0n;
    return sum + (price * BigInt(Number(item.quantity || 0)));
  }, 0n);

  if (dom.cartCount) dom.cartCount.textContent = String(totalQuantity);
  if (dom.cartQuantity) dom.cartQuantity.textContent = String(totalQuantity);
  if (dom.cartTotal) dom.cartTotal.textContent = core.formatEth(totalWei);

  if (!entries.length) {
    dom.cartItems.innerHTML = '<article class="panel-card"><strong>購物車目前是空的</strong><p>先到商品頁或首頁商品區加入想買的服飾。</p></article>';
    return;
  }

  dom.cartItems.innerHTML = entries.map((item) => {
    const product = item.product;
    if (!product) {
      return `<article class="cart-card"><strong>商品 #${item.productId}</strong><p>這件商品目前已不存在，建議從購物車移除。</p></article>`;
    }
    return `
      <article class="cart-card">
        <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" />
        <div class="cart-card-copy">
          <h3>${escapeHtml(product.name)}</h3>
          <p>尺寸：${escapeHtml(item.size || "-")} ・ 顏色：${escapeHtml(item.color || "-")}</p>
          <p>數量：${Number(item.quantity || 0)}</p>
        </div>
        <div class="cart-card-side">
          <strong>${escapeHtml(core.formatEth(product.priceWei * BigInt(Number(item.quantity || 0))))}</strong>
          <button class="button ghost" data-remove-cart="${product.productId}:${escapeHtml(item.size || "")}:${escapeHtml(item.color || "")}" type="button">移除</button>
        </div>
      </article>
    `;
  }).join("");
}

function serializeOrdersForPanel() {
  const keyword = state.orderSearch.trim().toLowerCase();
  return state.orders.filter((order) => {
    if (state.orderRoleFilter === "buyer" && String(order.buyer || "").toLowerCase() !== String(state.account || "").toLowerCase()) return false;
    if (state.orderRoleFilter === "seller" && String(order.seller || "").toLowerCase() !== String(state.account || "").toLowerCase()) return false;
    if (state.orderStage !== "all" && String(order.stage) !== String(state.orderStage)) return false;
    if (!keyword) return true;
    return String(order.productName || "").toLowerCase().includes(keyword) || String(order.orderId || "").includes(keyword);
  });
}

function renderOrdersPanel() {
  if (!dom.ordersGrid || !dom.ordersSummary) return;
  const visible = serializeOrdersForPanel();
  const waitingPickup = visible.filter((order) => Number(order.stage) === 4).length;
  const withdrawable = visible.filter((order) => Number(order.stage) === 5 && String(order.seller || "").toLowerCase() === String(state.account || "").toLowerCase()).length;

  dom.ordersSummary.innerHTML = `
    <span class="summary-pill"><strong>${visible.length}</strong> 筆可見訂單</span>
    <span class="summary-pill"><strong>${waitingPickup}</strong> 筆等待取貨</span>
    <span class="summary-pill"><strong>${withdrawable}</strong> 筆可提領</span>
  `;

  if (!visible.length) {
    dom.ordersGrid.innerHTML = '<article class="panel-card"><strong>目前沒有符合條件的訂單</strong><p>可以切換角色、狀態或先完成一次購買流程。</p></article>';
    return;
  }

  dom.ordersGrid.innerHTML = visible.map((order) => `
    <article class="order-card">
      <div class="order-head">
        <strong>訂單 #${order.orderId}</strong>
        <span class="tag-pill">${escapeHtml(order.stageLabel || "未建立")}</span>
      </div>
      <p>${escapeHtml(order.productName || "未命名商品")}</p>
      <p>買家：${escapeHtml(core.formatAddress(order.buyer))} ・ 賣家：${escapeHtml(core.formatAddress(order.seller))}</p>
      <div class="price-row">
        <strong>${escapeHtml(core.formatEth(order.amountWei || 0n))}</strong>
        <a href="/frontend/${String(order.seller || "").toLowerCase() === String(state.account || "").toLowerCase() ? "seller-center" : "buyer-center"}.html" class="button ghost link-button">查看詳情</a>
      </div>
    </article>
  `).join("");
}

function syncOverlayState() {
  const overlayOpen = state.cartOpen || state.ordersOpen;
  dom.cartDrawer?.classList.toggle("open", state.cartOpen);
  dom.ordersPopover?.classList.toggle("open", state.ordersOpen);
  dom.drawerBackdrop?.classList.toggle("visible", overlayOpen);
  dom.floatingStack?.classList.toggle("is-overlay-hidden", overlayOpen);
}

function openCart() {
  state.cartOpen = !state.cartOpen;
  state.ordersOpen = false;
  renderCart();
  syncOverlayState();
}

function openOrders() {
  state.ordersOpen = !state.ordersOpen;
  state.cartOpen = false;
  renderOrdersPanel();
  syncOverlayState();
}

function closeOverlays() {
  state.cartOpen = false;
  state.ordersOpen = false;
  syncOverlayState();
}

async function loadData() {
  try {
    state.products = await core.getProducts(true);
    state.reviews = await core.getReviews(true);
    state.orders = state.account ? await core.getOrders(true) : [];
    await refreshEscrowBalance();
    renderHeroProduct();
    renderRecommendations();
    renderCatalog();
    renderCart();
    renderOrdersPanel();
  } catch (error) {
    renderCatalog();
    renderCart();
    renderOrdersPanel();
    toast("error", normalizeError(error));
  }
}

async function hydrate(force=false) {
  try {
    await bootstrap.sync(force);
    setHeaderState();
    renderFilterChips();
    renderCatalog();
    startAutoScroll();
    await loadData();
  } catch (error) {
    setHeaderState();
    renderFilterChips();
    renderCatalog();
    toast("error", normalizeError(error));
  }
}

function buildOrderProductName(product, item) {
  const parts = [];
  if (item.size) parts.push(`尺寸 ${item.size}`);
  if (item.color) parts.push(`顏色 ${item.color}`);
  return parts.length ? `${product.name} (${parts.join(" / ")})` : product.name;
}

async function handleCheckout() {
  const entries = getCartEntries();
  if (!entries.length) {
    toast("error", "購物車目前是空的，先加入商品再結帳。");
    return;
  }

  const invalidEntry = entries.find((entry) => !entry.product || !entry.product.isActive || Number(entry.product.meta?.stock || 0) <= 0);
  if (invalidEntry) {
    toast("error", "購物車內有已下架或缺貨商品，請先整理後再結帳。");
    return;
  }

  try {
    dom.checkoutButton.disabled = true;

    if (!state.account) {
      await core.connectWallet();
      await hydrate(true);
    }

    const contract = await core.ensureContract({ requireSigner: true });
    let paymentToken = await core.ensurePaymentToken({ requireSigner: true });
    const totalWei = entries.reduce((sum, entry) => {
      const lineAmount = entry.product.priceWei * BigInt(Number(entry.quantity || 0));
      return sum + lineAmount;
    }, 0n);
    const currentAccount = state.account || core.runtime.currentAccount || "";
    if (typeof paymentToken.balanceOf !== "function") {
      const paymentTokenAddress = core.runtime.paymentTokenAddress || await contract.payment_token();
      const signer = await core.ensureContract({ requireSigner: true }).then(() => core.runtime.signer || core.runtime.provider);
      paymentToken = new window.ethers.Contract(
        paymentTokenAddress,
        ["function balanceOf(address owner) external view returns (uint256)"],
        signer
      );
    }
    const balance = await paymentToken.balanceOf(currentAccount);

    if (balance < totalWei) {
      throw new Error(`USDT 餘額不足。需要 ${core.formatEth(totalWei)}，目前只有 ${core.formatEth(balance)}。`);
    }

    await core.ensurePaymentTokenApproval(totalWei);

    for (const entry of entries) {
      const product = entry.product;
      const amountWei = product.priceWei * BigInt(Number(entry.quantity || 0));
      const beforeId = Number(await contract.Order_ID());
      const tx = await contract.create_and_fund_order(product.seller, amountWei);
      await tx.wait();
      const afterId = Number(await contract.Order_ID());
      const orderId = afterId > beforeId ? afterId : beforeId + 1;

      await core.saveOrderMeta(orderId, {
        buyer: state.account || core.runtime.currentAccount || "",
        productId: product.productId,
        productName: buildOrderProductName(product, entry),
        productSeller: product.seller,
        priceWei: String(amountWei),
        flowStage: 1
      });
    }

    core.saveCart([]);
    closeOverlays();
    await hydrate(true);
    toast("success", "已送出鏈上訂單，請到錢包確認交易並稍候查詢訂單狀態。");
  } catch (error) {
    toast("error", normalizeError(error));
  } finally {
    dom.checkoutButton.disabled = false;
  }
}

bootstrap.bind();

function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

dom.searchInput?.addEventListener("input", debounce((event) => {
  state.search = event.target.value.trim();
  renderCatalog();
}, 250));

dom.cartToggleButton?.addEventListener("click", openCart);
dom.ordersToggleButton?.addEventListener("click", openOrders);
dom.cartCloseButton?.addEventListener("click", closeOverlays);
dom.ordersCloseButton?.addEventListener("click", closeOverlays);
dom.drawerBackdrop?.addEventListener("click", closeOverlays);
dom.clearCartButton?.addEventListener("click", () => {
  core.saveCart([]);
  renderCart();
  toast("success", "購物車已清空");
});
dom.checkoutButton?.addEventListener("click", handleCheckout);
dom.orderSearchInput?.addEventListener("input", debounce((event) => {
  state.orderSearch = event.target.value.trim();
  renderOrdersPanel();
}, 250));
dom.orderStageFilter?.addEventListener("change", (event) => {
  state.orderStage = event.target.value;
  renderOrdersPanel();
});
dom.refreshOrdersButton?.addEventListener("click", () => renderOrdersPanel());
dom.orderRoleTabs?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-role-filter]");
  if (!button) return;
  state.orderRoleFilter = button.dataset.roleFilter || "all";
  dom.orderRoleTabs.querySelectorAll(".segment-tab").forEach((tab) => {
    tab.classList.toggle("active", tab === button);
  });
  renderOrdersPanel();
});
dom.cartItems?.addEventListener("click", (event) => {
  const target = event.target.closest("[data-remove-cart]");
  if (!target) return;
  const [productId, size, color] = String(target.dataset.removeCart || "").split(":");
  const next = core.getCart().filter((item) => !(String(item.productId) === String(productId) && String(item.size || "") === String(size || "") && String(item.color || "") === String(color || "")));
  core.saveCart(next);
  renderCart();
  toast("success", "已從購物車移除");
});

dom.catalogViewport?.addEventListener("mouseenter", () => { state.autoScrollPaused = true; });
dom.catalogViewport?.addEventListener("mouseleave", () => { state.autoScrollPaused = false; });
document.addEventListener("visibilitychange", () => { state.autoScrollPaused = document.hidden; });

document.addEventListener("DOMContentLoaded", hydrate);
