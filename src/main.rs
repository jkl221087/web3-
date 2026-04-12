use std::{
    collections::BTreeMap,
    env,
    net::SocketAddr,
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use anyhow::Context;
use axum::{
    Router,
    body::Body,
    extract::{Multipart, Path as AxumPath, State},
    http::{HeaderMap, HeaderValue, Response, StatusCode, header},
    response::IntoResponse,
    routing::{get, patch, post},
};
use ethers::{
    core::rand::{RngCore, thread_rng},
    types::{Address, Signature},
    utils::hash_message,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::fs;

type AppResult<T> = Result<T, (StatusCode, axum::Json<Value>)>;

#[derive(Clone)]
struct AppState {
    root: PathBuf,
    db_path: Arc<PathBuf>,
    upload_dir: Arc<PathBuf>,
    admin_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Product {
    #[serde(rename = "productId")]
    product_id: u64,
    seller: String,
    name: String,
    #[serde(rename = "priceWei")]
    price_wei: String,
    #[serde(rename = "isActive")]
    is_active: bool,
    meta: Value,
}

#[derive(Debug, Deserialize)]
struct CreateProduct {
    seller: String,
    name: String,
    #[serde(rename = "priceWei")]
    price_wei: String,
    meta: Value,
}

#[derive(Debug, Deserialize)]
struct UpdateProduct {
    name: Option<String>,
    #[serde(rename = "priceWei")]
    price_wei: Option<String>,
    #[serde(rename = "isActive")]
    is_active: Option<bool>,
    meta: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SellersStore {
    approved: Vec<String>,
    pending: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct SellerRequestPayload {
    address: String,
}

#[derive(Debug, Deserialize)]
struct SellerApprovePayload {
    address: String,
    approved: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct OrderRecord {
    #[serde(rename = "orderId")]
    order_id: u64,
    #[serde(rename = "productId")]
    product_id: u64,
    #[serde(rename = "productName")]
    product_name: String,
    #[serde(rename = "productSeller")]
    product_seller: String,
    #[serde(rename = "priceWei")]
    price_wei: String,
    #[serde(rename = "flowStage")]
    flow_stage: u8,
}

#[derive(Debug, Deserialize)]
struct CreateOrderPayload {
    #[serde(rename = "orderId")]
    order_id: u64,
    #[serde(rename = "productId")]
    product_id: Option<u64>,
    #[serde(rename = "productName")]
    product_name: Option<String>,
    #[serde(rename = "productSeller")]
    product_seller: Option<String>,
    #[serde(rename = "priceWei")]
    price_wei: Option<String>,
    #[serde(rename = "flowStage")]
    flow_stage: Option<u8>,
}

#[derive(Debug, Deserialize)]
struct UpdateOrderFlowPayload {
    #[serde(rename = "flowStage")]
    flow_stage: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Review {
    #[serde(rename = "orderId")]
    order_id: u64,
    #[serde(rename = "productId")]
    product_id: u64,
    #[serde(rename = "productName")]
    product_name: String,
    seller: String,
    buyer: String,
    rating: u8,
    comment: String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Debug, Deserialize)]
struct CreateReviewPayload {
    #[serde(rename = "orderId")]
    order_id: u64,
    #[serde(rename = "productId")]
    product_id: Option<u64>,
    #[serde(rename = "productName")]
    product_name: Option<String>,
    seller: Option<String>,
    buyer: Option<String>,
    rating: u8,
    comment: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Payout {
    #[serde(rename = "orderId")]
    order_id: u64,
    seller: String,
    buyer: String,
    #[serde(rename = "productId")]
    product_id: u64,
    #[serde(rename = "productName")]
    product_name: String,
    #[serde(rename = "amountWei")]
    amount_wei: String,
    #[serde(rename = "txHash")]
    tx_hash: String,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Debug, Deserialize)]
struct CreatePayoutPayload {
    #[serde(rename = "orderId")]
    order_id: u64,
    seller: Option<String>,
    buyer: Option<String>,
    #[serde(rename = "productId")]
    product_id: Option<u64>,
    #[serde(rename = "productName")]
    product_name: Option<String>,
    #[serde(rename = "amountWei")]
    amount_wei: Option<String>,
    #[serde(rename = "txHash")]
    tx_hash: Option<String>,
    #[serde(rename = "createdAt")]
    created_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthNoncePayload {
    address: String,
    #[serde(rename = "chainId")]
    chain_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthVerifyPayload {
    address: String,
    message: String,
    signature: String,
}

#[derive(Debug, Serialize)]
struct SessionProfile {
    authenticated: bool,
    address: String,
    #[serde(rename = "isAdmin")]
    is_admin: bool,
    #[serde(rename = "sellerStatus")]
    seller_status: String,
}

#[derive(Debug, Serialize)]
struct UploadResponse {
    url: String,
    filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuditLog {
    id: u64,
    category: String,
    action: String,
    actor: String,
    subject: String,
    #[serde(rename = "productId")]
    product_id: Option<u64>,
    summary: String,
    detail: Value,
    #[serde(rename = "createdAt")]
    created_at: String,
}

#[derive(Debug, Clone, Default)]
struct LegacySeedData {
    products: Vec<Product>,
    sellers: SellersStore,
    orders: BTreeMap<String, OrderRecord>,
    reviews: Vec<Review>,
    payouts: Vec<Payout>,
}

#[tokio::main]
async fn main() {
    let _ = dotenv::dotenv();

    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3000);

    let root = env::current_dir().expect("failed to get current directory");
    let data_dir = root.join("data");
    let db_path = data_dir.join("store.db");
    let upload_dir = root.join("uploads").join("products");

    fs::create_dir_all(&data_dir)
        .await
        .expect("failed to create data directory");
    fs::create_dir_all(&upload_dir)
        .await
        .expect("failed to create upload directory");

    let legacy_seed = load_legacy_seed_data(&data_dir).await;
    initialize_database(&db_path, legacy_seed)
        .await
        .expect("failed to prepare SQLite database");

    let state = AppState {
        root,
        db_path: Arc::new(db_path),
        upload_dir: Arc::new(upload_dir),
        admin_address: env::var("ADMIN_WALLET_ADDRESS")
            .ok()
            .map(|value| normalize_address(&value))
            .filter(|value| is_valid_evm_address(value)),
    };

    let app = Router::new()
        .route("/api/auth/nonce", post(issue_auth_nonce))
        .route("/api/auth/verify", post(verify_auth_signature))
        .route("/api/auth/logout", post(logout_session))
        .route("/api/me", get(get_session_profile))
        .route("/api/products", get(get_products).post(create_product))
        .route("/api/products/{id}", patch(update_product))
        .route("/api/sellers", get(get_sellers))
        .route("/api/sellers/request", post(request_seller))
        .route("/api/sellers/approve", post(approve_seller))
        .route("/api/admin/audit", get(get_admin_audit_logs))
        .route("/api/orders", get(get_orders).post(upsert_order))
        .route("/api/orders/{id}/flow", patch(update_order_flow))
        .route("/api/reviews", get(get_reviews).post(upsert_review))
        .route("/api/payouts", get(get_payouts).post(upsert_payout))
        .route("/api/uploads/product-image", post(upload_product_image))
        .route("/", get(serve_root))
        .fallback(get(serve_static))
        .with_state(state);

    let address = SocketAddr::from(([127, 0, 0, 1], port));
    println!("Frontend ready at http://localhost:{port}");

    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("failed to bind server");
    axum::serve(listener, app)
        .await
        .expect("failed to start server");
}

async fn load_legacy_seed_data(data_dir: &Path) -> LegacySeedData {
    LegacySeedData {
        products: load_json_file(&data_dir.join("products.json")).await,
        sellers: load_json_file(&data_dir.join("sellers.json")).await,
        orders: load_json_file(&data_dir.join("orders.json")).await,
        reviews: load_json_file(&data_dir.join("reviews.json")).await,
        payouts: load_json_file(&data_dir.join("payouts.json")).await,
    }
}

async fn load_json_file<T>(path: &Path) -> T
where
    T: serde::de::DeserializeOwned + Default,
{
    match fs::read_to_string(path).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => T::default(),
    }
}

async fn initialize_database(db_path: &Path, seed: LegacySeedData) -> anyhow::Result<()> {
    let db_path = db_path.to_path_buf();
    tokio::task::spawn_blocking(move || -> anyhow::Result<()> {
        let conn = open_connection(&db_path)?;
        conn.execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS products (
                product_id INTEGER PRIMARY KEY AUTOINCREMENT,
                seller TEXT NOT NULL,
                name TEXT NOT NULL,
                price_wei TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                meta_json TEXT NOT NULL DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS sellers (
                address TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS orders (
                order_id INTEGER PRIMARY KEY,
                product_id INTEGER NOT NULL DEFAULT 0,
                product_name TEXT NOT NULL DEFAULT '',
                product_seller TEXT NOT NULL DEFAULT '',
                price_wei TEXT NOT NULL DEFAULT '0',
                flow_stage INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS reviews (
                order_id INTEGER PRIMARY KEY,
                product_id INTEGER NOT NULL DEFAULT 0,
                product_name TEXT NOT NULL DEFAULT '',
                seller TEXT NOT NULL DEFAULT '',
                buyer TEXT NOT NULL DEFAULT '',
                rating INTEGER NOT NULL,
                comment TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS payouts (
                order_id INTEGER PRIMARY KEY,
                seller TEXT NOT NULL DEFAULT '',
                buyer TEXT NOT NULL DEFAULT '',
                product_id INTEGER NOT NULL DEFAULT 0,
                product_name TEXT NOT NULL DEFAULT '',
                amount_wei TEXT NOT NULL DEFAULT '0',
                tx_hash TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS auth_nonces (
                address TEXT PRIMARY KEY,
                nonce TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS auth_sessions (
                session_id TEXT PRIMARY KEY,
                address TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );

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
            );
            "#,
        )
        .context("create sqlite tables")?;

        cleanup_expired_auth_records(&conn).context("cleanup expired auth records")?;

        if table_count(&conn, "products")? == 0 {
            for product in seed.products {
                conn.execute(
                    "INSERT INTO products (product_id, seller, name, price_wei, is_active, meta_json)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        product.product_id as i64,
                        product.seller,
                        product.name,
                        product.price_wei,
                        bool_to_int(product.is_active),
                        serde_json::to_string(&product.meta).unwrap_or_else(|_| "{}".to_string())
                    ],
                )
                .context("seed products")?;
            }
        }

        if table_count(&conn, "sellers")? == 0 {
            let timestamp = now_iso_like();
            for address in seed.sellers.approved {
                conn.execute(
                    "INSERT OR REPLACE INTO sellers (address, status, created_at, updated_at)
                     VALUES (?1, 'approved', ?2, ?2)",
                    params![address, timestamp],
                )
                .context("seed approved sellers")?;
            }
            for address in seed.sellers.pending {
                conn.execute(
                    "INSERT OR IGNORE INTO sellers (address, status, created_at, updated_at)
                     VALUES (?1, 'pending', ?2, ?2)",
                    params![address, timestamp],
                )
                .context("seed pending sellers")?;
            }
        }

        if table_count(&conn, "orders")? == 0 {
            for order in seed.orders.into_values() {
                conn.execute(
                    "INSERT INTO orders (order_id, product_id, product_name, product_seller, price_wei, flow_stage)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        order.order_id as i64,
                        order.product_id as i64,
                        order.product_name,
                        order.product_seller,
                        order.price_wei,
                        order.flow_stage as i64
                    ],
                )
                .context("seed orders")?;
            }
        }

        if table_count(&conn, "reviews")? == 0 {
            for review in seed.reviews {
                conn.execute(
                    "INSERT INTO reviews (order_id, product_id, product_name, seller, buyer, rating, comment, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        review.order_id as i64,
                        review.product_id as i64,
                        review.product_name,
                        review.seller,
                        review.buyer,
                        review.rating as i64,
                        review.comment,
                        review.created_at
                    ],
                )
                .context("seed reviews")?;
            }
        }

        if table_count(&conn, "payouts")? == 0 {
            for payout in seed.payouts {
                conn.execute(
                    "INSERT INTO payouts (order_id, seller, buyer, product_id, product_name, amount_wei, tx_hash, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        payout.order_id as i64,
                        payout.seller,
                        payout.buyer,
                        payout.product_id as i64,
                        payout.product_name,
                        payout.amount_wei,
                        payout.tx_hash,
                        payout.created_at
                    ],
                )
                .context("seed payouts")?;
            }
        }

        Ok(())
    })
    .await
    .context("join sqlite initialization task")??;

    Ok(())
}

fn table_count(conn: &Connection, table: &str) -> rusqlite::Result<i64> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    conn.query_row(&sql, [], |row| row.get(0))
}

fn json_error(status: StatusCode, message: &str) -> (StatusCode, axum::Json<Value>) {
    (status, axum::Json(json!({ "error": message })))
}

fn normalize_address(address: &str) -> String {
    address.trim().to_ascii_lowercase()
}

fn is_valid_evm_address(address: &str) -> bool {
    let value = address.trim();
    value.len() == 42
        && value.starts_with("0x")
        && value
            .bytes()
            .skip(2)
            .all(|byte| byte.is_ascii_hexdigit())
}

fn random_hex(bytes_len: usize) -> String {
    let mut bytes = vec![0u8; bytes_len];
    thread_rng().fill_bytes(&mut bytes);
    let mut output = String::with_capacity(bytes_len * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn build_auth_message(address: &str, nonce: &str, chain_id: Option<&str>) -> String {
    let chain_line = chain_id.unwrap_or("unknown");
    format!(
        "Escrow Fashion Store Login\nAddress: {address}\nNonce: {nonce}\nChain ID: {chain_line}\nIssued At: {}",
        now_iso_like()
    )
}

fn parse_cookie_value(headers: &HeaderMap, name: &str) -> Option<String> {
    let raw = headers.get(header::COOKIE)?.to_str().ok()?;
    raw.split(';')
        .find_map(|segment| {
            let mut parts = segment.trim().splitn(2, '=');
            let key = parts.next()?.trim();
            let value = parts.next()?.trim();
            (key == name).then(|| value.to_string())
        })
}

fn require_header_actor_address(headers: &HeaderMap) -> AppResult<String> {
    let Some(value) = headers.get("x-actor-address") else {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "Missing x-actor-address header",
        ));
    };

    let actor = value
        .to_str()
        .map_err(|_| json_error(StatusCode::BAD_REQUEST, "Invalid x-actor-address header"))?;
    let actor = normalize_address(actor);

    if !is_valid_evm_address(&actor) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "Actor address must be a valid EVM address",
        ));
    }

    Ok(actor)
}

async fn session_actor_from_headers(state: &AppState, headers: &HeaderMap) -> AppResult<Option<String>> {
    let Some(session_id) = parse_cookie_value(headers, "fashion_store_session") else {
        return Ok(None);
    };

    let session_id = session_id.trim().to_string();
    if session_id.is_empty() {
        return Ok(None);
    }

    with_connection(state, move |conn| {
        cleanup_expired_auth_records(conn)
            .map_err(|error| log_internal_error("Failed to cleanup expired auth records", error))?;
        fetch_session_address(conn, &session_id)
            .map_err(|error| log_internal_error("Failed to load auth session", error))
    })
    .await
}

async fn require_actor_address(state: &AppState, headers: &HeaderMap) -> AppResult<String> {
    if let Some(actor) = session_actor_from_headers(state, headers).await? {
        return Ok(actor);
    }
    require_header_actor_address(headers)
}

async fn require_admin_actor(state: &AppState, headers: &HeaderMap) -> AppResult<String> {
    let actor = require_actor_address(state, headers).await?;
    let Some(admin_address) = state.admin_address.as_ref() else {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "ADMIN_WALLET_ADDRESS is not configured on the server",
        ));
    };

    if &actor != admin_address {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "Only the configured admin wallet can perform this action",
        ));
    }

    Ok(actor)
}

fn build_session_cookie(session_id: &str, max_age_seconds: i64) -> String {
    format!(
        "fashion_store_session={session_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age_seconds}"
    )
}

fn clear_session_cookie() -> String {
    "fashion_store_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0".to_string()
}

fn ensure_non_empty(value: &str, field_name: &str) -> AppResult<()> {
    if value.trim().is_empty() {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("{field_name} is required"),
        ));
    }
    Ok(())
}

fn ensure_uint_string(value: &str, field_name: &str) -> AppResult<()> {
    let trimmed = value.trim();
    if trimmed.is_empty() || !trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            &format!("{field_name} must be an unsigned integer string"),
        ));
    }
    Ok(())
}

fn log_internal_error(
    context: &str,
    error: impl std::fmt::Display,
) -> (StatusCode, axum::Json<Value>) {
    eprintln!("{context}: {error}");
    json_error(StatusCode::INTERNAL_SERVER_ERROR, context)
}

async fn with_connection<T, F>(state: &AppState, operation: F) -> AppResult<T>
where
    T: Send + 'static,
    F: FnOnce(&Connection) -> AppResult<T> + Send + 'static,
{
    let db_path = state.db_path.as_ref().clone();
    tokio::task::spawn_blocking(move || {
        let conn = open_connection(&db_path)
            .map_err(|error| log_internal_error("Failed to open database", error))?;
        operation(&conn)
    })
    .await
    .map_err(|error| log_internal_error("Database worker failed", error))?
}

fn open_connection(db_path: &Path) -> anyhow::Result<Connection> {
    let conn = Connection::open(db_path).with_context(|| format!("open {}", db_path.display()))?;
    conn.busy_timeout(Duration::from_secs(5))
        .context("set sqlite busy timeout")?;
    Ok(conn)
}

async fn issue_auth_nonce(
    State(state): State<AppState>,
    axum::Json(payload): axum::Json<AuthNoncePayload>,
) -> AppResult<impl IntoResponse> {
    let address = normalize_address(&payload.address);
    ensure_non_empty(&address, "Address")?;
    if !is_valid_evm_address(&address) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Address must be a valid EVM address"));
    }

    let nonce = random_hex(16);
    let message = build_auth_message(&address, &nonce, payload.chain_id.as_deref());
    let issued_at = now_iso_like();
    let expires_at = auth_expiry_iso(10);
    let response = json!({
        "address": address,
        "nonce": nonce,
        "message": message,
        "expiresAt": expires_at
    });

    with_connection(&state, move |conn| {
        cleanup_expired_auth_records(conn)
            .map_err(|error| log_internal_error("Failed to cleanup expired auth records", error))?;
        conn.execute(
            "INSERT INTO auth_nonces (address, nonce, message, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(address) DO UPDATE SET
                 nonce = excluded.nonce,
                 message = excluded.message,
                 created_at = excluded.created_at,
                 expires_at = excluded.expires_at",
            params![address, nonce, message, issued_at, expires_at],
        )
        .map_err(|error| log_internal_error("Failed to save auth nonce", error))?;
        Ok(())
    })
    .await?;

    Ok((StatusCode::OK, axum::Json(response)))
}

async fn verify_auth_signature(
    State(state): State<AppState>,
    axum::Json(payload): axum::Json<AuthVerifyPayload>,
) -> AppResult<impl IntoResponse> {
    let address = normalize_address(&payload.address);
    ensure_non_empty(&address, "Address")?;
    ensure_non_empty(&payload.message, "Message")?;
    ensure_non_empty(&payload.signature, "Signature")?;
    if !is_valid_evm_address(&address) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Address must be a valid EVM address"));
    }

    let signature: Signature = payload
        .signature
        .parse()
        .map_err(|_| json_error(StatusCode::BAD_REQUEST, "Invalid signature"))?;
    let recovered: Address = signature
        .recover(hash_message(&payload.message))
        .map_err(|_| json_error(StatusCode::UNAUTHORIZED, "Signature verification failed"))?;
    let recovered_address = normalize_address(&format!("{:#x}", recovered));
    if recovered_address != address {
        return Err(json_error(
            StatusCode::UNAUTHORIZED,
            "Signature does not match the requested wallet address",
        ));
    }

    let session_id = random_hex(32);
    let session_cookie_id = session_id.clone();
    let created_at = now_iso_like();
    let expires_at = auth_expiry_iso(60 * 60 * 24 * 7);
    let admin_address = state.admin_address.clone();
    let response = with_connection(&state, move |conn| {
        cleanup_expired_auth_records(conn)
            .map_err(|error| log_internal_error("Failed to cleanup expired auth records", error))?;

        let stored = fetch_auth_nonce(conn, &address)
            .map_err(|error| log_internal_error("Failed to load auth nonce", error))?
            .ok_or_else(|| json_error(StatusCode::UNAUTHORIZED, "Login nonce was not found or expired"))?;

        if stored != payload.message {
            return Err(json_error(StatusCode::UNAUTHORIZED, "Login message does not match the latest nonce"));
        }

        conn.execute("DELETE FROM auth_nonces WHERE address = ?1", params![address.clone()])
            .map_err(|error| log_internal_error("Failed to clear auth nonce", error))?;

        conn.execute(
            "INSERT INTO auth_sessions (session_id, address, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![session_id.clone(), address.clone(), created_at, expires_at],
        )
        .map_err(|error| log_internal_error("Failed to create auth session", error))?;

        let seller_status = fetch_seller_status(conn, &address)
            .map_err(|error| log_internal_error("Failed to load seller status", error))?
            .unwrap_or_else(|| "buyer".to_string());
        let is_admin = admin_address.as_deref() == Some(address.as_str());

        Ok(SessionProfile {
            authenticated: true,
            address,
            is_admin,
            seller_status,
        })
    })
    .await?;

    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&build_session_cookie(&session_cookie_id, 60 * 60 * 24 * 7))
            .map_err(|error| log_internal_error("Failed to set auth cookie", error))?,
    );

    Ok((StatusCode::OK, response_headers, axum::Json(response)))
}

async fn get_session_profile(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    let Some(address) = session_actor_from_headers(&state, &headers).await? else {
        return Ok((
            StatusCode::OK,
            axum::Json(SessionProfile {
                authenticated: false,
                address: String::new(),
                is_admin: false,
                seller_status: "guest".to_string(),
            }),
        ));
    };

    let admin_address = state.admin_address.clone();
    let profile = with_connection(&state, move |conn| {
        let seller_status = fetch_seller_status(conn, &address)
            .map_err(|error| log_internal_error("Failed to load seller status", error))?
            .unwrap_or_else(|| "buyer".to_string());
        Ok(SessionProfile {
            authenticated: true,
            address: address.clone(),
            is_admin: admin_address.as_deref() == Some(address.as_str()),
            seller_status,
        })
    })
    .await?;

    Ok((StatusCode::OK, axum::Json(profile)))
}

async fn logout_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    if let Some(session_id) = parse_cookie_value(&headers, "fashion_store_session") {
        with_connection(&state, move |conn| {
            conn.execute("DELETE FROM auth_sessions WHERE session_id = ?1", params![session_id])
                .map_err(|error| log_internal_error("Failed to delete auth session", error))?;
            Ok(())
        })
        .await?;
    }

    let mut response_headers = HeaderMap::new();
    response_headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&clear_session_cookie())
            .map_err(|error| log_internal_error("Failed to clear auth cookie", error))?,
    );

    Ok((StatusCode::OK, response_headers, axum::Json(json!({ "ok": true }))))
}

async fn get_products(State(state): State<AppState>) -> impl IntoResponse {
    match with_connection(&state, |conn| {
        let mut statement = conn
            .prepare(
                "SELECT product_id, seller, name, price_wei, is_active, meta_json
                 FROM products
                 ORDER BY product_id DESC",
            )
            .map_err(|error| log_internal_error("Failed to load products", error))?;
        let rows = statement
            .query_map([], map_product_row)
            .map_err(|error| log_internal_error("Failed to query products", error))?;
        let mut products = Vec::new();
        for row in rows {
            products.push(
                row.map_err(|error| log_internal_error("Failed to parse product row", error))?,
            );
        }
        Ok(products)
    })
    .await
    {
        Ok(products) => axum::Json(products).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn create_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<CreateProduct>,
) -> AppResult<impl IntoResponse> {
    let actor = require_actor_address(&state, &headers).await?;
    let seller = normalize_address(&payload.seller);
    let name = payload.name.trim().to_string();
    ensure_non_empty(&seller, "Seller")?;
    ensure_non_empty(&name, "Name")?;
    ensure_uint_string(&payload.price_wei, "priceWei")?;
    if !is_valid_evm_address(&seller) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Seller must be a valid EVM address"));
    }
    if actor != seller {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "Seller can only create products for the connected wallet address",
        ));
    }

    let meta_json = serde_json::to_string(&payload.meta)
        .map_err(|error| log_internal_error("Failed to serialize product meta", error))?;
    let product = with_connection(&state, move |conn| {
        let seller_status = fetch_seller_status(conn, &seller)
            .map_err(|error| log_internal_error("Failed to load seller status", error))?;
        if seller_status.as_deref() != Some("approved") {
            return Err(json_error(
                StatusCode::FORBIDDEN,
                "Seller address must be approved before creating products",
            ));
        }

        conn.execute(
            "INSERT INTO products (seller, name, price_wei, is_active, meta_json)
             VALUES (?1, ?2, ?3, 1, ?4)",
            params![seller, name, payload.price_wei, meta_json],
        )
        .map_err(|error| log_internal_error("Failed to create product", error))?;
        let product_id = conn.last_insert_rowid() as u64;
        let product = fetch_product_by_id(conn, product_id)?
            .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Product was not created"))?;
        insert_audit_log(
            conn,
            "product",
            "create",
            &seller,
            &product.name,
            Some(product.product_id),
            &format!("建立商品「{}」", product.name),
            &json!({
                "seller": product.seller,
                "priceWei": product.price_wei,
                "isActive": product.is_active,
                "meta": product.meta
            }),
        )?;
        Ok(product)
    })
    .await?;

    Ok((StatusCode::CREATED, axum::Json(product)))
}

async fn update_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
    axum::Json(payload): axum::Json<UpdateProduct>,
) -> AppResult<impl IntoResponse> {
    let actor = require_actor_address(&state, &headers).await?;
    let admin_address = state.admin_address.clone();
    let product = with_connection(&state, move |conn| {
        let current = fetch_product_by_id(conn, id)?
            .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "Product not found"))?;
        let is_admin = admin_address.as_deref() == Some(actor.as_str());
        if normalize_address(&current.seller) != actor && !is_admin {
            return Err(json_error(
                StatusCode::FORBIDDEN,
                "Only the seller or admin can update this product",
            ));
        }

        if payload.name.is_none()
            && payload.price_wei.is_none()
            && payload.is_active.is_none()
            && payload.meta.is_none()
        {
            return Ok(current);
        }

        let next_name = match payload.name {
            Some(value) => {
                let value = value.trim().to_string();
                ensure_non_empty(&value, "Product name")?;
                value
            }
            None => current.name.clone(),
        };
        let next_price_wei = match payload.price_wei {
            Some(value) => {
                ensure_non_empty(&value, "Price")?;
                ensure_uint_string(&value, "Price")?;
                value
            }
            None => current.price_wei.clone(),
        };
        let next_is_active = payload.is_active.unwrap_or(current.is_active);
        let next_meta_json = match payload.meta {
            Some(value) => serde_json::to_string(&value)
                .map_err(|error| log_internal_error("Failed to serialize product meta", error))?,
            None => serde_json::to_string(&current.meta)
                .map_err(|error| log_internal_error("Failed to serialize current product meta", error))?,
        };
        let next_meta_value: Value = serde_json::from_str(&next_meta_json)
            .map_err(|error| log_internal_error("Failed to parse updated product meta", error))?;
        let mut changed_fields = Vec::new();
        if current.name != next_name {
            changed_fields.push("name");
        }
        if current.price_wei != next_price_wei {
            changed_fields.push("priceWei");
        }
        if current.is_active != next_is_active {
            changed_fields.push("isActive");
        }
        if current.meta != next_meta_value {
            changed_fields.push("meta");
        }

        let updated = conn
            .execute(
                "UPDATE products
                 SET name = ?1, price_wei = ?2, is_active = ?3, meta_json = ?4
                 WHERE product_id = ?5",
                params![
                    next_name,
                    next_price_wei,
                    bool_to_int(next_is_active),
                    next_meta_json,
                    id as i64
                ],
            )
            .map_err(|error| log_internal_error("Failed to update product", error))?;
        if updated == 0 {
            return Err(json_error(StatusCode::NOT_FOUND, "Product not found"));
        }
        let product = fetch_product_by_id(conn, id)?
            .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "Product not found"))?;
        let action = if changed_fields.len() == 1 && changed_fields[0] == "isActive" {
            if product.is_active { "reactivate" } else { "deactivate" }
        } else {
            "update"
        };
        let summary = match action {
            "deactivate" => format!("下架商品「{}」", product.name),
            "reactivate" => format!("重新上架商品「{}」", product.name),
            _ => format!("更新商品「{}」", product.name),
        };
        insert_audit_log(
            conn,
            "product",
            action,
            &actor,
            &product.name,
            Some(product.product_id),
            &summary,
            &json!({
                "seller": product.seller,
                "changedFields": changed_fields,
                "priceWei": product.price_wei,
                "isActive": product.is_active,
                "meta": product.meta
            }),
        )?;
        Ok(product)
    })
    .await?;

    Ok((StatusCode::OK, axum::Json(product)))
}

async fn get_sellers(State(state): State<AppState>) -> impl IntoResponse {
    match with_connection(&state, |conn| load_sellers_store(conn)).await {
        Ok(sellers) => axum::Json(sellers).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn request_seller(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<SellerRequestPayload>,
) -> AppResult<impl IntoResponse> {
    let actor = require_actor_address(&state, &headers).await?;
    let address = normalize_address(&payload.address);
    ensure_non_empty(&address, "Address")?;
    if !is_valid_evm_address(&address) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Address must be a valid EVM address"));
    }
    if actor != address {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "Seller request address must match the connected wallet address",
        ));
    }

    let sellers = with_connection(&state, move |conn| {
        let current_status = fetch_seller_status(conn, &address)
            .map_err(|error| log_internal_error("Failed to load seller status", error))?;

        if current_status.as_deref() != Some("approved") {
            let timestamp = now_iso_like();
            conn.execute(
                "INSERT INTO sellers (address, status, created_at, updated_at)
                 VALUES (?1, 'pending', ?2, ?2)
                 ON CONFLICT(address) DO UPDATE SET
                     status = CASE
                         WHEN sellers.status = 'approved' THEN 'approved'
                         ELSE 'pending'
                     END,
                     updated_at = excluded.updated_at",
                params![address, timestamp],
            )
            .map_err(|error| log_internal_error("Failed to request seller access", error))?;
            insert_audit_log(
                conn,
                "seller",
                "request",
                &actor,
                &address,
                None,
                &format!("地址 {} 送出賣家申請", address),
                &json!({
                    "address": address,
                    "previousStatus": current_status,
                    "nextStatus": "pending"
                }),
            )?;
        }

        load_sellers_store(conn)
    })
    .await?;

    Ok((StatusCode::OK, axum::Json(sellers)))
}

async fn approve_seller(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<SellerApprovePayload>,
) -> AppResult<impl IntoResponse> {
    let actor = require_admin_actor(&state, &headers).await?;
    let address = normalize_address(&payload.address);
    ensure_non_empty(&address, "Address")?;
    if !is_valid_evm_address(&address) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Address must be a valid EVM address"));
    }

    let approved = payload.approved.unwrap_or(true);
    let sellers = with_connection(&state, move |conn| {
        let timestamp = now_iso_like();
        let status = if approved { "approved" } else { "pending" };
        let previous_status = fetch_seller_status(conn, &address)
            .map_err(|error| log_internal_error("Failed to load seller status", error))?;
        let summary = if approved {
            format!("管理員核准 {} 成為賣家", address)
        } else {
            format!("管理員將 {} 設回審核中", address)
        };
        conn.execute(
            "INSERT INTO sellers (address, status, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(address) DO UPDATE SET
                 status = excluded.status,
                 updated_at = excluded.updated_at",
            params![address, status, timestamp],
        )
        .map_err(|error| log_internal_error("Failed to approve seller", error))?;
        insert_audit_log(
            conn,
            "seller",
            if approved { "approve" } else { "mark_pending" },
            &actor,
            &address,
            None,
            &summary,
            &json!({
                "address": address,
                "previousStatus": previous_status,
                "nextStatus": status
            }),
        )?;
        load_sellers_store(conn)
    })
    .await?;

    Ok((StatusCode::OK, axum::Json(sellers)))
}

async fn get_admin_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> AppResult<impl IntoResponse> {
    require_admin_actor(&state, &headers).await?;
    let logs = with_connection(&state, |conn| load_audit_logs(conn)).await?;
    Ok((StatusCode::OK, axum::Json(logs)))
}

async fn get_orders(State(state): State<AppState>) -> impl IntoResponse {
    match with_connection(&state, |conn| load_orders(conn)).await {
        Ok(orders) => axum::Json(orders).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn upsert_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<CreateOrderPayload>,
) -> AppResult<impl IntoResponse> {
    let _actor = require_actor_address(&state, &headers).await?;
    if payload.order_id == 0 {
        return Err(json_error(StatusCode::BAD_REQUEST, "Order ID required"));
    }
    if let Some(product_seller) = payload.product_seller.as_deref() {
        if !product_seller.trim().is_empty() && !is_valid_evm_address(product_seller) {
            return Err(json_error(
                StatusCode::BAD_REQUEST,
                "productSeller must be a valid EVM address",
            ));
        }
    }
    if let Some(price_wei) = payload.price_wei.as_deref() {
        ensure_uint_string(price_wei, "priceWei")?;
    }

    let next = with_connection(&state, move |conn| {
        let current = fetch_order_by_id(conn, payload.order_id)
            .map_err(|error| log_internal_error("Failed to load order", error))?
            .unwrap_or_default();
        let next = OrderRecord {
            order_id: payload.order_id,
            product_id: payload.product_id.unwrap_or(current.product_id),
            product_name: payload.product_name.unwrap_or(current.product_name),
            product_seller: payload.product_seller.unwrap_or(current.product_seller),
            price_wei: payload.price_wei.unwrap_or(current.price_wei),
            flow_stage: payload.flow_stage.unwrap_or(current.flow_stage.max(1)),
        };

        conn.execute(
            "INSERT INTO orders (order_id, product_id, product_name, product_seller, price_wei, flow_stage)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(order_id) DO UPDATE SET
                 product_id = excluded.product_id,
                 product_name = excluded.product_name,
                 product_seller = excluded.product_seller,
                 price_wei = excluded.price_wei,
                 flow_stage = excluded.flow_stage",
            params![
                next.order_id as i64,
                next.product_id as i64,
                next.product_name,
                next.product_seller,
                next.price_wei,
                next.flow_stage as i64
            ],
        )
        .map_err(|error| log_internal_error("Failed to save order", error))?;

        fetch_order_by_id(conn, payload.order_id)
            .map_err(|error| log_internal_error("Failed to reload order", error))?
            .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Order was not saved"))
    })
    .await?;

    Ok((StatusCode::CREATED, axum::Json(next)))
}

async fn update_order_flow(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
    axum::Json(payload): axum::Json<UpdateOrderFlowPayload>,
) -> AppResult<impl IntoResponse> {
    let actor = require_actor_address(&state, &headers).await?;
    let admin_address = state.admin_address.clone();
    let updated = with_connection(&state, move |conn| {
        let mut current = fetch_order_by_id(conn, id)
            .map_err(|error| log_internal_error("Failed to load order", error))?
            .ok_or_else(|| json_error(StatusCode::NOT_FOUND, "Order not found"))?;
        let is_admin = admin_address.as_deref() == Some(actor.as_str());
        if normalize_address(&current.product_seller) != actor && !is_admin {
            return Err(json_error(
                StatusCode::FORBIDDEN,
                "Only the seller or admin can update order flow",
            ));
        }
        current.flow_stage = payload.flow_stage.unwrap_or(current.flow_stage).clamp(1, 4);

        conn.execute(
            "UPDATE orders SET flow_stage = ?1 WHERE order_id = ?2",
            params![current.flow_stage as i64, id as i64],
        )
        .map_err(|error| log_internal_error("Failed to update order flow", error))?;
        Ok(current)
    })
    .await?;

    Ok((StatusCode::OK, axum::Json(updated)))
}

async fn get_reviews(State(state): State<AppState>) -> impl IntoResponse {
    match with_connection(&state, |conn| load_reviews(conn)).await {
        Ok(reviews) => axum::Json(reviews).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn upsert_review(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<CreateReviewPayload>,
) -> AppResult<impl IntoResponse> {
    let actor = require_actor_address(&state, &headers).await?;
    if payload.order_id == 0 {
        return Err(json_error(StatusCode::BAD_REQUEST, "Order ID required"));
    }
    if !(1..=5).contains(&payload.rating) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Rating required"));
    }
    let buyer = normalize_address(payload.buyer.as_deref().unwrap_or_default());
    let seller = normalize_address(payload.seller.as_deref().unwrap_or_default());
    if !is_valid_evm_address(&buyer) || !is_valid_evm_address(&seller) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "Buyer and seller must be valid EVM addresses",
        ));
    }
    if actor != buyer {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "Only the buyer can create or update the review",
        ));
    }

    let review = with_connection(&state, move |conn| {
        let next = Review {
            order_id: payload.order_id,
            product_id: payload.product_id.unwrap_or(0),
            product_name: payload.product_name.unwrap_or_default(),
            seller,
            buyer,
            rating: payload.rating,
            comment: payload.comment.unwrap_or_default().trim().to_string(),
            created_at: payload.created_at.unwrap_or_else(now_iso_like),
        };

        conn.execute(
            "INSERT INTO reviews (order_id, product_id, product_name, seller, buyer, rating, comment, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(order_id) DO UPDATE SET
                 product_id = excluded.product_id,
                 product_name = excluded.product_name,
                 seller = excluded.seller,
                 buyer = excluded.buyer,
                 rating = excluded.rating,
                 comment = excluded.comment,
                 created_at = excluded.created_at",
            params![
                next.order_id as i64,
                next.product_id as i64,
                next.product_name,
                next.seller,
                next.buyer,
                next.rating as i64,
                next.comment,
                next.created_at
            ],
        )
        .map_err(|error| log_internal_error("Failed to save review", error))?;

        fetch_review_by_order_id(conn, payload.order_id)
            .map_err(|error| log_internal_error("Failed to reload review", error))?
            .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Review was not saved"))
    })
    .await?;

    Ok((StatusCode::CREATED, axum::Json(review)))
}

async fn get_payouts(State(state): State<AppState>) -> impl IntoResponse {
    match with_connection(&state, |conn| load_payouts(conn)).await {
        Ok(payouts) => axum::Json(payouts).into_response(),
        Err(error) => error.into_response(),
    }
}

async fn upsert_payout(
    State(state): State<AppState>,
    headers: HeaderMap,
    axum::Json(payload): axum::Json<CreatePayoutPayload>,
) -> AppResult<impl IntoResponse> {
    let actor = require_actor_address(&state, &headers).await?;
    if payload.order_id == 0 {
        return Err(json_error(StatusCode::BAD_REQUEST, "Order ID required"));
    }
    let seller = normalize_address(payload.seller.as_deref().unwrap_or_default());
    let buyer = normalize_address(payload.buyer.as_deref().unwrap_or_default());
    if !is_valid_evm_address(&seller) || !is_valid_evm_address(&buyer) {
        return Err(json_error(
            StatusCode::BAD_REQUEST,
            "Buyer and seller must be valid EVM addresses",
        ));
    }
    if actor != seller {
        return Err(json_error(
            StatusCode::FORBIDDEN,
            "Only the seller can save payout history",
        ));
    }
    ensure_uint_string(payload.amount_wei.as_deref().unwrap_or(""), "amountWei")?;

    let payout = with_connection(&state, move |conn| {
        let next = Payout {
            order_id: payload.order_id,
            seller,
            buyer,
            product_id: payload.product_id.unwrap_or(0),
            product_name: payload.product_name.unwrap_or_default(),
            amount_wei: payload.amount_wei.unwrap_or_else(|| "0".to_string()),
            tx_hash: payload.tx_hash.unwrap_or_default(),
            created_at: payload.created_at.unwrap_or_else(now_iso_like),
        };

        conn.execute(
            "INSERT INTO payouts (order_id, seller, buyer, product_id, product_name, amount_wei, tx_hash, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(order_id) DO UPDATE SET
                 seller = excluded.seller,
                 buyer = excluded.buyer,
                 product_id = excluded.product_id,
                 product_name = excluded.product_name,
                 amount_wei = excluded.amount_wei,
                 tx_hash = excluded.tx_hash,
                 created_at = excluded.created_at",
            params![
                next.order_id as i64,
                next.seller,
                next.buyer,
                next.product_id as i64,
                next.product_name,
                next.amount_wei,
                next.tx_hash,
                next.created_at
            ],
        )
        .map_err(|error| log_internal_error("Failed to save payout", error))?;

        fetch_payout_by_order_id(conn, payload.order_id)
            .map_err(|error| log_internal_error("Failed to reload payout", error))?
            .ok_or_else(|| json_error(StatusCode::INTERNAL_SERVER_ERROR, "Payout was not saved"))
    })
    .await?;

    Ok((StatusCode::CREATED, axum::Json(payout)))
}

async fn upload_product_image(
    State(state): State<AppState>,
    headers: HeaderMap,
    mut multipart: Multipart,
) -> AppResult<impl IntoResponse> {
    const MAX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
    let _actor = require_actor_address(&state, &headers).await?;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|error| log_internal_error("Failed to read upload payload", error))?
    {
        if field.name() != Some("image") {
            continue;
        }

        let original_filename = field.file_name().unwrap_or("product-image").to_string();
        let content_type = field
            .content_type()
            .unwrap_or("application/octet-stream")
            .to_string();

        if !content_type.starts_with("image/") {
            return Err(json_error(StatusCode::BAD_REQUEST, "只能上傳圖片檔案"));
        }

        let bytes = field
            .bytes()
            .await
            .map_err(|error| log_internal_error("Failed to read uploaded image", error))?;

        if bytes.is_empty() {
            return Err(json_error(StatusCode::BAD_REQUEST, "圖片內容不能為空"));
        }

        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(json_error(StatusCode::BAD_REQUEST, "圖片大小不可超過 5MB"));
        }

        let extension = infer_upload_extension(&original_filename, &content_type);
        let filename = format!(
            "product-{}-{}.{}",
            chrono::Utc::now().timestamp_millis(),
            std::process::id(),
            extension
        );
        let path = state.upload_dir.join(&filename);

        fs::write(&path, bytes)
            .await
            .map_err(|error| log_internal_error("Failed to save uploaded image", error))?;

        let response = UploadResponse {
            url: format!("/uploads/products/{filename}"),
            filename,
        };
        return Ok((StatusCode::CREATED, axum::Json(response)));
    }

    Err(json_error(StatusCode::BAD_REQUEST, "沒有接收到圖片欄位"))
}

async fn serve_root(State(state): State<AppState>) -> impl IntoResponse {
    serve_file_response(&state.root.join("frontend").join("index.html")).await
}

async fn serve_static(
    State(state): State<AppState>,
    request: axum::extract::Request,
) -> impl IntoResponse {
    let path = sanitize_request_path(request.uri().path());
    let Some(path) = path else {
        return (StatusCode::FORBIDDEN, "Forbidden").into_response();
    };
    let full_path = state.root.join(path);
    serve_file_response(&full_path).await
}

fn sanitize_request_path(request_path: &str) -> Option<PathBuf> {
    let clean = if request_path == "/" {
        PathBuf::from("frontend/index.html")
    } else {
        let trimmed = request_path.trim_start_matches('/');
        let candidate = PathBuf::from(trimmed);
        if candidate
            .components()
            .any(|component| matches!(component, Component::ParentDir))
        {
            return None;
        }
        candidate
    };

    Some(clean)
}

async fn serve_file_response(path: &Path) -> Response<Body> {
    match fs::read(path).await {
        Ok(bytes) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let mut response = Response::new(Body::from(bytes));
            *response.status_mut() = StatusCode::OK;
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_str(mime.as_ref())
                    .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
            );
            response
        }
        Err(_) => {
            let mut response = Response::new(Body::from("Not Found".to_string()));
            *response.status_mut() = StatusCode::NOT_FOUND;
            response.headers_mut().insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("text/plain; charset=utf-8"),
            );
            response
        }
    }
}

fn map_product_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Product> {
    let meta_json: String = row.get(5)?;
    Ok(Product {
        product_id: row.get::<_, i64>(0)? as u64,
        seller: row.get(1)?,
        name: row.get(2)?,
        price_wei: row.get(3)?,
        is_active: row.get::<_, i64>(4)? != 0,
        meta: serde_json::from_str(&meta_json).unwrap_or_else(|_| json!({})),
    })
}

fn map_order_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OrderRecord> {
    Ok(OrderRecord {
        order_id: row.get::<_, i64>(0)? as u64,
        product_id: row.get::<_, i64>(1)? as u64,
        product_name: row.get(2)?,
        product_seller: row.get(3)?,
        price_wei: row.get(4)?,
        flow_stage: row.get::<_, i64>(5)? as u8,
    })
}

fn map_review_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Review> {
    Ok(Review {
        order_id: row.get::<_, i64>(0)? as u64,
        product_id: row.get::<_, i64>(1)? as u64,
        product_name: row.get(2)?,
        seller: row.get(3)?,
        buyer: row.get(4)?,
        rating: row.get::<_, i64>(5)? as u8,
        comment: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn map_payout_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Payout> {
    Ok(Payout {
        order_id: row.get::<_, i64>(0)? as u64,
        seller: row.get(1)?,
        buyer: row.get(2)?,
        product_id: row.get::<_, i64>(3)? as u64,
        product_name: row.get(4)?,
        amount_wei: row.get(5)?,
        tx_hash: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn map_audit_log_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AuditLog> {
    let detail_json: String = row.get(7)?;
    Ok(AuditLog {
        id: row.get::<_, i64>(0)? as u64,
        category: row.get(1)?,
        action: row.get(2)?,
        actor: row.get(3)?,
        subject: row.get(4)?,
        product_id: row
            .get::<_, Option<i64>>(5)?
            .map(|value| value as u64),
        summary: row.get(6)?,
        detail: serde_json::from_str(&detail_json).unwrap_or_else(|_| json!({})),
        created_at: row.get(8)?,
    })
}

fn fetch_product_by_id(conn: &Connection, product_id: u64) -> AppResult<Option<Product>> {
    conn.query_row(
        "SELECT product_id, seller, name, price_wei, is_active, meta_json
         FROM products
         WHERE product_id = ?1",
        params![product_id as i64],
        map_product_row,
    )
    .optional()
    .map_err(|error| log_internal_error("Failed to query product", error))
}

fn fetch_auth_nonce(conn: &Connection, address: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT message
         FROM auth_nonces
         WHERE lower(address) = lower(?1) AND datetime(expires_at) > datetime('now')",
        params![address],
        |row| row.get(0),
    )
    .optional()
}

fn fetch_session_address(conn: &Connection, session_id: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT address
         FROM auth_sessions
         WHERE session_id = ?1 AND datetime(expires_at) > datetime('now')",
        params![session_id],
        |row| row.get(0),
    )
    .optional()
}

fn cleanup_expired_auth_records(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM auth_nonces WHERE datetime(expires_at) <= datetime('now')",
        [],
    )?;
    conn.execute(
        "DELETE FROM auth_sessions WHERE datetime(expires_at) <= datetime('now')",
        [],
    )?;
    Ok(())
}

fn fetch_seller_status(conn: &Connection, address: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT status FROM sellers WHERE lower(address) = lower(?1)",
        params![address],
        |row| row.get(0),
    )
    .optional()
}

fn load_sellers_store(conn: &Connection) -> AppResult<SellersStore> {
    let mut statement = conn
        .prepare("SELECT address, status FROM sellers ORDER BY updated_at DESC, address ASC")
        .map_err(|error| log_internal_error("Failed to load sellers", error))?;
    let rows = statement
        .query_map([], |row| {
            let address: String = row.get(0)?;
            let status: String = row.get(1)?;
            Ok((address, status))
        })
        .map_err(|error| log_internal_error("Failed to query sellers", error))?;

    let mut approved = Vec::new();
    let mut pending = Vec::new();
    for row in rows {
        let (address, status) =
            row.map_err(|error| log_internal_error("Failed to parse seller row", error))?;
        match status.as_str() {
            "approved" => approved.push(address),
            "pending" => pending.push(address),
            _ => {}
        }
    }

    Ok(SellersStore { approved, pending })
}

fn insert_audit_log(
    conn: &Connection,
    category: &str,
    action: &str,
    actor: &str,
    subject: &str,
    product_id: Option<u64>,
    summary: &str,
    detail: &Value,
) -> AppResult<()> {
    let detail_json = serde_json::to_string(detail)
        .map_err(|error| log_internal_error("Failed to serialize audit detail", error))?;
    conn.execute(
        "INSERT INTO audit_logs (category, action, actor, subject, product_id, summary, detail_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            category,
            action,
            actor,
            subject,
            product_id.map(|value| value as i64),
            summary,
            detail_json,
            now_iso_like()
        ],
    )
    .map_err(|error| log_internal_error("Failed to insert audit log", error))?;
    Ok(())
}

fn load_audit_logs(conn: &Connection) -> AppResult<Vec<AuditLog>> {
    let mut statement = conn
        .prepare(
            "SELECT id, category, action, actor, subject, product_id, summary, detail_json, created_at
             FROM audit_logs
             ORDER BY id DESC
             LIMIT 40",
        )
        .map_err(|error| log_internal_error("Failed to load audit logs", error))?;
    let rows = statement
        .query_map([], map_audit_log_row)
        .map_err(|error| log_internal_error("Failed to query audit logs", error))?;

    let mut logs = Vec::new();
    for row in rows {
        logs.push(row.map_err(|error| log_internal_error("Failed to parse audit log row", error))?);
    }
    Ok(logs)
}

fn fetch_order_by_id(conn: &Connection, order_id: u64) -> rusqlite::Result<Option<OrderRecord>> {
    conn.query_row(
        "SELECT order_id, product_id, product_name, product_seller, price_wei, flow_stage
         FROM orders
         WHERE order_id = ?1",
        params![order_id as i64],
        map_order_row,
    )
    .optional()
}

fn load_orders(conn: &Connection) -> AppResult<BTreeMap<String, OrderRecord>> {
    let mut statement = conn
        .prepare(
            "SELECT order_id, product_id, product_name, product_seller, price_wei, flow_stage
             FROM orders
             ORDER BY order_id DESC",
        )
        .map_err(|error| log_internal_error("Failed to load orders", error))?;
    let rows = statement
        .query_map([], map_order_row)
        .map_err(|error| log_internal_error("Failed to query orders", error))?;

    let mut orders = BTreeMap::new();
    for row in rows {
        let order = row.map_err(|error| log_internal_error("Failed to parse order row", error))?;
        orders.insert(order.order_id.to_string(), order);
    }
    Ok(orders)
}

fn fetch_review_by_order_id(conn: &Connection, order_id: u64) -> rusqlite::Result<Option<Review>> {
    conn.query_row(
        "SELECT order_id, product_id, product_name, seller, buyer, rating, comment, created_at
         FROM reviews
         WHERE order_id = ?1",
        params![order_id as i64],
        map_review_row,
    )
    .optional()
}

fn load_reviews(conn: &Connection) -> AppResult<Vec<Review>> {
    let mut statement = conn
        .prepare(
            "SELECT order_id, product_id, product_name, seller, buyer, rating, comment, created_at
             FROM reviews
             ORDER BY datetime(created_at) DESC, order_id DESC",
        )
        .map_err(|error| log_internal_error("Failed to load reviews", error))?;
    let rows = statement
        .query_map([], map_review_row)
        .map_err(|error| log_internal_error("Failed to query reviews", error))?;

    let mut reviews = Vec::new();
    for row in rows {
        reviews.push(row.map_err(|error| log_internal_error("Failed to parse review row", error))?);
    }
    Ok(reviews)
}

fn fetch_payout_by_order_id(conn: &Connection, order_id: u64) -> rusqlite::Result<Option<Payout>> {
    conn.query_row(
        "SELECT order_id, seller, buyer, product_id, product_name, amount_wei, tx_hash, created_at
         FROM payouts
         WHERE order_id = ?1",
        params![order_id as i64],
        map_payout_row,
    )
    .optional()
}

fn load_payouts(conn: &Connection) -> AppResult<Vec<Payout>> {
    let mut statement = conn
        .prepare(
            "SELECT order_id, seller, buyer, product_id, product_name, amount_wei, tx_hash, created_at
             FROM payouts
             ORDER BY datetime(created_at) DESC, order_id DESC",
        )
        .map_err(|error| log_internal_error("Failed to load payouts", error))?;
    let rows = statement
        .query_map([], map_payout_row)
        .map_err(|error| log_internal_error("Failed to query payouts", error))?;

    let mut payouts = Vec::new();
    for row in rows {
        payouts.push(row.map_err(|error| log_internal_error("Failed to parse payout row", error))?);
    }
    Ok(payouts)
}

fn bool_to_int(value: bool) -> i64 {
    if value { 1 } else { 0 }
}

fn infer_upload_extension(filename: &str, content_type: &str) -> &'static str {
    let lower = filename.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "jpg"
    } else if lower.ends_with(".webp") {
        "webp"
    } else if lower.ends_with(".gif") {
        "gif"
    } else if content_type == "image/png" {
        "png"
    } else if content_type == "image/webp" {
        "webp"
    } else if content_type == "image/gif" {
        "gif"
    } else {
        "jpg"
    }
}

fn now_iso_like() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn auth_expiry_iso(seconds_from_now: i64) -> String {
    (chrono::Utc::now() + chrono::Duration::seconds(seconds_from_now)).to_rfc3339()
}
