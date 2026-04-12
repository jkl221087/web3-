use std::{
    collections::BTreeMap,
    env,
    net::SocketAddr,
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use axum::{
    Router,
    body::Body,
    extract::{Path as AxumPath, State},
    http::{HeaderValue, Response, StatusCode, header},
    response::IntoResponse,
    routing::{get, patch, post},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::{fs, sync::Mutex};

type AppResult<T> = Result<T, (StatusCode, axum::Json<Value>)>;

#[derive(Clone)]
struct AppState {
    root: PathBuf,
    data_files: DataFiles,
    file_lock: Arc<Mutex<()>>,
}

#[derive(Clone)]
struct DataFiles {
    products: PathBuf,
    sellers: PathBuf,
    orders: PathBuf,
    reviews: PathBuf,
    payouts: PathBuf,
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
    #[serde(rename = "isActive")]
    is_active: Option<bool>,
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

#[tokio::main]
async fn main() {
    let port = env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3000);

    let root = env::current_dir().expect("failed to get current directory");
    let data_dir = root.join("data");
    let data_files = DataFiles {
        products: data_dir.join("products.json"),
        sellers: data_dir.join("sellers.json"),
        orders: data_dir.join("orders.json"),
        reviews: data_dir.join("reviews.json"),
        payouts: data_dir.join("payouts.json"),
    };

    ensure_data_files(&data_dir, &data_files)
        .await
        .expect("failed to prepare data files");

    let state = AppState {
        root,
        data_files,
        file_lock: Arc::new(Mutex::new(())),
    };

    let app = Router::new()
        .route("/api/products", get(get_products).post(create_product))
        .route("/api/products/{id}", patch(update_product))
        .route("/api/sellers", get(get_sellers))
        .route("/api/sellers/request", post(request_seller))
        .route("/api/sellers/approve", post(approve_seller))
        .route("/api/orders", get(get_orders).post(upsert_order))
        .route("/api/orders/{id}/flow", patch(update_order_flow))
        .route("/api/reviews", get(get_reviews).post(upsert_review))
        .route("/api/payouts", get(get_payouts).post(upsert_payout))
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

async fn ensure_data_files(data_dir: &Path, data_files: &DataFiles) -> std::io::Result<()> {
    fs::create_dir_all(data_dir).await?;

    write_default_if_missing(&data_files.products, "[]").await?;
    write_default_if_missing(
        &data_files.sellers,
        &serde_json::to_string_pretty(&SellersStore {
            approved: Vec::new(),
            pending: Vec::new(),
        })
        .expect("serialize sellers"),
    )
    .await?;
    write_default_if_missing(&data_files.orders, "{}").await?;
    write_default_if_missing(&data_files.reviews, "[]").await?;
    write_default_if_missing(&data_files.payouts, "[]").await?;

    Ok(())
}

async fn write_default_if_missing(path: &Path, contents: &str) -> std::io::Result<()> {
    if fs::metadata(path).await.is_err() {
        fs::write(path, contents).await?;
    }
    Ok(())
}

fn json_error(status: StatusCode, message: &str) -> (StatusCode, axum::Json<Value>) {
    (status, axum::Json(json!({ "error": message })))
}

async fn read_json_or_default<T>(path: &Path) -> T
where
    T: serde::de::DeserializeOwned + Default,
{
    match fs::read_to_string(path).await {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
        Err(_) => T::default(),
    }
}

async fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let payload = serde_json::to_string_pretty(value).map_err(|_| {
        json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to serialize JSON",
        )
    })?;
    fs::write(path, payload).await.map_err(|_| {
        json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Failed to write JSON file",
        )
    })?;
    Ok(())
}

async fn get_products(State(state): State<AppState>) -> impl IntoResponse {
    let mut products: Vec<Product> = read_json_or_default(&state.data_files.products).await;
    products.sort_by(|a, b| b.product_id.cmp(&a.product_id));
    axum::Json(products)
}

async fn create_product(
    State(state): State<AppState>,
    axum::Json(payload): axum::Json<CreateProduct>,
) -> AppResult<impl IntoResponse> {
    let _guard = state.file_lock.lock().await;
    let mut products: Vec<Product> = read_json_or_default(&state.data_files.products).await;
    let next_id = products
        .iter()
        .map(|item| item.product_id)
        .max()
        .unwrap_or(0)
        + 1;
    let product = Product {
        product_id: next_id,
        seller: payload.seller,
        name: payload.name.trim().to_string(),
        price_wei: payload.price_wei,
        is_active: true,
        meta: payload.meta,
    };
    products.insert(0, product.clone());
    write_json(&state.data_files.products, &products).await?;
    Ok((StatusCode::CREATED, axum::Json(product)))
}

async fn update_product(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<u64>,
    axum::Json(payload): axum::Json<UpdateProduct>,
) -> AppResult<impl IntoResponse> {
    let _guard = state.file_lock.lock().await;
    let mut products: Vec<Product> = read_json_or_default(&state.data_files.products).await;

    let Some(product) = products.iter_mut().find(|item| item.product_id == id) else {
        return Err(json_error(StatusCode::NOT_FOUND, "Product not found"));
    };

    if let Some(is_active) = payload.is_active {
        product.is_active = is_active;
    }

    let updated = product.clone();
    write_json(&state.data_files.products, &products).await?;
    Ok((StatusCode::OK, axum::Json(updated)))
}

async fn get_sellers(State(state): State<AppState>) -> impl IntoResponse {
    let sellers: SellersStore = read_json_or_default(&state.data_files.sellers).await;
    axum::Json(sellers)
}

async fn request_seller(
    State(state): State<AppState>,
    axum::Json(payload): axum::Json<SellerRequestPayload>,
) -> AppResult<impl IntoResponse> {
    let address = payload.address.trim().to_string();
    if address.is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "Address required"));
    }

    let _guard = state.file_lock.lock().await;
    let mut sellers: SellersStore = read_json_or_default(&state.data_files.sellers).await;
    if !contains_ignore_case(&sellers.approved, &address)
        && !contains_ignore_case(&sellers.pending, &address)
    {
        sellers.pending.push(address);
    }

    write_json(&state.data_files.sellers, &sellers).await?;
    Ok((StatusCode::OK, axum::Json(sellers)))
}

async fn approve_seller(
    State(state): State<AppState>,
    axum::Json(payload): axum::Json<SellerApprovePayload>,
) -> AppResult<impl IntoResponse> {
    let address = payload.address.trim().to_string();
    if address.is_empty() {
        return Err(json_error(StatusCode::BAD_REQUEST, "Address required"));
    }

    let approved = payload.approved.unwrap_or(true);
    let _guard = state.file_lock.lock().await;
    let mut sellers: SellersStore = read_json_or_default(&state.data_files.sellers).await;

    sellers
        .pending
        .retain(|item| !eq_ignore_case(item, &address));
    sellers
        .approved
        .retain(|item| !eq_ignore_case(item, &address));
    if approved {
        sellers.approved.push(address);
    }

    write_json(&state.data_files.sellers, &sellers).await?;
    Ok((StatusCode::OK, axum::Json(sellers)))
}

async fn get_orders(State(state): State<AppState>) -> impl IntoResponse {
    let orders: BTreeMap<String, OrderRecord> =
        read_json_or_default(&state.data_files.orders).await;
    axum::Json(orders)
}

async fn upsert_order(
    State(state): State<AppState>,
    axum::Json(payload): axum::Json<CreateOrderPayload>,
) -> AppResult<impl IntoResponse> {
    if payload.order_id == 0 {
        return Err(json_error(StatusCode::BAD_REQUEST, "Order ID required"));
    }

    let _guard = state.file_lock.lock().await;
    let mut orders: BTreeMap<String, OrderRecord> =
        read_json_or_default(&state.data_files.orders).await;
    let key = payload.order_id.to_string();
    let current = orders.get(&key).cloned().unwrap_or_default();
    let next = OrderRecord {
        order_id: payload.order_id,
        product_id: payload.product_id.unwrap_or(current.product_id),
        product_name: payload.product_name.unwrap_or(current.product_name),
        product_seller: payload.product_seller.unwrap_or(current.product_seller),
        price_wei: payload.price_wei.unwrap_or(current.price_wei),
        flow_stage: payload.flow_stage.unwrap_or(current.flow_stage.max(1)),
    };

    orders.insert(key, next.clone());
    write_json(&state.data_files.orders, &orders).await?;
    Ok((StatusCode::CREATED, axum::Json(next)))
}

async fn update_order_flow(
    State(state): State<AppState>,
    AxumPath(id): AxumPath<u64>,
    axum::Json(payload): axum::Json<UpdateOrderFlowPayload>,
) -> AppResult<impl IntoResponse> {
    let _guard = state.file_lock.lock().await;
    let mut orders: BTreeMap<String, OrderRecord> =
        read_json_or_default(&state.data_files.orders).await;
    let key = id.to_string();
    let Some(order) = orders.get_mut(&key) else {
        return Err(json_error(StatusCode::NOT_FOUND, "Order not found"));
    };

    let stage = payload.flow_stage.unwrap_or(order.flow_stage).clamp(1, 4);
    order.flow_stage = stage;
    let updated = order.clone();
    write_json(&state.data_files.orders, &orders).await?;
    Ok((StatusCode::OK, axum::Json(updated)))
}

async fn get_reviews(State(state): State<AppState>) -> impl IntoResponse {
    let reviews: Vec<Review> = read_json_or_default(&state.data_files.reviews).await;
    axum::Json(reviews)
}

async fn upsert_review(
    State(state): State<AppState>,
    axum::Json(payload): axum::Json<CreateReviewPayload>,
) -> AppResult<impl IntoResponse> {
    if payload.order_id == 0 {
        return Err(json_error(StatusCode::BAD_REQUEST, "Order ID required"));
    }
    if !(1..=5).contains(&payload.rating) {
        return Err(json_error(StatusCode::BAD_REQUEST, "Rating required"));
    }

    let _guard = state.file_lock.lock().await;
    let mut reviews: Vec<Review> = read_json_or_default(&state.data_files.reviews).await;
    let next = Review {
        order_id: payload.order_id,
        product_id: payload.product_id.unwrap_or(0),
        product_name: payload.product_name.unwrap_or_default(),
        seller: payload.seller.unwrap_or_default(),
        buyer: payload.buyer.unwrap_or_default(),
        rating: payload.rating,
        comment: payload.comment.unwrap_or_default().trim().to_string(),
        created_at: payload.created_at.unwrap_or_else(now_iso_like),
    };

    if let Some(index) = reviews
        .iter()
        .position(|item| item.order_id == payload.order_id)
    {
        reviews[index] = next.clone();
    } else {
        reviews.insert(0, next.clone());
    }

    write_json(&state.data_files.reviews, &reviews).await?;
    Ok((StatusCode::CREATED, axum::Json(next)))
}

async fn get_payouts(State(state): State<AppState>) -> impl IntoResponse {
    let payouts: Vec<Payout> = read_json_or_default(&state.data_files.payouts).await;
    axum::Json(payouts)
}

async fn upsert_payout(
    State(state): State<AppState>,
    axum::Json(payload): axum::Json<CreatePayoutPayload>,
) -> AppResult<impl IntoResponse> {
    if payload.order_id == 0 {
        return Err(json_error(StatusCode::BAD_REQUEST, "Order ID required"));
    }

    let _guard = state.file_lock.lock().await;
    let mut payouts: Vec<Payout> = read_json_or_default(&state.data_files.payouts).await;
    let next = Payout {
        order_id: payload.order_id,
        seller: payload.seller.unwrap_or_default(),
        buyer: payload.buyer.unwrap_or_default(),
        product_id: payload.product_id.unwrap_or(0),
        product_name: payload.product_name.unwrap_or_default(),
        amount_wei: payload.amount_wei.unwrap_or_else(|| "0".to_string()),
        tx_hash: payload.tx_hash.unwrap_or_default(),
        created_at: payload.created_at.unwrap_or_else(now_iso_like),
    };

    if let Some(index) = payouts
        .iter()
        .position(|item| item.order_id == payload.order_id)
    {
        payouts[index] = next.clone();
    } else {
        payouts.insert(0, next.clone());
    }

    write_json(&state.data_files.payouts, &payouts).await?;
    Ok((StatusCode::CREATED, axum::Json(next)))
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

fn contains_ignore_case(items: &[String], target: &str) -> bool {
    items.iter().any(|item| eq_ignore_case(item, target))
}

fn eq_ignore_case(left: &str, right: &str) -> bool {
    left.eq_ignore_ascii_case(right)
}

fn now_iso_like() -> String {
    chrono::Utc::now().to_rfc3339()
}
