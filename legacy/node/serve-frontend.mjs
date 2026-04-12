import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 3000);
const ROOT = process.cwd();
const DATA_DIR = join(ROOT, "data");

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8"
};

const DATA_FILES = {
    products: join(DATA_DIR, "products.json"),
    sellers: join(DATA_DIR, "sellers.json"),
    orders: join(DATA_DIR, "orders.json"),
    reviews: join(DATA_DIR, "reviews.json"),
    payouts: join(DATA_DIR, "payouts.json")
};

const DEFAULT_DATA = {
    products: [],
    sellers: {
        approved: [],
        pending: []
    },
    orders: {},
    reviews: [],
    payouts: []
};

function resolvePath(urlPath) {
    const pathname = new URL(urlPath, "http://localhost").pathname;
    const cleanedPath = pathname === "/" ? "/frontend/index.html" : pathname;
    const fullPath = normalize(join(ROOT, cleanedPath));

    if (!fullPath.startsWith(normalize(ROOT))) {
        return null;
    }

    return fullPath;
}

async function ensureDataFiles() {
    await mkdir(DATA_DIR, { recursive: true });

    for (const [key, filePath] of Object.entries(DATA_FILES)) {
        try {
            await readFile(filePath, "utf8");
        } catch {
            await writeFile(filePath, JSON.stringify(DEFAULT_DATA[key], null, 2), "utf8");
        }
    }
}

async function readJson(filePath, fallback) {
    try {
        const raw = await readFile(filePath, "utf8");
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

async function writeJson(filePath, data) {
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function readRequestBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }

    if (!chunks.length) {
        return {};
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        return {};
    }
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(data));
}

async function handleProductsApi(req, res, url) {
    const pathname = url.pathname;
    const products = await readJson(DATA_FILES.products, []);

    if (req.method === "GET" && pathname === "/api/products") {
        sendJson(res, 200, products.sort((a, b) => Number(b.productId) - Number(a.productId)));
        return true;
    }

    if (req.method === "POST" && pathname === "/api/products") {
        const body = await readRequestBody(req);
        const nextId = products.reduce((max, item) => Math.max(max, Number(item.productId) || 0), 0) + 1;
        const product = {
            productId: nextId,
            seller: body.seller,
            name: String(body.name || "").trim(),
            priceWei: String(body.priceWei || "0"),
            isActive: true,
            meta: body.meta || {}
        };

        products.unshift(product);
        await writeJson(DATA_FILES.products, products);
        sendJson(res, 201, product);
        return true;
    }

    if (req.method === "PATCH" && pathname.startsWith("/api/products/")) {
        const productId = Number(pathname.split("/").pop());
        const body = await readRequestBody(req);
        const nextProducts = products.map((product) => (
            Number(product.productId) === productId
                ? { ...product, ...body, productId: Number(product.productId) }
                : product
        ));
        const updated = nextProducts.find((item) => Number(item.productId) === productId);

        if (!updated) {
            sendJson(res, 404, { error: "Product not found" });
            return true;
        }

        await writeJson(DATA_FILES.products, nextProducts);
        sendJson(res, 200, updated);
        return true;
    }

    return false;
}

async function handleSellersApi(req, res, url) {
    const pathname = url.pathname;
    const sellers = await readJson(DATA_FILES.sellers, DEFAULT_DATA.sellers);

    if (req.method === "GET" && pathname === "/api/sellers") {
        sendJson(res, 200, sellers);
        return true;
    }

    if (req.method === "POST" && pathname === "/api/sellers/request") {
        const body = await readRequestBody(req);
        const address = String(body.address || "").trim();

        if (!address) {
            sendJson(res, 400, { error: "Address required" });
            return true;
        }

        if (!sellers.approved.includes(address) && !sellers.pending.includes(address)) {
            sellers.pending.push(address);
            await writeJson(DATA_FILES.sellers, sellers);
        }

        sendJson(res, 200, sellers);
        return true;
    }

    if (req.method === "POST" && pathname === "/api/sellers/approve") {
        const body = await readRequestBody(req);
        const address = String(body.address || "").trim();
        const approved = body.approved !== false;

        if (!address) {
            sendJson(res, 400, { error: "Address required" });
            return true;
        }

        sellers.pending = sellers.pending.filter((item) => item.toLowerCase() !== address.toLowerCase());
        sellers.approved = sellers.approved.filter((item) => item.toLowerCase() !== address.toLowerCase());

        if (approved) {
            sellers.approved.push(address);
        }

        await writeJson(DATA_FILES.sellers, sellers);
        sendJson(res, 200, sellers);
        return true;
    }

    return false;
}

async function handleOrdersApi(req, res, url) {
    const pathname = url.pathname;
    const orders = await readJson(DATA_FILES.orders, DEFAULT_DATA.orders);

    if (req.method === "GET" && pathname === "/api/orders") {
        sendJson(res, 200, orders);
        return true;
    }

    if (req.method === "POST" && pathname === "/api/orders") {
        const body = await readRequestBody(req);
        const orderId = String(body.orderId || "").trim();

        if (!orderId) {
            sendJson(res, 400, { error: "Order ID required" });
            return true;
        }

        const current = orders[orderId] || {};
        orders[orderId] = {
            ...current,
            orderId: Number(orderId),
            productId: Number(body.productId || current.productId || 0),
            productName: String(body.productName || current.productName || ""),
            productSeller: String(body.productSeller || current.productSeller || ""),
            priceWei: String(body.priceWei || current.priceWei || "0"),
            flowStage: Number(body.flowStage || current.flowStage || 1)
        };

        await writeJson(DATA_FILES.orders, orders);
        sendJson(res, 201, orders[orderId]);
        return true;
    }

    if (req.method === "PATCH" && /^\/api\/orders\/\d+\/flow$/.test(pathname)) {
        const [, , , orderId] = pathname.split("/");
        const body = await readRequestBody(req);
        const current = orders[orderId];

        if (!current) {
            sendJson(res, 404, { error: "Order not found" });
            return true;
        }

        current.flowStage = Number(body.flowStage || current.flowStage || 1);
        orders[orderId] = current;
        await writeJson(DATA_FILES.orders, orders);
        sendJson(res, 200, current);
        return true;
    }

    return false;
}

async function handleReviewsApi(req, res, url) {
    const pathname = url.pathname;
    const reviews = await readJson(DATA_FILES.reviews, DEFAULT_DATA.reviews);

    if (req.method === "GET" && pathname === "/api/reviews") {
        sendJson(res, 200, reviews);
        return true;
    }

    if (req.method === "POST" && pathname === "/api/reviews") {
        const body = await readRequestBody(req);
        const orderId = Number(body.orderId || 0);
        const rating = Math.max(1, Math.min(5, Number(body.rating || 0)));

        if (!orderId) {
            sendJson(res, 400, { error: "Order ID required" });
            return true;
        }

        if (!rating) {
            sendJson(res, 400, { error: "Rating required" });
            return true;
        }

        const nextReview = {
            orderId,
            productId: Number(body.productId || 0),
            productName: String(body.productName || ""),
            seller: String(body.seller || ""),
            buyer: String(body.buyer || ""),
            rating,
            comment: String(body.comment || "").trim(),
            createdAt: String(body.createdAt || new Date().toISOString())
        };

        const reviewIndex = reviews.findIndex((item) => Number(item.orderId) === orderId);
        if (reviewIndex >= 0) {
            reviews[reviewIndex] = {
                ...reviews[reviewIndex],
                ...nextReview
            };
        } else {
            reviews.unshift(nextReview);
        }

        await writeJson(DATA_FILES.reviews, reviews);
        sendJson(res, 201, nextReview);
        return true;
    }

    return false;
}

async function handlePayoutsApi(req, res, url) {
    const pathname = url.pathname;
    const payouts = await readJson(DATA_FILES.payouts, DEFAULT_DATA.payouts);

    if (req.method === "GET" && pathname === "/api/payouts") {
        sendJson(res, 200, payouts);
        return true;
    }

    if (req.method === "POST" && pathname === "/api/payouts") {
        const body = await readRequestBody(req);
        const orderId = Number(body.orderId || 0);

        if (!orderId) {
            sendJson(res, 400, { error: "Order ID required" });
            return true;
        }

        const nextPayout = {
            orderId,
            seller: String(body.seller || ""),
            buyer: String(body.buyer || ""),
            productId: Number(body.productId || 0),
            productName: String(body.productName || ""),
            amountWei: String(body.amountWei || "0"),
            txHash: String(body.txHash || ""),
            createdAt: String(body.createdAt || new Date().toISOString())
        };

        const payoutIndex = payouts.findIndex((item) => Number(item.orderId) === orderId);
        if (payoutIndex >= 0) {
            payouts[payoutIndex] = {
                ...payouts[payoutIndex],
                ...nextPayout
            };
        } else {
            payouts.unshift(nextPayout);
        }

        await writeJson(DATA_FILES.payouts, payouts);
        sendJson(res, 201, nextPayout);
        return true;
    }

    return false;
}

async function handleApi(req, res) {
    const url = new URL(req.url || "/", "http://localhost");

    if (await handleProductsApi(req, res, url)) return true;
    if (await handleSellersApi(req, res, url)) return true;
    if (await handleOrdersApi(req, res, url)) return true;
    if (await handleReviewsApi(req, res, url)) return true;
    if (await handlePayoutsApi(req, res, url)) return true;

    return false;
}

await ensureDataFiles();

const server = createServer(async (req, res) => {
    if ((req.url || "").startsWith("/api/")) {
        const handled = await handleApi(req, res);
        if (!handled) {
            sendJson(res, 404, { error: "API route not found" });
        }
        return;
    }

    const filePath = resolvePath(req.url || "/");

    if (!filePath) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
    }

    try {
        const file = await readFile(filePath);
        const type = MIME_TYPES[extname(filePath)] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type });
        res.end(file);
    } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not Found");
    }
});

server.listen(PORT, () => {
    console.log(`Frontend ready at http://localhost:${PORT}`);
});
