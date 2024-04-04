import * as dotenv from "dotenv";
const { ethers } = require('hardhat');
const { parseEther } = ethers.utils;

const AMOUNT_RCH_DESIRED = parseEther('500000');
const AMOUNT_RCH_MIN = parseEther('480000');
const AMOUNT_USDT_DESIRED = 10000000000;
const AMOUNT_USDT_MIN = 9000000000;
const DEADLINE = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes from the current time

dotenv.config({ path: `.env.${network.name}` });
async function addLiquidity() {
  const [signer] = await ethers.getSigners();
  const router = new ethers.Contract(
    process.env.UNI_ROUTERV2_ADDRESS,
    [
      'function addLiquidity(address tokenA,address tokenB,uint amountADesired,uint amountBDesired,uint amountAMin,uint amountBMin,address to,uint deadline)'
        + ' external payable returns (uint amountToken, uint amountETH, uint liquidity)'
    ],
    signer
  );

  // Approve token transfer
  // const rchToken = new ethers.Contract(
  //   process.env.RCH_ADDRESS,
  //   ['function approve(address to, uint amount) returns (bool)'],
  //   signer
  // );
  // const usdtToken = new ethers.Contract(
  //   process.env.USDT_ADDRESS,
  //   ['function approve(address to, uint amount) returns (bool)'],
  //   signer
  // );
  // await usdtToken.approve(process.env.UNI_ROUTERV2_ADDRESS, AMOUNT_USDT_DESIRED);

  const tx = await router.addLiquidity(
    process.env.RCH_ADDRESS,
    process.env.USDT_ADDRESS,
    AMOUNT_RCH_DESIRED,
    AMOUNT_USDT_DESIRED,
    AMOUNT_RCH_MIN,
    AMOUNT_USDT_MIN,
    signer.address,
    DEADLINE,
  );

  console.log(`Transaction hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log('Liquidity added:', receipt.events);
}

addLiquidity()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
