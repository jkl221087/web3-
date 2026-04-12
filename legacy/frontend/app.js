const CONTRACT_ABI = [
    "function owner() external view returns (address)",
    "function Product_ID() external view returns (uint256)",
    "function Order_ID() external view returns (uint256)",
    "function create_product(string _name, uint256 _price) external returns (uint256)",
    "function create_and_fund_order(uint256 productId, uint256 _amount) external payable returns (uint256)",
    "function complete_order(uint256 orderId) external returns (bool)",
    "function withdraw_order_funds(uint256 orderId) external returns (bool)",
    "function set_product_active(uint256 productId, bool _isActive) external returns (bool)",
    "function get_order_info(uint256 orderId) external view returns ((uint256 orderId, uint256 productId, address buy_user, address sell_user, uint256 amount, bool pay_state, bool complete_state, bool seller_withdrawn))",
    "function get_product_info(uint256 productId) external view returns ((uint256 productId, address seller, string name, uint256 price, bool isActive))",
    "function get_contract_balance() external view returns (uint256)"
];

const STORAGE_KEY = "web3-basics-contract-address";
const CART_STORAGE_KEY = "web3-basics-cart";

const state = {
    provider: null,
    signer: null,
    contract: null,
    currentAccount: null,
    ownerAddress: null,
    validatedAddress: null,
    balanceTimer: null,
    products: [],
    orders: [],
    cart: [],
    search: "",
    filter: "active",
    isCartOpen: false
};

const dom = {
    connectButton: document.getElementById("connectButton"),
    switchNetworkButton: document.getElementById("switchNetworkButton"),
    cartToggleButton: document.getElementById("cartToggleButton"),
    cartCloseButton: document.getElementById("cartCloseButton"),
    drawerBackdrop: document.getElementById("drawerBackdrop"),
    cartDrawer: document.getElementById("cartDrawer"),
    cartItems: document.getElementById("cartItems"),
    cartCount: document.getElementById("cartCount"),
    cartQuantity: document.getElementById("cartQuantity"),
    cartTotal: document.getElementById("cartTotal"),
    checkoutButton: document.getElementById("checkoutButton"),
    clearCartButton: document.getElementById("clearCartButton"),
    contractAddress: document.getElementById("contractAddress"),
    activeContractAddress: document.getElementById("activeContractAddress"),
    refreshBalanceButton: document.getElementById("refreshBalanceButton"),
    contractBalance: document.getElementById("contractBalance"),
    walletAddress: document.getElementById("walletAddress"),
    chainId: document.getElementById("chainId"),
    heroProductCount: document.getElementById("heroProductCount"),
    heroOrderCount: document.getElementById("heroOrderCount"),
    heroEscrowBalance: document.getElementById("heroEscrowBalance"),
    searchInput: document.getElementById("searchInput"),
    catalogFilter: document.getElementById("catalogFilter"),
    catalogGrid: document.getElementById("catalogGrid"),
    ordersGrid: document.getElementById("ordersGrid"),
    sellerProductsGrid: document.getElementById("sellerProductsGrid"),
    reloadOrdersButton: document.getElementById("reloadOrdersButton"),
    createProductForm: document.getElementById("createProductForm"),
    productName: document.getElementById("productName"),
    productPrice: document.getElementById("productPrice"),
    statusLog: document.getElementById("statusLog"),
    clearLogButton: document.getElementById("clearLogButton"),
    emptyStateTemplate: document.getElementById("emptyStateTemplate")
};

function cloneEmptyState(title = "目前沒有資料", text = "等你連接錢包並重新整理後，這裡會顯示鏈上的內容。") {
    const node = dom.emptyStateTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector("strong").textContent = title;
    node.querySelector("p").textContent = text;
    return node;
}

function logStatus(type, message) {
    const entry = document.createElement("article");
    entry.className = `log-entry ${type}`;

    const time = document.createElement("small");
    time.textContent = new Date().toLocaleString("zh-TW");

    const content = document.createElement("div");
    content.textContent = message;

    entry.append(time, content);
    dom.statusLog.prepend(entry);
}

function formatAddress(address) {
    if (!address) return "-";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatEtherValue(value) {
    return `${Number(ethers.formatEther(value)).toFixed(4)} ETH`;
}

function parseEthInput(value) {
    if (!value || Number(value) <= 0) {
        throw new Error("請輸入大於 0 的 ETH 金額");
    }

    return ethers.parseEther(value);
}

function isSameAddress(a, b) {
    return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

function setContractAddressValue(address) {
    dom.contractAddress.value = address || "";
    dom.activeContractAddress.textContent = address ? formatAddress(address) : "未設定";
}

function getContractAddress() {
    const value = dom.contractAddress.value.trim();

    if (!ethers.isAddress(value)) {
        throw new Error("請先輸入正確的合約地址");
    }

    return value;
}

function getConfiguredContractAddress() {
    const configured = window.APP_CONFIG?.DEFAULT_CONTRACT_ADDRESS?.trim() || "";
    const stored = window.localStorage.getItem(STORAGE_KEY)?.trim() || "";

    if (ethers.isAddress(configured)) return configured;
    if (ethers.isAddress(stored)) return stored;
    return "";
}

function persistContractAddress() {
    const value = dom.contractAddress.value.trim();
    if (ethers.isAddress(value)) {
        window.localStorage.setItem(STORAGE_KEY, value);
        setContractAddressValue(value);
    }
}

function clearStoredContractAddress() {
    window.localStorage.removeItem(STORAGE_KEY);
}

function persistCart() {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state.cart));
}

function restoreCart() {
    try {
        const saved = JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) || "[]");
        state.cart = Array.isArray(saved) ? saved : [];
    } catch {
        state.cart = [];
    }
}

async function verifyContractAddress(address) {
    if (!state.provider || !window.ethereum) {
        throw new Error("請先連接 MetaMask");
    }

    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    const expectedChainId = window.APP_CONFIG?.EXPECTED_CHAIN_ID?.trim();

    if (expectedChainId && chainId.toLowerCase() !== expectedChainId.toLowerCase()) {
        throw new Error(`目前錢包鏈為 ${chainId}，請切換到部署合約的鏈 ${expectedChainId}`);
    }

    const code = await window.ethereum.request({
        method: "eth_getCode",
        params: [address, "latest"]
    });

    if (!code || code === "0x") {
        clearStoredContractAddress();
        throw new Error(`這個地址在目前鏈 ${chainId} 上查不到合約，請確認部署地址與網路`);
    }
}

async function ensureContract() {
    if (!window.ethereum) {
        throw new Error("請先安裝 MetaMask");
    }

    if (!state.signer || !state.provider) {
        throw new Error("請先連接 MetaMask");
    }

    const address = getContractAddress();

    if (!state.contract || state.contract.target?.toLowerCase() !== address.toLowerCase()) {
        await verifyContractAddress(address);
        state.contract = new ethers.Contract(address, CONTRACT_ABI, state.signer);
        state.validatedAddress = null;
    }

    if (state.validatedAddress !== address.toLowerCase()) {
        await state.contract.get_contract_balance();
        state.validatedAddress = address.toLowerCase();
        persistContractAddress();
    }

    return state.contract;
}

async function refreshContractBalanceSafely(options = {}) {
    const { silent = false, stopPollingOnError = false } = options;

    try {
        const contract = await ensureContract();
        const balance = await contract.get_contract_balance();
        dom.contractBalance.textContent = formatEtherValue(balance);
        dom.heroEscrowBalance.textContent = formatEtherValue(balance);
        return true;
    } catch (error) {
        dom.contractBalance.textContent = "-";
        dom.heroEscrowBalance.textContent = "-";

        if (stopPollingOnError) {
            stopBalancePolling();
        }

        if (!silent && state.signer && dom.contractAddress.value.trim()) {
            logStatus("error", normalizeError(error));
        }

        return false;
    }
}

function stopBalancePolling() {
    if (state.balanceTimer) {
        window.clearInterval(state.balanceTimer);
        state.balanceTimer = null;
    }
}

function startBalancePolling() {
    stopBalancePolling();

    if (!state.signer) {
        return;
    }

    state.balanceTimer = window.setInterval(() => {
        refreshContractBalanceSafely({ stopPollingOnError: true });
    }, 10000);
}

function toProductView(product) {
    return {
        productId: Number(product.productId),
        seller: product.seller,
        name: product.name,
        priceWei: product.price,
        priceEth: ethers.formatEther(product.price),
        isActive: product.isActive
    };
}

function toOrderView(order) {
    return {
        orderId: Number(order.orderId),
        productId: Number(order.productId),
        buyer: order.buy_user,
        seller: order.sell_user,
        amountWei: order.amount,
        amountEth: ethers.formatEther(order.amount),
        pay_state: order.pay_state,
        complete_state: order.complete_state,
        seller_withdrawn: order.seller_withdrawn
    };
}

async function loadProducts(contract) {
    const total = Number(await contract.Product_ID());
    dom.heroProductCount.textContent = `${total}`;

    if (!total) {
        return [];
    }

    const results = await Promise.allSettled(
        Array.from({ length: total }, (_, index) => contract.get_product_info(index + 1))
    );

    return results
        .filter((result) => result.status === "fulfilled")
        .map((result) => toProductView(result.value));
}

async function loadOrders(contract) {
    const total = Number(await contract.Order_ID());
    dom.heroOrderCount.textContent = `${total}`;

    if (!total) {
        return [];
    }

    const results = await Promise.allSettled(
        Array.from({ length: total }, (_, index) => contract.get_order_info(index + 1))
    );

    return results
        .filter((result) => result.status === "fulfilled")
        .map((result) => toOrderView(result.value))
        .sort((a, b) => b.orderId - a.orderId);
}

async function refreshMarketplaceData(options = {}) {
    const { silentBalanceError = true } = options;

    try {
        const contract = await ensureContract();
        const [products, orders, ownerAddress] = await Promise.all([
            loadProducts(contract),
            loadOrders(contract),
            contract.owner()
        ]);

        state.products = products;
        state.orders = orders;
        state.ownerAddress = ownerAddress;

        await refreshContractBalanceSafely({ silent: silentBalanceError });
        renderEverything();
        return true;
    } catch (error) {
        renderEverything();

        if (!silentBalanceError) {
            logStatus("error", normalizeError(error));
        }

        return false;
    }
}

function getProductById(productId) {
    return state.products.find((product) => Number(product.productId) === Number(productId));
}

function getFilteredProducts() {
    const keyword = state.search.trim().toLowerCase();

    return state.products.filter((product) => {
        const matchesKeyword =
            !keyword ||
            product.name.toLowerCase().includes(keyword) ||
            product.seller.toLowerCase().includes(keyword);

        const matchesFilter =
            state.filter === "all" ||
            (state.filter === "active" && product.isActive) ||
            (state.filter === "mine" && isSameAddress(product.seller, state.currentAccount));

        return matchesKeyword && matchesFilter;
    });
}

function getCartDetailedItems() {
    return state.cart
        .map((entry) => {
            const product = getProductById(entry.productId);
            if (!product) return null;

            return {
                ...entry,
                product,
                totalWei: product.priceWei * BigInt(entry.quantity)
            };
        })
        .filter(Boolean);
}

function renderCatalog() {
    dom.catalogGrid.innerHTML = "";

    const products = getFilteredProducts();
    if (!products.length) {
        const title = state.products.length ? "找不到符合條件的商品" : "目前還沒有商品";
        dom.catalogGrid.append(cloneEmptyState(title, "先上架商品，或調整搜尋與篩選條件。"));
        return;
    }

    products.forEach((product) => {
        const ownProduct = isSameAddress(product.seller, state.currentAccount);
        const card = document.createElement("article");
        card.className = "product-card";
        card.innerHTML = `
            <div class="product-meta">
                <span>#${product.productId}</span>
                <div class="chip-row">
                    <span class="chip ${product.isActive ? "active" : "inactive"}">${product.isActive ? "販售中" : "已下架"}</span>
                    ${ownProduct ? '<span class="chip">我的商品</span>' : ""}
                </div>
            </div>
            <div>
                <h3>${product.name}</h3>
                <p class="product-description">賣家：${formatAddress(product.seller)}</p>
            </div>
            <div class="product-footer">
                <div class="price-tag">
                    <span class="mini-label">價格</span>
                    <strong>${Number(product.priceEth).toFixed(4)} ETH</strong>
                </div>
                <button class="${product.isActive ? "primary-button" : "ghost-button"}" data-action="add-to-cart" data-product-id="${product.productId}" type="button" ${product.isActive ? "" : "disabled"}>
                    ${product.isActive ? "加入購物車" : "目前不可購買"}
                </button>
            </div>
        `;
        dom.catalogGrid.append(card);
    });
}

function renderCart() {
    dom.cartItems.innerHTML = "";

    const items = getCartDetailedItems();
    const quantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalWei = items.reduce((sum, item) => sum + item.totalWei, 0n);

    dom.cartCount.textContent = `${quantity}`;
    dom.cartQuantity.textContent = `${quantity}`;
    dom.cartTotal.textContent = quantity ? formatEtherValue(totalWei) : "0 ETH";

    if (!items.length) {
        dom.cartItems.append(cloneEmptyState("購物車目前是空的", "從商品列表加入幾件商品，這裡就會變成你的 checkout 區。"));
        return;
    }

    items.forEach((item) => {
        const card = document.createElement("article");
        card.className = "cart-item";
        card.innerHTML = `
            <div class="cart-item-top">
                <div>
                    <strong>${item.product.name}</strong>
                    <div class="mini-label">#${item.product.productId} • ${Number(item.product.priceEth).toFixed(4)} ETH</div>
                </div>
                <button class="icon-button" data-action="remove-from-cart" data-product-id="${item.product.productId}" type="button">×</button>
            </div>
            <div class="cart-item-controls">
                <button class="ghost-button" data-action="decrease-qty" data-product-id="${item.product.productId}" type="button">-</button>
                <span class="qty-pill">${item.quantity}</span>
                <button class="ghost-button" data-action="increase-qty" data-product-id="${item.product.productId}" type="button">+</button>
            </div>
            <div class="summary-row">
                <span>小計</span>
                <strong>${formatEtherValue(item.totalWei)}</strong>
            </div>
        `;
        dom.cartItems.append(card);
    });
}

function renderOrders() {
    dom.ordersGrid.innerHTML = "";

    if (!state.currentAccount) {
        dom.ordersGrid.append(cloneEmptyState("請先連接錢包", "連接後就能看到你作為買家或賣家的訂單。"));
        return;
    }

    const orders = state.orders.filter(
        (order) => isSameAddress(order.buyer, state.currentAccount) || isSameAddress(order.seller, state.currentAccount)
    );

    if (!orders.length) {
        dom.ordersGrid.append(cloneEmptyState("你目前還沒有訂單", "從商品列表完成一次購買後，這裡就會出現訂單狀態。"));
        return;
    }

    orders.forEach((order) => {
        const product = getProductById(order.productId);
        const isBuyer = isSameAddress(order.buyer, state.currentAccount);
        const isSeller = isSameAddress(order.seller, state.currentAccount);
        const card = document.createElement("article");
        card.className = "order-card";
        card.innerHTML = `
            <div class="order-head">
                <div>
                    <h3>訂單 #${order.orderId}</h3>
                    <div class="mini-label">${product ? product.name : `商品 #${order.productId}`}</div>
                </div>
                <div class="order-tags">
                    <span class="chip ${order.complete_state ? "complete" : "pending"}">${order.complete_state ? "已完成" : "待完成"}</span>
                    <span class="chip ${order.seller_withdrawn ? "complete" : "pending"}">${order.seller_withdrawn ? "已提領" : "待提領"}</span>
                </div>
            </div>
            <div class="order-meta">
                <span>買家：${formatAddress(order.buyer)}</span>
                <span>賣家：${formatAddress(order.seller)}</span>
            </div>
            <div class="summary-row">
                <span>金額</span>
                <strong>${Number(order.amountEth).toFixed(4)} ETH</strong>
            </div>
            <div class="order-actions">
                ${isBuyer && !order.complete_state ? `<button class="primary-button" data-action="complete-order" data-order-id="${order.orderId}" type="button">完成訂單</button>` : ""}
                ${isSeller && order.complete_state && !order.seller_withdrawn ? `<button class="primary-button" data-action="withdraw-order" data-order-id="${order.orderId}" type="button">提領款項</button>` : ""}
                <button class="ghost-button" data-action="refresh-orders" type="button">更新狀態</button>
            </div>
        `;
        dom.ordersGrid.append(card);
    });
}

function renderSellerProducts() {
    dom.sellerProductsGrid.innerHTML = "";

    if (!state.currentAccount) {
        dom.sellerProductsGrid.append(cloneEmptyState("請先連接錢包", "連接後就能管理自己的商品與販售狀態。"));
        return;
    }

    const products = state.products.filter((product) => isSameAddress(product.seller, state.currentAccount));

    if (!products.length) {
        dom.sellerProductsGrid.append(cloneEmptyState("你還沒有商品", "用左邊的表單建立第一個商品後，這裡就會出現管理卡片。"));
        return;
    }

    products.forEach((product) => {
        const card = document.createElement("article");
        card.className = "inventory-card";
        card.innerHTML = `
            <div class="inventory-meta">
                <div>
                    <h3>${product.name}</h3>
                    <div class="mini-label">商品 #${product.productId}</div>
                </div>
                <span class="chip ${product.isActive ? "active" : "inactive"}">${product.isActive ? "販售中" : "已下架"}</span>
            </div>
            <div class="summary-row">
                <span>價格</span>
                <strong>${Number(product.priceEth).toFixed(4)} ETH</strong>
            </div>
            <div class="inventory-actions">
                <button class="ghost-button" data-action="toggle-product" data-product-id="${product.productId}" data-next-state="${product.isActive ? "false" : "true"}" type="button">
                    ${product.isActive ? "下架商品" : "重新上架"}
                </button>
                <button class="ghost-button" data-action="copy-product-id" data-product-id="${product.productId}" type="button">複製商品 ID</button>
            </div>
        `;
        dom.sellerProductsGrid.append(card);
    });
}

function renderEverything() {
    renderCatalog();
    renderCart();
    renderOrders();
    renderSellerProducts();
}

function addToCart(productId) {
    const product = getProductById(productId);

    if (!product || !product.isActive) {
        logStatus("error", "這個商品目前不可加入購物車。");
        return;
    }

    const existing = state.cart.find((item) => Number(item.productId) === Number(productId));
    if (existing) {
        existing.quantity += 1;
    } else {
        state.cart.push({ productId: Number(productId), quantity: 1 });
    }

    persistCart();
    renderCart();
    setCartOpen(true);
    logStatus("success", `已將「${product.name}」加入購物車`);
}

function updateCartQuantity(productId, nextQuantity) {
    const item = state.cart.find((entry) => Number(entry.productId) === Number(productId));
    if (!item) return;

    if (nextQuantity <= 0) {
        state.cart = state.cart.filter((entry) => Number(entry.productId) !== Number(productId));
    } else {
        item.quantity = nextQuantity;
    }

    persistCart();
    renderCart();
}

function clearCart() {
    state.cart = [];//購物車
    persistCart();
    renderCart();
}

function setCartOpen(isOpen) {
    state.isCartOpen = isOpen;
    dom.cartDrawer.classList.toggle("open", isOpen);
    dom.drawerBackdrop.classList.toggle("visible", isOpen);
}

async function checkoutCart() {
    if (!state.cart.length) {//IF購物車沒有東西
        logStatus("error", "購物車是空的，先加入商品再結帳。");
        return;
    }

    const contract = await ensureContract();
    const items = getCartDetailedItems();
    const createdOrderIds = [];

    for (const item of items) {
        for (let count = 0; count < item.quantity; count += 1) {
            logStatus("info", `正在購買 ${item.product.name}...`);
            const tx = await contract.create_and_fund_order(item.product.productId, item.product.priceWei, {
                value: item.product.priceWei
            });
            const receipt = await tx.wait();

            for (const log of receipt.logs) {
                try {
                    const parsed = contract.interface.parseLog(log);
                    if (parsed?.name === "OrderCreated") {
                        createdOrderIds.push(parsed.args.orderId.toString());
                    }
                } catch {
                    // ignore unrelated logs
                }
            }
        }
    }

    clearCart();
    setCartOpen(false);
    await refreshMarketplaceData({ silentBalanceError: false });
    logStatus("success", `結帳完成，建立訂單：${createdOrderIds.join(", ") || "請到訂單區查看"}`);
}

async function handleCreateProduct(event) {
    event.preventDefault();
    

    try {
        const contract = await ensureContract();
        const priceWei = parseEthInput(dom.productPrice.value);
        const tx = await contract.create_product(dom.productName.value.trim(), priceWei);
        await tx.wait();

        dom.createProductForm.reset();
        await refreshMarketplaceData({ silentBalanceError: false });
        logStatus("success", "商品已上架，現在會顯示在商品列表裡。");
    } catch (error) {
        logStatus("error", normalizeError(error));
    }
}

async function switchToExpectedNetwork() {
    if (!window.ethereum) {
        logStatus("error", "找不到 MetaMask，請先安裝瀏覽器錢包。");
        return;
    }
    //從前端CONFIG,JS讀取預設鏈 ID，並嘗試切換到該鏈
    //?代表如果前端沒有設定預期鏈 ID 就不切換，並顯示錯誤訊息
    //.trim()代表去除前後空白，避免使用者不小心複製貼上帶入空白導致切換失敗
    const expectedChainId = window.APP_CONFIG?.EXPECTED_CHAIN_ID?.trim();
    if (!expectedChainId) {
        logStatus("error", "前端沒有設定預期鏈 ID。");
        return;
    }

    try {
        //代表切換到指定鏈 ID 的鏈，如果使用者錢包裡沒有該鏈，MetaMask 會詢問是否要新增這個鏈的設定，使用者同意後就會自動切換過去
        await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: expectedChainId }]
        });
        logStatus("success", `已切換到鏈 ${expectedChainId}`);
    } catch (error) {
        logStatus("error", normalizeError(error));
    }
}
//代表處理商品列表、購物車、訂單區等多個區塊的按鈕點擊事件，透過 data-action 屬性來判斷使用者點擊了哪個按鈕，並執行對應的邏輯
async function handleActionClick(event) {
    //trigger代表從點擊事件的目標元素開始，往上尋找最近的具有 data-action 屬性的元素，這樣不論使用者點擊了按鈕內的哪個子元素，都能正確識別出是哪個按鈕被點擊了
    const trigger = event.target.closest("[data-action]");
    if (!trigger) return;
    //代表從觸發事件的元素上讀取 data-action、data-product-id、data-order-id、data-next-state 等屬性，這些屬性會告訴我們使用者點擊了什麼按鈕，以及相關的商品 ID 或訂單 ID，讓我們能夠知道要對哪個商品或訂單執行什麼操作
    const { action, productId, orderId, nextState } = trigger.dataset;

    try {
        if (action === "add-to-cart") {
            addToCart(Number(productId));
            return;
        }

        if (action === "remove-from-cart") {
            updateCartQuantity(Number(productId), 0);
            return;
        }

        if (action === "increase-qty") {
            const item = state.cart.find((entry) => Number(entry.productId) === Number(productId));
            updateCartQuantity(Number(productId), (item?.quantity || 0) + 1);
            return;
        }

        if (action === "decrease-qty") {
            const item = state.cart.find((entry) => Number(entry.productId) === Number(productId));
            updateCartQuantity(Number(productId), (item?.quantity || 0) - 1);
            return;
        }

        if (action === "refresh-orders") {
            await refreshMarketplaceData({ silentBalanceError: false });
            return;
        }

        if (action === "copy-product-id") {
            await navigator.clipboard.writeText(productId);
            logStatus("success", `商品 ID #${productId} 已複製。`);
            return;
        }

        const contract = await ensureContract();

        if (action === "complete-order") {
            const tx = await contract.complete_order(orderId);
            await tx.wait();
            await refreshMarketplaceData({ silentBalanceError: false });
            logStatus("success", `訂單 #${orderId} 已完成。`);
            return;
        }

        if (action === "withdraw-order") {
            const tx = await contract.withdraw_order_funds(orderId);
            await tx.wait();
            await refreshMarketplaceData({ silentBalanceError: false });
            logStatus("success", `訂單 #${orderId} 已提領款項。`);
            return;
        }

        if (action === "toggle-product") {
            const tx = await contract.set_product_active(productId, nextState === "true");
            await tx.wait();
            await refreshMarketplaceData({ silentBalanceError: false });
            logStatus("success", `商品 #${productId} 狀態已更新。`);
        }
    } catch (error) {
        logStatus("error", normalizeError(error));
    }
}

function normalizeError(error) {
    const rawMessage =
        error?.reason ||
        error?.shortMessage ||
        error?.info?.error?.message ||
        error?.message ||
        "發生未知錯誤";

    if (rawMessage.includes("require(false)")) {
        return "目前地址上的合約和前端 ABI 不相容，請確認你填的是最新版部署合約地址。";
    }

    if (rawMessage.includes("could not decode result data")) {
        return "目前地址上的合約不是這個前端對應的版本，請確認合約地址和網路是否正確。";
    }

    if (rawMessage.includes("missing revert data")) {
        return "合約呼叫失敗，但節點沒有回傳原因。通常是地址錯誤、鏈錯誤，或部署的不是這個版本。";
    }

    if (rawMessage.includes("查不到合約") || rawMessage.includes("目前錢包鏈為")) {
        return rawMessage;
    }

    if (rawMessage.includes("user rejected")) {
        return "你取消了錢包簽署。";
    }

    return rawMessage.replace(/^execution reverted: /, "");
}

function bindEvents() {
    const initialContractAddress = getConfiguredContractAddress();
    if (initialContractAddress) {
        setContractAddressValue(initialContractAddress);
    }

    restoreCart();
    renderEverything();

    dom.connectButton.addEventListener("click", connectWallet);
    dom.switchNetworkButton.addEventListener("click", switchToExpectedNetwork);
    dom.cartToggleButton.addEventListener("click", () => setCartOpen(true));
    dom.cartCloseButton.addEventListener("click", () => setCartOpen(false));
    dom.drawerBackdrop.addEventListener("click", () => setCartOpen(false));
    dom.checkoutButton.addEventListener("click", async () => {
        try {
            await checkoutCart();
        } catch (error) {
            logStatus("error", normalizeError(error));
        }
    });
    dom.clearCartButton.addEventListener("click", clearCart);
    dom.refreshBalanceButton.addEventListener("click", async () => {
        const ok = await refreshMarketplaceData({ silentBalanceError: false });
        if (ok) logStatus("success", "商店資料已更新");
    });
    dom.reloadOrdersButton.addEventListener("click", async () => {
        const ok = await refreshMarketplaceData({ silentBalanceError: false });
        if (ok) logStatus("success", "訂單資料已更新");
    });
    dom.createProductForm.addEventListener("submit", handleCreateProduct);
    dom.searchInput.addEventListener("input", (event) => {
        state.search = event.target.value;
        renderCatalog();
    });
    dom.catalogFilter.addEventListener("change", (event) => {
        state.filter = event.target.value;
        renderCatalog();
    });
    dom.contractAddress.addEventListener("change", async () => {
        state.contract = null;
        state.validatedAddress = null;
        setContractAddressValue(dom.contractAddress.value.trim());
        await refreshMarketplaceData({ silentBalanceError: false });
    });
    dom.contractAddress.addEventListener("blur", async () => {
        state.contract = null;
        state.validatedAddress = null;
        setContractAddressValue(dom.contractAddress.value.trim());
        await refreshMarketplaceData({ silentBalanceError: false });
    });
    dom.catalogGrid.addEventListener("click", handleActionClick);
    dom.cartItems.addEventListener("click", handleActionClick);
    dom.ordersGrid.addEventListener("click", handleActionClick);
    dom.sellerProductsGrid.addEventListener("click", handleActionClick);
    dom.clearLogButton.addEventListener("click", () => {
        dom.statusLog.innerHTML = "";
    });

    if (window.ethereum) {
        window.ethereum.on("accountsChanged", () => location.reload());
        window.ethereum.on("chainChanged", () => location.reload());
    }
}

async function connectWallet() {
    if (!window.ethereum) {
        logStatus("error", "找不到 MetaMask，請先安裝瀏覽器錢包。");
        return;
    }

    state.provider = new ethers.BrowserProvider(window.ethereum);
    await state.provider.send("eth_requestAccounts", []);
    state.signer = await state.provider.getSigner();
    state.currentAccount = await state.signer.getAddress();
    state.contract = null;

    const network = await state.provider.getNetwork();
    dom.walletAddress.textContent = `${formatAddress(state.currentAccount)} (${state.currentAccount})`;
    dom.chainId.textContent = `${network.chainId.toString()}`;

    logStatus("success", `已連接錢包 ${state.currentAccount}`);

    const ok = await refreshMarketplaceData({ silentBalanceError: false });
    startBalancePolling();

    if (ok) {
        logStatus("success", "商店資料已同步");
    }
}

bindEvents();
logStatus("info", "電商前台已載入。先連接 MetaMask，然後就能像逛商店一樣測試商品、購物車與結帳。");
