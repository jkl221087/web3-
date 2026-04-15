
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
    Map<String, Object> authNonce(@RequestBody AuthNonceRequest payload) {
        return authService.issueNonce(payload.address(), payload.chainId());
    }

    @PostMapping("/auth/verify")
    ResponseEntity<SessionProfile> authVerify(@RequestBody AuthVerifyRequest payload) {
        AuthService.SessionLogin login = authService.verify(payload.address(), payload.message(), payload.signature());
        String actor = StoreSupport.normalizeAddress(payload.address());
        HttpHeaders headers = new HttpHeaders();
        headers.add(HttpHeaders.SET_COOKIE, authService.sessionCookie(login.sessionId(), login.maxAgeSeconds()));
        return new ResponseEntity<>(storeService.sessionProfile(actor), headers, HttpStatus.OK);
    }

    @PostMapping("/auth/logout")
    ResponseEntity<Map<String, Object>> logout(HttpServletRequest request) {
        authService.logout(request);
        HttpHeaders headers = new HttpHeaders();
        headers.add(HttpHeaders.SET_COOKIE, authService.clearSessionCookie());
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
        return storeService.loadProducts();
    }

    @PostMapping("/products")
    ResponseEntity<ProductRecord> createProduct(HttpServletRequest request,
                                                @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                                                @RequestBody CreateProductRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return ResponseEntity.status(HttpStatus.CREATED).body(storeService.createProduct(actor, payload));
    }

    @PatchMapping("/products/{id}")
    ProductRecord updateProduct(HttpServletRequest request,
                                @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                                @PathVariable("id") long id,
                                @RequestBody UpdateProductRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.updateProduct(actor, id, payload);
    }

    @GetMapping("/sellers")
    SellersStore sellers() {
        return storeService.loadSellersStore();
    }

    @PostMapping("/sellers/request")
    SellersStore requestSeller(HttpServletRequest request,
                               @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                               @RequestBody SellerRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.requestSeller(actor, payload);
    }

    @PostMapping("/sellers/approve")
    SellersStore approveSeller(HttpServletRequest request,
                               @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                               @RequestBody SellerApproveRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.approveSeller(actor, payload.address(), payload.approved());
    }

    @GetMapping("/orders/me")
    List<OrderRecord> myOrder(HttpServletRequest request,
                              @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.loadBuyerOrders(actor);
    }

    @GetMapping("/seller/orders")
    List<OrderRecord> sellerOrders(HttpServletRequest request,
                                   @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.loadSellerOrders(actor);
    }

    @GetMapping("/admin/orders")
    List<OrderRecord> adminOrder(HttpServletRequest request,
                                 @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.loadAllOrders(actor);
    }

    @GetMapping("/orders")
    Map<String, OrderRecord> orders() {
        return storeService.loadOrdersMap();
    }

    @PostMapping("/orders")
    ResponseEntity<OrderRecord> saveOrder(HttpServletRequest request,
                                          @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                                          @RequestBody CreateOrderRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return ResponseEntity.status(HttpStatus.CREATED).body(storeService.saveOrderMeta(actor, payload));
    }

    @PatchMapping("/orders/{id}/flow")
    OrderRecord updateOrderFlow(HttpServletRequest request,
                                @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                                @PathVariable("id") long id,
                                @RequestBody UpdateOrderFlowRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.updateOrderFlow(actor, id, payload);
    }

    @PatchMapping("/orders/{id}/risk")
    OrderRecord updateOrderRisk(HttpServletRequest request,
                                @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                                @PathVariable("id") long id,
                                @RequestBody UpdateOrderRiskRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.updateOrderRisk(actor, id, payload);
    }

    @PostMapping("/orders/{id}/freeze")
    OrderRecord freezeOrder(HttpServletRequest request,
                            @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                            @PathVariable("id") long id,
                            @RequestBody(required = false) UpdateOrderFreezeRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        String reason = payload == null ? "" : payload.reason();
        return storeService.setOrderFrozen(actor, id, true, reason);
    }

    @PostMapping("/orders/{id}/unfreeze")
    OrderRecord unfreezeOrder(HttpServletRequest request,
                              @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                              @PathVariable("id") long id,
                              @RequestBody(required = false) UpdateOrderFreezeRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        String reason = payload == null ? "" : payload.reason();
        return storeService.setOrderFrozen(actor, id, false, reason);
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

    @PatchMapping("/payouts/{orderId}/review")
    PayoutRecord reviewPayout(HttpServletRequest request,
                              @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                              @PathVariable("orderId") long orderId,
                              @RequestBody UpdatePayoutReviewRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.updatePayoutReview(actor, orderId, payload);
    }

    @GetMapping("/admin/audit")
    List<AuditLogRecord> audit(HttpServletRequest request,
                               @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        StoreSupport.require(storeService.isAdmin(actor), HttpStatus.FORBIDDEN,
                "Only the configured admin wallet can perform this action");
        return storeService.loadAuditLogs();
    }

    @GetMapping("/admin/risk-cases")
    List<RiskCaseRecord> riskCases(HttpServletRequest request,
                                   @RequestHeader(value = "x-actor-address", required = false) String actorHeader) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.loadRiskCases(actor);
    }

    @PostMapping("/admin/risk-cases")
    ResponseEntity<RiskCaseRecord> createRiskCase(HttpServletRequest request,
                                                  @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                                                  @RequestBody CreateRiskCaseRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return ResponseEntity.status(HttpStatus.CREATED).body(storeService.createRiskCase(actor, payload));
    }

    @PostMapping("/admin/risk-cases/{id}/resolve")
    RiskCaseRecord resolveRiskCase(HttpServletRequest request,
                                   @RequestHeader(value = "x-actor-address", required = false) String actorHeader,
                                   @PathVariable("id") long id,
                                   @RequestBody ResolveRiskCaseRequest payload) {
        String actor = storeService.requireActor(request, actorHeader, authService);
        return storeService.resolveRiskCase(actor, id, payload);
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
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "Internal server error"));
    }
}
