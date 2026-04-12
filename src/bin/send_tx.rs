use dotenv::dotenv;
use ethers::{
    providers::{Http, Middleware, Provider},
    signers::{LocalWallet, Signer},
    types::{TransactionRequest, U256},
    utils::parse_ether,
};
use std::{env, str::FromStr, sync::Arc};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenv().ok();

    let rpc_url = env::var("RPC_URL").expect("RPC_URL is required");
    let private_key = env::var("PRIVATE_KEY").expect("PRIVATE_KEY is required");

    let provider = Provider::<Http>::try_from(rpc_url)?;
    let wallet = LocalWallet::from_str(&private_key)?;
    let wallet = wallet.with_chain_id(11155111u64);
    let address = wallet.address();
    let client = Arc::new(ethers::middleware::SignerMiddleware::new(provider, wallet));

    println!("Wallet address: {address:?}");

    let tx = TransactionRequest::new()
        .to(address)
        .value(parse_ether("0.01")?)
        .from(address);

    let pending = client.send_transaction(tx, None).await?;
    println!("Transaction hash: {:?}", pending.tx_hash());

    let receipt = pending.await?;
    if let Some(receipt) = receipt {
        println!("Transaction confirmed");
        println!("Block number: {:?}", receipt.block_number);
        println!("Gas used: {:?}", receipt.gas_used.unwrap_or(U256::from(0)));
    }

    Ok(())
}
