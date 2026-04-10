import { config } from "dotenv";
import { ethers } from "ethers";

config();

async function main() {
    const rpcUrl = process.env.RPC_URL!;///第三方節點
    const privateKey = process.env.PRIVATE_KEY!;///測試錢包私鑰

    const provider = new ethers.JsonRpcProvider(rpcUrl);///連接到Sepolia節點
    const wallet = new ethers.Wallet(privateKey, provider);//使用私鑰創建錢包

    console.log("0xbd166ac8bCD24cdB575440817C995Ce113717a21:", wallet.address);//錢包地址

    const to = wallet.address;//發送到自己的地址

    const tx = await wallet.sendTransaction({//發送交易
        to,
        value: ethers.parseEther("0.01"),//發送0.01 ETH
    });

    console.log("Transaction hash:", tx.hash);//交易hash

    const receipt = await tx.wait();

    console.log("交易確認！");
    console.log("區塊號:", receipt?.blockNumber);
    console.log("Gas Used:", receipt?.gasUsed.toString());//使用的Gas量手續費
    }

    main().catch(console.error);