const core = window.FashionStoreCore;

const dom = {
    connectButton: document.getElementById("connectButton"),
    switchNetworkButton: document.getElementById("switchNetworkButton"),
    walletAddress: document.getElementById("walletAddress"),
    chainId: document.getElementById("chainId"),
    contractAddressLabel: document.getElementById("contractAddressLabel"),
    escrowBalance: document.getElementById("escrowBalance"),
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
    isSeller: false,
    products: [],
    orders: [],
    reviews: [],
    payouts: [],
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
        { stage: 1, label: "待出貨" },
        { stage: 2, label: "運送中" },
        { stage: 3, label: "已到貨" },
        { stage: 4, label: "待取貨" },
        { stage: 5, label: "可提領" },
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

function getSellerOrders() {
    if (!state.account) return [];
    const account = state.account.toLowerCase();
    const keyword = state.orderSearch.trim().toLowerCase();

    return state.orders.filter((order) => {
        if (order.seller.toLowerCase() !== account) return false;
        if (state.orderStageFilter !== "all" && String(order.stage) !== state.orderStageFilter) return false;
        if (!keyword) return true;
        return String(order.orderId).includes(keyword) || String(order.productName || "").toLowerCase().includes(keyword);
    });
}

function renderSellerReviews() {
    if (!dom.sellerReviewSummary || !dom.sellerReviewList) return;

    if (!state.account) {
        dom.sellerReviewSummary.innerHTML = "";
        dom.sellerReviewList.innerHTML = "";
        return;
    }

    const sellerReviews = state.reviews.filter((review) => String(review.seller).toLowerCase() === state.account.toLowerCase());
    if (!sellerReviews.length) {
        dom.sellerReviewSummary.innerHTML = '<span class="summary-pill"><strong>0</strong> 筆評論</span><span class="summary-pill"><strong>-</strong> 平均評分</span>';
        dom.sellerReviewList.innerHTML = '<article class="member-focus-card"><span>Reputation</span><h3>目前還沒有評論</h3><p>當買家完成收貨並留下評價後，這裡會自動顯示最近的文字評論與星等。</p></article>';
        return;
    }

    const average = sellerReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / sellerReviews.length;
    const withComment = sellerReviews.filter((review) => review.comment).length;

    dom.sellerReviewSummary.innerHTML = `
        <span class="summary-pill"><strong>${sellerReviews.length}</strong> 筆評論</span>
        <span class="summary-pill"><strong>${average.toFixed(1)}</strong> 平均評分</span>
        <span class="summary-pill"><strong>${withComment}</strong> 筆含文字評論</span>
    `;

    dom.sellerReviewList.innerHTML = "";
    sellerReviews.slice(0, 4).forEach((review) => {
        const card = document.createElement("article");
        card.className = "member-focus-card";
        card.innerHTML = `
            <span>訂單 #${review.orderId}</span>
            <h3>${review.productName || `商品 #${review.productId || review.orderId}`}</h3>
            <div class="review-meta">
                <strong class="review-stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</strong>
                <span>${new Date(review.createdAt).toLocaleDateString("zh-TW")}</span>
            </div>
            <p>${review.comment || "買家只留下星等評分。"}</p>
        `;
        dom.sellerReviewList.append(card);
    });
}

function renderMonthlyReport() {
    if (!dom.sellerMonthlyReport) return;

    if (!state.account) {
        dom.sellerMonthlyReport.innerHTML = "";
        return;
    }

    const sellerPayouts = state.payouts.filter((item) => String(item.seller).toLowerCase() === state.account.toLowerCase());
    const sellerReviews = state.reviews.filter((item) => String(item.seller).toLowerCase() === state.account.toLowerCase());
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const currentMonthPayouts = sellerPayouts.filter((item) => {
        const date = new Date(item.createdAt);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
        return monthKey === currentMonthKey;
    });
    const currentMonthWei = currentMonthPayouts.reduce((sum, item) => sum + BigInt(item.amountWei || "0"), 0n);
    const lastPayout = sellerPayouts[0];
    const averageRating = sellerReviews.length
        ? sellerReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / sellerReviews.length
        : 0;

    dom.sellerMonthlyReport.innerHTML = `
        <article class="metric-card">
            <span>本月提領</span>
            <strong>${core.formatEth(currentMonthWei)}</strong>
            <p>${currentMonthPayouts.length} 筆提領在本月完成。</p>
        </article>
        <article class="metric-card">
            <span>累計提領</span>
            <strong>${core.formatEth(sellerPayouts.reduce((sum, item) => sum + BigInt(item.amountWei || "0"), 0n))}</strong>
            <p>${sellerPayouts.length} 筆提領已收進帳務歷史。</p>
        </article>
        <article class="metric-card">
            <span>賣家評價</span>
            <strong>${sellerReviews.length ? averageRating.toFixed(1) : "-"}</strong>
            <p>${sellerReviews.length ? `${sellerReviews.length} 筆評論形成目前口碑。` : "目前還沒有買家評價。"} </p>
        </article>
        <article class="metric-card">
            <span>最近一次提領</span>
            <strong>${lastPayout ? core.formatEth(BigInt(lastPayout.amountWei || "0")) : "-"}</strong>
            <p>${lastPayout ? new Date(lastPayout.createdAt).toLocaleDateString("zh-TW") : "尚未有提領紀錄。"} </p>
        </article>
    `;
}

function renderPayoutHistory() {
    if (!dom.sellerPayoutSummary || !dom.sellerPayoutList) return;

    if (!state.account) {
        dom.sellerPayoutSummary.innerHTML = "";
        dom.sellerPayoutList.innerHTML = "";
        return;
    }

    const payouts = state.payouts.filter((item) => String(item.seller).toLowerCase() === state.account.toLowerCase());
    const totalWei = payouts.reduce((sum, item) => sum + BigInt(item.amountWei || "0"), 0n);

    dom.sellerPayoutSummary.innerHTML = `
        <span class="summary-pill"><strong>${payouts.length}</strong> 筆提領</span>
        <span class="summary-pill"><strong>${core.formatEth(totalWei)}</strong> 累計提領</span>
    `;

    if (!payouts.length) {
        dom.sellerPayoutList.innerHTML = '<article class="member-focus-card"><span>Payouts</span><h3>目前還沒有提領紀錄</h3><p>完成買家收貨確認後提領，這裡會留下每一筆實際請款時間與金額。</p></article>';
        return;
    }

    dom.sellerPayoutList.innerHTML = "";
    payouts.slice(0, 6).forEach((payout) => {
        const card = document.createElement("article");
        card.className = "payout-card";
        card.innerHTML = `
            <div class="price-row">
                <h3>訂單 #${payout.orderId}</h3>
                <strong>${core.formatEth(BigInt(payout.amountWei || "0"))}</strong>
            </div>
            <p>${payout.productName || `商品 #${payout.productId || payout.orderId}`}</p>
            <p>買家：${core.formatAddress(payout.buyer)}</p>
            <p>提領時間：${new Date(payout.createdAt).toLocaleString("zh-TW")}</p>
            <p>交易雜湊：${payout.txHash ? `${payout.txHash.slice(0, 10)}...${payout.txHash.slice(-8)}` : "未記錄"}</p>
        `;
        dom.sellerPayoutList.append(card);
    });
}

function renderSummary(orders) {
    if (!state.account) {
        dom.ordersSummary.innerHTML = "";
        dom.sellerMetrics.innerHTML = "";
        renderMonthlyReport();
        dom.sellerFocusList.innerHTML = "";
        renderSellerReviews();
        renderPayoutHistory();
        return;
    }

    const pendingShipment = orders.filter((order) => Number(order.stage) === 1).length;
    const pendingPickup = orders.filter((order) => Number(order.stage) === 4).length;
    const readyToWithdraw = orders.filter((order) => order.completeState && !order.sellerWithdrawn).length;
    const finished = orders.filter((order) => Number(order.stage) === 6).length;
    const inTransit = orders.filter((order) => Number(order.stage) === 2 || Number(order.stage) === 3).length;
    const pendingWei = orders
        .filter((order) => !order.sellerWithdrawn)
        .reduce((sum, order) => sum + order.amountWei, 0n);
    const withdrawnWei = orders
        .filter((order) => order.sellerWithdrawn)
        .reduce((sum, order) => sum + order.amountWei, 0n);

    dom.sellerMetrics.innerHTML = `
        <article class="metric-card">
            <span>全部接單</span>
            <strong>${orders.length}</strong>
            <p>你目前作為賣家的全部鏈上訂單。</p>
        </article>
        <article class="metric-card">
            <span>待出貨</span>
            <strong>${pendingShipment}</strong>
            <p>付款完成後，下一步要由你標記出貨。</p>
        </article>
        <article class="metric-card">
            <span>待結算金額</span>
            <strong>${core.formatEth(pendingWei)}</strong>
            <p>尚未完成提領的 escrow 款項總額。</p>
        </article>
        <article class="metric-card">
            <span>已提領金額</span>
            <strong>${core.formatEth(withdrawnWei)}</strong>
            <p>已完成整個流程並成功領出的金額。</p>
        </article>
    `;

    dom.sellerFocusList.innerHTML = `
        <article class="member-focus-card">
            <span>Priority 01</span>
            <h3>優先處理待出貨</h3>
            <p>${pendingShipment ? `目前有 ${pendingShipment} 筆訂單等待你按下出貨。` : "目前沒有待出貨訂單。"} </p>
        </article>
        <article class="member-focus-card">
            <span>Priority 02</span>
            <h3>提醒買家取貨</h3>
            <p>${pendingPickup ? `${pendingPickup} 筆訂單已進入等待取貨，可留意買家是否完成確認。` : "目前沒有等待買家取貨的訂單。"} </p>
        </article>
        <article class="member-focus-card">
            <span>Priority 03</span>
            <h3>鏈上提領</h3>
            <p>${readyToWithdraw ? `目前有 ${readyToWithdraw} 筆訂單可直接提領，合計 ${core.formatEth(orders.filter((order) => order.completeState && !order.sellerWithdrawn).reduce((sum, order) => sum + order.amountWei, 0n))}。` : "目前沒有可提領訂單。"} </p>
        </article>
        <article class="member-focus-card">
            <span>Priority 04</span>
            <h3>物流中訂單</h3>
            <p>${inTransit ? `${inTransit} 筆訂單還在運送或到貨階段，建議持續更新節點。` : "目前沒有物流中的訂單。"} </p>
        </article>
    `;

    dom.ordersSummary.innerHTML = `
        <span class="summary-pill"><strong>${orders.length}</strong> 筆賣家訂單</span>
        <span class="summary-pill"><strong>${pendingShipment}</strong> 筆待出貨</span>
        <span class="summary-pill"><strong>${pendingPickup}</strong> 筆待買家取貨</span>
        <span class="summary-pill"><strong>${readyToWithdraw}</strong> 筆可提領</span>
        <span class="summary-pill"><strong>${finished}</strong> 筆已完成</span>
    `;
}

function buildOrderActions(order) {
    const flow = getDisplayOrderFlow(order);
    const actions = [`<button class="button ghost" data-action="toggle-order-detail" data-order-id="${order.orderId}" type="button">${isOrderExpanded(order.orderId) ? "收合明細" : "查看明細"}</button>`];

    if (flow.stage === 1 && !order.completeState) {
        actions.push(`<button class="button ghost" data-action="mark-shipped" data-order-id="${order.orderId}" type="button">是否出貨</button>`);
    }
    if (flow.stage === 2 && !order.completeState) {
        actions.push(`<button class="button ghost" data-action="mark-arrived" data-order-id="${order.orderId}" type="button">物流是否到達</button>`);
    }
    if (flow.stage === 3 && !order.completeState) {
        actions.push(`<button class="button ghost" data-action="mark-waiting-pickup" data-order-id="${order.orderId}" type="button">提醒取貨</button>`);
    }
    if (order.completeState && !order.sellerWithdrawn) {
        actions.push(`<button class="button primary" data-action="withdraw-order" data-order-id="${order.orderId}" type="button">請領取款項</button>`);
    }

    return actions.join("");
}

function renderOrders() {
    dom.ordersGrid.innerHTML = "";
    renderMonthlyReport();
    renderSellerReviews();
    renderPayoutHistory();

    if (!state.account || !state.session?.authenticated) {
        renderSummary([]);
        dom.ordersGrid.innerHTML = '<article class="panel-card"><strong>請先連接錢包並完成登入</strong><p>登入後系統才會檢查你是不是核准賣家，並顯示接單工作台。</p></article>';
        return;
    }

    if (!state.isSeller) {
        renderSummary([]);
        dom.ordersGrid.innerHTML = '<article class="panel-card"><strong>目前不是賣家身份</strong><p>這個頁面只會顯示核准賣家的接單工作台。你可以先到賣家後台申請賣家資格。</p></article>';
        return;
    }

    const accountOrders = state.orders.filter((order) => order.seller.toLowerCase() === state.account.toLowerCase());
    renderSummary(accountOrders);
    const orders = getSellerOrders();

    if (!orders.length) {
        dom.ordersGrid.innerHTML = '<article class="panel-card"><strong>目前沒有符合條件的賣家訂單</strong><p>可以先從商品後台上架商品，或等待買家完成下單。</p></article>';
        return;
    }

    orders.forEach((order) => {
        const product = state.products.find((item) => item.productId === order.productId);
        const flow = getDisplayOrderFlow(order);
        const expanded = isOrderExpanded(order.orderId);
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
                    <span class="order-chip ${order.sellerWithdrawn ? "success" : "muted"}">${order.sellerWithdrawn ? "已提領" : "待提領"}</span>
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
                <div class="detail-actions">${buildOrderActions(order)}</div>
            </div>
            ${expanded ? `
                <div class="order-detail-panel">
                    <div class="order-detail-grid">
                        <div class="order-detail-block">
                            <span class="eyebrow">Product</span>
                            <strong>${product ? product.name : (order.productName || "商品資訊")}</strong>
                            <p>商品 ID：${order.productId || "-"}</p>
                            <p>買家：${order.buyer}</p>
                            <p>鏈上金額：${core.formatEth(order.amountWei)}</p>
                        </div>
                        <div class="order-detail-block">
                            <span class="eyebrow">Seller Ops</span>
                            <p>物流狀態：${flow.label}</p>
                            <p>${flow.description}</p>
                            <p>收貨確認：${order.completeState ? "買家已確認" : "等待買家確認"}</p>
                            <p>提領狀態：${order.sellerWithdrawn ? "已提領完成" : "尚未提領"}</p>
                        </div>
                        <div class="order-detail-block">
                            <span class="eyebrow">Settlement</span>
                            <p>託管付款：${order.payState ? "已進入 escrow" : "未付款"}</p>
                            <p>目前是否可提領：${order.completeState && !order.sellerWithdrawn ? "是" : "否"}</p>
                            <p>賣家地址：${order.seller}</p>
                        </div>
                    </div>
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
            state.orders = await core.fetchOrders();
            state.reviews = await core.fetchReviews();
            state.payouts = await core.fetchPayouts();
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
        if (action === "mark-shipped") {
            await core.saveOrderFlowStage(Number(trigger.dataset.orderId), 2);
            await loadData();
            toast("success", "已標記為出貨");
        }
        if (action === "mark-arrived") {
            await core.saveOrderFlowStage(Number(trigger.dataset.orderId), 3);
            await loadData();
            toast("success", "已標記為到貨");
        }
        if (action === "mark-waiting-pickup") {
            await core.saveOrderFlowStage(Number(trigger.dataset.orderId), 4);
            await loadData();
            toast("success", "已提醒買家取貨");
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
    }
}

async function hydrate() {
    const session = await core.initWalletState();
    state.account = session.account;
    state.chainId = session.chainId;
    state.session = session.session || null;
    state.isSeller = Boolean(state.session?.authenticated && (state.session?.isAdmin || state.session?.sellerStatus === "approved"));
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
        state.isSeller = Boolean(state.session?.authenticated && (state.session?.isAdmin || state.session?.sellerStatus === "approved"));
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
        state.isSeller = Boolean(state.session?.authenticated && (state.session?.isAdmin || state.session?.sellerStatus === "approved"));
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
