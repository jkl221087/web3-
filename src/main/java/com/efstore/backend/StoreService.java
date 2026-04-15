
package com.efstore.backend;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Value;
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
import java.util.Set;
import java.util.UUID;

@Service
class StoreService {
    private static final Set<String> RISK_STATUSES = Set.of("clear", "review", "blocked");
    private static final Set<String> SCREENING_STATUSES = Set.of("pending", "clear", "suspicious", "sanction_hit", "failed");
    private static final Set<String> CASE_TYPES = Set.of("aml", "sanctions", "fraud", "dispute");
    private static final Set<String> CASE_SEVERITIES = Set.of("low", "medium", "high", "critical");
    private static final Set<String> CASE_STATUSES = Set.of("open", "reviewing", "escalated", "resolved", "closed");
    private static final Set<String> PAYOUT_STATUSES = Set.of("pending", "approved", "blocked", "broadcasted", "confirmed", "failed");
    private static final Set<String> AML_REVIEW_STATUSES = Set.of("clear", "review", "blocked");

    private static final String ORDER_SELECT = """
            SELECT order_id, buyer, product_id, product_name, product_seller, price_wei, flow_stage,
                   commerce_status, settlement_status, dispute_status, risk_status, risk_score, screening_status,
                   screening_reason, pay_state, complete_state, seller_withdrawn, frozen, payout_blocked,
                   funded_at, release_eligible_at, received_at, settled_at
            FROM orders
            """;

    private static final String PAYOUT_SELECT = """
            SELECT order_id, seller, buyer, product_id, product_name, amount_wei, tx_hash, created_at,
                   payout_status, aml_review_status, approved_by
            FROM payouts
            """;

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final StorePaths paths;
    private final String adminAddress;

    StoreService(
            JdbcTemplate jdbc,
            ObjectMapper mapper,
            StorePaths paths,
            @Value("${app.admin-wallet-address:}") String configuredAdmin) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        this.paths = paths;
        this.adminAddress = (configuredAdmin == null || configuredAdmin.isBlank())
                ? null
                : StoreSupport.normalizeAddress(configuredAdmin);
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
                    risk_tier TEXT NOT NULL DEFAULT 'low',
                    kyc_level TEXT NOT NULL DEFAULT 'none',
                    kyb_status TEXT NOT NULL DEFAULT 'pending',
                    payout_wallet TEXT NOT NULL DEFAULT '',
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
                    flow_stage INTEGER NOT NULL DEFAULT 1,
                    commerce_status TEXT NOT NULL DEFAULT 'paid',
                    settlement_status TEXT NOT NULL DEFAULT 'funded',
                    dispute_status TEXT NOT NULL DEFAULT 'none',
                    risk_status TEXT NOT NULL DEFAULT 'clear',
                    risk_score REAL NOT NULL DEFAULT 0,
                    screening_status TEXT NOT NULL DEFAULT 'clear',
                    screening_reason TEXT NOT NULL DEFAULT '',
                    pay_state INTEGER NOT NULL DEFAULT 1,
                    complete_state INTEGER NOT NULL DEFAULT 0,
                    seller_withdrawn INTEGER NOT NULL DEFAULT 0,
                    frozen INTEGER NOT NULL DEFAULT 0,
                    payout_blocked INTEGER NOT NULL DEFAULT 0,
                    funded_at TEXT,
                    release_eligible_at TEXT,
                    received_at TEXT,
                    settled_at TEXT
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
                    created_at TEXT NOT NULL,
                    payout_status TEXT NOT NULL DEFAULT 'confirmed',
                    aml_review_status TEXT NOT NULL DEFAULT 'clear',
                    approved_by TEXT NOT NULL DEFAULT ''
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
        jdbc.execute("""
                CREATE TABLE IF NOT EXISTS risk_cases (
                    case_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_id INTEGER,
                    case_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'open',
                    reason_code TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    opened_by TEXT NOT NULL DEFAULT '',
                    resolved_by TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL,
                    resolved_at TEXT NOT NULL DEFAULT ''
                )
                """);

        ensureColumn("orders", "buyer", "ALTER TABLE orders ADD COLUMN buyer TEXT NOT NULL DEFAULT ''");
        ensureColumn("orders", "commerce_status", "ALTER TABLE orders ADD COLUMN commerce_status TEXT NOT NULL DEFAULT 'paid'");
        ensureColumn("orders", "settlement_status", "ALTER TABLE orders ADD COLUMN settlement_status TEXT NOT NULL DEFAULT 'funded'");
        ensureColumn("orders", "dispute_status", "ALTER TABLE orders ADD COLUMN dispute_status TEXT NOT NULL DEFAULT 'none'");
        ensureColumn("orders", "risk_status", "ALTER TABLE orders ADD COLUMN risk_status TEXT NOT NULL DEFAULT 'clear'");
        ensureColumn("orders", "risk_score", "ALTER TABLE orders ADD COLUMN risk_score REAL NOT NULL DEFAULT 0");
        ensureColumn("orders", "screening_status", "ALTER TABLE orders ADD COLUMN screening_status TEXT NOT NULL DEFAULT 'clear'");
        ensureColumn("orders", "screening_reason", "ALTER TABLE orders ADD COLUMN screening_reason TEXT NOT NULL DEFAULT ''");
        ensureColumn("orders", "pay_state", "ALTER TABLE orders ADD COLUMN pay_state INTEGER NOT NULL DEFAULT 1");
        ensureColumn("orders", "complete_state", "ALTER TABLE orders ADD COLUMN complete_state INTEGER NOT NULL DEFAULT 0");
        ensureColumn("orders", "seller_withdrawn", "ALTER TABLE orders ADD COLUMN seller_withdrawn INTEGER NOT NULL DEFAULT 0");
        ensureColumn("orders", "frozen", "ALTER TABLE orders ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0");
        ensureColumn("orders", "payout_blocked", "ALTER TABLE orders ADD COLUMN payout_blocked INTEGER NOT NULL DEFAULT 0");
        ensureColumn("orders", "funded_at", "ALTER TABLE orders ADD COLUMN funded_at TEXT");
        ensureColumn("orders", "release_eligible_at", "ALTER TABLE orders ADD COLUMN release_eligible_at TEXT");
        ensureColumn("orders", "received_at", "ALTER TABLE orders ADD COLUMN received_at TEXT");
        ensureColumn("orders", "settled_at", "ALTER TABLE orders ADD COLUMN settled_at TEXT");

        ensureColumn("payouts", "payout_status", "ALTER TABLE payouts ADD COLUMN payout_status TEXT NOT NULL DEFAULT 'confirmed'");
        ensureColumn("payouts", "aml_review_status", "ALTER TABLE payouts ADD COLUMN aml_review_status TEXT NOT NULL DEFAULT 'clear'");
        ensureColumn("payouts", "approved_by", "ALTER TABLE payouts ADD COLUMN approved_by TEXT NOT NULL DEFAULT ''");

        ensureColumn("sellers", "risk_tier", "ALTER TABLE sellers ADD COLUMN risk_tier TEXT NOT NULL DEFAULT 'low'");
        ensureColumn("sellers", "kyc_level", "ALTER TABLE sellers ADD COLUMN kyc_level TEXT NOT NULL DEFAULT 'none'");
        ensureColumn("sellers", "kyb_status", "ALTER TABLE sellers ADD COLUMN kyb_status TEXT NOT NULL DEFAULT 'pending'");
        ensureColumn("sellers", "payout_wallet", "ALTER TABLE sellers ADD COLUMN payout_wallet TEXT NOT NULL DEFAULT ''");

        try {
            java.nio.file.Files.createDirectories(paths.uploadsDir);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to create uploads directory", e);
        }
    }

    String requireActor(HttpServletRequest request, String actorHeader, AuthService authService) {
        String actor = authService.resolveActor(request, actorHeader)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Missing authenticated actor"));
        return StoreSupport.normalizeAddress(actor);
    }

    boolean isAdmin(String actor) {
        if (actor == null || adminAddress == null) {
            return false;
        }
        return adminAddress.equals(StoreSupport.normalizeAddress(actor));
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
                (row, index) -> mapProduct(row));
    }

    SellersStore loadSellersStore() {
        List<Map<String, Object>> rows = jdbc.queryForList(
                "SELECT address, status FROM sellers ORDER BY updated_at DESC, address ASC");
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
        jdbc.query(ORDER_SELECT + " ORDER BY order_id DESC", (ResultSet row) ->
                records.put(String.valueOf(row.getLong("order_id")), mapOrder(row)));
        return records;
    }

    List<OrderRecord> loadBuyerOrders(String actor) {
        String normalizedActor = StoreSupport.normalizeAddress(actor);
        return jdbc.query(
                ORDER_SELECT + " WHERE lower(buyer) = lower(?) ORDER BY order_id DESC",
                (row, index) -> mapOrder(row),
                normalizedActor);
    }

    List<OrderRecord> loadSellerOrders(String actor) {
        String normalizedActor = StoreSupport.normalizeAddress(actor);
        return jdbc.query(
                ORDER_SELECT + " WHERE lower(product_seller) = lower(?) ORDER BY order_id DESC",
                (row, index) -> mapOrder(row),
                normalizedActor);
    }

    List<OrderRecord> loadAllOrders(String actor) {
        String normalizedActor = StoreSupport.normalizeAddress(actor);
        StoreSupport.require(isAdmin(normalizedActor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");
        return jdbc.query(ORDER_SELECT + " ORDER BY order_id DESC", (row, index) -> mapOrder(row));
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
                        safe(row.getString("created_at"))));
    }

    List<PayoutRecord> loadPayouts() {
        return jdbc.query(
                PAYOUT_SELECT + " ORDER BY datetime(created_at) DESC, order_id DESC",
                (row, index) -> mapPayout(row));
    }

    List<AuditLogRecord> loadAuditLogs() {
        return jdbc.query(
                "SELECT id, category, action, actor, subject, product_id, summary, detail_json, created_at FROM audit_logs ORDER BY id DESC LIMIT 80",
                (row, index) -> new AuditLogRecord(
                        row.getLong("id"),
                        safe(row.getString("category")),
                        safe(row.getString("action")),
                        safe(row.getString("actor")),
                        safe(row.getString("subject")),
                        row.getObject("product_id") == null ? null : row.getLong("product_id"),
                        safe(row.getString("summary")),
                        parseJson(row.getString("detail_json")),
                        safe(row.getString("created_at"))));
    }

    List<RiskCaseRecord> loadRiskCases(String actor) {
        StoreSupport.require(isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");
        return jdbc.query(
                """
                SELECT case_id, order_id, case_type, severity, status, reason_code, notes,
                       opened_by, resolved_by, created_at, resolved_at
                FROM risk_cases
                ORDER BY case_id DESC
                """,
                (row, index) -> new RiskCaseRecord(
                        row.getLong("case_id"),
                        row.getObject("order_id") == null ? null : row.getLong("order_id"),
                        safe(row.getString("case_type")),
                        safe(row.getString("severity")),
                        safe(row.getString("status")),
                        safe(row.getString("reason_code")),
                        safe(row.getString("notes")),
                        safe(row.getString("opened_by")),
                        safe(row.getString("resolved_by")),
                        safe(row.getString("created_at")),
                        safe(row.getString("resolved_at"))));
    }

    ProductRecord createProduct(String actor, CreateProductRequest payload) {
        String seller = StoreSupport.normalizeAddress(payload.seller());
        StoreSupport.requireAddress(seller, HttpStatus.BAD_REQUEST, "Seller must be a valid EVM address");
        StoreSupport.require(actor.equals(seller), HttpStatus.FORBIDDEN,
                "Seller can only create products for the connected wallet address");
        StoreSupport.require("approved".equals(getSellerStatus(seller).orElse(null)), HttpStatus.FORBIDDEN,
                "Seller address must be approved before creating products");

        String name = StoreSupport.requireNonBlank(payload.name(), HttpStatus.BAD_REQUEST, "Name is required");
        StoreSupport.requireUintString(payload.priceWei(), HttpStatus.BAD_REQUEST,
                "priceWei must be an unsigned integer string");

        jdbc.update(
                "INSERT INTO products (seller, name, price_wei, is_active, meta_json) VALUES (?, ?, ?, 1, ?)",
                seller, name, payload.priceWei(), stringify(payload.meta()));

        Long productId = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
        ProductRecord product = findProduct(productId);

        insertAudit("product", "create", actor, product.name(), product.productId(),
                "建立商品「" + product.name() + "」",
                detailMap(
                        "seller", product.seller(),
                        "priceWei", product.priceWei(),
                        "isActive", product.isActive(),
                        "meta", product.meta()));

        return product;
    }

    ProductRecord updateProduct(String actor, long productId, UpdateProductRequest payload) {
        ProductRecord current = findProduct(productId);
        StoreSupport.require(current.seller().equals(actor) || isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the seller or admin can update this product");

        String nextName = payload.name() != null
                ? StoreSupport.requireNonBlank(payload.name(), HttpStatus.BAD_REQUEST, "Product name is required")
                : current.name();
        String nextPrice = payload.priceWei() != null ? payload.priceWei() : current.priceWei();
        StoreSupport.requireUintString(nextPrice, HttpStatus.BAD_REQUEST,
                "Price must be an unsigned integer string");
        boolean nextActive = payload.isActive() != null ? payload.isActive() : current.isActive();
        JsonNode nextMeta = payload.meta() != null ? payload.meta() : current.meta();

        jdbc.update(
                "UPDATE products SET name = ?, price_wei = ?, is_active = ?, meta_json = ? WHERE product_id = ?",
                nextName, nextPrice, nextActive ? 1 : 0, stringify(nextMeta), productId);

        ProductRecord updated = findProduct(productId);
        List<String> changed = new ArrayList<>();
        if (!Objects.equals(current.name(), updated.name())) changed.add("name");
        if (!Objects.equals(current.priceWei(), updated.priceWei())) changed.add("priceWei");
        if (current.isActive() != updated.isActive()) changed.add("isActive");
        if (!Objects.equals(current.meta(), updated.meta())) changed.add("meta");

        String action = changed.equals(List.of("isActive"))
                ? (updated.isActive() ? "reactivate" : "deactivate")
                : "update";
        String summary = switch (action) {
            case "reactivate" -> "重新上架商品「" + updated.name() + "」";
            case "deactivate" -> "下架商品「" + updated.name() + "」";
            default -> "更新商品「" + updated.name() + "」";
        };

        insertAudit("product", action, actor, updated.name(), updated.productId(), summary,
                detailMap(
                        "seller", updated.seller(),
                        "changedFields", changed,
                        "priceWei", updated.priceWei(),
                        "isActive", updated.isActive(),
                        "meta", updated.meta()));

        return updated;
    }

    SellersStore requestSeller(String actor, SellerRequest payload) {
        String normalized = StoreSupport.normalizeAddress(actor);
        String current = getSellerStatus(normalized).orElse(null);

        if (!"approved".equals(current)) {
            String now = StoreSupport.nowIso();
            jdbc.update(
                    """
                    INSERT INTO sellers (address, status, risk_tier, kyc_level, kyb_status, payout_wallet, created_at, updated_at)
                    VALUES (?, 'pending', 'low', 'none', 'pending', ?, ?, ?)
                    ON CONFLICT(address) DO UPDATE SET
                        status = CASE WHEN sellers.status = 'approved' THEN 'approved' ELSE 'pending' END,
                        updated_at = excluded.updated_at
                    """,
                    normalized, normalized, now, now);

            insertAudit("seller", "request", actor, normalized, null, "地址 " + normalized + " 送出賣家申請",
                    detailMap(
                            "address", normalized,
                            "previousStatus", current,
                            "nextStatus", "pending"));
        }

        return loadSellersStore();
    }

    SellersStore approveSeller(String actor, String address, Boolean approved) {
        StoreSupport.require(isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");

        String normalized = StoreSupport.normalizeAddress(address);
        StoreSupport.requireAddress(normalized, HttpStatus.BAD_REQUEST, "Address must be a valid EVM address");

        String nextStatus = Boolean.FALSE.equals(approved) ? "pending" : "approved";
        String previous = getSellerStatus(normalized).orElse(null);
        String now = StoreSupport.nowIso();

        jdbc.update(
                """
                INSERT INTO sellers (address, status, risk_tier, kyc_level, kyb_status, payout_wallet, created_at, updated_at)
                VALUES (?, ?, 'low', 'basic', 'pending', ?, ?, ?)
                ON CONFLICT(address) DO UPDATE SET
                    status = excluded.status,
                    updated_at = excluded.updated_at
                """,
                normalized, nextStatus, normalized, now, now);

        insertAudit("seller", "approved".equals(nextStatus) ? "approve" : "mark_pending", actor, normalized, null,
                "approved".equals(nextStatus)
                        ? "管理員核准 " + normalized + " 成為賣家"
                        : "管理員將 " + normalized + " 設回審核中",
                detailMap(
                        "address", normalized,
                        "previousStatus", previous,
                        "nextStatus", nextStatus));

        return loadSellersStore();
    }

    OrderRecord saveOrderMeta(String actor, CreateOrderRequest payload) {
        StoreSupport.require(payload.orderId() > 0, HttpStatus.BAD_REQUEST, "Order ID required");

        String buyer = payload.buyer() == null || payload.buyer().isBlank()
                ? actor
                : StoreSupport.normalizeAddress(payload.buyer());
        StoreSupport.requireAddress(buyer, HttpStatus.BAD_REQUEST, "buyer must be a valid EVM address");
        StoreSupport.require(actor.equals(buyer), HttpStatus.FORBIDDEN,
                "buyer must match the connected wallet address");

        String productSeller = "";
        if (payload.productSeller() != null && !payload.productSeller().isBlank()) {
            productSeller = StoreSupport.normalizeAddress(payload.productSeller());
            StoreSupport.requireAddress(productSeller, HttpStatus.BAD_REQUEST,
                    "productSeller must be a valid EVM address");
        }

        String priceWei = payload.priceWei() == null || payload.priceWei().isBlank() ? "0" : payload.priceWei();
        StoreSupport.requireUintString(priceWei, HttpStatus.BAD_REQUEST,
                "priceWei must be an unsigned integer string");

        OrderRecord current = findOrder(payload.orderId()).orElse(blankOrder());

        short flowStage = (short) Math.max(1, Math.min(4,
                payload.flowStage() == null ? Math.max(1, current.flowStage()) : payload.flowStage()));
        String commerceStatus = commerceStatusForFlow(flowStage);
        String settlementStatus = settlementStatusForFlow(flowStage);
        String fundedAt = safe(current.fundedAt()).isBlank() ? StoreSupport.nowIso() : current.fundedAt();

        jdbc.update(
                """
                INSERT INTO orders (
                    order_id, buyer, product_id, product_name, product_seller, price_wei, flow_stage,
                    commerce_status, settlement_status, dispute_status, risk_status, risk_score, screening_status,
                    screening_reason, pay_state, complete_state, seller_withdrawn, frozen, payout_blocked,
                    funded_at, release_eligible_at, received_at, settled_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(order_id) DO UPDATE SET
                    buyer = excluded.buyer,
                    product_id = excluded.product_id,
                    product_name = excluded.product_name,
                    product_seller = excluded.product_seller,
                    price_wei = excluded.price_wei,
                    flow_stage = excluded.flow_stage,
                    commerce_status = excluded.commerce_status,
                    settlement_status = excluded.settlement_status,
                    pay_state = excluded.pay_state,
                    funded_at = COALESCE(orders.funded_at, excluded.funded_at)
                """,
                payload.orderId(),
                buyer,
                payload.productId() == null ? current.productId() : payload.productId(),
                payload.productName() == null ? current.productName() : payload.productName(),
                productSeller.isBlank() ? current.productSeller() : productSeller,
                priceWei,
                flowStage,
                commerceStatus,
                settlementStatus,
                current.disputeStatus(),
                current.riskStatus(),
                current.riskScore(),
                current.screeningStatus(),
                current.screeningReason(),
                1,
                current.completeState() ? 1 : 0,
                current.sellerWithdrawn() ? 1 : 0,
                current.frozen() ? 1 : 0,
                current.payoutBlocked() ? 1 : 0,
                fundedAt,
                current.releaseEligibleAt(),
                current.receivedAt(),
                current.settledAt());

        OrderRecord saved = findOrder(payload.orderId())
                .orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Order was not saved"));

        insertAudit("order", "create", actor, String.valueOf(saved.orderId()), saved.productId(),
                "建立訂單 #" + saved.orderId(),
                detailMap(
                        "buyer", saved.buyer(),
                        "seller", saved.productSeller(),
                        "productName", saved.productName(),
                        "priceWei", saved.priceWei(),
                        "flowStage", saved.flowStage(),
                        "riskStatus", saved.riskStatus()));

        return saved;
    }

    OrderRecord updateOrderFlow(String actor, long orderId, UpdateOrderFlowRequest payload) {
        OrderRecord current = findOrder(orderId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));

        StoreSupport.require(current.productSeller().equals(actor) || isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the seller or admin can update order flow");

        int nextStage = payload.flowStage() == null ? current.flowStage() : payload.flowStage();
        short clamped = (short) Math.max(1, Math.min(4, nextStage));
        String commerceStatus = commerceStatusForFlow(clamped);
        String settlementStatus = settlementStatusForFlow(clamped);

        jdbc.update(
                "UPDATE orders SET flow_stage = ?, commerce_status = ?, settlement_status = ? WHERE order_id = ?",
                clamped, commerceStatus, settlementStatus, orderId);

        OrderRecord updated = findOrder(orderId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));

        insertAudit("order", "flow_update", actor, String.valueOf(orderId), updated.productId(),
                "更新訂單 #" + orderId + " 的物流節點",
                detailMap(
                        "previousFlowStage", current.flowStage(),
                        "nextFlowStage", updated.flowStage(),
                        "commerceStatus", updated.commerceStatus(),
                        "settlementStatus", updated.settlementStatus()));

        return updated;
    }

    OrderRecord updateOrderRisk(String actor, long orderId, UpdateOrderRiskRequest payload) {
        StoreSupport.require(isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");

        OrderRecord current = findOrder(orderId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));

        String nextRiskStatus = payload.riskStatus() == null ? current.riskStatus() : payload.riskStatus().trim().toLowerCase(Locale.ROOT);
        String nextScreeningStatus = payload.screeningStatus() == null
                ? current.screeningStatus()
                : payload.screeningStatus().trim().toLowerCase(Locale.ROOT);

        StoreSupport.requireOneOf(nextRiskStatus, RISK_STATUSES, HttpStatus.BAD_REQUEST, "Invalid riskStatus");
        StoreSupport.requireOneOf(nextScreeningStatus, SCREENING_STATUSES, HttpStatus.BAD_REQUEST, "Invalid screeningStatus");

        double nextRiskScore = payload.riskScore() == null ? current.riskScore() : payload.riskScore();
        StoreSupport.require(nextRiskScore >= 0, HttpStatus.BAD_REQUEST, "riskScore must be >= 0");

        boolean riskRequiresHold = "blocked".equals(nextRiskStatus) || "review".equals(nextRiskStatus);
        boolean nextPayoutBlocked = payload.payoutBlocked() != null
                ? (payload.payoutBlocked() || riskRequiresHold)
                : current.payoutBlocked() || riskRequiresHold;

        String nextScreeningReason = payload.screeningReason() == null ? current.screeningReason() : safe(payload.screeningReason());

        jdbc.update(
                """
                UPDATE orders
                SET risk_status = ?, risk_score = ?, screening_status = ?, screening_reason = ?, payout_blocked = ?
                WHERE order_id = ?
                """,
                nextRiskStatus,
                nextRiskScore,
                nextScreeningStatus,
                nextScreeningReason,
                nextPayoutBlocked ? 1 : 0,
                orderId);

        OrderRecord updated = findOrder(orderId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));

        insertAudit("compliance", "risk_update", actor, String.valueOf(orderId), updated.productId(),
                "更新訂單 #" + orderId + " 的風控狀態",
                detailMap(
                        "previousRiskStatus", current.riskStatus(),
                        "nextRiskStatus", updated.riskStatus(),
                        "previousRiskScore", current.riskScore(),
                        "nextRiskScore", updated.riskScore(),
                        "screeningStatus", updated.screeningStatus(),
                        "screeningReason", updated.screeningReason(),
                        "payoutBlocked", updated.payoutBlocked()));

        return updated;
    }

    OrderRecord setOrderFrozen(String actor, long orderId, boolean frozen, String reason) {
        StoreSupport.require(isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");

        OrderRecord current = findOrder(orderId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));

        jdbc.update(
                "UPDATE orders SET frozen = ?, settlement_status = ? WHERE order_id = ?",
                frozen ? 1 : 0,
                frozen ? "frozen" : settlementStatusAfterUnfreeze(current),
                orderId);

        OrderRecord updated = findOrder(orderId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));

        insertAudit("compliance", frozen ? "freeze_order" : "unfreeze_order", actor, String.valueOf(orderId), updated.productId(),
                (frozen ? "凍結" : "解除凍結") + "訂單 #" + orderId,
                detailMap(
                        "reason", reason,
                        "previousFrozen", current.frozen(),
                        "nextFrozen", updated.frozen(),
                        "riskStatus", updated.riskStatus()));

        if (frozen) {
            createRiskCaseInternal(orderId, "aml", "high", "manual_freeze", safe(reason), actor);
        }

        return updated;
    }

    RiskCaseRecord createRiskCase(String actor, CreateRiskCaseRequest payload) {
        StoreSupport.require(isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");

        Long orderId = payload.orderId();
        if (orderId != null) {
            findOrder(orderId).orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));
        }

        String caseType = payload.caseType() == null ? "aml" : payload.caseType().trim().toLowerCase(Locale.ROOT);
        String severity = payload.severity() == null ? "medium" : payload.severity().trim().toLowerCase(Locale.ROOT);

        StoreSupport.requireOneOf(caseType, CASE_TYPES, HttpStatus.BAD_REQUEST, "Invalid caseType");
        StoreSupport.requireOneOf(severity, CASE_SEVERITIES, HttpStatus.BAD_REQUEST, "Invalid severity");

        return createRiskCaseInternal(orderId, caseType, severity, safe(payload.reasonCode()), safe(payload.notes()), actor);
    }

    RiskCaseRecord resolveRiskCase(String actor, long caseId, ResolveRiskCaseRequest payload) {
        StoreSupport.require(isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");

        RiskCaseRecord current = findRiskCase(caseId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Risk case not found"));

        String nextStatus = payload.status() == null ? "resolved" : payload.status().trim().toLowerCase(Locale.ROOT);
        StoreSupport.requireOneOf(nextStatus, CASE_STATUSES, HttpStatus.BAD_REQUEST, "Invalid case status");

        String notes = payload.notes() == null || payload.notes().isBlank()
                ? current.notes()
                : payload.notes().trim();
        String resolvedAt = StoreSupport.nowIso();

        jdbc.update(
                """
                UPDATE risk_cases
                SET status = ?, notes = ?, resolved_by = ?, resolved_at = ?
                WHERE case_id = ?
                """,
                nextStatus,
                notes,
                actor,
                resolvedAt,
                caseId);

        RiskCaseRecord updated = findRiskCase(caseId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Risk case not found"));

        insertAudit("compliance", "resolve_case", actor, String.valueOf(caseId),
                null,
                "結案風控案件 #" + caseId,
                detailMap(
                        "previousStatus", current.status(),
                        "nextStatus", updated.status(),
                        "notes", updated.notes(),
                        "orderId", updated.orderId()));

        return updated;
    }

    PayoutRecord updatePayoutReview(String actor, long orderId, UpdatePayoutReviewRequest payload) {
        StoreSupport.require(isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");

        PayoutRecord current = findPayout(orderId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Payout not found"));

        String nextPayoutStatus = payload.payoutStatus() == null
                ? current.payoutStatus()
                : payload.payoutStatus().trim().toLowerCase(Locale.ROOT);
        String nextAmlReviewStatus = payload.amlReviewStatus() == null
                ? current.amlReviewStatus()
                : payload.amlReviewStatus().trim().toLowerCase(Locale.ROOT);

        StoreSupport.requireOneOf(nextPayoutStatus, PAYOUT_STATUSES, HttpStatus.BAD_REQUEST, "Invalid payoutStatus");
        StoreSupport.requireOneOf(nextAmlReviewStatus, AML_REVIEW_STATUSES, HttpStatus.BAD_REQUEST, "Invalid amlReviewStatus");

        String approvedBy = payload.approvedBy() == null || payload.approvedBy().isBlank()
                ? actor
                : StoreSupport.normalizeAddress(payload.approvedBy());

        jdbc.update(
                """
                UPDATE payouts
                SET payout_status = ?, aml_review_status = ?, approved_by = ?
                WHERE order_id = ?
                """,
                nextPayoutStatus,
                nextAmlReviewStatus,
                approvedBy,
                orderId);

        boolean blockPayout = "blocked".equals(nextPayoutStatus) || "blocked".equals(nextAmlReviewStatus);
        jdbc.update(
                "UPDATE orders SET payout_blocked = ? WHERE order_id = ?",
                blockPayout ? 1 : 0,
                orderId);

        PayoutRecord updated = findPayout(orderId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Payout not found"));

        insertAudit("payout", "review", actor, String.valueOf(orderId), updated.productId(),
                "更新訂單 #" + orderId + " 的提領審核狀態",
                detailMap(
                        "previousPayoutStatus", current.payoutStatus(),
                        "nextPayoutStatus", updated.payoutStatus(),
                        "previousAmlReviewStatus", current.amlReviewStatus(),
                        "nextAmlReviewStatus", updated.amlReviewStatus(),
                        "approvedBy", updated.approvedBy()));

        return updated;
    }

    ReviewRecord saveReview(String actor, CreateReviewRequest payload) {
        StoreSupport.require(payload.orderId() > 0, HttpStatus.BAD_REQUEST, "Order ID required");
        StoreSupport.require(payload.rating() >= 1 && payload.rating() <= 5, HttpStatus.BAD_REQUEST, "Rating required");

        String buyer = StoreSupport.normalizeAddress(payload.buyer());
        String seller = StoreSupport.normalizeAddress(payload.seller());

        StoreSupport.requireAddress(buyer, HttpStatus.BAD_REQUEST,
                "Buyer and seller must be valid EVM addresses");
        StoreSupport.requireAddress(seller, HttpStatus.BAD_REQUEST,
                "Buyer and seller must be valid EVM addresses");
        StoreSupport.require(actor.equals(buyer), HttpStatus.FORBIDDEN,
                "Only the buyer can create or update the review");

        OrderRecord order = findOrder(payload.orderId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));
        StoreSupport.require(order.buyer().equals(buyer), HttpStatus.FORBIDDEN,
                "Only the order buyer can create or update the review");
        StoreSupport.require(order.productSeller().equals(seller), HttpStatus.BAD_REQUEST,
                "Seller does not match the stored order metadata");

        String createdAt = payload.createdAt() == null || payload.createdAt().isBlank()
                ? StoreSupport.nowIso()
                : payload.createdAt();

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
                payload.productId() == null ? order.productId() : payload.productId(),
                payload.productName() == null || payload.productName().isBlank() ? order.productName() : payload.productName(),
                seller,
                buyer,
                payload.rating(),
                safe(payload.comment()),
                createdAt);

        jdbc.update(
                """
                UPDATE orders
                SET complete_state = 1,
                    commerce_status = CASE WHEN commerce_status = 'closed' THEN commerce_status ELSE 'reviewed' END,
                    settlement_status = CASE WHEN seller_withdrawn = 1 THEN 'settled' ELSE 'payout_ready' END,
                    received_at = COALESCE(received_at, ?),
                    release_eligible_at = COALESCE(release_eligible_at, ?)
                WHERE order_id = ?
                """,
                createdAt,
                createdAt,
                payload.orderId());

        ReviewRecord saved = findReview(payload.orderId())
                .orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Review was not saved"));

        insertAudit("order", "review", actor, String.valueOf(payload.orderId()), saved.productId(),
                "買家為訂單 #" + payload.orderId() + " 留下評價",
                detailMap(
                        "rating", saved.rating(),
                        "seller", saved.seller(),
                        "buyer", saved.buyer()));

        return saved;
    }

    PayoutRecord savePayout(String actor, CreatePayoutRequest payload) {
        StoreSupport.require(payload.orderId() > 0, HttpStatus.BAD_REQUEST, "Order ID required");

        String seller = StoreSupport.normalizeAddress(payload.seller());
        String buyer = StoreSupport.normalizeAddress(payload.buyer());

        StoreSupport.requireAddress(seller, HttpStatus.BAD_REQUEST,
                "Buyer and seller must be valid EVM addresses");
        StoreSupport.requireAddress(buyer, HttpStatus.BAD_REQUEST,
                "Buyer and seller must be valid EVM addresses");
        StoreSupport.require(actor.equals(seller), HttpStatus.FORBIDDEN,
                "Only the seller can save payout history");

        String amountWei = payload.amountWei() == null ? "0" : payload.amountWei();
        StoreSupport.requireUintString(amountWei, HttpStatus.BAD_REQUEST,
                "amountWei must be an unsigned integer string");

        OrderRecord order = findOrder(payload.orderId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Order not found"));
        StoreSupport.require(order.productSeller().equals(seller), HttpStatus.FORBIDDEN,
                "Only the stored seller can save payout history");
        StoreSupport.require(!order.frozen(), HttpStatus.FORBIDDEN,
                "This order is frozen and cannot be settled");
        StoreSupport.require(!order.payoutBlocked(), HttpStatus.FORBIDDEN,
                "This order is blocked from payout");
        StoreSupport.require(!"blocked".equals(order.riskStatus()) && !"review".equals(order.riskStatus()), HttpStatus.FORBIDDEN,
                "This order is blocked by risk controls");

        String createdAt = payload.createdAt() == null || payload.createdAt().isBlank()
                ? StoreSupport.nowIso()
                : payload.createdAt();

        jdbc.update(
                """
                INSERT INTO payouts (order_id, seller, buyer, product_id, product_name, amount_wei, tx_hash, created_at, payout_status, aml_review_status, approved_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(order_id) DO UPDATE SET
                    seller = excluded.seller,
                    buyer = excluded.buyer,
                    product_id = excluded.product_id,
                    product_name = excluded.product_name,
                    amount_wei = excluded.amount_wei,
                    tx_hash = excluded.tx_hash,
                    created_at = excluded.created_at,
                    payout_status = excluded.payout_status,
                    aml_review_status = excluded.aml_review_status,
                    approved_by = excluded.approved_by
                """,
                payload.orderId(),
                seller,
                buyer,
                payload.productId() == null ? order.productId() : payload.productId(),
                payload.productName() == null || payload.productName().isBlank() ? order.productName() : payload.productName(),
                amountWei,
                safe(payload.txHash()),
                createdAt,
                "confirmed",
                "clear",
                actor);

        jdbc.update(
                """
                UPDATE orders
                SET seller_withdrawn = 1,
                    complete_state = 1,
                    settlement_status = 'settled',
                    commerce_status = 'closed',
                    settled_at = ?,
                    release_eligible_at = COALESCE(release_eligible_at, ?)
                WHERE order_id = ?
                """,
                createdAt,
                createdAt,
                payload.orderId());

        PayoutRecord saved = findPayout(payload.orderId())
                .orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Payout was not saved"));

        insertAudit("payout", "save", actor, String.valueOf(payload.orderId()), saved.productId(),
                "記錄訂單 #" + payload.orderId() + " 的提領結果",
                detailMap(
                        "seller", saved.seller(),
                        "buyer", saved.buyer(),
                        "amountWei", saved.amountWei(),
                        "txHash", saved.txHash(),
                        "payoutStatus", saved.payoutStatus()));

        return saved;
    }

    UploadResponse uploadImage(String actor, MultipartFile image) {
        StoreSupport.require(actor != null && !actor.isBlank(), HttpStatus.UNAUTHORIZED, "Missing actor");
        StoreSupport.require(image != null && !image.isEmpty(), HttpStatus.BAD_REQUEST, "Missing image file");
        StoreSupport.require(image.getSize() <= 5L * 1024L * 1024L, HttpStatus.BAD_REQUEST, "Image file too large");

        String original = image.getOriginalFilename() == null
                ? "product-image"
                : image.getOriginalFilename().toLowerCase(Locale.ROOT);
        String extension = original.endsWith(".png") ? "png"
                : original.endsWith(".jpg") || original.endsWith(".jpeg") ? "jpg"
                : original.endsWith(".webp") ? "webp"
                : original.endsWith(".gif") ? "gif"
                : "jpg";
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
        List<RiskCaseRecord> riskCases = jdbc.query(
                """
                SELECT case_id, order_id, case_type, severity, status, reason_code, notes,
                       opened_by, resolved_by, created_at, resolved_at
                FROM risk_cases
                ORDER BY case_id DESC
                LIMIT 50
                """,
                (row, index) -> new RiskCaseRecord(
                        row.getLong("case_id"),
                        row.getObject("order_id") == null ? null : row.getLong("order_id"),
                        safe(row.getString("case_type")),
                        safe(row.getString("severity")),
                        safe(row.getString("status")),
                        safe(row.getString("reason_code")),
                        safe(row.getString("notes")),
                        safe(row.getString("opened_by")),
                        safe(row.getString("resolved_by")),
                        safe(row.getString("created_at")),
                        safe(row.getString("resolved_at"))));

        long reviewOrders = orders.values().stream().filter(item -> "review".equals(item.riskStatus())).count();
        long blockedOrders = orders.values().stream().filter(item -> "blocked".equals(item.riskStatus()) || item.frozen()).count();

        return Map.of(
                "metrics", Map.of(
                        "approvedSellers", sellers.approved().size(),
                        "pendingSellers", sellers.pending().size(),
                        "activeProducts", products.stream().filter(ProductRecord::isActive).count(),
                        "inactiveProducts", products.stream().filter(item -> !item.isActive()).count(),
                        "orders", orders.size(),
                        "reviews", reviews.size(),
                        "payouts", payouts.size(),
                        "riskReviewOrders", reviewOrders,
                        "blockedOrders", blockedOrders,
                        "openRiskCases", riskCases.stream().filter(item -> !"resolved".equals(item.status()) && !"closed".equals(item.status())).count()),
                "products", products,
                "orders", orders,
                "reviews", reviews,
                "payouts", payouts,
                "sellers", sellers,
                "auditLogs", loadAuditLogs(),
                "riskCases", riskCases);
    }

    Map<String, Object> sellerDashboard(String actor) {
        String sellerStatus = isAdmin(actor) ? "approved" : getSellerStatus(actor).orElse("guest");
        StoreSupport.require("approved".equals(sellerStatus), HttpStatus.FORBIDDEN,
                "Only approved sellers can access seller dashboard data");

        return Map.of(
                "seller", actor,
                "sellerStatus", sellerStatus,
                "products", loadProducts().stream().filter(item -> item.seller().equals(actor)).toList(),
                "orders", loadOrdersMap().values().stream().filter(item -> item.productSeller().equals(actor)).toList(),
                "reviews", loadReviews().stream().filter(item -> item.seller().equals(actor)).toList(),
                "payouts", loadPayouts().stream().filter(item -> item.seller().equals(actor)).toList(),
                "auditLogs", loadAuditLogs().stream()
                        .filter(item -> item.actor().equals(actor) || item.subject().equals(actor))
                        .toList());
    }

    Map<String, Object> buyerDashboard(String actor) {
        return Map.of(
                "buyer", actor,
                "orders", loadOrdersMap().values().stream().filter(item -> item.buyer().equals(actor)).toList(),
                "reviews", loadReviews().stream().filter(item -> item.buyer().equals(actor)).toList(),
                "payouts", loadPayouts().stream().filter(item -> item.buyer().equals(actor)).toList());
    }

    Map<String, Object> myDashboard(String actor) {
        boolean admin = isAdmin(actor);
        String sellerStatus = admin ? "approved" : getSellerStatus(actor).orElse("guest");
        return Map.of(
                "actor", actor,
                "isAdmin", admin,
                "sellerStatus", sellerStatus,
                "orders", loadOrdersMap().values().stream()
                        .filter(item -> item.buyer().equals(actor) || item.productSeller().equals(actor))
                        .toList(),
                "reviews", loadReviews().stream()
                        .filter(item -> item.buyer().equals(actor) || item.seller().equals(actor))
                        .toList(),
                "payouts", loadPayouts().stream()
                        .filter(item -> item.buyer().equals(actor) || item.seller().equals(actor))
                        .toList());
    }

    private Optional<String> getSellerStatus(String address) {
        List<String> rows = jdbc.query(
                "SELECT status FROM sellers WHERE lower(address) = lower(?)",
                (row, index) -> row.getString("status"),
                address);
        return rows.stream().findFirst();
    }

    private ProductRecord findProduct(Long productId) {
        List<ProductRecord> rows = jdbc.query(
                "SELECT product_id, seller, name, price_wei, is_active, meta_json FROM products WHERE product_id = ?",
                (row, index) -> mapProduct(row),
                productId);
        return rows.stream().findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Product not found"));
    }

    private Optional<OrderRecord> findOrder(long orderId) {
        List<OrderRecord> rows = jdbc.query(
                ORDER_SELECT + " WHERE order_id = ?",
                (row, index) -> mapOrder(row),
                orderId);
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
                        safe(row.getString("created_at"))),
                orderId);
        return rows.stream().findFirst();
    }

    private Optional<PayoutRecord> findPayout(long orderId) {
        List<PayoutRecord> rows = jdbc.query(
                PAYOUT_SELECT + " WHERE order_id = ?",
                (row, index) -> mapPayout(row),
                orderId);
        return rows.stream().findFirst();
    }

    private Optional<RiskCaseRecord> findRiskCase(long caseId) {
        List<RiskCaseRecord> rows = jdbc.query(
                """
                SELECT case_id, order_id, case_type, severity, status, reason_code, notes,
                       opened_by, resolved_by, created_at, resolved_at
                FROM risk_cases
                WHERE case_id = ?
                """,
                (row, index) -> new RiskCaseRecord(
                        row.getLong("case_id"),
                        row.getObject("order_id") == null ? null : row.getLong("order_id"),
                        safe(row.getString("case_type")),
                        safe(row.getString("severity")),
                        safe(row.getString("status")),
                        safe(row.getString("reason_code")),
                        safe(row.getString("notes")),
                        safe(row.getString("opened_by")),
                        safe(row.getString("resolved_by")),
                        safe(row.getString("created_at")),
                        safe(row.getString("resolved_at"))),
                caseId);
        return rows.stream().findFirst();
    }

    private ProductRecord mapProduct(ResultSet row) throws SQLException {
        return new ProductRecord(
                row.getLong("product_id"),
                safe(row.getString("seller")),
                safe(row.getString("name")),
                safe(row.getString("price_wei")),
                row.getInt("is_active") == 1,
                parseJson(row.getString("meta_json")));
    }

    private OrderRecord mapOrder(ResultSet row) throws SQLException {
        return new OrderRecord(
                row.getLong("order_id"),
                StoreSupport.normalizeAddress(safe(row.getString("buyer"))),
                row.getLong("product_id"),
                safe(row.getString("product_name")),
                StoreSupport.normalizeAddress(safe(row.getString("product_seller"))),
                safe(row.getString("price_wei")),
                row.getShort("flow_stage"),
                safe(row.getString("commerce_status")),
                safe(row.getString("settlement_status")),
                safe(row.getString("dispute_status")),
                safe(row.getString("risk_status")),
                row.getDouble("risk_score"),
                safe(row.getString("screening_status")),
                safe(row.getString("screening_reason")),
                row.getInt("pay_state") == 1,
                row.getInt("complete_state") == 1,
                row.getInt("seller_withdrawn") == 1,
                row.getInt("frozen") == 1,
                row.getInt("payout_blocked") == 1,
                safe(row.getString("funded_at")),
                safe(row.getString("release_eligible_at")),
                safe(row.getString("received_at")),
                safe(row.getString("settled_at")));
    }

    private PayoutRecord mapPayout(ResultSet row) throws SQLException {
        return new PayoutRecord(
                row.getLong("order_id"),
                safe(row.getString("seller")),
                safe(row.getString("buyer")),
                row.getLong("product_id"),
                safe(row.getString("product_name")),
                safe(row.getString("amount_wei")),
                safe(row.getString("tx_hash")),
                safe(row.getString("created_at")),
                safe(row.getString("payout_status")),
                safe(row.getString("aml_review_status")),
                safe(row.getString("approved_by")));
    }

    private RiskCaseRecord createRiskCaseInternal(Long orderId, String caseType, String severity, String reasonCode, String notes, String actor) {
        String now = StoreSupport.nowIso();
        jdbc.update(
                """
                INSERT INTO risk_cases (order_id, case_type, severity, status, reason_code, notes, opened_by, resolved_by, created_at, resolved_at)
                VALUES (?, ?, ?, 'open', ?, ?, ?, '', ?, '')
                """,
                orderId,
                caseType,
                severity,
                safe(reasonCode),
                safe(notes),
                actor,
                now);

        Long caseId = jdbc.queryForObject("SELECT last_insert_rowid()", Long.class);
        RiskCaseRecord created = findRiskCase(caseId == null ? 0L : caseId)
                .orElseThrow(() -> new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Risk case was not saved"));

        insertAudit("compliance", "open_case", actor, String.valueOf(created.caseId()), null,
                "建立風控案件 #" + created.caseId(),
                detailMap(
                        "orderId", created.orderId(),
                        "caseType", created.caseType(),
                        "severity", created.severity(),
                        "reasonCode", created.reasonCode()));

        return created;
    }

    private String commerceStatusForFlow(short stage) {
        return switch (stage) {
            case 2 -> "shipped";
            case 3 -> "arrived";
            case 4 -> "ready_for_pickup";
            default -> "paid";
        };
    }

    private String settlementStatusForFlow(short stage) {
        return stage <= 1 ? "funded" : "fulfillment_pending";
    }

    private String settlementStatusAfterUnfreeze(OrderRecord current) {
        if (current.sellerWithdrawn()) return "settled";
        if (current.completeState()) return "payout_ready";
        return settlementStatusForFlow(current.flowStage());
    }

    private OrderRecord blankOrder() {
        return new OrderRecord(
                0L, "", 0L, "", "", "0", (short) 1,
                "paid", "funded", "none", "clear", 0.0, "clear", "",
                true, false, false, false, false,
                "", "", "", "");
    }

    private void insertAudit(String category, String action, String actor, String subject, Long productId,
                             String summary, Map<String, ?> detail) {
        jdbc.update(
                "INSERT INTO audit_logs (category, action, actor, subject, product_id, summary, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                category,
                action,
                actor,
                safe(subject),
                productId,
                summary,
                stringify(mapper.valueToTree(detail)),
                StoreSupport.nowIso());
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

    private Map<String, Object> detailMap(Object... keyValues) {
        LinkedHashMap<String, Object> result = new LinkedHashMap<>();
        for (int i = 0; i + 1 < keyValues.length; i += 2) {
            result.put(String.valueOf(keyValues[i]), keyValues[i + 1]);
        }
        return result;
    }

    private void ensureColumn(String table, String column, String alterSql) {
        Integer count = jdbc.queryForObject(
                "SELECT COUNT(*) FROM pragma_table_info('" + table + "') WHERE name = ?",
                Integer.class,
                column);
        if (count != null && count == 0) {
            jdbc.execute(alterSql);
        }
    }

    private String safe(String value) {
        return value == null ? "" : value;
    }
}
