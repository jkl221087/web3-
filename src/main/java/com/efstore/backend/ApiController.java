package com.efstore.backend;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
class ApiController {
    private final StoreService storeService;

    private final AuthService authService;

    ApiController(StoreService storeService, AuthService authService) {
        this.storeService = storeService;
        this.authService = authService;
    }

    @PostMapping("/auth/nonce")
    Map<String, Object> authNonce(@RequestBody AuthNonceRequest payload) {// 自動轉成 AuthNonceRequest 物件命名為 payload
        return authService.issueNonce(payload.address(), payload.chainId());
    }

    @PostMapping("/auth/verify") // post api
    ResponseEntity<SessionProfile> authVerify(@RequestBody AuthVerifyRequest payload) {
        AuthService.SessionLogin login = authService.verify(payload.address(), payload.message(), payload.signature());
        String actor = StoreSupport.normalizeAddress(payload.address());
        HttpHeaders headers = new HttpHeaders();// 建立 HTTP headers 物件
        // 把登入成功後的 session id 寫進 cookie，並設定 cookie 的有效時間。
        headers.add(HttpHeaders.SET_COOKIE, authService.sessionCookie(login.sessionId(), login.maxAgeSeconds()));
        return new ResponseEntity<>(storeService.sessionProfile(actor), headers, HttpStatus.OK);
    }

    @PostMapping("/auth/logout") // POST API
    ResponseEntity<Map<String, Object>> logout(HttpServletRequest request) {// HTTP 請求
        authService.logout(request);// 登出
        HttpHeaders headers = new HttpHeaders();// 實例
        headers.add(HttpHeaders.SET_COOKIE, authService.clearSessionCookie());// cookie 刪掉
        return new ResponseEntity<>(Map.of("ok", true), headers, HttpStatus.OK);
    }

    @GetMapping("/me")
    SessionProfile me(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = authService.resolveActor(request, actorHeader)
                .map(StoreSupport::normalizeAddress)
                .orElse(null);
        return storeService.sessionProfile(actor);
    }

    @GetMapping("/products")
    List<ProductRecord> products() {
        return storeService.loadProducts();// 商品清單
    }

    @PostMapping("/products")
    ResponseEntity<ProductRecord> createProduct(HttpServletRequest request,
            // x-actor-address 地址
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
            // 把 request body 的 JSON 轉成 CreateProductRequest
            @RequestBody CreateProductRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);// 驗證身分
        return ResponseEntity.status(HttpStatus.CREATED).body(storeService.createProduct(actor, payload));// 建立商品
    }

    @PatchMapping("/products/{id}")
    ProductRecord updateProduct(HttpServletRequest request,
            // 地址
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader, @PathVariable("id") long id,
            // 把 request body 的 JSON 轉成 UpdateProductRequest
            @RequestBody UpdateProductRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.updateProduct(actor, id, payload);// storeService 更新商品
    }

    @GetMapping("/sellers")
    SellersStore sellers() {
        return storeService.loadSellersStore();
    }

    @PostMapping("/sellers/request")
    SellersStore requestSeller(HttpServletRequest request,
            // 地址
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
            @RequestBody SellerRequest payload) {// 申請成為賣家
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.requestSeller(actor, payload);// 更改成不看address 只用actor 當身分來源
    }

    @PostMapping("/sellers/approve")
    SellersStore approveSeller(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
            @RequestBody SellerApproveRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.approveSeller(actor, payload.address(), payload.approved());
    }

    @GetMapping("/orders/me") // only look order for Buyer self
    List<OrderRecord> myOrder(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.loadBuyerOrders(actor);
    }

    // PostMapping -> GetMapping 查資料
    @GetMapping("/seller/orders") // only look order for seller self
    List<OrderRecord> sellerOrders(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.loadSellerOrders(actor);
    }

    @GetMapping("/admin/orders") // admin can see all Orders
    List<OrderRecord> adminOrder(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.loadAllOrders(actor);
    }

    @PostMapping("/orders")
    ResponseEntity<OrderRecord> saveOrder(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
            @RequestBody CreateOrderRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(storeService.saveOrderMeta(actor, payload));
    }

    @PatchMapping("/orders/{id}/flow")
    OrderRecord updateOrderFlow(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader, @PathVariable("id") long id,
            @RequestBody UpdateOrderFlowRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.updateOrderFlow(actor, id, payload);
    }

    @GetMapping("/reviews")
    List<ReviewRecord> reviews() {
        return storeService.loadReviews();
    }

    @PostMapping("/reviews")
    ResponseEntity<ReviewRecord> saveReview(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
            @RequestBody CreateReviewRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return ResponseEntity.status(HttpStatus.CREATED).body(storeService.saveReview(actor, payload));
    }

    @GetMapping("/payouts")
    List<PayoutRecord> payouts() {
        return storeService.loadPayouts();
    }

    @PostMapping("/payouts")
    ResponseEntity<PayoutRecord> savePayout(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
            @RequestBody CreatePayoutRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return ResponseEntity.status(HttpStatus.CREATED).body(storeService.savePayout(actor, payload));
    }

    @GetMapping("/admin/audit")
    List<AuditLogRecord> audit(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        StoreSupport.require(storeService.isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");
        return storeService.loadAuditLogs();
    }

    @GetMapping("/dashboard/admin")
    Map<String, Object> adminDashboard(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        StoreSupport.require(storeService.isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");
        return storeService.adminDashboard();
    }

    @GetMapping("/dashboard/seller")
    Map<String, Object> sellerDashboard(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.sellerDashboard(actor);
    }

    @GetMapping("/dashboard/buyer")
    Map<String, Object> buyerDashboard(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.buyerDashboard(actor);
    }

    @GetMapping("/dashboard/me")
    Map<String, Object> myDashboard(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.myDashboard(actor);
    }

    @PostMapping(value = "/uploads/product-image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    UploadResponse uploadImage(HttpServletRequest request,
            @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
            @RequestPart("image") MultipartFile image) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.uploadImage(actor, image);
    }

    @ExceptionHandler(ApiException.class)
    ResponseEntity<Map<String, Object>> handleApiError(ApiException error) {
        return ResponseEntity.status(error.status()).body(Map.of("error", error.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> handleUnexpected(Exception error) {
        error.printStackTrace();
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", "Internal server error"));
    }
}
