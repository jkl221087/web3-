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

const state = {
    account: null,
    chainId: null,
    session: null,
    products: [],
    orders: [],
    reviews: [],
    orderSearch: "",
    orderStageFilter: "all",
    expandedOrders: []
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

    const flow = getDisplayOrderFlow(order);
    return steps.map((item) => {
        const classes = ["step-pill", flow.stage >= item.stage ? "done" : "", flow.stage === item.stage ? "current" : ""]
            .filter(Boolean)
            .join(" ");
        return `<span class="${classes}">${item.label}</span>`;
    }).join("");
}

function getBuyerOrders() {
    if (!state.account) return [];
    const account = state.account.toLowerCase();
    const keyword = state.orderSearch.trim().toLowerCase();

    return state.orders.filter((order) => {
        if (order.buyer.toLowerCase() !== account) return false;
        if (state.orderStageFilter !== "all" && String(order.stage) !== state.orderStageFilter) return false;
        if (!keyword) return true;
        return String(order.orderId).includes(keyword) || String(order.productName || "").toLowerCase().includes(keyword);
    });
}

function renderProductCollection(target, products, emptyTitle, emptyDescription) {
    if (!target) return;
    if (!products.length) {
        target.innerHTML = `<article class="panel-card"><strong>${emptyTitle}</strong><p>${emptyDescription}</p></article>`;
        return;
    }

    target.innerHTML = "";
    products.forEach((product) => {
        const card = document.createElement("article");
        card.className = "compact-product-card";
        card.innerHTML = `
            <img src="${product.image}" alt="${product.name}" />
            <div class="compact-product-copy">
                <div class="detail-tags">
                    <span class="tag-pill">${product.meta.department}</span>
                    <span class="tag-pill">${product.meta.season}</span>
                </div>
                <h3>${product.name}</h3>
                <p>${product.meta.description || `${product.meta.style} / ${core.formatAddress(product.seller)}`}</p>
                <div class="price-row">
                    <strong>${core.formatEth(product.priceWei)}</strong>
                    <a href="/frontend/product.html?id=${product.productId}" class="button ghost link-button">查看</a>
                </div>
            </div>
        `;
        target.append(card);
    });
}

function renderCollections() {
    const favoriteIds = core.getFavoriteProductIds();
    const recentIds = core.getRecentlyViewedProductIds();
    const favoriteProducts = favoriteIds
        .map((id) => state.products.find((product) => product.productId === id))
        .filter((product) => product && product.isActive)
        .slice(0, 4);
    const recentProducts = recentIds
        .map((id) => state.products.find((product) => product.productId === id))
        .filter((product) => product && product.isActive)
        .slice(0, 4);

    renderProductCollection(
        dom.favoriteGrid,
        favoriteProducts,
        "你還沒有收藏商品",
        "在商品詳情頁按下加入收藏，這裡就會整理成你的個人選品。"
    );
    renderProductCollection(
        dom.recentlyViewedGrid,
        recentProducts,
        "最近還沒有瀏覽紀錄",
        "從商店首頁或商品頁開始逛，最近看過的單品會出現在這裡。"
    );
}

function getReviewForOrder(orderId) {
    return state.reviews.find((review) => Number(review.orderId) === Number(orderId)) || null;
}

function renderReviewHistory() {
    if (!dom.buyerReviewHistory) return;

    const buyerReviews = state.account
        ? state.reviews.filter((review) => String(review.buyer).toLowerCase() === state.account.toLowerCase())
        : [];

    if (!buyerReviews.length) {
        dom.buyerReviewHistory.innerHTML = '<article class="member-focus-card"><span>Reviews</span><h3>目前還沒有評價</h3><p>完成收貨後，就可以在訂單明細裡留下對賣家的評分與文字評論。</p></article>';
        return;
    }

    dom.buyerReviewHistory.innerHTML = "";
    buyerReviews.slice(0, 4).forEach((review) => {
        const card = document.createElement("article");
        card.className = "member-focus-card";
        card.innerHTML = `
            <span>訂單 #${review.orderId}</span>
            <h3>${review.productName || `商品 #${review.productId || review.orderId}`}</h3>
            <div class="review-meta">
                <strong class="review-stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</strong>
                <span>${new Date(review.createdAt).toLocaleDateString("zh-TW")}</span>
            </div>
            <p>${review.comment || "這筆評價沒有留下文字內容。"}</p>
        `;
        dom.buyerReviewHistory.append(card);
    });
}

function renderSummary(orders) {
    if (!state.account) {
        dom.ordersSummary.innerHTML = "";
        dom.buyerMetrics.innerHTML = "";
        dom.buyerFocusList.innerHTML = "";
        renderCollections();
        renderReviewHistory();
        return;
    }

    const waitingPickup = orders.filter((order) => Number(order.stage) === 4).length;
    const activeOrders = orders.filter((order) => Number(order.stage) < 6).length;
    const completed = orders.filter((order) => Number(order.stage) === 6).length;
    const alreadyReceived = orders.filter((order) => order.completeState).length;

    dom.buyerMetrics.innerHTML = `
        <article class="metric-card">
            <span>全部訂單</span>
            <strong>${orders.length}</strong>
            <p>你目前作為買家的所有鏈上訂單。</p>
        </article>
        <article class="metric-card">
            <span>進行中</span>
            <strong>${activeOrders}</strong>
            <p>仍在物流流程中的訂單數量。</p>
        </article>
        <article class="metric-card">
            <span>待取貨</span>
            <strong>${waitingPickup}</strong>
            <p>賣家已提醒取貨，下一步可確認收貨。</p>
        </article>
        <article class="metric-card">
            <span>已確認收貨</span>
            <strong>${alreadyReceived}</strong>
            <p>你已在鏈上完成確認的訂單。</p>
        </article>
    `;

    dom.buyerFocusList.innerHTML = `
        <article class="member-focus-card">
            <span>Priority 01</span>
            <h3>等待取貨訂單</h3>
            <p>${waitingPickup ? `目前有 ${waitingPickup} 筆訂單可以直接完成收貨確認。` : "目前沒有等待你取貨的訂單。"} </p>
        </article>
        <article class="member-focus-card">
            <span>Priority 02</span>
            <h3>運送中追蹤</h3>
            <p>${orders.filter((order) => Number(order.stage) === 2 || Number(order.stage) === 3).length} 筆訂單正在運送或已到貨，可持續追蹤最新節點。</p>
        </article>
        <article class="member-focus-card">
            <span>Priority 03</span>
            <h3>已完成訂單</h3>
            <p>${completed} 筆訂單已走完整個 escrow 流程，可回頭檢查商品與賣家表現。</p>
        </article>
    `;

    dom.ordersSummary.innerHTML = `
        <span class="summary-pill"><strong>${orders.length}</strong> 筆買家訂單</span>
        <span class="summary-pill"><strong>${activeOrders}</strong> 筆進行中</span>
        <span class="summary-pill"><strong>${waitingPickup}</strong> 筆等待取貨</span>
        <span class="summary-pill"><strong>${completed}</strong> 筆已完成</span>
    `;
}

function renderOrders() {
    dom.ordersGrid.innerHTML = "";
    renderCollections();
    renderReviewHistory();

    if (!state.account || !state.session?.authenticated) {
        renderSummary([]);
        dom.ordersGrid.innerHTML = '<article class="panel-card"><strong>請先連接錢包並完成登入</strong><p>登入後就能看到你所有購買過的訂單、物流節點與評價紀錄。</p></article>';
        return;
    }

    const orders = getBuyerOrders();
    renderSummary(state.orders.filter((order) => order.buyer.toLowerCase() === state.account.toLowerCase()));

    if (!orders.length) {
        dom.ordersGrid.innerHTML = '<article class="panel-card"><strong>目前沒有符合條件的買家訂單</strong><p>可以先回到商店下單，或調整搜尋與狀態條件。</p></article>';
        return;
    }

    orders.forEach((order) => {
        const product = state.products.find((item) => item.productId === order.productId);
        const flow = getDisplayOrderFlow(order);
        const expanded = isOrderExpanded(order.orderId);
        const canConfirm = flow.stage === 4 && !order.completeState;
        const review = getReviewForOrder(order.orderId);
        const card = document.createElement("article");
        card.className = "order-card";
        card.innerHTML = `
            <div class="order-head">
                <div>
                    <strong>訂單 #${order.orderId}</strong>
                    <p>${product ? product.name : (order.productName || `商品 #${order.productId || order.orderId}`)}</p>
                </div>
                <div class="detail-tags">
                    <span class="order-chip ${flow.tone}">${flow.label}</span>
                    <span class="order-chip ${order.completeState ? "success" : "muted"}">${order.completeState ? "已確認收貨" : "待確認收貨"}</span>
                </div>
            </div>
            <div class="order-stage-row">
                <span class="status-light ${flow.stage >= 4 && !order.sellerWithdrawn ? "active" : ""}"></span>
                <strong>${flow.label}</strong>
                <span>${flow.description}</span>
            </div>
            <div class="step-track">${buildOrderStepTrack(order)}</div>
            <div class="price-row">
                <strong>${core.formatEth(order.amountWei)}</strong>
                <div class="detail-actions">
                    <button class="button ghost" data-action="toggle-order-detail" data-order-id="${order.orderId}" type="button">${expanded ? "收合明細" : "查看明細"}</button>
                    ${canConfirm ? `<button class="button primary" data-action="confirm-received" data-order-id="${order.orderId}" type="button">我已取貨</button>` : ""}
                </div>
            </div>
            ${expanded ? `
                <div class="order-detail-panel">
                    <div class="order-detail-grid">
                        <div class="order-detail-block">
                            <span class="eyebrow">Product</span>
                            <strong>${product ? product.name : (order.productName || "商品資訊")}</strong>
                            <p>商品 ID：${order.productId || "-"}</p>
                            <p>鏈上金額：${core.formatEth(order.amountWei)}</p>
                            <p>賣家：${order.seller}</p>
                        </div>
                        <div class="order-detail-block">
                            <span class="eyebrow">Buyer</span>
                            <p>目前地址：${order.buyer}</p>
                            <p>付款狀態：${order.payState ? "已付款" : "未付款"}</p>
                            <p>收貨確認：${order.completeState ? "已完成" : "尚未確認"}</p>
                            <p>提領狀態：${order.sellerWithdrawn ? "賣家已提領" : "賣家尚未提領"}</p>
                        </div>
                        <div class="order-detail-block">
                            <span class="eyebrow">Flow</span>
                            <p>目前節點：${flow.label}</p>
                            <p>${flow.description}</p>
                            <p>等待取貨亮燈：${flow.stage >= 4 ? "已亮起" : "尚未亮起"}</p>
                        </div>
                    </div>
                    ${order.completeState ? `
                        <div class="order-detail-block">
                            <span class="eyebrow">Review</span>
                            ${review ? `
                                <div class="review-meta">
                                    <strong class="review-stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</strong>
                                    <span>你已送出評價</span>
                                </div>
                                <p>${review.comment || "這筆評價沒有留下文字內容。"}</p>
                            ` : `
                                <form class="review-form" data-review-form="true" data-order-id="${order.orderId}">
                                    <select class="search-input" name="rating">
                                        <option value="5">5 星</option>
                                        <option value="4">4 星</option>
                                        <option value="3">3 星</option>
                                        <option value="2">2 星</option>
                                        <option value="1">1 星</option>
                                    </select>
                                    <textarea class="search-input" name="comment" rows="3" placeholder="分享這次購買與賣家服務感受"></textarea>
                                    <button class="button primary" data-action="submit-review" data-order-id="${order.orderId}" type="submit">送出評價</button>
                                </form>
                            `}
                        </div>
                    ` : ""}
                </div>
            ` : ""}
        `;
        dom.ordersGrid.append(card);
    });
}

async function loadData() {
    try {
        state.products = await core.fetchProducts();
        if (state.account && state.session?.authenticated) {
            const dashboard = await core.fetchBuyerDashboard();
            state.orders = await core.fetchOrders();
            state.reviews = Array.isArray(dashboard.reviews) ? dashboard.reviews : [];
        } else {
            state.orders = [];
            state.reviews = [];
        }
        const balance = await core.fetchContractBalance();
        dom.escrowBalance.textContent = core.formatEth(balance);
        renderOrders();
    } catch (error) {
        renderOrders();
        toast("error", normalizeError(error));
    }
}

async function handleActionClick(event) {
    const trigger = event.target.closest("[data-action]");
    if (!trigger) return;

    try {
        const action = trigger.dataset.action;
        if (action === "toggle-order-detail") {
            toggleExpandedOrder(Number(trigger.dataset.orderId));
            renderOrders();
        }
        if (action === "confirm-received") {
            const contract = await core.ensureContract({ requireSigner: true });
            const tx = await contract.confirm_order_received(Number(trigger.dataset.orderId));
            await tx.wait();
            await loadData();
            toast("success", "已完成鏈上確認收貨");
        }
        if (action === "submit-review") {
            event.preventDefault();
            const orderId = Number(trigger.dataset.orderId);
            const form = trigger.closest("form");
            const order = state.orders.find((item) => Number(item.orderId) === orderId);
            if (!form || !order) return;
            const rating = Number(form.elements.rating.value);
            const comment = String(form.elements.comment.value || "").trim();

            await core.saveReview({
                orderId,
                productId: order.productId,
                productName: order.productName,
                seller: order.seller,
                buyer: order.buyer,
                rating,
                comment
            });
            state.reviews = await core.fetchReviews();
            renderOrders();
            toast("success", "評價已送出");
        }
    } catch (error) {
        toast("error", normalizeError(error));
    }
}

async function hydrate() {
    const session = await core.initWalletState();
    state.account = session.account;
    state.chainId = session.chainId;
    state.session = session.session || null;
    setHeaderState();
    renderOrders();

    if (core.getConfiguredContractAddress()) {
        await loadData();
    }
}

dom.connectButton.addEventListener("click", async () => {
    try {
        const session = await core.connectWallet();
        state.account = session.account;
        state.chainId = session.chainId;
        state.session = session.session || null;
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
        state.session = session.session || null;
        setHeaderState();
        toast("success", "已切換到 Sepolia");
    } catch (error) {
        toast("error", normalizeError(error));
    }
});

dom.orderSearchInput.addEventListener("input", (event) => {
    state.orderSearch = event.target.value;
    renderOrders();
});

dom.orderStageFilter.addEventListener("change", (event) => {
    state.orderStageFilter = event.target.value;
    renderOrders();
});

dom.refreshOrdersButton.addEventListener("click", loadData);
dom.ordersGrid.addEventListener("click", handleActionClick);

if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());
}

hydrate().catch((error) => toast("error", normalizeError(error)));
