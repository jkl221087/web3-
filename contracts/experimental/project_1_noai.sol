pragma solidity <=0.8.35;



contract Owner{
    address public owner;
    modifier onlyOwner() {
        require(msg.sender == owner, "Not the owner");
        _;
    }
}

//主合約
contract contractName_order is Owner {
    uint256 public Order_ID = 0;
    uint256 public user_ID = 0;
    address public seller; //賣家地址

//訂單
    struct OrderInfo{
        uint256 orderId; //訂單ID
        address buy_user; //買家地址
        address sell_user; //賣家地址
        uint256 amount; //訂單金額
        bool pay_state; //是否付款
        bool complete_state; //是否出貨並且收貨
    }
    //賣家
    struct ProductInfo{
        uint256 productId; //產品ID
        address seller; //賣家地址
        string name; //產品名稱
        uint256 price; //價格
    }

    mapping(uint256 => OrderInfo) public orders; //訂單mapping
    mapping(uint256 => ProductInfo) public products;//賣家產品mapping


//輸入_amount，創建訂單，回傳訂單ID
    function create_and_fund_order(uint256 productId, uint256 _amount) public payable returns (uint256) {
        require(msg.value > 0, 'No payment sent');
        require(_amount == products[productId].price, "Incorrect input amount");//檢查輸入金額是否正確
        require(msg.value == products[productId].price, "Payment must equal product price");//檢查付款金額是否正確

        seller = products[productId].seller;//賣家地址
        require(seller != address(0), "Product does not exist");//檢查賣家地址是否存在
        require(seller != msg.sender, "Cannot buy your own product");//防止自己買自己

        Order_ID++;//新ID
        orders[Order_ID] = OrderInfo(Order_ID, msg.sender, seller, msg.value, true, false);//存入訂單
        return Order_ID;//回傳訂單ID
    }
}




