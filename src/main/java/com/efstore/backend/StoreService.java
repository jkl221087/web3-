package com.efstore.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

@Service
class StoreService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final StorePaths paths;
    private final String adminAddress;

    StoreService(JdbcTemplate jdbc, ObjectMapper mapper, StorePaths paths) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.paths = paths;
        String configuredAdmin = System.getenv("ADMIN_WALLET_ADDRESS");
        this.adminAddress = configuredAdmin == null ? null : StoreSupport.normalizeAddress(configuredAdmin);
    }

    @PostConstruct
    void initialize() {
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS products (
                product_id INTEGER PRIMARY KEY AUTOINCREMENT,
                seller TEXT NOT NULL,
                name TEXT NOT NULL,
                price_wei TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                meta_json TEXT NOT NULL DEFAULT '{}'
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS sellers (
                address TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                order_id INTEGER PRIMARY KEY,
                buyer TEXT NOT NULL DEFAULT '',
                product_id INTEGER NOT NULL DEFAULT 0,
                product_name TEXT NOT NULL DEFAULT '',
                product_seller TEXT NOT NULL DEFAULT '',
                price_wei TEXT NOT NULL DEFAULT '0',
                flow_stage INTEGER NOT NULL DEFAULT 1
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS reviews (
                order_id INTEGER PRIMARY KEY,
                product_id INTEGER NOT NULL DEFAULT 0,
                product_name TEXT NOT NULL DEFAULT '',
                seller TEXT NOT NULL DEFAULT '',
                buyer TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL,
                comment TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS payouts (
                order_id INTEGER PRIMARY KEY,
                seller TEXT NOT NULL DEFAULT '',
                buyer TEXT NOT NULL DEFAULT '',
                product_id INTEGER NOT NULL DEFAULT 0,
                product_name TEXT NOT NULL DEFAULT '',
                amount_wei TEXT NOT NULL DEFAULT '0',
                tx_hash TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """);
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT NOT NULL,
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                subject TEXT NOT NULL DEFAULT '',
                product_id INTEGER,
                summary TEXT NOT NULL,
                detail_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            )
            """);
        Integer buyerColumnCount = jdbc.queryForObject(
            "SELECT COUNT(*) FROM pragma_table_info('orders') WHERE name = 'buyer'",
            Integer.class
        );
        if (buyerColumnCount != null && buyerColumnCount == 0) {
            jdbc.execute("ALTER TABLE orders ADD COLUMN buyer TEXT NOT NULL DEFAULT ''");
        }
        try {
            java.nio.file.Files.createDirectories(paths.uploadsDir);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to create uploads directory", e);
        }
    }

    String requireActor(HttpServletRequest request, String actorHeader, AuthService authService) {
        return authService.resolveActor(request, actorHeader)
            .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Missing x-actor-address header"));
    }

    boolean isAdmin(String actor) {
        return actor != null && adminAddress != null && adminAddress.equals(actor);
    }

    SessionProfile sessionProfile(String actor) {
        boolean admin = isAdmin(actor);
        String sellerStatus = actor == null ? "guest" : getSellerStatus(actor).orElse("guest");
        if (admin) {
            sellerStatus = "approved";
        }
        return new SessionProfile(actor != null, actor == null ? "" : actor, admin, sellerStatus);
    }

    List<ProductRecord> loadProducts() {
        return jdbc.query(
            "SELECT product_id, seller, name, price_wei, is_active, meta_json FROM products ORDER BY product_id DESC",
            (row, index) -> mapProduct(row)
        );
    }

    SellersStore loadSellersStore() {
        List<Map<String, Object>> rows = jdbc.queryForList("SELECT address, status FROM sellers ORDER BY updated_at DESC, address ASC");
        List<String> approved = new ArrayList<>();
        List<String> pending = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            String status = String.valueOf(row.get("status"));
            String address = String.valueOf(row.get("address"));
            if ("approved".equals(status)) approved.add(address);
            if ("pending".equals(status)) pending.add(address);
        }
        return new SellersStore(approved, pending);
    }

    Map<String, OrderRecord> loadOrdersMap() {
        LinkedHashMap<String, OrderRecord> records = new LinkedHashMap<>();
        jdbc.query(
            "SELECT order_id, buyer, product_id, product_name, product_seller, price_wei, flow_stage FROM orders ORDER BY order_id DESC",
            (ResultSet row) -> records.put(String.valueOf(row.getLong("order_id")), mapOrder(row))
        );
        return records;
    }

    List<ReviewRecord> loadReviews() {
        return jdbc.query(
            "SELECT order_id, product_id, product_name, seller, buyer, rating, comment, created_at FROM reviews ORDER BY datetime(created_at) DESC, order_id DESC",
            (row, index) -> new ReviewRecord(
                row.getLong("order_id"),
                row.getLong("product_id"),
                safe(row.getString("product_name")),
                safe(row.getString("seller")),
                safe(row.getString("buyer")),
                row.getInt("rating"),
                safe(row.getString("comment")),
                safe(row.getString("created_at"))
            )
        );
    }

    List<PayoutRecord> loadPayouts() {
        return jdbc.query(
            "SELECT order_id, seller, buyer, product_id, product_name, amount_wei, tx_hash, created_at FROM payouts ORDER BY datetime(created_at) DESC, order_id DESC",
            (row, index) -> new PayoutRecord(
                row.getLong("order_id"),
                safe(row.getString("seller")),
                safe(row.getString("buyer")),
                row.getLong("product_id"),
                safe(row.getString("product_name")),
                safe(row.getString("amount_wei")),
                safe(row.getString("tx_hash")),
                safe(row.getString("created_at"))
            )
        );
    }

    List<AuditLogRecord> loadAuditLogs() {
        return jdbc.query(
            "SELECT id, category, action, actor, subject, product_id, summary, detail_json, created_at FROM audit_logs ORDER BY id DESC LIMIT 40",
            (row, index) -> new AuditLogRecord(
                row.getLong("id"),
                safe(row.getString("category")),
                safe(row.getString("action")),
                safe(row.getString("actor")),
                safe(row.getString("subject")),
                row.getObject("product_id") == null ? null : row.getLong("product_id"),
                safe(row.getString("summary")),
                parseJson(row.getString("detail_json")),
                safe(row.getString("created_at"))
            )
        );
    }

    ProductRecord createProduct(String actor, CreateProductRequest payload) {
        String seller = StoreSupport.normalizeAddress(payload.seller());
        StoreSupport.requireAddress(seller, HttpStatus.BAD_REQUEST, "Seller must be a valid EVM address");
        StoreSupport.require(actor.equals(seller), HttpStatus.FORBIDDEN, "Seller can only create products for the connected wallet address");
        StoreSupport.require("approved".equals(getSellerStatus(seller).orElse(null)), HttpStatus.FORBIDDEN, "Seller address must be approved before creating products");
        String name = StoreSupport.requireNonBlank(payload.name(), HttpStatus.BAD_REQUEST, "Name is required");
        StoreSupport.requireUintString(payload.priceWei(), HttpStatus.BAD_REQUEST, "priceWei must be an unsigned integer string");

        jdbc.update(
            "INSERT INTO products (seller, name, price_wei, is_active, meta_json) VALUES (?, ?, ?, 1, ?)",
            seller, name, payload.priceWei(), stringify(payload.meta())
        );
        Long productId = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
        ProductRecord product = findProduct(productId);
        insertAudit("product", "create", actor, product.name(), product.productId(), "建立商品「" + product.name() + "」", Map.of(
            "seller", product.seller(),
            "priceWei", product.priceWei(),
            "isActive", product.isActive(),
            "meta", product.meta()
        ));
        return product;
    }

    ProductRecord updateProduct(String actor, long productId, UpdateProductRequest payload) {
        ProductRecord current = findProduct(productId);
        StoreSupport.require(current.seller().equals(actor) || isAdmin(actor), HttpStatus.FORBIDDEN, "Only the seller or admin can update this product");

        String nextName = payload.name() != null ? StoreSupport.requireNonBlank(payload.name(), HttpStatus.BAD_REQUEST, "Product name is required") : current.name();
        String nextPrice = payload.priceWei() != null ? payload.priceWei() : current.priceWei();
        StoreSupport.requireUintString(nextPrice, HttpStatus.BAD_REQUEST, "Price must be an unsigned integer string");
        boolean nextActive = payload.isActive() != null ? payload.isActive() : current.isActive();
        JsonNode nextMeta = payload.meta() != null ? payload.meta() : current.meta();

        jdbc.update(
            "UPDATE products SET name = ?, price_wei = ?, is_active = ?, meta_json = ? WHERE product_id = ?",
            nextName, nextPrice, nextActive ? 1 : 0, stringify(nextMeta), productId
        );
        ProductRecord updated = findProduct(productId);
        List<String> changed = new ArrayList<>();
        if (!Objects.equals(current.name(), updated.name())) changed.add("name");
        if (!Objects.equals(current.priceWei(), updated.priceWei())) changed.add("priceWei");
        if (current.isActive() != updated.isActive()) changed.add("isActive");
        if (!Objects.equals(current.meta(), updated.meta())) changed.add("meta");
        String action = changed.equals(List.of("isActive")) ? (updated.isActive() ? "reactivate" : "deactivate") : "update";
        String summary = switch (action) {
            case "reactivate" -> "重新上架商品「" + updated.name() + "」";
            case "deactivate" -> "下架商品「" + updated.name() + "」";
            default -> "更新商品「" + updated.name() + "」";
        };
        insertAudit("product", action, actor, updated.name(), updated.productId(), summary, Map.of(
            "seller", updated.seller(),
            "changedFields", changed,
            "priceWei", updated.priceWei(),
            "isActive", updated.isActive(),
            "meta", updated.meta()
        ));
        return updated;
    }

    SellersStore requestSeller(String actor, String address) {
        String normalized = StoreSupport.normalizeAddress(address);
        StoreSupport.requireAddress(normalized, HttpStatus.BAD_REQUEST, "Address must be a valid EVM address");
        StoreSupport.require(actor.equals(normalized), HttpStatus.FORBIDDEN, "Seller request address must match the connected wallet address");
        String current = getSellerStatus(normalized).orElse(null);
        if (!"approved".equals(current)) {
            String now = StoreSupport.nowIso();
            jdbc.update(
                """
                INSERT INTO sellers (address, status, created_at, updated_at)
                VALUES (?, 'pending', ?, ?)
                ON CONFLICT(address) DO UPDATE SET
                    status = CASE WHEN sellers.status = 'approved' THEN 'approved' ELSE 'pending' END,
                    updated_at = excluded.updated_at
                """,
                normalized, now, now
            );
            insertAudit("seller", "request", actor, normalized, null, "地址 " + normalized + " 送出賣家申請", Map.of(
                "address", normalized,
                "previousStatus", current,
                "nextStatus", "pending"
            ));
        }
        return loadSellersStore();
    }

    SellersStore approveSeller(String actor, String address, Boolean approved) {
        StoreSupport.require(isAdmin(actor), HttpStatus.FORBIDDEN, "Only the configured admin wallet can perform this action");
        String normalized = StoreSupport.normalizeAddress(address);
        StoreSupport.requireAddress(normalized, HttpStatus.BAD_REQUEST, "Address must be a valid EVM address");
        String nextStatus = Boolean.FALSE.equals(approved) ? "pending" : "approved";
        String previous = getSellerStatus(normalized).orElse(null);
        String now = StoreSupport.nowIso();
        jdbc.update(
            """
            INSERT INTO sellers (address, status, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(address) DO UPDATE SET
                status = excluded.status,
                updated_at = excluded.updated_at
            """,
            normalized, nextStatus, now, now
        );
        insertAudit("seller", "approved".equals(nextStatus) ? "approve" : "mark_pending", actor, normalized, null,
            "approved".equals(nextStatus) ? "管理員核准 " + normalized + " 成為賣家" : "管理員將 " + normalized + " 設回審核中",
            Map.of("address", normalized, "previousStatus", previous, "nextStatus", nextStatus));
        return loadSellersStore();
    }

    OrderRecord saveOrderMeta(String actor, CreateOrderRequest payload) {
        StoreSupport.require(payload.orderId() > 0, HttpStatus.BAD_REQUEST, "Order ID required");
        String buyer = payload.buyer() == null || payload.buyer().isBlank() ? actor : StoreSupport.normalizeAddress(payload.buyer());
        StoreSupport.requireAddress(buyer, HttpStatus.BAD_REQUEST, "buyer must be a valid EVM address");
        StoreSupport.require(actor.equals(buyer), HttpStatus.FORBIDDEN, "buyer must match the connected wallet address");
        if (payload.productSeller() != null && !payload.productSeller().isBlank()) {
            StoreSupport.requireAddress(StoreSupport.normalizeAddress(payload.productSeller()), HttpStatus.BAD_REQUEST, "productSeller must be a valid EVM address");
        }
        String priceWei = payload.priceWei() == null || payload.priceWei().isBlank() ? "0" : payload.priceWei();
        StoreSupport.requireUintString(priceWei, HttpStatus.BAD_REQUEST, "priceWei must be an unsigned integer string");
        OrderRecord current = findOrder(payload.orderId()).orElse(new OrderRecord(0, "", 0, "", "", "0", (short) 1));
        jdbc.update(
            """
            INSERT INTO orders (order_id, buyer, product_id, product_name, product_seller, price_wei, flow_stage)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
                buyer = excluded.buyer,
                product_id = excluded.product_id,
                product_name = excluded.product_name,
                product_seller = excluded.product_seller,
                price_wei = excluded.price_wei,
                flow_stage = excluded.flow_stage
            """,
            payload.orderId(),
            buyer,
            payload.productId() == null ? current.productId() : payload.productId(),
            payload.productName() == null ? current.productName() : payload.productName(),
            payload.productSeller() == null ? current.productSeller() : StoreSupport.normalizeAddress(payload.productSeller()),
            priceWei,
            payload.flowStage() == null ? Math.max(1, current.flowStage()) : Math.max(1, payload.flowStage())
        );
        return findOrder(payload.orderId()).orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Order was not saved"));
    }

    OrderRecord updateOrderFlow(String actor, long orderId, UpdateOrderFlowRequest payload) {
        OrderRecord current = findOrder(orderId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));
        StoreSupport.require(current.productSeller().equals(actor) || isAdmin(actor), HttpStatus.FORBIDDEN, "Only the seller or admin can update order flow");
        int nextStage = payload.flowStage() == null ? current.flowStage() : payload.flowStage();
        short clamped = (short) Math.max(1, Math.min(4, nextStage));
        jdbc.update("UPDATE orders SET flow_stage = ? WHERE order_id = ?", clamped, orderId);
        return findOrder(orderId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));
    }

    ReviewRecord saveReview(String actor, CreateReviewRequest payload) {
        StoreSupport.require(payload.orderId() > 0, HttpStatus.BAD_REQUEST, "Order ID required");
        StoreSupport.require(payload.rating() >= 1 && payload.rating() <= 5, HttpStatus.BAD_REQUEST, "Rating required");
        String buyer = StoreSupport.normalizeAddress(payload.buyer());
        String seller = StoreSupport.normalizeAddress(payload.seller());
        StoreSupport.requireAddress(buyer, HttpStatus.BAD_REQUEST, "Buyer and seller must be valid EVM addresses");
        StoreSupport.requireAddress(seller, HttpStatus.BAD_REQUEST, "Buyer and seller must be valid EVM addresses");
        StoreSupport.require(actor.equals(buyer), HttpStatus.FORBIDDEN, "Only the buyer can create or update the review");
        String createdAt = payload.createdAt() == null || payload.createdAt().isBlank() ? StoreSupport.nowIso() : payload.createdAt();
        jdbc.update(
            """
            INSERT INTO reviews (order_id, product_id, product_name, seller, buyer, rating, comment, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
                product_id = excluded.product_id,
                product_name = excluded.product_name,
                seller = excluded.seller,
                buyer = excluded.buyer,
                rating = excluded.rating,
                comment = excluded.comment,
                created_at = excluded.created_at
            """,
            payload.orderId(),
            payload.productId() == null ? 0 : payload.productId(),
            safe(payload.productName()),
            seller,
            buyer,
            payload.rating(),
            safe(payload.comment()),
            createdAt
        );
        return findReview(payload.orderId()).orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Review was not saved"));
    }

    PayoutRecord savePayout(String actor, CreatePayoutRequest payload) {
        StoreSupport.require(payload.orderId() > 0, HttpStatus.BAD_REQUEST, "Order ID required");
        String seller = StoreSupport.normalizeAddress(payload.seller());
        String buyer = StoreSupport.normalizeAddress(payload.buyer());
        StoreSupport.requireAddress(seller, HttpStatus.BAD_REQUEST, "Buyer and seller must be valid EVM addresses");
        StoreSupport.requireAddress(buyer, HttpStatus.BAD_REQUEST, "Buyer and seller must be valid EVM addresses");
        StoreSupport.require(actor.equals(seller), HttpStatus.FORBIDDEN, "Only the seller can save payout history");
        String amountWei = payload.amountWei() == null ? "0" : payload.amountWei();
        StoreSupport.requireUintString(amountWei, HttpStatus.BAD_REQUEST, "amountWei must be an unsigned integer string");
        String createdAt = payload.createdAt() == null || payload.createdAt().isBlank() ? StoreSupport.nowIso() : payload.createdAt();
        jdbc.update(
            """
            INSERT INTO payouts (order_id, seller, buyer, product_id, product_name, amount_wei, tx_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
                seller = excluded.seller,
                buyer = excluded.buyer,
                product_id = excluded.product_id,
                product_name = excluded.product_name,
                amount_wei = excluded.amount_wei,
                tx_hash = excluded.tx_hash,
                created_at = excluded.created_at
            """,
            payload.orderId(),
            seller,
            buyer,
            payload.productId() == null ? 0 : payload.productId(),
            safe(payload.productName()),
            amountWei,
            safe(payload.txHash()),
            createdAt
        );
        return findPayout(payload.orderId()).orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Payout was not saved"));
    }

    UploadResponse uploadImage(String actor, MultipartFile image) {
        StoreSupport.require(actor != null && !actor.isBlank(), HttpStatus.UNAUTHORIZED, "Missing actor");
        StoreSupport.require(image != null && !image.isEmpty(), HttpStatus.BAD_REQUEST, "Missing image file");
        StoreSupport.require(image.getSize() <= 5L * 1024L * 1024L, HttpStatus.BAD_REQUEST, "Image file too large");
        String original = image.getOriginalFilename() == null ? "product-image" : image.getOriginalFilename().toLowerCase(Locale.ROOT);
        String extension = original.endsWith(".png") ? "png" :
            original.endsWith(".jpg") || original.endsWith(".jpeg") ? "jpg" :
            original.endsWith(".webp") ? "webp" :
            original.endsWith(".gif") ? "gif" : "jpg";
        String filename = "product-" + UUID.randomUUID().toString().replace("-", "") + "." + extension;
        try {
            image.transferTo(paths.uploadsDir.resolve(filename));
        } catch (IOException error) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to save uploaded image");
        }
        return new UploadResponse("/uploads/products/" + filename, filename);
    }

    Map<String, Object> adminDashboard() {
        List<ProductRecord> products = loadProducts();
        List<ReviewRecord> reviews = loadReviews();
        List<PayoutRecord> payouts = loadPayouts();
        Map<String, OrderRecord> orders = loadOrdersMap();
        SellersStore sellers = loadSellersStore();
        return Map.of(
            "metrics", Map.of(
                "approvedSellers", sellers.approved().size(),
                "pendingSellers", sellers.pending().size(),
                "activeProducts", products.stream().filter(ProductRecord::isActive).count(),
                "inactiveProducts", products.stream().filter(item -> !item.isActive()).count(),
                "orders", orders.size(),
                "reviews", reviews.size(),
                "payouts", payouts.size()
            ),
            "products", products,
            "orders", orders,
            "reviews", reviews,
            "payouts", payouts,
            "sellers", sellers,
            "auditLogs", loadAuditLogs()
        );
    }

    Map<String, Object> sellerDashboard(String actor) {
        String sellerStatus = isAdmin(actor) ? "approved" : getSellerStatus(actor).orElse("guest");
        StoreSupport.require("approved".equals(sellerStatus), HttpStatus.FORBIDDEN, "Only approved sellers can access seller dashboard data");
        return Map.of(
            "seller", actor,
            "sellerStatus", sellerStatus,
            "products", loadProducts().stream().filter(item -> item.seller().equals(actor)).toList(),
            "orders", loadOrdersMap().values().stream().filter(item -> item.productSeller().equals(actor)).toList(),
            "reviews", loadReviews().stream().filter(item -> item.seller().equals(actor)).toList(),
            "payouts", loadPayouts().stream().filter(item -> item.seller().equals(actor)).toList(),
            "auditLogs", loadAuditLogs().stream().filter(item -> item.actor().equals(actor) || item.subject().equals(actor)).toList()
        );
    }

    Map<String, Object> buyerDashboard(String actor) {
        return Map.of(
            "buyer", actor,
            "orders", loadOrdersMap().values().stream().filter(item -> item.buyer().equals(actor)).toList(),
            "reviews", loadReviews().stream().filter(item -> item.buyer().equals(actor)).toList(),
            "payouts", loadPayouts().stream().filter(item -> item.buyer().equals(actor)).toList()
        );
    }

    Map<String, Object> myDashboard(String actor) {
        boolean admin = isAdmin(actor);
        String sellerStatus = admin ? "approved" : getSellerStatus(actor).orElse("guest");
        return Map.of(
            "actor", actor,
            "isAdmin", admin,
            "sellerStatus", sellerStatus,
            "orders", loadOrdersMap().values().stream().filter(item -> item.buyer().equals(actor) || item.productSeller().equals(actor)).toList(),
            "reviews", loadReviews().stream().filter(item -> item.buyer().equals(actor) || item.seller().equals(actor)).toList(),
            "payouts", loadPayouts().stream().filter(item -> item.buyer().equals(actor) || item.seller().equals(actor)).toList()
        );
    }

    private Optional<String> getSellerStatus(String address) {
        List<String> rows = jdbc.query(
            "SELECT status FROM sellers WHERE lower(address) = lower(?)",
            (row, index) -> row.getString("status"),
            address
        );
        return rows.stream().findFirst();
    }

    private ProductRecord findProduct(Long productId) {
        List<ProductRecord> rows = jdbc.query(
            "SELECT product_id, seller, name, price_wei, is_active, meta_json FROM products WHERE product_id = ?",
            (row, index) -> mapProduct(row),
            productId
        );
        return rows.stream().findFirst().orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Product not found"));
    }

    private Optional<OrderRecord> findOrder(long orderId) {
        List<OrderRecord> rows = jdbc.query(
            "SELECT order_id, buyer, product_id, product_name, product_seller, price_wei, flow_stage FROM orders WHERE order_id = ?",
            (row, index) -> mapOrder(row),
            orderId
        );
        return rows.stream().findFirst();
    }

    private Optional<ReviewRecord> findReview(long orderId) {
        List<ReviewRecord> rows = jdbc.query(
            "SELECT order_id, product_id, product_name, seller, buyer, rating, comment, created_at FROM reviews WHERE order_id = ?",
            (row, index) -> new ReviewRecord(
                row.getLong("order_id"),
                row.getLong("product_id"),
                safe(row.getString("product_name")),
                safe(row.getString("seller")),
                safe(row.getString("buyer")),
                row.getInt("rating"),
                safe(row.getString("comment")),
                safe(row.getString("created_at"))
            ),
            orderId
        );
        return rows.stream().findFirst();
    }

    private Optional<PayoutRecord> findPayout(long orderId) {
        List<PayoutRecord> rows = jdbc.query(
            "SELECT order_id, seller, buyer, product_id, product_name, amount_wei, tx_hash, created_at FROM payouts WHERE order_id = ?",
            (row, index) -> new PayoutRecord(
                row.getLong("order_id"),
                safe(row.getString("seller")),
                safe(row.getString("buyer")),
                row.getLong("product_id"),
                safe(row.getString("product_name")),
                safe(row.getString("amount_wei")),
                safe(row.getString("tx_hash")),
                safe(row.getString("created_at"))
            ),
            orderId
        );
        return rows.stream().findFirst();
    }

    private ProductRecord mapProduct(ResultSet row) throws SQLException {
        return new ProductRecord(
            row.getLong("product_id"),
            safe(row.getString("seller")),
            safe(row.getString("name")),
            safe(row.getString("price_wei")),
            row.getInt("is_active") == 1,
            parseJson(row.getString("meta_json"))
        );
    }

    private OrderRecord mapOrder(ResultSet row) throws SQLException {
        return new OrderRecord(
            row.getLong("order_id"),
            StoreSupport.normalizeAddress(safe(row.getString("buyer"))),
            row.getLong("product_id"),
            safe(row.getString("product_name")),
            StoreSupport.normalizeAddress(safe(row.getString("product_seller"))),
            safe(row.getString("price_wei")),
            row.getShort("flow_stage")
        );
    }

    private void insertAudit(String category, String action, String actor, String subject, Long productId, String summary, Map<String, ?> detail) {
        jdbc.update(
            "INSERT INTO audit_logs (category, action, actor, subject, product_id, summary, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            category,
            action,
            actor,
            safe(subject),
            productId,
            summary,
            stringify(mapper.valueToTree(detail)),
            StoreSupport.nowIso()
        );
    }

    private JsonNode parseJson(String raw) {
        try {
            if (raw == null || raw.isBlank()) {
                return mapper.createObjectNode();
            }
            return mapper.readTree(raw);
        } catch (IOException error) {
            return mapper.createObjectNode();
        }
    }

    private String stringify(JsonNode node) {
        try {
            return mapper.writeValueAsString(node == null ? mapper.createObjectNode() : node);
        } catch (IOException error) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to serialize JSON");
        }
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }
}
