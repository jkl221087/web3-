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
    walletAddress: document.getElementById("walletAddress"),
    chainId: document.getElementById("chainId"),
    contractAddressLabel: document.getElementById("contractAddressLabel"),
    adminStatusLabel: document.getElementById("adminStatusLabel"),
    adminGateCard: document.getElementById("adminGateCard"),
    adminWorkspace: document.getElementById("adminWorkspace"),
    adminMetrics: document.getElementById("adminMetrics"),
    refreshButton: document.getElementById("refreshButton"),
    sellerRequestList: document.getElementById("sellerRequestList"),
    productModerationGrid: document.getElementById("productModerationGrid"),
    adminAuditLog: document.getElementById("adminAuditLog"),
    adminOrderMonitor: document.getElementById("adminOrderMonitor"),
    adminPayoutMonitor: document.getElementById("adminPayoutMonitor"),
    toastStack: document.getElementById("toastStack")
};

const state = {
    account: null,
    chainId: null,
    session: null,
    isAdmin: false,
    products: [],
    orders: [],
    payouts: [],
    reviews: [],
    auditLogs: [],
    sellers: { approved: [], pending: [] }
};

//訊息通知
function toast(type, message) {
    const node = document.createElement("article");
    node.className = `toast ${type}`;
    node.textContent = message;
    dom.toastStack.prepend(node);
    window.setTimeout(() => node.remove(), 3200);
}


//處理error message
function normalizeError(error) {
    const raw = error?.reason || error?.shortMessage || error?.message || "發生未知錯誤";
    return raw.replace(/^execution reverted: /, "");
}

//後台管理
function setHeaderState() {
    dom.walletAddress.textContent = state.account ? core.formatAddress(state.account) : "尚未連接";
    dom.chainId.textContent = state.chainId || "-";
    const contractAddress = core.getConfiguredContractAddress();
    dom.contractAddressLabel.textContent = contractAddress ? core.formatAddress(contractAddress) : "未設定";
    dom.adminStatusLabel.textContent = !state.account
        ? "未連接"
        : !state.session?.authenticated
            ? "未登入"
            : state.isAdmin
                ? "Owner / Admin"
                : "非管理員";
}

function renderGate() {
    if (!state.account) {
        dom.adminGateCard.innerHTML = '<article class="member-focus-card"><span>Access</span><h3>請先連接錢包</h3><p>只有連接錢包後，系統才能檢查你是不是合約 owner。</p></article>';
        dom.adminWorkspace.classList.add("hidden");
        return;
    }

    if (!state.session?.authenticated) {
        dom.adminGateCard.innerHTML = '<article class="member-focus-card"><span>Access</span><h3>請先完成錢包登入</h3><p>這個後台現在會使用後端 session 驗證管理員身份，請重新連接錢包並完成簽名登入。</p></article>';
        dom.adminWorkspace.classList.add("hidden");
        return;
    }

    if (!state.isAdmin) {
        dom.adminGateCard.innerHTML = '<article class="member-focus-card"><span>Access</span><h3>目前地址不是管理員</h3><p>這個頁面只開放給合約 owner。你仍然可以回到賣家中心或商店前台繼續操作。</p></article>';
        dom.adminWorkspace.classList.add("hidden");
        return;
    }

    dom.adminGateCard.innerHTML = '<article class="member-focus-card"><span>Access</span><h3>管理權限已通過</h3><p>目前地址就是合約 owner，可以審核賣家、管理商品與查看商店概況。</p></article>';
    dom.adminWorkspace.classList.remove("hidden");
}

function renderMetrics() {
    if (!state.isAdmin) {
        dom.adminMetrics.innerHTML = "";
        return;
    }

    const activeProducts = state.products.filter((product) => product.isActive).length;
    const inactiveProducts = state.products.filter((product) => !product.isActive).length;
    const pendingPayoutWei = state.orders
        .filter((order) => !order.sellerWithdrawn)
        .reduce((sum, order) => sum + order.amountWei, 0n);
    const totalPayoutWei = state.payouts.reduce((sum, item) => sum + BigInt(item.amountWei || "0"), 0n);

    dom.adminMetrics.innerHTML = `
        <article class="metric-card">
            <span>待審核賣家</span>
            <strong>${state.sellers.pending.length}</strong>
            <p>等待 owner 核准才能進入賣家後台。</p>
        </article>
        <article class="metric-card">
            <span>上架中商品</span>
            <strong>${activeProducts}</strong>
            <p>目前全店可被買家看到的商品數量。</p>
        </article>
        <article class="metric-card">
            <span>已下架商品</span>
            <strong>${inactiveProducts}</strong>
            <p>可由管理員或賣家重新上架。</p>
        </article>
        <article class="metric-card">
            <span>全店訂單</span>
            <strong>${state.orders.length}</strong>
            <p>已建立的鏈上訂單總數。</p>
        </article>
        <article class="metric-card">
            <span>待結算金額</span>
            <strong>${core.formatEth(pendingPayoutWei)}</strong>
            <p>尚未完成提領的訂單總額。</p>
        </article>
        <article class="metric-card">
            <span>累計提領</span>
            <strong>${core.formatEth(totalPayoutWei)}</strong>
            <p>已成功完成提領的總金額。</p>
        </article>
    `;
}

function renderSellerRequests() {
    if (!state.isAdmin) {
        dom.sellerRequestList.innerHTML = "";
        return;
    }

    if (!state.sellers.pending.length) {
        dom.sellerRequestList.innerHTML = '<article class="request-card empty"><strong>目前沒有待審核賣家</strong><p>新的賣家申請送出後，這裡會立即顯示。</p></article>';
        return;
    }

    dom.sellerRequestList.innerHTML = "";
    state.sellers.pending.forEach((address) => {
        const card = document.createElement("article");
        card.className = "request-card";
        card.innerHTML = `
            <div>
                <strong>${escapeHtml(address)}</strong>
                <p>這個地址正等待管理員核准成為賣家。</p>
            </div>
            <div class="detail-actions">
                <button class="button primary" data-action="approve-seller" data-address="${escapeHtml(address)}" type="button">核准賣家</button>
            </div>
        `;
        dom.sellerRequestList.append(card);
    });
}

function renderProductModeration() {
    if (!state.isAdmin) {
        dom.productModerationGrid.innerHTML = "";
        return;
    }

    if (!state.products.length) {
        dom.productModerationGrid.innerHTML = '<article class="panel-card"><strong>目前沒有商品</strong><p>賣家建立商品後，這裡會顯示全店商品與狀態。</p></article>';
        return;
    }

    dom.productModerationGrid.innerHTML = "";
    state.products.forEach((product) => {
        const card = document.createElement("article");
        card.className = "inventory-card";
        card.innerHTML = `
            <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" />
            <div class="inventory-meta">
                <div>
                    <strong>${escapeHtml(product.name)}</strong>
                    <p>#${product.productId} • ${escapeHtml(product.meta.department)} • ${escapeHtml(product.meta.season)}</p>
                </div>
                <span class="tag-pill">${product.isActive ? "販售中" : "已下架"}</span>
            </div>
            <p>賣家：${escapeHtml(core.formatAddress(product.seller))}</p>
            <p>尺寸：${escapeHtml(product.meta.sizes.join(" / "))} ・ 顏色：${escapeHtml(product.meta.colors.join(" / "))} ・ 庫存：${product.meta.stock}</p>
            <div class="price-row">
                <strong>${escapeHtml(core.formatEth(product.priceWei))}</strong>
                <div class="detail-actions">
                    <button class="button ghost" data-action="toggle-product" data-product-id="${product.productId}" data-next="${product.isActive ? "false" : "true"}" type="button">
                        ${product.isActive ? "下架商品" : "重新上架"}
                    </button>
                </div>
            </div>
        `;
        dom.productModerationGrid.append(card);
    });
}

function renderOrderMonitor() {
    if (!state.isAdmin) {
        dom.adminOrderMonitor.innerHTML = "";
        return;
    }

    if (!state.orders.length) {
        dom.adminOrderMonitor.innerHTML = '<article class="member-focus-card"><span>Orders</span><h3>目前沒有訂單</h3><p>當買家完成下單後，這裡會整理最新的訂單動態。</p></article>';
        return;
    }

    dom.adminOrderMonitor.innerHTML = "";
    state.orders.slice(0, 6).forEach((order) => {
        const flow = core.getOrderStageMeta(order.stage || 1);
        const productLabel = escapeHtml(order.productName || `商品 #${order.productId || order.orderId}`);
        const card = document.createElement("article");
        card.className = "member-focus-card";
        card.innerHTML = `
            <span>訂單 #${order.orderId}</span>
            <h3>${productLabel}</h3>
            <p>賣家：${escapeHtml(core.formatAddress(order.seller))} ・ 買家：${escapeHtml(core.formatAddress(order.buyer))}</p>
            <p>狀態：${escapeHtml(flow.label)} ・ 金額：${escapeHtml(core.formatEth(order.amountWei))}</p>
        `;
        dom.adminOrderMonitor.append(card);
    });
}

function renderPayoutMonitor() {
    if (!state.isAdmin) {
        dom.adminPayoutMonitor.innerHTML = "";
        return;
    }

    const averageRating = state.reviews.length
        ? state.reviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / state.reviews.length
        : 0;

    dom.adminPayoutMonitor.innerHTML = `
        <article class="member-focus-card">
            <span>Payouts</span>
            <h3>累計提領 ${state.payouts.length} 筆</h3>
            <p>${core.formatEth(state.payouts.reduce((sum, item) => sum + BigInt(item.amountWei || "0"), 0n))} 已從 escrow 完成結算。</p>
        </article>
        <article class="member-focus-card">
            <span>Reviews</span>
            <h3>${state.reviews.length} 筆買家評論</h3>
            <p>目前全店平均評分 ${state.reviews.length ? averageRating.toFixed(1) : "-"} / 5.0。</p>
        </article>
        <article class="member-focus-card">
            <span>Sellers</span>
            <h3>${state.sellers.approved.length} 位核准賣家</h3>
            <p>${state.sellers.pending.length} 位賣家還在等待審核。</p>
        </article>
    `;
}

function formatAuditCategory(category) {
    if (category === "seller") return "賣家";
    if (category === "product") return "商品";
    return "系統";
}

function renderAuditTrail() {
    if (!state.isAdmin) {
        dom.adminAuditLog.innerHTML = "";
        return;
    }

    if (!state.auditLogs.length) {
        dom.adminAuditLog.innerHTML = '<article class="member-focus-card"><span>Audit</span><h3>目前還沒有異動紀錄</h3><p>賣家申請、核准與商品異動後，這裡會留下可追蹤的後端紀錄。</p></article>';
        return;
    }

    dom.adminAuditLog.innerHTML = "";
    state.auditLogs.forEach((entry) => {
        const card = document.createElement("article");
        card.className = "member-focus-card";
        const productHint = entry.productId ? ` ・ 商品 #${entry.productId}` : "";
        card.innerHTML = `
            <span>${escapeHtml(formatAuditCategory(entry.category))}紀錄</span>
            <h3>${escapeHtml(entry.summary)}</h3>
            <p>操作者：${escapeHtml(core.formatAddress(entry.actor))} ・ 對象：${escapeHtml(entry.subject || "-")}${productHint}</p>
            <p>${escapeHtml(new Date(entry.createdAt).toLocaleString("zh-TW"))}</p>
        `;
        dom.adminAuditLog.append(card);
    });
}

async function loadAdminState() {
    if (!state.account) {
        state.session = null;
        state.isAdmin = false;
        state.auditLogs = [];
        state.sellers = { approved: [], pending: [] };
        setHeaderState();
        renderGate();
        renderMetrics();
        renderSellerRequests();
        renderProductModeration();
        renderAuditTrail();
        renderOrderMonitor();
        renderPayoutMonitor();
        return;
    }

    try {
        state.session = await core.fetchSessionProfile();
        state.isAdmin = Boolean(
            state.session?.authenticated &&
            state.session?.address?.toLowerCase() === state.account.toLowerCase() &&
            state.session?.isAdmin
        );
        setHeaderState();
        renderGate();

        if (!state.isAdmin) {
            state.auditLogs = [];
            renderMetrics();
            renderSellerRequests();
            renderProductModeration();
            renderAuditTrail();
            renderOrderMonitor();
            renderPayoutMonitor();
            return;
        }

        state.products = await core.fetchProducts();
        state.sellers = await core.fetchSellersStore();
        state.auditLogs = await core.fetchAdminAuditLogs();
        state.orders = core.getConfiguredContractAddress() ? await core.fetchOrders() : [];
        state.payouts = await core.fetchPayouts();
        state.reviews = await core.fetchReviews();

        renderMetrics();
        renderSellerRequests();
        renderProductModeration();
        renderAuditTrail();
        renderOrderMonitor();
        renderPayoutMonitor();
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
    renderGate();
    await loadAdminState();
}

async function handleActionClick(event) {
    const trigger = event.target.closest("[data-action]");
    if (!trigger || trigger.disabled) return;

    trigger.disabled = true;
    try {
        const action = trigger.dataset.action;
        if (action === "approve-seller") {
            await core.approveSellerAccess(trigger.dataset.address, true);
            await loadAdminState();
            toast("success", "賣家已核准");
        }
        if (action === "toggle-product") {
            await core.setMockProductActive(Number(trigger.dataset.productId), trigger.dataset.next === "true");
            await loadAdminState();
            toast("success", "商品狀態已更新");
        }
    } catch (error) {
        toast("error", normalizeError(error));
    } finally {
        trigger.disabled = false;
    }
}

dom.connectButton.addEventListener("click", async () => {
    try {
        const session = await core.connectWallet();
        state.account = session.account;
        state.chainId = session.chainId;
        state.session = session.session || null;
        setHeaderState();
        await loadAdminState();
        toast("success", "管理錢包已連接");
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

dom.refreshButton.addEventListener("click", loadAdminState);
dom.sellerRequestList.addEventListener("click", handleActionClick);
dom.productModerationGrid.addEventListener("click", handleActionClick);

if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());
}

hydrate().catch((error) => toast("error", normalizeError(error)));
