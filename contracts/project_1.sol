// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Owner {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }
}

/// @title EscrowOrder
/// @notice 負責 ERC20 / USDT 訂單付款、買家確認收貨、賣家提領。
/// @dev 使用 SafeERC20 避免不標準 ERC20 的問題，使用 ReentrancyGuard 防止重入攻擊。
contract EscrowOrder is Owner, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public orderCount = 0;
    address public immutable paymentToken;

    struct OrderInfo {
        uint256 orderId;
        uint256 amount;
        address buyer;          // 打包進同一個 slot（address 20 bytes + 3 bool = 23 bytes < 32 bytes）
        bool isPaid;
        bool isCompleted;
        bool sellerWithdrawn;
        address seller;
    }

    mapping(uint256 => OrderInfo) public orders;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed buyer,
        address indexed seller,
        uint256 amount
    );
    event OrderCompleted(
        uint256 indexed orderId,
        address indexed buyer,
        address indexed seller
    );
    event SellerWithdrawn(
        uint256 indexed orderId,
        address indexed seller,
        uint256 amount
    );

    constructor(address paymentToken_) {
        require(paymentToken_ != address(0), "Payment token required");
        paymentToken = paymentToken_;
    }

    // ─────────────────────────────────────────────
    // External — 買家操作
    // ─────────────────────────────────────────────

    /// @notice 建立訂單並從買家帳戶轉入款項到合約
    function create_and_fund_order(
        address seller,
        uint256 amount
    ) external nonReentrant returns (uint256) {
        require(seller != address(0), "Seller required");
        require(amount > 0, "Amount must be greater than 0");

        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);

        unchecked { ++orderCount; }

        orders[orderCount] = OrderInfo({
            orderId:         orderCount,
            buyer:           msg.sender,
            seller:          seller,
            amount:          amount,
            isPaid:          true,
            isCompleted:     false,
            sellerWithdrawn: false
        });

        emit OrderCreated(orderCount, msg.sender, seller, amount);
        return orderCount;
    }

    /// @notice 買家確認取貨，釋放款項給賣家提領
    function confirm_order_received(uint256 orderId) external returns (bool) {
        OrderInfo storage order = orders[orderId];

        require(order.orderId != 0,      "Order does not exist");
        require(order.isPaid,            "Order not paid");
        require(!order.isCompleted,      "Order already completed");
        require(!order.sellerWithdrawn,  "Funds already withdrawn");
        require(msg.sender == order.buyer, "Only buyer can confirm");

        order.isCompleted = true;
        emit OrderCompleted(orderId, order.buyer, order.seller);
        return true;
    }

    // ─────────────────────────────────────────────
    // External — 賣家操作
    // ─────────────────────────────────────────────

    /// @notice 賣家在買家確認收貨後提領款項
    function withdraw_order_funds(uint256 orderId) external nonReentrant returns (bool) {
        OrderInfo storage order = orders[orderId];

        require(order.orderId != 0, "Order does not exist");
        require(msg.sender == order.seller,   "Only seller can withdraw");
        require(order.isCompleted,            "Order is not completed");
        require(!order.sellerWithdrawn,       "Funds already withdrawn");

        uint256 amount = order.amount;
        order.sellerWithdrawn = true;

        IERC20(paymentToken).safeTransfer(msg.sender, amount);

        emit SellerWithdrawn(orderId, msg.sender, amount);
        return true;
    }

    // ─────────────────────────────────────────────
    // Owner — 緊急仲裁
    // ─────────────────────────────────────────────

    /// @notice 僅供 owner 在爭議情況下強制完成訂單（買家無回應等）
    /// @dev 若不需要仲裁功能可直接刪除此函式
    function admin_force_complete(uint256 orderId) external onlyOwner returns (bool) {
        OrderInfo storage order = orders[orderId];

        require(order.orderId != 0,     "Order does not exist");
        require(order.isPaid,           "Order not paid");
        require(!order.isCompleted,     "Order already completed");
        require(!order.sellerWithdrawn, "Funds already withdrawn");

        order.isCompleted = true;
        emit OrderCompleted(orderId, order.buyer, order.seller);
        return true;
    }

    // ─────────────────────────────────────────────
    // View
    // ─────────────────────────────────────────────

    function get_order_info(uint256 orderId) external view returns (OrderInfo memory) {
        require(orders[orderId].orderId != 0, "Order does not exist");
        return orders[orderId];
    }

    function get_contract_balance() external view returns (uint256) {
        return IERC20(paymentToken).balanceOf(address(this));
    }
}
