const core = window.FashionStoreCore;

const dom = {
    connectButton: document.getElementById("connectButton"),
    switchNetworkButton: document.getElementById("switchNetworkButton"),
    walletAddress: document.getElementById("walletAddress"),
    contractAddressLabel: document.getElementById("contractAddressLabel"),
    inventoryCount: document.getElementById("inventoryCount"),
    sellerStatusLabel: document.getElementById("sellerStatusLabel"),
    sellerStatusBadge: document.getElementById("sellerStatusBadge"),
    sellerGateTitle: document.getElementById("sellerGateTitle"),
    sellerGateDescription: document.getElementById("sellerGateDescription"),
    requestSellerAccessButton: document.getElementById("requestSellerAccessButton"),
    sellerAdminPanel: document.getElementById("sellerAdminPanel"),
    sellerRequestsList: document.getElementById("sellerRequestsList"),
    refreshRequestsButton: document.getElementById("refreshRequestsButton"),
    sellerWorkspace: document.getElementById("sellerWorkspace"),
    createProductForm: document.getElementById("createProductForm"),
    productName: document.getElementById("productName"),
    productPrice: document.getElementById("productPrice"),
    departmentSelect: document.getElementById("departmentSelect"),
    seasonSelect: document.getElementById("seasonSelect"),
    styleSelect: document.getElementById("styleSelect"),
    imageUrlInput: document.getElementById("imageUrlInput"),
    descriptionInput: document.getElementById("descriptionInput"),
    previewImage: document.getElementById("previewImage"),
    previewDepartment: document.getElementById("previewDepartment"),
    previewSeason: document.getElementById("previewSeason"),
    previewStyle: document.getElementById("previewStyle"),
    previewName: document.getElementById("previewName"),
    previewDescription: document.getElementById("previewDescription"),
    refreshInventoryButton: document.getElementById("refreshInventoryButton"),
    inventoryGrid: document.getElementById("inventoryGrid"),
    toastStack: document.getElementById("toastStack")
};

const state = {
    account: null,
    products: [],
    sellerProfile: { approved: false, pending: false, isContractOwner: false },
    sellerRequests: []
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

function buildPreviewMeta() {
    return core.normalizeMeta({
        department: dom.departmentSelect.value,
        season: dom.seasonSelect.value,
        style: dom.styleSelect.value,
        imageUrl: dom.imageUrlInput.value,
        description: dom.descriptionInput.value
    });
}

function renderPreview() {
    const meta = buildPreviewMeta();
    const product = {
        name: dom.productName.value.trim() || "服裝商品預覽",
        meta
    };

    dom.previewDepartment.textContent = meta.department;
    dom.previewSeason.textContent = meta.season;
    dom.previewStyle.textContent = meta.style;
    dom.previewName.textContent = product.name;
    dom.previewDescription.textContent = meta.description || "上架後這張卡片會像商店前台一樣顯示分類、季節與敘述。";
    dom.previewImage.src = core.buildPlaceholderImage(product);
}

function setSellerGate(status) {
    dom.sellerStatusBadge.className = `status-badge ${status.tone}`;
    dom.sellerStatusBadge.textContent = status.badge;
    dom.sellerGateTitle.textContent = status.title;
    dom.sellerGateDescription.textContent = status.description;
    dom.sellerStatusLabel.textContent = status.badge;
    dom.requestSellerAccessButton.disabled = status.disableRequest;
    dom.sellerWorkspace.classList.toggle("hidden", !status.showWorkspace);
    dom.sellerAdminPanel.classList.toggle("hidden", !status.showAdmin);
}

function renderAccessState() {
    if (!state.account) {
        setSellerGate({
            tone: "neutral",
            badge: "未連接",
            title: "請先連接錢包",
            description: "連接後會檢查地址是否通過賣家審核，只有核准地址才能進入商品管理。",
            disableRequest: true,
            showWorkspace: false,
            showAdmin: false
        });
        return;
    }

    if (state.sellerProfile.approved) {
        setSellerGate({
            tone: "success",
            badge: state.sellerProfile.isContractOwner ? "Owner / 賣家" : "已核准賣家",
            title: "賣家資格已通過",
            description: "目前地址已具備賣家權限。商品上架與上下架現在走 mock database，不需要鏈上交易。",
            disableRequest: true,
            showWorkspace: true,
            showAdmin: state.sellerProfile.isContractOwner
        });
        return;
    }

    if (state.sellerProfile.pending) {
        setSellerGate({
            tone: "warn",
            badge: "審核中",
            title: "賣家申請已送出",
            description: "目前地址正在等待 owner 審核，審核通過後才會開放賣家後台功能。",
            disableRequest: true,
            showWorkspace: false,
            showAdmin: false
        });
        return;
    }

    setSellerGate({
        tone: "neutral",
        badge: "買家模式",
        title: "目前地址尚未成為賣家",
        description: "商品資料現在存在前端 mock database，但仍保留賣家資格 gate，先核准再進入後台。",
        disableRequest: false,
        showWorkspace: false,
        showAdmin: false
    });
}

function renderSellerRequests() {
    dom.sellerRequestsList.innerHTML = "";

    if (!state.sellerProfile.isContractOwner) {
        return;
    }

    if (!state.sellerRequests.length) {
        dom.sellerRequestsList.innerHTML = '<article class="request-card empty"><strong>目前沒有待審核賣家</strong><p>新的申請送出後，這裡就會出現地址清單。</p></article>';
        return;
    }

    state.sellerRequests.forEach((address) => {
        const card = document.createElement("article");
        card.className = "request-card";
        card.innerHTML = `
            <div>
                <strong>${address}</strong>
                <p>等待 owner 審核為賣家地址</p>
            </div>
            <div class="detail-actions">
                <button class="button primary" type="button" data-action="approve-seller" data-address="${address}">核准賣家</button>
            </div>
        `;
        dom.sellerRequestsList.append(card);
    });
}

function renderInventory() {
    dom.inventoryGrid.innerHTML = "";

    if (!state.account || !state.sellerProfile.approved) {
        dom.inventoryGrid.innerHTML = '<article class="panel-card"><strong>尚未開放商品管理</strong><p>只有通過審核的賣家地址，才會顯示這裡的商品庫存。</p></article>';
        dom.inventoryCount.textContent = "0";
        return;
    }

    const products = state.products.filter((product) => product.seller.toLowerCase() === state.account.toLowerCase());
    dom.inventoryCount.textContent = `${products.length}`;

    if (!products.length) {
        dom.inventoryGrid.innerHTML = '<article class="panel-card"><strong>你還沒有商品</strong><p>先建立第一個服裝商品，這一步現在不需要錢包確認。</p></article>';
        return;
    }

    products.forEach((product) => {
        const card = document.createElement("article");
        card.className = "inventory-card";
        card.innerHTML = `
            <img src="${product.image}" alt="${product.name}" />
            <div class="inventory-meta">
                <div>
                    <strong>${product.name}</strong>
                    <p>#${product.productId} • ${product.meta.department} • ${product.meta.season}</p>
                </div>
                <span class="tag-pill">${product.isActive ? "販售中" : "已下架"}</span>
            </div>
            <p>${product.meta.description || `${product.meta.style} / ${core.formatEth(product.priceWei)}`}</p>
            <div class="price-row">
                <strong>${core.formatEth(product.priceWei)}</strong>
                <div class="detail-actions">
                    <button class="button ghost" data-action="toggle-product" data-product-id="${product.productId}" data-next="${product.isActive ? "false" : "true"}" type="button">
                        ${product.isActive ? "下架" : "重新上架"}
                    </button>
                </div>
            </div>
        `;
        dom.inventoryGrid.append(card);
    });
}

async function loadInventory() {
    try {
        state.products = await core.fetchProducts();
        renderInventory();
    } catch (error) {
        renderInventory();
        toast("error", normalizeError(error));
    }
}

async function loadSellerState() {
    if (!state.account) {
        state.sellerProfile = { approved: false, pending: false, isContractOwner: false };
        state.sellerRequests = [];
        renderAccessState();
        renderSellerRequests();
        renderInventory();
        return;
    }

    try {
        state.sellerProfile = await core.fetchSellerProfile(state.account);
        state.sellerRequests = state.sellerProfile.isContractOwner ? await core.fetchSellerRequests() : [];
        renderAccessState();
        renderSellerRequests();

        if (state.sellerProfile.approved) {
            await loadInventory();
        } else {
            renderInventory();
        }
    } catch (error) {
        toast("error", normalizeError(error));
    }
}

async function createProduct(event) {
    event.preventDefault();

    if (!state.sellerProfile.approved) {
        toast("error", "目前地址尚未通過賣家審核");
        return;
    }

    try {
        const product = await core.createMockProduct({
            seller: state.account,
            name: dom.productName.value.trim(),
            priceWei: window.ethers.parseEther(dom.productPrice.value),
            meta: buildPreviewMeta()
        });

        dom.createProductForm.reset();
        renderPreview();
        await loadInventory();
        toast("success", `商品已建立，商品 ID：${product.productId}`);
    } catch (error) {
        toast("error", normalizeError(error));
    }
}

async function connectWallet() {
    try {
        const session = await core.connectWallet();
        state.account = session.account;
        dom.walletAddress.textContent = core.formatAddress(session.account);
        dom.contractAddressLabel.textContent = core.getConfiguredContractAddress()
            ? core.formatAddress(core.getConfiguredContractAddress())
            : "未設定";
        await loadSellerState();
        toast("success", "賣家錢包已連接");
    } catch (error) {
        toast("error", normalizeError(error));
    }
}

async function requestSellerAccess() {
    if (!state.account) {
        toast("error", "請先連接錢包");
        return;
    }

    await core.requestSellerAccess(state.account);
    await loadSellerState();
    toast("success", "已送出賣家資格申請，這一步不需要鏈上交易");
}

async function approveSeller(address) {
    if (!state.sellerProfile.isContractOwner) {
        toast("error", "只有 owner 可以審核賣家");
        return;
    }

    await core.approveSellerAccess(address, true);
    await loadSellerState();
    toast("success", `已核准賣家 ${core.formatAddress(address)}`);
}

async function hydrate() {
    const session = await core.initWalletState();
    state.account = session.account;
    dom.walletAddress.textContent = state.account ? core.formatAddress(state.account) : "尚未連接";
    const contractAddress = core.getConfiguredContractAddress();
    dom.contractAddressLabel.textContent = contractAddress ? core.formatAddress(contractAddress) : "未設定";
    renderPreview();
    renderAccessState();
    renderSellerRequests();
    renderInventory();
    await loadSellerState();
}

dom.connectButton.addEventListener("click", connectWallet);
dom.switchNetworkButton.addEventListener("click", async () => {
    try {
        await core.switchToExpectedNetwork();
        toast("success", "已切換到 Sepolia");
    } catch (error) {
        toast("error", normalizeError(error));
    }
});

dom.requestSellerAccessButton.addEventListener("click", requestSellerAccess);
dom.refreshRequestsButton.addEventListener("click", loadSellerState);
dom.refreshInventoryButton.addEventListener("click", loadInventory);

[dom.productName, dom.productPrice, dom.departmentSelect, dom.seasonSelect, dom.styleSelect, dom.imageUrlInput, dom.descriptionInput]
    .forEach((element) => element.addEventListener("input", renderPreview));

dom.createProductForm.addEventListener("submit", createProduct);

dom.sellerRequestsList.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-action='approve-seller']");
    if (!trigger) return;
    await approveSeller(trigger.dataset.address);
});

dom.inventoryGrid.addEventListener("click", async (event) => {
    const trigger = event.target.closest("[data-action='toggle-product']");
    if (!trigger) return;

    await core.setMockProductActive(Number(trigger.dataset.productId), trigger.dataset.next === "true");
    await loadInventory();
    toast("success", "商品狀態已更新，這一步不需要鏈上交易");
});

if (window.ethereum) {
    window.ethereum.on("accountsChanged", () => window.location.reload());
    window.ethereum.on("chainChanged", () => window.location.reload());
}

hydrate().catch((error) => toast("error", normalizeError(error)));
