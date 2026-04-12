(function () {
    const CONTRACT_ABI = [
        "function owner() external view returns (address)",
        "function Order_ID() external view returns (uint256)",
        "function payment_token() external view returns (address)",
        "function create_and_fund_order(address seller, uint256 _amount) external returns (uint256)",
        "function complete_order(uint256 orderId) external returns (bool)",
        "function confirm_order_received(uint256 orderId) external returns (bool)",
        "function withdraw_order_funds(uint256 orderId) external returns (bool)",
        "function get_order_info(uint256 orderId) external view returns ((uint256 orderId, address buy_user, address sell_user, uint256 amount, bool pay_state, bool complete_state, bool seller_withdrawn))",
        "function get_contract_balance() external view returns (uint256)",
        "event OrderCreated(uint256 indexed orderId, address indexed buyer, address indexed seller, uint256 amount)"
    ];
    const PAYMENT_TOKEN_ABI = [
        "function symbol() external view returns (string)",
        "function decimals() external view returns (uint8)",
        "function balanceOf(address account) external view returns (uint256)",
        "function allowance(address owner, address spender) external view returns (uint256)",
        "function approve(address spender, uint256 amount) external returns (bool)"
    ];

    const CONTRACT_KEY = "fashion-store-contract-address";
    const CART_KEY = "fashion-store-cart";
    const FAVORITES_KEY = "fashion-store-favorites";
    const RECENTLY_VIEWED_KEY = "fashion-store-recently-viewed";
    const CATEGORY_OPTIONS = [
        { id: "all", label: "全部商品" },
        { id: "mens", label: "男裝" },
        { id: "womens", label: "女裝" },
        { id: "kids", label: "孩童" },
        { id: "summer", label: "夏季" },
        { id: "autumn", label: "秋季" },
        { id: "winter", label: "冬季" }
    ];

    const STYLE_OPTIONS = ["上衣", "外套", "洋裝", "褲裝", "針織", "配件"];
    const SEASON_OPTIONS = ["四季", "夏季", "秋季", "冬季"];
    const DEPARTMENT_OPTIONS = ["男裝", "女裝", "孩童"];
    const ORDER_STAGE_META = {
        0: { label: "未建立", tone: "muted", description: "訂單尚未建立。" },
        1: { label: "已付款", tone: "info", description: "買家已付款，款項由合約託管。" },
        2: { label: "已出貨", tone: "info", description: "賣家已出貨，等待物流到站。" },
        3: { label: "已到貨", tone: "info", description: "物流已到站，可進入提醒取貨。" },
        4: { label: "等待取貨", tone: "warn", description: "賣家已提醒取貨，等待買家確認。" },
        5: { label: "已取貨", tone: "success", description: "買家已確認收貨，賣家可提領。" },
        6: { label: "已完成", tone: "success", description: "賣家已提領，訂單完成。" }
    };

    const PALETTES = {
        "男裝": ["#1f3655", "#4c77a8", "#dbe8ff"],
        "女裝": ["#52305f", "#c48ad9", "#f4e7ff"],
        "孩童": ["#25516a", "#8dd1ff", "#dff6ff"]
    };

    const runtime = {
        provider: null,
        signer: null,
        contract: null,
        paymentTokenContract: null,
        paymentTokenAddress: null,
        paymentTokenMeta: null,
        validatedAddress: null,
        currentAccount: null,
        session: null
    };

    function parseJson(key, fallback) {
        try {
            const value = window.localStorage.getItem(key);
            return value ? JSON.parse(value) : fallback;
        } catch {
            return fallback;
        }
    }

    function writeJson(key, value) {
        window.localStorage.setItem(key, JSON.stringify(value));
    }

    async function apiRequest(path, options = {}) {
        const headers = new window.Headers(options.headers || {});
        const authActor = options.authActor === false ? "" : (runtime.currentAccount || "");
        if (authActor) {
            headers.set("x-actor-address", authActor);
        }
        if (!(options.body instanceof window.FormData) && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }

        const response = await window.fetch(path, {
            ...options,
            credentials: "same-origin",
            headers
        });

        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload.error || "API request failed");
        }

        return response.json();
    }

    function getConfiguredContractAddress() {
        const configured = window.APP_CONFIG?.DEFAULT_CONTRACT_ADDRESS?.trim() || "";
        const stored = window.localStorage.getItem(CONTRACT_KEY)?.trim() || "";

        if (window.ethers?.isAddress(configured)) return configured;
        if (window.ethers?.isAddress(stored)) return stored;
        return "";
    }

    function setStoredContractAddress(address) {
        if (window.ethers?.isAddress(address)) {
            window.localStorage.setItem(CONTRACT_KEY, address);
        }
    }

    function clearStoredContractAddress() {
        window.localStorage.removeItem(CONTRACT_KEY);
    }

    function getFallbackPaymentTokenMeta() {
        return {
            symbol: String(window.APP_CONFIG?.PAYMENT_TOKEN_SYMBOL || "USDT").trim() || "USDT",
            decimals: Number(window.APP_CONFIG?.PAYMENT_TOKEN_DECIMALS || 6)
        };
    }

    function normalizeMeta(meta) {
        const toList = (value, fallback) => {
            if (Array.isArray(value)) {
                const cleaned = value.map((item) => String(item).trim()).filter(Boolean);
                return cleaned.length ? [...new Set(cleaned)] : fallback;
            }

            if (typeof value === "string") {
                const cleaned = value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean);
                return cleaned.length ? [...new Set(cleaned)] : fallback;
            }

            return fallback;
        };

        const stock = Number(meta?.stock);
        return {
            mainCategory: "服裝",
            department: DEPARTMENT_OPTIONS.includes(meta?.department) ? meta.department : "女裝",
            season: SEASON_OPTIONS.includes(meta?.season) ? meta.season : "四季",
            style: STYLE_OPTIONS.includes(meta?.style) ? meta.style : "上衣",
            imageUrl: meta?.imageUrl?.trim() || "",
            description: meta?.description?.trim() || "",
            sizes: toList(meta?.sizes, ["S", "M", "L"]),
            colors: toList(meta?.colors, ["奶油白"]),
            stock: Number.isFinite(stock) && stock >= 0 ? Math.floor(stock) : 1
        };
    }

    function inferMetaFromName(name) {
        const lower = name.toLowerCase();
        const department = lower.includes("男") ? "男裝" : lower.includes("童") ? "孩童" : "女裝";
        const season = lower.includes("冬") ? "冬季" : lower.includes("秋") ? "秋季" : lower.includes("夏") ? "夏季" : "四季";
        const style = lower.includes("外套") ? "外套" : lower.includes("裙") ? "洋裝" : lower.includes("褲") ? "褲裝" : lower.includes("針織") ? "針織" : lower.includes("包") ? "配件" : "上衣";
        return normalizeMeta({ department, season, style });
    }

    function normalizeCartEntry(entry) {
        return {
            productId: Number(entry?.productId) || 0,
            quantity: Math.max(1, Number(entry?.quantity) || 1),
            size: String(entry?.size || "").trim(),
            color: String(entry?.color || "").trim()
        };
    }

    function getCart() {
        const cart = parseJson(CART_KEY, []);
        return Array.isArray(cart)
            ? cart.map((entry) => normalizeCartEntry(entry)).filter((entry) => entry.productId > 0)
            : [];
    }

    function saveCart(cart) {
        writeJson(CART_KEY, cart.map((entry) => normalizeCartEntry(entry)));
    }

    function buildCartEntryKey(entry) {
        const normalized = normalizeCartEntry(entry);
        return `${normalized.productId}::${normalized.size}::${normalized.color}`;
    }

    function formatVariantLabel(size, color) {
        const parts = [];
        if (size) parts.push(`尺寸 ${size}`);
        if (color) parts.push(`顏色 ${color}`);
        return parts.join(" / ");
    }

    function buildOrderProductTitle(name, size, color) {
        const variant = formatVariantLabel(size, color);
        return variant ? `${name} (${variant})` : name;
    }

    function getFavoriteProductIds() {
        const favorites = parseJson(FAVORITES_KEY, []);
        return Array.isArray(favorites) ? favorites.map((item) => Number(item)).filter(Boolean) : [];
    }

    function isFavoriteProduct(productId) {
        return getFavoriteProductIds().includes(Number(productId));
    }

    function toggleFavoriteProduct(productId) {
        const target = Number(productId);
        const favorites = getFavoriteProductIds();
        const next = favorites.includes(target)
            ? favorites.filter((item) => item !== target)
            : [target, ...favorites].slice(0, 24);
        writeJson(FAVORITES_KEY, next);
        return next;
    }

    function getRecentlyViewedProductIds() {
        const items = parseJson(RECENTLY_VIEWED_KEY, []);
        return Array.isArray(items) ? items.map((item) => Number(item)).filter(Boolean) : [];
    }

    function pushRecentlyViewedProduct(productId) {
        const target = Number(productId);
        const current = getRecentlyViewedProductIds().filter((item) => item !== target);
        const next = [target, ...current].slice(0, 18);
        writeJson(RECENTLY_VIEWED_KEY, next);
        return next;
    }

    async function fetchOrderRecords() {
        const store = await apiRequest("/api/orders");
        return typeof store === "object" && store ? store : {};
    }

    async function fetchReviews() {
        const reviews = await apiRequest("/api/reviews");
        return Array.isArray(reviews) ? reviews : [];
    }

    async function saveReview(input) {
        return apiRequest("/api/reviews", {
            method: "POST",
            body: JSON.stringify({
                orderId: Number(input.orderId) || 0,
                productId: Number(input.productId) || 0,
                productName: input.productName || "",
                seller: input.seller || "",
                buyer: input.buyer || "",
                rating: Number(input.rating) || 0,
                comment: input.comment || "",
                createdAt: input.createdAt || new Date().toISOString()
            })
        });
    }

    async function fetchPayouts() {
        const payouts = await apiRequest("/api/payouts");
        return Array.isArray(payouts) ? payouts : [];
    }

    async function savePayout(input) {
        return apiRequest("/api/payouts", {
            method: "POST",
            body: JSON.stringify({
                orderId: Number(input.orderId) || 0,
                seller: input.seller || "",
                buyer: input.buyer || "",
                productId: Number(input.productId) || 0,
                productName: input.productName || "",
                amountWei: input.amountWei?.toString?.() || String(input.amountWei || "0"),
                txHash: input.txHash || "",
                createdAt: input.createdAt || new Date().toISOString()
            })
        });
    }

    async function uploadProductImage(file) {
        const formData = new window.FormData();
        formData.append("image", file);
        return apiRequest("/api/uploads/product-image", {
            method: "POST",
            body: formData
        });
    }

    async function getOrderFlowStage(orderId) {
        const store = await fetchOrderRecords();
        return Number(store[String(orderId)]?.flowStage || 1);
    }

    async function saveOrderFlowStage(orderId, stage) {
        // Stage 5（已取貨）與 6（已完成）由合約事件驅動，API 只負責 1–4 物流節點
        const nextStage = Math.max(1, Math.min(4, Number(stage) || 1));
        return apiRequest(`/api/orders/${orderId}/flow`, {
            method: "PATCH",
            body: JSON.stringify({ flowStage: nextStage })
        });
    }

    function deserializeProduct(record) {
        const priceWei = BigInt(record.priceWei);
        const meta = normalizeMeta(record.meta);
        const result = {
            productId: Number(record.productId),
            seller: record.seller,
            name: record.name,
            priceWei,
            priceDisplay: formatEth(priceWei),
            isActive: Boolean(record.isActive),
            meta
        };
        result.image = buildPlaceholderImage(result);
        return result;
    }

    async function fetchProducts() {
        const products = await apiRequest("/api/products");
        return products
            .map((record) => deserializeProduct(record))
            .sort((a, b) => b.productId - a.productId);
    }

    async function createMockProduct(input) {
        const product = await apiRequest("/api/products", {
            method: "POST",
            body: JSON.stringify({
                seller: input.seller,
                name: input.name.trim(),
                priceWei: input.priceWei.toString(),
                meta: normalizeMeta(input.meta)
            })
        });
        return deserializeProduct(product);
    }

    async function updateMockProduct(productId, input) {
        const payload = {};

        if (Object.prototype.hasOwnProperty.call(input, "name")) {
            payload.name = String(input.name || "").trim();
        }
        if (Object.prototype.hasOwnProperty.call(input, "priceWei")) {
            payload.priceWei = input.priceWei?.toString?.() || String(input.priceWei || "0");
        }
        if (Object.prototype.hasOwnProperty.call(input, "isActive")) {
            payload.isActive = Boolean(input.isActive);
        }
        if (Object.prototype.hasOwnProperty.call(input, "meta")) {
            payload.meta = normalizeMeta(input.meta);
        }

        const updated = await apiRequest(`/api/products/${productId}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        });
        return deserializeProduct(updated);
    }

    async function setMockProductActive(productId, isActive) {
        return updateMockProduct(productId, { isActive });
    }

    async function getOwnerAddress() {
        if (!getConfiguredContractAddress()) return null;
        try {
            const contract = await ensureContract();
            return await contract.owner();
        } catch {
            return null;
        }
    }

    async function fetchSellerProfile(address) {
        if (!address || !window.ethers?.isAddress(address)) {
            return { approved: false, pending: false, isContractOwner: false };
        }

        const lower = address.toLowerCase();
        const session = runtime.session;
        if (
            session?.authenticated &&
            session.address &&
            session.address.toLowerCase() === lower
        ) {
            return {
                approved: Boolean(session.isAdmin || session.sellerStatus === "approved"),
                pending: session.sellerStatus === "pending",
                isContractOwner: Boolean(session.isAdmin)
            };
        }

        const ownerAddress = await getOwnerAddress();
        const ownerLower = ownerAddress?.toLowerCase() || "";
        const store = await apiRequest("/api/sellers");
        const approved = Array.isArray(store.approved) ? store.approved : [];
        const pending = Array.isArray(store.pending) ? store.pending : [];

        return {
            approved: lower === ownerLower || approved.some((item) => item.toLowerCase() === lower),
            pending: pending.some((item) => item.toLowerCase() === lower),
            isContractOwner: lower === ownerLower
        };
    }

    async function fetchSellerRequests() {
        const store = await apiRequest("/api/sellers");
        return (Array.isArray(store.pending) ? store.pending : []).sort((a, b) => a.localeCompare(b));
    }

    async function fetchSellersStore() {
        const store = await apiRequest("/api/sellers");
        return {
            approved: Array.isArray(store.approved) ? store.approved : [],
            pending: Array.isArray(store.pending) ? store.pending : []
        };
    }

    async function requestSellerAccess(address) {
        return apiRequest("/api/sellers/request", {
            method: "POST",
            body: JSON.stringify({ address })
        });
    }

    async function approveSellerAccess(address, approved = true) {
        return apiRequest("/api/sellers/approve", {
            method: "POST",
            body: JSON.stringify({ address, approved })
        });
    }

    async function fetchAdminAuditLogs() {
        return apiRequest("/api/admin/audit", {
            method: "GET"
        });
    }

    async function saveOrderMeta(orderId, meta) {
        return apiRequest("/api/orders", {
            method: "POST",
            body: JSON.stringify({
                orderId,
                productId: Number(meta.productId) || 0,
                productName: meta.productName || "",
                productSeller: meta.productSeller || "",
                priceWei: meta.priceWei?.toString?.() || String(meta.priceWei || "0"),
                flowStage: Number(meta.flowStage || 1)
            })
        });
    }

    function formatAddress(address) {
        if (!address) return "-";
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    function formatEth(value) {
        const meta = runtime.paymentTokenMeta || getFallbackPaymentTokenMeta();
        const fractionDigits = meta.decimals >= 4 ? 4 : meta.decimals;
        return `${Number(window.ethers.formatUnits(value, meta.decimals)).toFixed(fractionDigits)} ${meta.symbol}`;
    }

    function parsePaymentAmount(value) {
        const meta = runtime.paymentTokenMeta || getFallbackPaymentTokenMeta();
        return window.ethers.parseUnits(String(value || "0"), meta.decimals);
    }

    function escapeXml(value) {
        return value.replace(/[<>&'"]/g, (char) => ({
            "<": "&lt;",
            ">": "&gt;",
            "&": "&amp;",
            "'": "&apos;",
            '"': "&quot;"
        }[char]));
    }

    function buildPlaceholderImage(product) {
        if (product.meta.imageUrl) {
            return product.meta.imageUrl;
        }

        const [bg, accent, textBg] = PALETTES[product.meta.department] || PALETTES["女裝"];
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="900" height="1100" viewBox="0 0 900 1100">
                <defs>
                    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="${bg}" />
                        <stop offset="100%" stop-color="${accent}" />
                    </linearGradient>
                </defs>
                <rect width="900" height="1100" rx="42" fill="url(#g)" />
                <rect x="48" y="48" width="804" height="1004" rx="40" fill="rgba(255,255,255,0.12)" />
                <circle cx="730" cy="218" r="120" fill="rgba(255,255,255,0.09)" />
                <circle cx="190" cy="868" r="170" fill="rgba(255,255,255,0.08)" />
                <text x="88" y="150" fill="rgba(255,255,255,0.82)" font-family="Arial" font-size="32">FASHION DROP</text>
                <text x="88" y="250" fill="white" font-family="Arial" font-size="76" font-weight="700">${escapeXml(product.meta.department)}</text>
                <text x="88" y="332" fill="white" font-family="Arial" font-size="50">${escapeXml(product.meta.season)} / ${escapeXml(product.meta.style)}</text>
                <rect x="88" y="764" width="724" height="188" rx="30" fill="${textBg}" />
                <text x="120" y="844" fill="${bg}" font-family="Arial" font-size="58" font-weight="700">${escapeXml(product.name)}</text>
                <text x="120" y="906" fill="${bg}" font-family="Arial" font-size="30">Glass Store Selection</text>
            </svg>
        `;

        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    }

    function getOrderStageMeta(stage) {
        return ORDER_STAGE_META[Number(stage)] || ORDER_STAGE_META[0];
    }

    async function fetchSessionProfile() {
        const session = await apiRequest("/api/me", {
            method: "GET",
            authActor: false
        });
        runtime.session = session;
        return session;
    }

    async function signInWithBackend() {
        if (!runtime.signer || !runtime.currentAccount) {
            throw new Error("請先連接 MetaMask");
        }

        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        const noncePayload = await apiRequest("/api/auth/nonce", {
            method: "POST",
            authActor: false,
            body: JSON.stringify({
                address: runtime.currentAccount,
                chainId
            })
        });

        const signature = await runtime.signer.signMessage(noncePayload.message);
        const session = await apiRequest("/api/auth/verify", {
            method: "POST",
            authActor: false,
            body: JSON.stringify({
                address: runtime.currentAccount,
                message: noncePayload.message,
                signature
            })
        });

        runtime.session = session;
        return session;
    }

    async function logoutBackendSession() {
        runtime.session = null;
        return apiRequest("/api/auth/logout", {
            method: "POST",
            authActor: false,
            body: JSON.stringify({})
        });
    }

    function getSessionSnapshot() {
        return runtime.session;
    }

    async function initWalletState() {
        if (!window.ethereum) {
            return { account: null, chainId: null, session: null };
        }

        if (!runtime.provider) {
            runtime.provider = new window.ethers.BrowserProvider(window.ethereum);
        }

        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        const chainId = await window.ethereum.request({ method: "eth_chainId" });

        if (accounts[0]) {
            runtime.signer = await runtime.provider.getSigner();
            runtime.currentAccount = accounts[0];
        }

        runtime.session = await fetchSessionProfile().catch(() => null);

        if (
            runtime.currentAccount &&
            runtime.session?.authenticated &&
            runtime.session.address &&
            runtime.session.address.toLowerCase() !== runtime.currentAccount.toLowerCase()
        ) {
            runtime.session = null;
        }

        return { account: runtime.currentAccount, chainId, session: runtime.session };
    }

    async function verifyContractAddress(address) {
        if (!window.ethereum || !runtime.provider) {
            throw new Error("請先安裝並連接 MetaMask");
        }

        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        const expected = window.APP_CONFIG?.EXPECTED_CHAIN_ID?.trim();

        if (expected && chainId.toLowerCase() !== expected.toLowerCase()) {
            throw new Error(`目前錢包鏈為 ${chainId}，請切換到部署合約的鏈 ${expected}`);
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

    async function ensureContract(options = {}) {
        const { requireSigner = false } = options;

        if (!window.ethereum) {
            throw new Error("請先安裝 MetaMask");
        }

        if (!runtime.provider) {
            runtime.provider = new window.ethers.BrowserProvider(window.ethereum);
        }

        const address = getConfiguredContractAddress();
        if (!window.ethers.isAddress(address)) {
            throw new Error("請先設定正確的合約地址");
        }

        const targetSigner = requireSigner ? runtime.signer : runtime.provider;
        if (requireSigner && !targetSigner) {
            throw new Error("請先連接 MetaMask");
        }

        if (!runtime.contract || runtime.contract.target?.toLowerCase() !== address.toLowerCase()) {
            await verifyContractAddress(address);
            runtime.contract = new window.ethers.Contract(address, CONTRACT_ABI, targetSigner);
            runtime.paymentTokenContract = null;
            runtime.paymentTokenAddress = null;
            runtime.paymentTokenMeta = null;
            runtime.validatedAddress = null;
        } else if (requireSigner && runtime.contract.runner !== runtime.signer) {
            runtime.contract = runtime.contract.connect(runtime.signer);
        }

        if (runtime.validatedAddress !== address.toLowerCase()) {
            await runtime.contract.payment_token();
            await runtime.contract.get_contract_balance();
            runtime.validatedAddress = address.toLowerCase();
            setStoredContractAddress(address);
        }

        return runtime.contract;
    }

    async function connectWallet() {
        if (!window.ethereum) {
            throw new Error("請先安裝 MetaMask");
        }

        if (!runtime.provider) {
            runtime.provider = new window.ethers.BrowserProvider(window.ethereum);
        }

        await runtime.provider.send("eth_requestAccounts", []);
        runtime.signer = await runtime.provider.getSigner();
        runtime.currentAccount = await runtime.signer.getAddress();
        runtime.contract = null;
        runtime.paymentTokenContract = null;
        runtime.paymentTokenAddress = null;
        runtime.paymentTokenMeta = null;
        runtime.validatedAddress = null;

        const chainId = await window.ethereum.request({ method: "eth_chainId" });
        await signInWithBackend();
        return { account: runtime.currentAccount, chainId, session: runtime.session };
    }

    async function switchToExpectedNetwork() {
        if (!window.ethereum) {
            throw new Error("請先安裝 MetaMask");
        }

        const expected = window.APP_CONFIG?.EXPECTED_CHAIN_ID?.trim();
        if (!expected) {
            throw new Error("目前沒有設定預期鏈 ID");
        }

        await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: expected }]
        });
    }

    function serializeOrder(order) {
        const orderId = Number(order.orderId);
        const stage = order.seller_withdrawn ? 6 : order.complete_state ? 5 : Number(order.flowStage || 1);
        const stageMeta = getOrderStageMeta(stage);

        return {
            orderId,
            productId: Number(order.productId || 0),
            productName: order.productName || "",
            buyer: order.buy_user,
            seller: order.sell_user,
            amountWei: order.amount,
            amountDisplay: formatEth(order.amount),
            payState: order.pay_state,
            completeState: order.complete_state,
            sellerWithdrawn: order.seller_withdrawn,
            stage,
            stageLabel: stageMeta.label,
            stageDescription: stageMeta.description,
            stageTone: stageMeta.tone
        };
    }

    async function fetchOrders() {
        const contract = await ensureContract();
        const total = Number(await contract.Order_ID());

        if (!total) {
            return [];
        }

        const orderRecords = await fetchOrderRecords();
        const results = await Promise.allSettled(
            Array.from({ length: total }, (_, index) => contract.get_order_info(index + 1))
        );

        return results
            .filter((result) => result.status === "fulfilled")
            .map((result) => {
                const order = result.value;
                const orderId = Number(order.orderId);
                const record = orderRecords[String(orderId)] || {};
                return serializeOrder({
                    orderId,
                    buy_user: order.buy_user,
                    sell_user: order.sell_user,
                    amount: order.amount,
                    pay_state: order.pay_state,
                    complete_state: order.complete_state,
                    seller_withdrawn: order.seller_withdrawn,
                    productId: Number(record.productId || 0),
                    productName: record.productName || "",
                    productSeller: record.productSeller || "",
                    flowStage: Number(record.flowStage || 1)
                });
            })
            .sort((a, b) => b.orderId - a.orderId);
    }

    async function ensurePaymentToken(options = {}) {
        const { requireSigner = false } = options;
        const contract = await ensureContract({ requireSigner });
        const tokenAddress = await contract.payment_token();
        const targetRunner = requireSigner ? runtime.signer : runtime.provider;

        if (
            !runtime.paymentTokenContract ||
            runtime.paymentTokenAddress?.toLowerCase() !== tokenAddress.toLowerCase()
        ) {
            runtime.paymentTokenContract = new window.ethers.Contract(
                tokenAddress,
                PAYMENT_TOKEN_ABI,
                targetRunner
            );
            runtime.paymentTokenAddress = tokenAddress;
            runtime.paymentTokenMeta = null;
        } else if (requireSigner && runtime.paymentTokenContract.runner !== runtime.signer) {
            runtime.paymentTokenContract = runtime.paymentTokenContract.connect(runtime.signer);
        }

        if (!runtime.paymentTokenMeta) {
            const fallback = getFallbackPaymentTokenMeta();
            const [symbolResult, decimalsResult] = await Promise.allSettled([
                runtime.paymentTokenContract.symbol(),
                runtime.paymentTokenContract.decimals()
            ]);

            runtime.paymentTokenMeta = {
                symbol: symbolResult.status === "fulfilled" ? symbolResult.value : fallback.symbol,
                decimals: decimalsResult.status === "fulfilled" ? Number(decimalsResult.value) : fallback.decimals
            };
        }

        return runtime.paymentTokenContract;
    }

    async function fetchPaymentTokenMeta() {
        await ensurePaymentToken();
        return runtime.paymentTokenMeta || getFallbackPaymentTokenMeta();
    }

    async function ensurePaymentTokenApproval(requiredAmount) {
        const contract = await ensureContract({ requireSigner: true });
        const paymentToken = await ensurePaymentToken({ requireSigner: true });
        const ownerAddress = runtime.currentAccount || await runtime.signer.getAddress();
        const allowance = await paymentToken.allowance(ownerAddress, contract.target);

        if (allowance >= requiredAmount) {
            return null;
        }

        return paymentToken.approve(contract.target, requiredAmount);
    }

    async function fetchContractBalance() {
        await fetchPaymentTokenMeta();
        const contract = await ensureContract();
        return contract.get_contract_balance();
    }

    window.FashionStoreCore = {
        CONTRACT_ABI,
        CATEGORY_OPTIONS,
        STYLE_OPTIONS,
        SEASON_OPTIONS,
        DEPARTMENT_OPTIONS,
        ORDER_STAGE_META,
        runtime,
        initWalletState,
        fetchSessionProfile,
        getSessionSnapshot,
        signInWithBackend,
        logoutBackendSession,
        ensureContract,
        connectWallet,
        switchToExpectedNetwork,
        fetchProducts,
        fetchOrders,
        fetchContractBalance,
        fetchPaymentTokenMeta,
        ensurePaymentToken,
        ensurePaymentTokenApproval,
        fetchSellerProfile,
        fetchSellerRequests,
        fetchSellersStore,
        requestSellerAccess,
        approveSellerAccess,
        fetchAdminAuditLogs,
        createMockProduct,
        updateMockProduct,
        setMockProductActive,
        saveOrderMeta,
        fetchReviews,
        saveReview,
        fetchPayouts,
        savePayout,
        uploadProductImage,
        getConfiguredContractAddress,
        setStoredContractAddress,
        clearStoredContractAddress,
        getCart,
        saveCart,
        buildCartEntryKey,
        formatVariantLabel,
        buildOrderProductTitle,
        getFavoriteProductIds,
        isFavoriteProduct,
        toggleFavoriteProduct,
        getRecentlyViewedProductIds,
        pushRecentlyViewedProduct,
        getOrderFlowStage,
        saveOrderFlowStage,
        formatAddress,
        formatEth,
        parsePaymentAmount,
        normalizeMeta,
        inferMetaFromName,
        buildPlaceholderImage,
        getOrderStageMeta,
        serializeOrder,
        escapeXml
    };
}());
