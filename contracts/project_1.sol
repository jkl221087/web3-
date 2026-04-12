// SPDX-License-Identifier: UNLICENSED
pragma solidity >=0.8.20 <=0.8.35;

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

// 主合約：只負責訂單付款、買家確認收貨、賣家提領。
contract contractName_order is Owner {
    uint256 public Order_ID = 0;

    struct OrderInfo {
        uint256 orderId;
        address buy_user;
        address sell_user;
        uint256 amount;
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

    function create_and_fund_order(
        address seller,
        uint256 _amount
    ) external payable returns (uint256) {
        require(seller != address(0), "Seller required");
        require(_amount > 0, "Amount must be greater than 0");
        require(msg.value == _amount, "Payment must equal order amount");

        Order_ID++;
        orders[Order_ID] = OrderInfo({
            orderId: Order_ID,
            buy_user: msg.sender,
            sell_user: seller,
            amount: msg.value,
            pay_state: true,
            complete_state: false,
            seller_withdrawn: false
        });

        emit OrderCreated(Order_ID, msg.sender, seller, msg.value);
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

        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Transfer failed");

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
        return address(this).balance;
    }
}
