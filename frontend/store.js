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
    dom.catalogGrid.classList.remove("single-card");
    dom.catalogGrid.innerHTML = '<article class="panel-card"><strong>目前沒有符合條件的商品</strong><p>可以先切換分類或重新調整搜尋條件。</p></article>';
    return;
  }

  dom.catalogGrid.classList.toggle("single-card", filtered.length === 1);
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

async function loadData() {
  try {
    state.products = await core.getProducts(true);
    state.reviews = await core.getReviews(true);
    state.orders = state.account ? await core.getOrders(true) : [];
    await refreshEscrowBalance();
    renderHeroProduct();
    renderRecommendations();
    renderCatalog();
  } catch (error) {
    renderCatalog();
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

dom.catalogViewport?.addEventListener("mouseenter", () => { state.autoScrollPaused = true; });
dom.catalogViewport?.addEventListener("mouseleave", () => { state.autoScrollPaused = false; });
document.addEventListener("visibilitychange", () => { state.autoScrollPaused = document.hidden; });

document.addEventListener("DOMContentLoaded", hydrate);