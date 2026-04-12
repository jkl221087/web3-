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
    connectButton: document.getElementById("connectButton"),
    switchNetworkButton: document.getElementById("switchNetworkButton"),
    cartToggleButton: document.getElementById("cartToggleButton"),
    ordersToggleButton: document.getElementById("ordersToggleButton"),
    cartCloseButton: document.getElementById("cartCloseButton"),
    ordersCloseButton: document.getElementById("ordersCloseButton"),
    checkoutButton: document.getElementById("checkoutButton"),
    clearCartButton: document.getElementById("clearCartButton"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    walletAddress: document.getElementById("walletAddress"),
    chainId: document.getElementById("chainId"),
    contractAddressLabel: document.getElementById("contractAddressLabel"),
    escrowBalance: document.getElementById("escrowBalance"),
    searchInput: document.getElementById("searchInput"),
    categoryFilters: document.getElementById("categoryFilters"),
    catalogGrid: document.getElementById("catalogGrid"),
    catalogViewport: document.getElementById("catalogViewport"),
    popularProductsGrid: document.getElementById("popularProductsGrid"),
    topRatedProductsGrid: document.getElementById("topRatedProductsGrid"),
    orderRoleTabs: document.getElementById("orderRoleTabs"),
    orderSearchInput: document.getElementById("orderSearchInput"),
    orderStageFilter: document.getElementById("orderStageFilter"),
    ordersSummary: document.getElementById("ordersSummary"),
    ordersGrid: document.getElementById("ordersGrid"),
    ordersPopover: document.getElementById("ordersPopover"),
    cartDrawer: document.getElementById("cartDrawer"),
    cartItems: document.getElementById("cartItems"),
    cartCount: document.getElementById("cartCount"),
    cartQuantity: document.getElementById("cartQuantity"),
    cartTotal: document.getElementById("cartTotal"),
    refreshOrdersButton: document.getElementById("refreshOrdersButton"),
    toastStack: document.getElementById("toastStack")
};

const state = {
    products: [],
    orders: [],
    reviews: [],
    cart: core.getCart(),
    account: null,
    chainId: null,
    activeFilter: "all",
    search: "",
    orderRoleFilter: "all",
    orderSearch: "",
    orderStageFilter: "all",
    expandedOrders: [],
    autoScrollPaused: false,
    railFrame: null,
    cartOpen: false,
    ordersOpen: false
};

function toast(type, message) {
    const node = document.createElement("article");
    node.className = `toast ${type}`;
    node.textContent = message;
    dom.toastStack.prepend(node);
    window.setTimeout(() => node.remove(), 3200);
}

function normalizeError(error) {
    const raw = error?.reason || error?.shortMessage || error?.message || "發生未知錯誤";
    return raw.replace(/^execution reverted: /, "");
}

function setHeaderState() {
    dom.walletAddress.textContent = state.account ? core.formatAddress(state.account) : "尚未連接";
    dom.chainId.textContent = state.chainId || "-";
    const contractAddress = core.getConfiguredContractAddress();
    dom.contractAddressLabel.textContent = contractAddress ? core.formatAddress(contractAddress) : "未設定";
}

function syncOverlayState() {
    dom.drawerBackdrop.classList.toggle("visible", state.cartOpen || state.ordersOpen);
}

function setCartOpen(isOpen) {
    state.cartOpen = isOpen;
    dom.cartDrawer.classList.toggle("open", isOpen);
    if (isOpen) {
        state.ordersOpen = false;
        dom.ordersPopover.classList.remove("open");
    }
    syncOverlayState();
}

function setOrdersOpen(isOpen) {
    state.ordersOpen = isOpen;
    dom.ordersPopover.classList.toggle("open", isOpen);
    if (isOpen) {
        state.cartOpen = false;
        dom.cartDrawer.classList.remove("open");
    }
    syncOverlayState();
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

function renderFilterChips() {
    dom.categoryFilters.innerHTML = "";
    core.CATEGORY_OPTIONS.forEach((option) => {
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
    if (state.railFrame) {
        window.cancelAnimationFrame(state.railFrame);
    }

    const tick = () => {
        if (
            dom.catalogViewport &&
            !state.autoScrollPaused &&
            dom.catalogViewport.scrollWidth > dom.catalogViewport.clientWidth
        ) {
            const endReached =
                dom.catalogViewport.scrollLeft + dom.catalogViewport.clientWidth >= dom.catalogViewport.scrollWidth - 1;
            dom.catalogViewport.scrollLeft = endReached ? 0 : dom.catalogViewport.scrollLeft + 0.55;
        }

        state.railFrame = window.requestAnimationFrame(tick);
    };

    state.railFrame = window.requestAnimationFrame(tick);
}

function renderCatalog() {
    dom.catalogGrid.innerHTML = "";
    const keyword = state.search.trim().toLowerCase();

    const filtered = state.products.filter((product) => {
        if (!product.isActive) return false;
        const inSearch =
            !keyword ||
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
        const descFallback = `${product.meta.style} / ${product.meta.season} / ${core.formatAddress(product.seller)}`;
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
                <button class="button primary" data-action="add-to-cart" data-product-id="${product.productId}" type="button" ${product.isActive && product.meta.stock > 0 ? "" : "disabled"}>
                    ${product.isActive ? (product.meta.stock > 0 ? "加入購物車" : "已缺貨") : "已下架"}
                </button>
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

function getCartDetailedItems() {
    return state.cart
        .map((entry) => {
            const product = state.products.find((item) => item.productId === entry.productId);
            if (!product) return null;
            const variantLabel = core.formatVariantLabel(entry.size, entry.color);
            return {
                ...entry,
                entryKey: core.buildCartEntryKey(entry),
                variantLabel,
                product,
                totalWei: product.priceWei * BigInt(entry.quantity)
            };
        })
        .filter(Boolean);
}

function renderCart() {
    dom.cartItems.innerHTML = "";
    const items = getCartDetailedItems();
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalWei = items.reduce((sum, item) => sum + item.totalWei, 0n);

    dom.cartCount.textContent = `${quantity}`;
    dom.cartQuantity.textContent = `${quantity}`;
    dom.cartTotal.textContent = quantity ? core.formatEth(totalWei) : core.formatEth(0n);

    if (!items.length) {
        dom.cartItems.innerHTML = '<article class="cart-card"><strong>購物車目前是空的</strong><p>先從滑動商品區挑一件喜歡的服裝，再回來這裡結帳。</p></article>';
        return;
    }

    items.forEach((item) => {
        const card = document.createElement("article");
        card.className = "cart-card";
        card.innerHTML = `
            <div class="cart-row">
                <strong>${escapeHtml(item.product.name)}</strong>
                <button class="icon-button" data-action="remove-from-cart" data-entry-key="${escapeHtml(item.entryKey)}" type="button">×</button>
            </div>
            <div class="detail-tags">
                <span class="tag-pill">${escapeHtml(item.product.meta.department)}</span>
                <span class="tag-pill">${escapeHtml(item.product.meta.season)}</span>
                ${item.size ? `<span class="tag-pill">${escapeHtml(item.size)}</span>` : ""}
                ${item.color ? `<span class="tag-pill">${escapeHtml(item.color)}</span>` : ""}
            </div>
            <div class="cart-row">
                <span>數量 ${item.quantity}</span>
                <strong>${escapeHtml(core.formatEth(item.totalWei))}</strong>
            </div>
            <p>${escapeHtml(item.variantLabel || "預設規格")}</p>
            <div class="detail-actions">
                <button class="button ghost" data-action="decrease-qty" data-entry-key="${escapeHtml(item.entryKey)}" type="button">-1</button>
                <button class="button ghost" data-action="increase-qty" data-entry-key="${escapeHtml(item.entryKey)}" type="button">+1</button>
            </div>
        `;
        dom.cartItems.append(card);
    });
}

function getDisplayOrderFlow(order) {
    const fallback = core.getOrderStageMeta(order.stage || 1);
    return {
        stage: Number(order.stage || 1),
        label: order.stageLabel || fallback.label,
        tone: order.stageTone || fallback.tone,
        description: order.stageDescription || fallback.description
    };
}

function buildOrderStepTrack(order) {
    const steps = [
        { stage: 1, label: "已付款" },
        { stage: 2, label: "已出貨" },
        { stage: 3, label: "已到貨" },
        { stage: 4, label: "等待取貨" },
        { stage: 5, label: "已取貨" },
        { stage: 6, label: "已完成" }
    ];

    return steps.map((item) => {
        const flow = getDisplayOrderFlow(order);
        const classes = [
            "step-pill",
            flow.stage >= item.stage ? "done" : "",
            flow.stage === item.stage ? "current" : ""
        ].filter(Boolean).join(" ");
        return `<span class="${classes}">${item.label}</span>`;
    }).join("");
}

function buildOrderActions(order, isBuyer, isSeller) {
    const actions = [];

    const flow = getDisplayOrderFlow(order);

    if (isSeller && flow.stage === 1 && !order.completeState) {
        actions.push(`<button class="button ghost" data-action="mark-shipped" data-order-id="${order.orderId}" type="button">是否出貨</button>`);
    }
    if (isSeller && flow.stage === 2 && !order.completeState) {
        actions.push(`<button class="button ghost" data-action="mark-arrived" data-order-id="${order.orderId}" type="button">物流是否到達</button>`);
    }
    if (isSeller && flow.stage === 3 && !order.completeState) {
        actions.push(`<button class="button ghost" data-action="mark-waiting-pickup" data-order-id="${order.orderId}" type="button">提醒取貨</button>`);
    }
    if (isBuyer && flow.stage === 4 && !order.completeState) {
        actions.push(`<button class="button primary" data-action="confirm-received" data-order-id="${order.orderId}" type="button">我已取貨</button>`);
    }
    if (isSeller && order.completeState && !order.sellerWithdrawn) {
        actions.push(`<button class="button primary" data-action="withdraw-order" data-order-id="${order.orderId}" type="button">請領取款項</button>`);
    }

    return actions.join("");
}

function isOrderExpanded(orderId) {
    return state.expandedOrders.includes(Number(orderId));
}

function toggleExpandedOrder(orderId) {
    const target = Number(orderId);
    if (isOrderExpanded(target)) {
        state.expandedOrders = state.expandedOrders.filter((item) => item !== target);
    } else {
        state.expandedOrders = [...state.expandedOrders, target];
    }
}

function getOrdersForCurrentAccount() {
    if (!state.account) return [];
    const account = state.account.toLowerCase();
    const keyword = state.orderSearch.trim().toLowerCase();

    return state.orders.filter((order) => {
        const isBuyer = order.buyer.toLowerCase() === account;
        const isSeller = order.seller.toLowerCase() === account;
        const belongsToAccount = isBuyer || isSeller;

        if (!belongsToAccount) return false;
        if (state.orderRoleFilter === "buyer" && !isBuyer) return false;
        if (state.orderRoleFilter === "seller" && !isSeller) return false;
        if (state.orderStageFilter !== "all" && String(order.stage) !== state.orderStageFilter) return false;

        if (!keyword) return true;

        return (
            String(order.orderId).includes(keyword) ||
            String(order.productName || "").toLowerCase().includes(keyword) ||
            core.formatAddress(order.buyer).toLowerCase().includes(keyword) ||
            core.formatAddress(order.seller).toLowerCase().includes(keyword)
        );
    });
}

function renderOrderSummary(orders) {
    if (!dom.ordersSummary) return;

    if (!state.account) {
        dom.ordersSummary.innerHTML = "";
        return;
    }

    const buyerCount = orders.filter((order) => order.buyer.toLowerCase() === state.account.toLowerCase()).length;
    const sellerCount = orders.filter((order) => order.seller.toLowerCase() === state.account.toLowerCase()).length;
    const waitingPickup = orders.filter((order) => Number(order.stage) === 4).length;
    const readyToWithdraw = orders.filter((order) => order.completeState && !order.sellerWithdrawn).length;

    dom.ordersSummary.innerHTML = `
        <span class="summary-pill"><strong>${orders.length}</strong> 筆可見訂單</span>
        <span class="summary-pill"><strong>${buyerCount}</strong> 筆買家角色</span>
        <span class="summary-pill"><strong>${sellerCount}</strong> 筆賣家角色</span>
        <span class="summary-pill"><strong>${waitingPickup}</strong> 筆等待取貨</span>
        <span class="summary-pill"><strong>${readyToWithdraw}</strong> 筆可提領</span>
    `;
}

function renderOrders() {
    dom.ordersGrid.innerHTML = "";

    if (!state.account) {
        renderOrderSummary([]);
        dom.ordersGrid.innerHTML = '<article class="panel-card"><strong>請先連接錢包</strong><p>連接後就能看到你作為買家或賣家的訂單與物流節點。</p></article>';
        return;
    }

    const accountOrders = state.orders.filter((order) => order.buyer.toLowerCase() === state.account.toLowerCase() || order.seller.toLowerCase() === state.account.toLowerCase());
    renderOrderSummary(accountOrders);
    const orders = getOrdersForCurrentAccount();

    if (!orders.length) {
        dom.ordersGrid.innerHTML = '<article class="panel-card"><strong>目前沒有符合條件的訂單</strong><p>可以切換買家 / 賣家視角、狀態篩選，或先完成一次購買流程。</p></article>';
        return;
    }

    orders.forEach((order) => {
        const product = state.products.find((item) => item.productId === order.productId);
        const isBuyer = order.buyer.toLowerCase() === state.account.toLowerCase();
        const isSeller = order.seller.toLowerCase() === state.account.toLowerCase();
        const flow = getDisplayOrderFlow(order);
        const expanded = isOrderExpanded(order.orderId);
        const card = document.createElement("article");
        card.className = "order-card";
        const productName = escapeHtml(product ? product.name : (order.productName || `商品 #${order.productId || order.orderId}`));
        card.innerHTML = `
            <div class="order-head">
                <div>
                    <strong>訂單 #${order.orderId}</strong>
                    <p>${productName}</p>
                </div>
                <div class="detail-tags">
                    <span class="order-chip ${flow.tone}">${escapeHtml(flow.label)}</span>
                    <span class="order-chip ${order.sellerWithdrawn ? "success" : "muted"}">${order.sellerWithdrawn ? "已提領" : "待提領"}</span>
                </div>
            </div>
            <div class="order-meta">
                <span>買家：${escapeHtml(core.formatAddress(order.buyer))}</span>
                <span>賣家：${escapeHtml(core.formatAddress(order.seller))}</span>
            </div>
            <div class="order-stage-row">
                <span class="status-light ${flow.stage >= 4 && !order.sellerWithdrawn ? "active" : ""}"></span>
                <strong>${escapeHtml(flow.label)}</strong>
                <span>${escapeHtml(flow.description)}</span>
            </div>
            <div class="step-track">${buildOrderStepTrack(order)}</div>
            <div class="price-row">
                <strong>${escapeHtml(core.formatEth(order.amountWei))}</strong>
                <div class="detail-actions">
                    <button class="button ghost" data-action="toggle-order-detail" data-order-id="${order.orderId}" type="button">${expanded ? "收合明細" : "查看明細"}</button>
                    ${buildOrderActions(order, isBuyer, isSeller)}
                </div>
            </div>
            ${expanded ? `
                <div class="order-detail-panel">
                    <div class="order-detail-grid">
                        <div class="order-detail-block">
                            <span class="eyebrow">Order Snapshot</span>
                            <strong>${productName}</strong>
                            <p>商品 ID：${order.productId || "-"}</p>
                            <p>鏈上金額：${escapeHtml(core.formatEth(order.amountWei))}</p>
                            <p>付款狀態：${order.payState ? "已付款" : "未付款"}</p>
                        </div>
                        <div class="order-detail-block">
                            <span class="eyebrow">Roles</span>
                            <p>目前視角：${isBuyer ? "買家" : "賣家"}</p>
                            <p>買家地址：${escapeHtml(order.buyer)}</p>
                            <p>賣家地址：${escapeHtml(order.seller)}</p>
                            <p>提領狀態：${order.sellerWithdrawn ? "已完成提領" : "尚未提領"}</p>
                        </div>
                        <div class="order-detail-block">
                            <span class="eyebrow">Logistics</span>
                            <p>站內物流階段：${escapeHtml(flow.label)}</p>
                            <p>${escapeHtml(flow.description)}</p>
                            <p>鏈上收貨確認：${order.completeState ? "已確認" : "未確認"}</p>
                            <p>可提領：${order.completeState && !order.sellerWithdrawn ? "是" : "否"}</p>
                        </div>
                    </div>
                </div>
            ` : ""}
        `;
        dom.ordersGrid.append(card);
    });
}

function syncCart() {
    core.saveCart(state.cart);
    renderCart();
}

function addToCart(productId, options = {}) {
    const product = state.products.find((item) => item.productId === productId);
    if (!product) return;
    if (!product.isActive) {
        toast("error", "這件商品目前已下架。");
        return;
    }
    if (Number(product.meta.stock || 0) <= 0) {
        toast("error", "這件商品目前缺貨中。");
        return;
    }

    const size = options.size || product.meta.sizes[0] || "";
    const color = options.color || product.meta.colors[0] || "";
    const quantity = Math.max(1, Number(options.quantity) || 1);
    const existing = state.cart.find((item) =>
        item.productId === productId &&
        item.size === size &&
        item.color === color
    );
    if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, Number(product.meta.stock || existing.quantity + quantity));
    } else {
        state.cart.push({ productId, quantity: Math.min(quantity, Number(product.meta.stock || quantity)), size, color });
    }
    syncCart();
    toast("success", "已加入購物車");
}

function updateCartQuantity(entryKey, delta) {
    const item = state.cart.find((entry) => core.buildCartEntryKey(entry) === entryKey);
    if (!item) return;
    const product = state.products.find((entry) => entry.productId === item.productId);

    item.quantity += delta;
    if (product) {
        item.quantity = Math.min(item.quantity, Number(product.meta.stock || item.quantity));
    }
    if (item.quantity <= 0) {
        state.cart = state.cart.filter((entry) => core.buildCartEntryKey(entry) !== entryKey);
    }
    syncCart();
}

async function loadData() {
    try {
        if (core.getConfiguredContractAddress()) {
            await core.fetchPaymentTokenMeta();
        }
        state.products = await core.fetchProducts();
        state.orders = core.getConfiguredContractAddress() ? await core.fetchOrders() : [];
        state.reviews = await core.fetchReviews();
        const balance = await core.fetchContractBalance();
        dom.escrowBalance.textContent = core.formatEth(balance);
        renderRecommendations();
        renderCatalog();
        renderCart();
        renderOrders();
    } catch (error) {
        renderCatalog();
        renderCart();
        renderOrders();
        toast("error", normalizeError(error));
    }
}

function setOrderRoleFilter(nextFilter) {
    state.orderRoleFilter = nextFilter;
    dom.orderRoleTabs.querySelectorAll("[data-role-filter]").forEach((button) => {
        button.classList.toggle("active", button.dataset.roleFilter === nextFilter);
    });
    renderOrders();
}

async function checkoutCart() {
    if (!state.cart.length) {
        toast("error", "購物車是空的");
        return;
    }

    dom.checkoutButton.disabled = true;
    const originalText = dom.checkoutButton.textContent;
    dom.checkoutButton.textContent = "結帳中…";

    try {
        const contract = await core.ensureContract({ requireSigner: true });
    const items = getCartDetailedItems();
    const totalTokenAmount = items.reduce((sum, item) => sum + item.totalWei, 0n);

    const approvalTx = await core.ensurePaymentTokenApproval(totalTokenAmount);
    if (approvalTx) {
        toast("success", "已送出穩定幣授權，等待鏈上確認");
        await approvalTx.wait();
    }

    for (const item of items) {
        for (let count = 0; count < item.quantity; count += 1) {
            const tx = await contract.create_and_fund_order(item.product.seller, item.product.priceWei);
            const receipt = await tx.wait();
            let createdOrderId = null;

            for (const log of receipt.logs) {
                try {
                    const parsed = contract.interface.parseLog(log);
                    if (parsed?.name === "OrderCreated") {
                        createdOrderId = Number(parsed.args.orderId);
                    }
                } catch {
                    // ignore unrelated logs
                }
            }

            if (!createdOrderId) {
                createdOrderId = Number(await contract.Order_ID());
            }

            await core.saveOrderMeta(createdOrderId, {
                productId: item.product.productId,
                productName: core.buildOrderProductTitle(item.product.name, item.size, item.color),
                productSeller: item.product.seller,
                priceWei: item.product.priceWei,
                flowStage: 1
            });
        }
    }

    state.cart = [];
    syncCart();
    setCartOpen(false);
    await loadData();
    toast("success", "穩定幣結帳完成，訂單已建立");
    } finally {
        dom.checkoutButton.disabled = false;
        dom.checkoutButton.textContent = originalText;
    }
}

async function handleActionClick(event) {
    const trigger = event.target.closest("[data-action]");
    if (!trigger || trigger.disabled) return;

    const action = trigger.dataset.action;
    const isAsync = ["mark-shipped", "mark-arrived", "mark-waiting-pickup", "confirm-received", "withdraw-order"].includes(action);

    if (isAsync) {
        trigger.disabled = true;
    }

    try {
        const action = trigger.dataset.action;
        if (action === "add-to-cart") addToCart(Number(trigger.dataset.productId));
        if (action === "remove-from-cart") updateCartQuantity(trigger.dataset.entryKey, -999);
        if (action === "increase-qty") updateCartQuantity(trigger.dataset.entryKey, 1);
        if (action === "decrease-qty") updateCartQuantity(trigger.dataset.entryKey, -1);
        if (action === "toggle-order-detail") {
            toggleExpandedOrder(Number(trigger.dataset.orderId));
            renderOrders();
        }
        if (action === "mark-shipped") {
            await core.saveOrderFlowStage(Number(trigger.dataset.orderId), 2);
            await loadData();
            toast("success", "已標記為出貨，物流狀態已同步到本地 API");
        }
        if (action === "mark-arrived") {
            await core.saveOrderFlowStage(Number(trigger.dataset.orderId), 3);
            await loadData();
            toast("success", "已標記為到貨，物流狀態已同步到本地 API");
        }
        if (action === "mark-waiting-pickup") {
            await core.saveOrderFlowStage(Number(trigger.dataset.orderId), 4);
            await loadData();
            toast("success", "已提醒買家取貨，物流狀態已同步到本地 API");
        }
        if (action === "confirm-received") {
            const contract = await core.ensureContract({ requireSigner: true });
            const tx = await contract.confirm_order_received(Number(trigger.dataset.orderId));
            await tx.wait();
            await loadData();
            toast("success", "已確認取貨");
        }
        if (action === "withdraw-order") {
            const orderId = Number(trigger.dataset.orderId);
            const order = state.orders.find((item) => Number(item.orderId) === orderId);
            const contract = await core.ensureContract({ requireSigner: true });
            const tx = await contract.withdraw_order_funds(orderId);
            await tx.wait();
            if (order) {
                await core.savePayout({
                    orderId,
                    seller: order.seller,
                    buyer: order.buyer,
                    productId: order.productId,
                    productName: order.productName,
                    amountWei: order.amountWei,
                    txHash: tx.hash
                });
            }
            await loadData();
            toast("success", "款項已提領");
        }
    } catch (error) {
        toast("error", normalizeError(error));
    } finally {
        trigger.disabled = false;
    }
}

async function hydrate() {
    const session = await core.initWalletState();
    state.account = session.account;
    state.chainId = session.chainId;
    setHeaderState();
    renderFilterChips();
    renderCatalog();
    renderCart();
    renderOrders();
    startAutoScroll();

    if (core.getConfiguredContractAddress()) {
        await loadData();
    }
}

dom.connectButton.addEventListener("click", async () => {
    try {
        const session = await core.connectWallet();
        state.account = session.account;
        state.chainId = session.chainId;
        setHeaderState();
        await loadData();
        toast("success", "錢包已連接");
    } catch (error) {
        toast("error", normalizeError(error));
    }
});

dom.switchNetworkButton.addEventListener("click", async () => {
    try {
        await core.switchToExpectedNetwork();
        const session = await core.initWalletState();
        state.chainId = session.chainId;
        setHeaderState();
        toast("success", "已切換到 Sepolia");
    } catch (error) {
        toast("error", normalizeError(error));
    }
});

dom.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    renderCatalog();
});

dom.orderRoleTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-role-filter]");
    if (!button) return;
    setOrderRoleFilter(button.dataset.roleFilter);
});

dom.orderSearchInput.addEventListener("input", (event) => {
    state.orderSearch = event.target.value;
    renderOrders();
});

dom.orderStageFilter.addEventListener("change", (event) => {
    state.orderStageFilter = event.target.value;
    renderOrders();
});

dom.catalogViewport.addEventListener("mouseenter", () => {
    state.autoScrollPaused = true;
});

dom.catalogViewport.addEventListener("mouseleave", () => {
    state.autoScrollPaused = false;
});

document.addEventListener("visibilitychange", () => {
    state.autoScrollPaused = document.hidden;
});

dom.cartToggleButton.addEventListener("click", () => setCartOpen(true));
dom.ordersToggleButton.addEventListener("click", () => setOrdersOpen(true));
dom.cartCloseButton.addEventListener("click", () => setCartOpen(false));
dom.ordersCloseButton.addEventListener("click", () => setOrdersOpen(false));
dom.drawerBackdrop.addEventListener("click", () => {
    setCartOpen(false);
    setOrdersOpen(false);
});
dom.clearCartButton.addEventListener("click", () => {
    state.cart = [];
    syncCart();
});
dom.checkoutButton.addEventListener("click", async () => {
    try {
        await checkoutCart();
    } catch (error) {
        toast("error", normalizeError(error));
    }
});
dom.refreshOrdersButton.addEventListener("click", loadData);
dom.catalogGrid.addEventListener("click", handleActionClick);
dom.cartItems.addEventListener("click", handleActionClick);
dom.ordersGrid.addEventListener("click", handleActionClick);

if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());
}

window.addEventListener("beforeunload", () => {
    if (state.railFrame) {
        window.cancelAnimationFrame(state.railFrame);
    }
});

hydrate().catch((error) => toast("error", normalizeError(error)));
