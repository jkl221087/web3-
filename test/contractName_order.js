import { expect } from "chai";

const ORDER_CONTRACT_FQN = "contracts/project_1.sol:contractName_order";
const MOCK_USDT_FQN = "contracts/mocks/MockUSDT.sol:MockUSDT";
const USDT_DECIMALS = 6;

describe("contractName_order", function () {
  async function deployFixture() {
    const [owner, buyer, seller, stranger] = await ethers.getSigners();
    const paymentToken = await ethers.deployContract(MOCK_USDT_FQN);
    const orderContract = await ethers.deployContract(ORDER_CONTRACT_FQN, [
      paymentToken.target,
    ]);

    const seededBalance = ethers.parseUnits("1000", USDT_DECIMALS);
    await paymentToken.mint(buyer.address, seededBalance);
    await paymentToken.mint(stranger.address, seededBalance);

    return { orderContract, paymentToken, owner, buyer, seller, stranger };
  }

  async function approveOrderFunding(paymentToken, signer, spender, amount) {
    await paymentToken.connect(signer).approve(spender, amount);
  }

  it("sets the deployer as owner and stores the payment token", async function () {
    const { orderContract, paymentToken, owner } = await deployFixture();

    expect(await orderContract.owner()).to.equal(owner.address);
    expect(await orderContract.payment_token()).to.equal(paymentToken.target);
  });

  it("creates an escrow order and stores the USDT payment", async function () {
    const { orderContract, paymentToken, buyer, seller } = await deployFixture();
    const amount = ethers.parseUnits("25", USDT_DECIMALS);

    await approveOrderFunding(paymentToken, buyer, orderContract.target, amount);

    await expect(
      orderContract.connect(buyer).create_and_fund_order(seller.address, amount),
    )
      .to.emit(orderContract, "OrderCreated")
      .withArgs(1n, buyer.address, seller.address, amount);

    const orderInfo = await orderContract.get_order_info(1n);

    expect(orderInfo.orderId).to.equal(1n);
    expect(orderInfo.buy_user).to.equal(buyer.address);
    expect(orderInfo.sell_user).to.equal(seller.address);
    expect(orderInfo.amount).to.equal(amount);
    expect(orderInfo.pay_state).to.equal(true);
    expect(orderInfo.complete_state).to.equal(false);
    expect(orderInfo.seller_withdrawn).to.equal(false);
    expect(await orderContract.get_contract_balance()).to.equal(amount);
    expect(await paymentToken.balanceOf(orderContract.target)).to.equal(amount);
  });

  it("rejects invalid order creation inputs", async function () {
    const { orderContract, paymentToken, buyer, seller } = await deployFixture();
    const amount = ethers.parseUnits("25", USDT_DECIMALS);

    await approveOrderFunding(paymentToken, buyer, orderContract.target, amount);

    await expect(
      orderContract.connect(buyer).create_and_fund_order(ethers.ZeroAddress, amount),
    ).to.be.revertedWith("Seller required");

    await expect(
      orderContract.connect(buyer).create_and_fund_order(seller.address, 0n),
    ).to.be.revertedWith("Amount must be greater than 0");
  });

  it("rejects order funding without enough token allowance", async function () {
    const { orderContract, buyer, seller } = await deployFixture();
    const amount = ethers.parseUnits("25", USDT_DECIMALS);

    await expect(
      orderContract.connect(buyer).create_and_fund_order(seller.address, amount),
    ).to.be.revertedWith("ERC20: insufficient allowance");
  });

  it("only allows the buyer or owner to complete an order", async function () {
    const { orderContract, paymentToken, owner, buyer, seller, stranger } =
      await deployFixture();
    const amount = ethers.parseUnits("25", USDT_DECIMALS);

    await approveOrderFunding(paymentToken, buyer, orderContract.target, amount);
    await orderContract.connect(buyer).create_and_fund_order(seller.address, amount);

    await expect(
      orderContract.connect(stranger).complete_order(1n),
    ).to.be.revertedWith("Only buyer or owner can complete");

    await expect(orderContract.connect(owner).complete_order(1n))
      .to.emit(orderContract, "OrderCompleted")
      .withArgs(1n, buyer.address, seller.address);

    const orderInfo = await orderContract.get_order_info(1n);
    expect(orderInfo.complete_state).to.equal(true);
  });

  it("lets the buyer confirm receipt and then lets the seller withdraw once", async function () {
    const { orderContract, paymentToken, buyer, seller } = await deployFixture();
    const amount = ethers.parseUnits("25", USDT_DECIMALS);

    await approveOrderFunding(paymentToken, buyer, orderContract.target, amount);
    await orderContract.connect(buyer).create_and_fund_order(seller.address, amount);

    await expect(orderContract.connect(buyer).confirm_order_received(1n))
      .to.emit(orderContract, "OrderCompleted")
      .withArgs(1n, buyer.address, seller.address);

    const sellerBalanceBefore = await paymentToken.balanceOf(seller.address);

    await expect(orderContract.connect(seller).withdraw_order_funds(1n))
      .to.emit(orderContract, "SellerWithdrawn")
      .withArgs(1n, seller.address, amount);

    const orderInfo = await orderContract.get_order_info(1n);
    const sellerBalanceAfter = await paymentToken.balanceOf(seller.address);

    expect(orderInfo.seller_withdrawn).to.equal(true);
    expect(await orderContract.get_contract_balance()).to.equal(0n);
    expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(amount);

    await expect(
      orderContract.connect(seller).withdraw_order_funds(1n),
    ).to.be.revertedWith("Funds already withdrawn");
  });

  it("blocks withdrawal before completion and from non-seller accounts", async function () {
    const { orderContract, paymentToken, buyer, seller, stranger } =
      await deployFixture();
    const amount = ethers.parseUnits("25", USDT_DECIMALS);

    await approveOrderFunding(paymentToken, buyer, orderContract.target, amount);
    await orderContract.connect(buyer).create_and_fund_order(seller.address, amount);

    await expect(
      orderContract.connect(seller).withdraw_order_funds(1n),
    ).to.be.revertedWith("Order is not completed");

    await orderContract.connect(buyer).complete_order(1n);

    await expect(
      orderContract.connect(stranger).withdraw_order_funds(1n),
    ).to.be.revertedWith("Only seller can withdraw");
  });

  it("reverts when reading or updating a non-existent order", async function () {
    const { orderContract, buyer, seller } = await deployFixture();

    await expect(orderContract.get_order_info(999n)).to.be.revertedWith(
      "Order does not exist",
    );

    await expect(orderContract.complete_order(999n)).to.be.revertedWith(
      "Order does not exist",
    );

    await expect(
      orderContract.connect(seller).withdraw_order_funds(999n),
    ).to.be.revertedWith("Order does not exist");

    await expect(
      orderContract.connect(buyer).confirm_order_received(999n),
    ).to.be.revertedWith("Order does not exist");
  });

  it("does not allow completing an order twice", async function () {
    const { orderContract, paymentToken, buyer, seller } = await deployFixture();
    const amount = ethers.parseUnits("25", USDT_DECIMALS);

    await approveOrderFunding(paymentToken, buyer, orderContract.target, amount);
    await orderContract.connect(buyer).create_and_fund_order(seller.address, amount);
    await orderContract.connect(buyer).complete_order(1n);

    await expect(
      orderContract.connect(buyer).confirm_order_received(1n),
    ).to.be.revertedWith("Order already completed");
  });

  it("supports multiple orders and keeps balances isolated by order id", async function () {
    const { orderContract, paymentToken, buyer, seller, stranger } =
      await deployFixture();
    const firstAmount = ethers.parseUnits("25", USDT_DECIMALS);
    const secondAmount = ethers.parseUnits("80", USDT_DECIMALS);

    await approveOrderFunding(paymentToken, buyer, orderContract.target, firstAmount);
    await approveOrderFunding(
      paymentToken,
      stranger,
      orderContract.target,
      secondAmount,
    );

    await orderContract.connect(buyer).create_and_fund_order(seller.address, firstAmount);
    await orderContract
      .connect(stranger)
      .create_and_fund_order(seller.address, secondAmount);

    const firstOrder = await orderContract.get_order_info(1n);
    const secondOrder = await orderContract.get_order_info(2n);

    expect(firstOrder.buy_user).to.equal(buyer.address);
    expect(firstOrder.amount).to.equal(firstAmount);
    expect(secondOrder.buy_user).to.equal(stranger.address);
    expect(secondOrder.amount).to.equal(secondAmount);
    expect(await orderContract.Order_ID()).to.equal(2n);
    expect(await orderContract.get_contract_balance()).to.equal(
      firstAmount + secondAmount,
    );
  });

  it("allows the owner to use confirm_order_received as an admin override", async function () {
    const { orderContract, paymentToken, owner, buyer, seller } =
      await deployFixture();
    const amount = ethers.parseUnits("25", USDT_DECIMALS);

    await approveOrderFunding(paymentToken, buyer, orderContract.target, amount);
    await orderContract.connect(buyer).create_and_fund_order(seller.address, amount);

    await expect(orderContract.connect(owner).confirm_order_received(1n))
      .to.emit(orderContract, "OrderCompleted")
      .withArgs(1n, buyer.address, seller.address);

    const orderInfo = await orderContract.get_order_info(1n);
    expect(orderInfo.complete_state).to.equal(true);
  });
});
