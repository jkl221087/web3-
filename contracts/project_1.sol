// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.20 <=0.8.35;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


interface IERC20EscrowToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

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

// 主合約：只負責 ERC20 / USDT 訂單付款、買家確認收貨、賣家提領。
contract contractName_order is Owner {
    uint256 public Order_ID = 0;
    address public immutable payment_token;
    using SafeERC20 for IERC20;

    struct OrderInfo {
    uint256 orderId;
    uint256 amount;
    address buy_user;
    address sell_user;
    bool pay_state;
    bool complete_state;
    bool seller_withdrawn;
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
        payment_token = paymentToken_;
    }

    function create_and_fund_order(
        address seller,
        uint256 _amount

    ) external returns (uint256) {
        require(seller != address(0), "Seller required");
        require(_amount > 0, "Amount must be greater than 0");

        IERC20(payment_token).safeTransferFrom(msg.sender, address(this), _amount);

        unchecked {
            Order_ID++;
            }

        orders[Order_ID] = OrderInfo({
            orderId: Order_ID,
            buy_user: msg.sender,
            sell_user: seller,
            amount: _amount,
            pay_state: true,
            complete_state: false,
            seller_withdrawn: false
        });

        emit OrderCreated(Order_ID, msg.sender, seller, _amount);
        return Order_ID;
    }

    function _complete_order(uint256 orderId, address actor) internal returns (bool) {
        OrderInfo storage order = orders[orderId];

        require(order.orderId != 0, "Order does not exist");
        require(order.pay_state, "Order not paid");
        require(!order.complete_state, "Order already completed");
        require(!order.seller_withdrawn, "Funds already withdrawn");
        require(
            actor == order.buy_user || actor == owner,
            "Only buyer or owner can complete"
        );

        order.complete_state = true;
        emit OrderCompleted(orderId, order.buy_user, order.sell_user);
        return true;
    }

    function complete_order(uint256 orderId) external returns (bool) {
        return _complete_order(orderId, msg.sender);
    }

    function confirm_order_received(uint256 orderId) external returns (bool) {
        return _complete_order(orderId, msg.sender);
    }



    function withdraw_order_funds(uint256 orderId) external returns (bool) {
        OrderInfo storage order = orders[orderId];

        require(order.orderId != 0, "Order does not exist");
        require(msg.sender == order.sell_user, "Only seller can withdraw");
        require(order.complete_state, "Order is not completed");
        require(!order.seller_withdrawn, "Funds already withdrawn");

        uint256 amount = order.amount;
        order.seller_withdrawn = true;
        
        //原本的transferFrom會有資金問題
        IERC20(payment_token).safeTransfer(msg.sender, amount);//安全

        emit SellerWithdrawn(orderId, msg.sender, amount);
        return true;
    }

    function get_order_info(
        uint256 orderId
    ) external view returns (OrderInfo memory) {
        require(orders[orderId].orderId != 0, "Order does not exist");
        return orders[orderId];
    }

    function get_contract_balance() external view returns (uint256) {
        return IERC20EscrowToken(payment_token).balanceOf(address(this));
    }
}
