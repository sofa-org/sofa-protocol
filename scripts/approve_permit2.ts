import * as dotenv from "dotenv";
import { network, ethers, upgrades } from "hardhat";
import {
    PERMIT2_ADDRESS
} from "@uniswap/permit2-sdk";


dotenv.config({ path: `.env.${network.name}` });
async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const privateKey = process.env.MAKER_PRIVATE_KEY; // 用你的私钥替换这里

  const gas = await ethers.provider.getGasPrice();
  const USDT = await ethers.getContractFactory("MockERC20Mintable");
  const usdt = USDT.attach(process.env.USDT_ADDRESS);
  const amount = ethers.utils.parseUnits("100000", 18);

  return await usdt.approve(PERMIT2_ADDRESS, amount, {
    gasPrice: gas,
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(receipt => {
    console.log('Transaction receipt:', receipt);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
