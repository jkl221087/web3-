
package com.efstore.backend;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

record SessionProfile(
    boolean authenticated,
    String address,
    @JsonProperty("isAdmin") boolean isAdmin,
    @JsonProperty("sellerStatus") String sellerStatus
) {}

record ProductRecord(
    @JsonProperty("productId") long productId,
    String seller,
    String name,
    @JsonProperty("priceWei") String priceWei,
    @JsonProperty("isActive") boolean isActive,
    JsonNode meta
) {}

record SellersStore(List<String> approved, List<String> pending) {}

record OrderRecord(
    @JsonProperty("orderId") long orderId,
    String buyer,
    @JsonProperty("productId") long productId,
    @JsonProperty("productName") String productName,
    @JsonProperty("productSeller") String productSeller,
    @JsonProperty("priceWei") String priceWei,
    @JsonProperty("flowStage") short flowStage,
    @JsonProperty("commerceStatus") String commerceStatus,
    @JsonProperty("settlementStatus") String settlementStatus,
    @JsonProperty("disputeStatus") String disputeStatus,
    @JsonProperty("riskStatus") String riskStatus,
    @JsonProperty("riskScore") double riskScore,
    @JsonProperty("screeningStatus") String screeningStatus,
    @JsonProperty("screeningReason") String screeningReason,
    @JsonProperty("payState") boolean payState,
    @JsonProperty("completeState") boolean completeState,
    @JsonProperty("sellerWithdrawn") boolean sellerWithdrawn,
    boolean frozen,
    @JsonProperty("payoutBlocked") boolean payoutBlocked,
    @JsonProperty("fundedAt") String fundedAt,
    @JsonProperty("releaseEligibleAt") String releaseEligibleAt,
    @JsonProperty("receivedAt") String receivedAt,
    @JsonProperty("settledAt") String settledAt
) {}

record ReviewRecord(
    @JsonProperty("orderId") long orderId,
    @JsonProperty("productId") long productId,
    @JsonProperty("productName") String productName,
    String seller,
    String buyer,
    int rating,
    String comment,
    @JsonProperty("createdAt") String createdAt
) {}

record PayoutRecord(
    @JsonProperty("orderId") long orderId,
    String seller,
    String buyer,
    @JsonProperty("productId") long productId,
    @JsonProperty("productName") String productName,
    @JsonProperty("amountWei") String amountWei,
    @JsonProperty("txHash") String txHash,
    @JsonProperty("createdAt") String createdAt,
    @JsonProperty("payoutStatus") String payoutStatus,
    @JsonProperty("amlReviewStatus") String amlReviewStatus,
    @JsonProperty("approvedBy") String approvedBy
) {}

record AuditLogRecord(
    long id,
    String category,
    String action,
    String actor,
    String subject,
    @JsonProperty("productId") Long productId,
    String summary,
    JsonNode detail,
    @JsonProperty("createdAt") String createdAt
) {}

record RiskCaseRecord(
    @JsonProperty("caseId") long caseId,
    @JsonProperty("orderId") Long orderId,
    @JsonProperty("caseType") String caseType,
    String severity,
    String status,
    @JsonProperty("reasonCode") String reasonCode,
    String notes,
    @JsonProperty("openedBy") String openedBy,
    @JsonProperty("resolvedBy") String resolvedBy,
    @JsonProperty("createdAt") String createdAt,
    @JsonProperty("resolvedAt") String resolvedAt
) {}

record UploadResponse(String url, String filename) {}

record AuthNonceRequest(String address, @JsonProperty("chainId") String chainId) {}

record AuthVerifyRequest(String address, String message, String signature) {}

record SellerRequest(String address) {}

record SellerApproveRequest(String address, Boolean approved) {}

record CreateProductRequest(String seller, String name, @JsonProperty("priceWei") String priceWei, JsonNode meta) {}

record UpdateProductRequest(String name, @JsonProperty("priceWei") String priceWei, @JsonProperty("isActive") Boolean isActive, JsonNode meta) {}

record CreateOrderRequest(
    @JsonProperty("orderId") long orderId,
    String buyer,
    @JsonProperty("productId") Long productId,
    @JsonProperty("productName") String productName,
    @JsonProperty("productSeller") String productSeller,
    @JsonProperty("priceWei") String priceWei,
    @JsonProperty("flowStage") Integer flowStage
) {}

record UpdateOrderFlowRequest(@JsonProperty("flowStage") Integer flowStage) {}

record UpdateOrderRiskRequest(
    @JsonProperty("riskStatus") String riskStatus,
    @JsonProperty("riskScore") Double riskScore,
    @JsonProperty("screeningStatus") String screeningStatus,
    @JsonProperty("screeningReason") String screeningReason,
    @JsonProperty("payoutBlocked") Boolean payoutBlocked
) {}

record UpdateOrderFreezeRequest(String reason) {}

record CreateRiskCaseRequest(
    @JsonProperty("orderId") Long orderId,
    @JsonProperty("caseType") String caseType,
    String severity,
    @JsonProperty("reasonCode") String reasonCode,
    String notes
) {}

record ResolveRiskCaseRequest(String status, String notes) {}

record UpdatePayoutReviewRequest(
    @JsonProperty("payoutStatus") String payoutStatus,
    @JsonProperty("amlReviewStatus") String amlReviewStatus,
    @JsonProperty("approvedBy") String approvedBy
) {}

record CreateReviewRequest(
    @JsonProperty("orderId") long orderId,
    @JsonProperty("productId") Long productId,
    @JsonProperty("productName") String productName,
    String seller,
    String buyer,
    int rating,
    String comment,
    @JsonProperty("createdAt") String createdAt
) {}

record CreatePayoutRequest(
    @JsonProperty("orderId") long orderId,
    String seller,
    String buyer,
    @JsonProperty("productId") Long productId,
    @JsonProperty("productName") String productName,
    @JsonProperty("amountWei") String amountWei,
    @JsonProperty("txHash") String txHash,
    @JsonProperty("createdAt") String createdAt
) {}
