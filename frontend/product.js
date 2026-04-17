const core = window.FashionStoreCore;

const dom = {
    detailImage: document.getElementById("detailImage"),
    detailTags: document.getElementById("detailTags"),
    detailName: document.getElementById("detailName"),
    detailDescription: document.getElementById("detailDescription"),
    detailPrice: document.getElementById("detailPrice"),
    detailProductId: document.getElementById("detailProductId"),
    detailSeller: document.getElementById("detailSeller"),
    detailWallet: document.getElementById("detailWallet"),
    detailSizes: document.getElementById("detailSizes"),
    detailColors: document.getElementById("detailColors"),
    detailStock: document.getElementById("detailStock"),
    detailSizeSelect: document.getElementById("detailSizeSelect"),
    detailColorSelect: document.getElementById("detailColorSelect"),
    detailQuantityInput: document.getElementById("detailQuantityInput"),
    detailSellerReviewSummary: document.getElementById("detailSellerReviewSummary"),
    detailSellerReviewList: document.getElementById("detailSellerReviewList"),
    detailAddCartButton: document.getElementById("detailAddCartButton"),
    detailFavoriteButton: document.getElementById("detailFavoriteButton"),
    relatedGrid: document.getElementById("relatedGrid"),
    toastStack: document.getElementById("toastStack")
};

const state = {
    account: null,
    products: [],
    currentProduct: null,
    inactiveProduct: null,
    reviews: [],
    selectedSize: "",
    selectedColor: ""
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

function getProductIdFromUrl() {
    const url = new URL(window.location.href);
    return Number(url.searchParams.get("id"));
}

function renderCurrentProduct() {
    if (!state.currentProduct) {
        dom.detailName.textContent = state.inactiveProduct ? "這件商品已下架" : "找不到這件商品";
        dom.detailDescription.textContent = state.inactiveProduct
            ? "這件商品目前已從商店商品區移除，如需重新販售會再回到前台。"
            : "請回到商店首頁重新選擇商品。";
        dom.detailAddCartButton.disabled = true;
        dom.detailAddCartButton.textContent = state.inactiveProduct ? "商品已下架" : "無法加入購物車";
        dom.detailSellerReviewSummary.innerHTML = "";
        dom.detailSellerReviewList.innerHTML = "";
        return;
    }

    const product = state.currentProduct;
    dom.detailImage.src = product.image;
    dom.detailName.textContent = product.name;
    dom.detailDescription.textContent = product.meta.description || `${product.meta.department} / ${product.meta.season} / ${product.meta.style}`;
    dom.detailPrice.textContent = core.formatEth(product.priceWei);
    dom.detailProductId.textContent = `#${product.productId}`;
    dom.detailSeller.textContent = core.formatAddress(product.seller);
    dom.detailWallet.textContent = state.account ? core.formatAddress(state.account) : "尚未連接";
    dom.detailSizes.textContent = product.meta.sizes.join(" / ");
    dom.detailColors.textContent = product.meta.colors.join(" / ");
    dom.detailStock.textContent = `${product.meta.stock}`;
    dom.detailFavoriteButton.textContent = core.isFavoriteProduct(product.productId) ? "移除收藏" : "加入收藏";
    dom.detailAddCartButton.disabled = !product.isActive || Number(product.meta.stock || 0) <= 0;
    dom.detailAddCartButton.textContent = !product.isActive ? "商品已下架" : (Number(product.meta.stock || 0) <= 0 ? "目前缺貨中" : "加入購物車");
    dom.detailTags.innerHTML = `
        <span class="tag-pill">${product.meta.mainCategory}</span>
        <span class="tag-pill">${product.meta.department}</span>
        <span class="tag-pill">${product.meta.season}</span>
        <span class="tag-pill">${product.meta.style}</span>
        <span class="tag-pill">庫存 ${product.meta.stock}</span>
    `;

    dom.detailSizeSelect.innerHTML = product.meta.sizes
        .map((size) => `<option value="${size}">${size}</option>`)
        .join("");
    dom.detailColorSelect.innerHTML = product.meta.colors
        .map((color) => `<option value="${color}">${color}</option>`)
        .join("");

    state.selectedSize = product.meta.sizes.includes(state.selectedSize) ? state.selectedSize : product.meta.sizes[0];
    state.selectedColor = product.meta.colors.includes(state.selectedColor) ? state.selectedColor : product.meta.colors[0];
    dom.detailSizeSelect.value = state.selectedSize;
    dom.detailColorSelect.value = state.selectedColor;
    dom.detailQuantityInput.max = String(Math.max(1, Number(product.meta.stock || 1)));
    dom.detailQuantityInput.value = String(Math.min(Number(dom.detailQuantityInput.value || 1), Math.max(1, Number(product.meta.stock || 1))));

    renderSellerReputation();
}

function renderRelatedProducts() {
    dom.relatedGrid.innerHTML = "";

    if (!state.currentProduct) {
        return;
    }

    const related = state.products
        .filter((product) =>
            product.isActive &&
            product.productId !== state.currentProduct.productId &&
            product.meta.department === state.currentProduct.meta.department
        )
        .slice(0, 3);

    if (!related.length) {
        dom.relatedGrid.innerHTML = '<article class="panel-card"><strong>目前沒有相近分類商品</strong><p>回到商店首頁看看其他季節或其他對象分類的單品。</p></article>';
        return;
    }

    related.forEach((product) => {
        const card = document.createElement("article");
        card.className = "product-card";
        card.innerHTML = `
            <a href="/frontend/product.html?id=${product.productId}">
                <img src="${product.image}" alt="${product.name}" />
            </a>
            <div class="detail-tags">
                <span class="tag-pill">${product.meta.department}</span>
                <span class="tag-pill">${product.meta.season}</span>
            </div>
            <h3>${product.name}</h3>
            <div class="price-row">
                <strong>${core.formatEth(product.priceWei)}</strong>
                <a href="/frontend/product.html?id=${product.productId}" class="button ghost link-button">查看</a>
            </div>
        `;
        dom.relatedGrid.append(card);
    });
}

function renderSellerReputation() {
    if (!state.currentProduct) return;

    const sellerReviews = state.reviews.filter((review) => String(review.seller).toLowerCase() === state.currentProduct.seller.toLowerCase());
    if (!sellerReviews.length) {
        dom.detailSellerReviewSummary.innerHTML = `
            <span class="summary-pill"><strong>0</strong> 筆評論</span>
            <span class="summary-pill"><strong>-</strong> 平均評分</span>
        `;
        dom.detailSellerReviewList.innerHTML = '<article class="review-card"><h3>目前還沒有評價</h3><p>這位賣家尚未收到買家的公開評論。</p></article>';
        return;
    }

    const average = sellerReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / sellerReviews.length;
    dom.detailSellerReviewSummary.innerHTML = `
        <span class="summary-pill"><strong>${sellerReviews.length}</strong> 筆評論</span>
        <span class="summary-pill"><strong>${average.toFixed(1)}</strong> 平均評分</span>
        <span class="summary-pill"><strong>${"★".repeat(Math.round(average))}</strong> 口碑星等</span>
    `;

    dom.detailSellerReviewList.innerHTML = "";
    sellerReviews.slice(0, 3).forEach((review) => {
        const card = document.createElement("article");
        card.className = "review-card";
        card.innerHTML = `
            <div class="review-meta">
                <strong class="review-stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</strong>
                <span>訂單 #${review.orderId}</span>
            </div>
            <h3>${review.productName || `商品 #${review.productId || review.orderId}`}</h3>
            <p>${review.comment || "買家只留下星等評分。"}</p>
        `;
        dom.detailSellerReviewList.append(card);
    });
}

function addCurrentProductToCart() {
    if (!state.currentProduct) return;
    if (!state.currentProduct.isActive) {
        toast("error", "這件商品目前已下架，不能加入購物車。");
        return;
    }
    if (Number(state.currentProduct.meta.stock || 0) <= 0) {
        toast("error", "這件商品目前缺貨中，暫時不能加入購物車。");
        return;
    }

    const quantity = Math.max(1, Math.min(Number(dom.detailQuantityInput.value || 1), Number(state.currentProduct.meta.stock || 1)));
    const size = dom.detailSizeSelect.value || state.currentProduct.meta.sizes[0] || "";
    const color = dom.detailColorSelect.value || state.currentProduct.meta.colors[0] || "";
    const cart = core.getCart();
    const existing = cart.find((item) =>
        item.productId === state.currentProduct.productId &&
        item.size === size &&
        item.color === color
    );
    if (existing) {
        existing.quantity = Math.min(existing.quantity + quantity, Number(state.currentProduct.meta.stock || existing.quantity + quantity));
    } else {
        cart.push({ productId: state.currentProduct.productId, quantity, size, color });
    }

    core.saveCart(cart);
    toast("success", `${state.currentProduct.name} 已加入購物車`);
}

function toggleCurrentProductFavorite() {
    if (!state.currentProduct) return;
    const next = core.toggleFavoriteProduct(state.currentProduct.productId);
    dom.detailFavoriteButton.textContent = next.includes(state.currentProduct.productId) ? "移除收藏" : "加入收藏";
    toast("success", next.includes(state.currentProduct.productId) ? "已加入收藏" : "已移除收藏");
}

async function hydrate() {
    const session = await core.initWalletState();
    state.account = session.account;
    dom.detailWallet.textContent = state.account ? core.formatAddress(state.account) : "尚未連接";

    state.products = await core.fetchProducts();
    state.reviews = await core.fetchReviews();
    const targetProductId = getProductIdFromUrl();
    state.currentProduct = state.products.find((product) => product.productId === targetProductId && product.isActive) || null;
    state.inactiveProduct = state.products.find((product) => product.productId === targetProductId && !product.isActive) || null;
    if (state.currentProduct) {
        core.pushRecentlyViewedProduct(state.currentProduct.productId);
    }

    renderCurrentProduct();
    renderRelatedProducts();
}

dom.detailAddCartButton.addEventListener("click", addCurrentProductToCart);
dom.detailFavoriteButton.addEventListener("click", toggleCurrentProductFavorite);
dom.detailSizeSelect.addEventListener("change", (event) => {
    state.selectedSize = event.target.value;
});
dom.detailColorSelect.addEventListener("change", (event) => {
    state.selectedColor = event.target.value;
});

hydrate().catch((error) => toast("error", normalizeError(error)));
