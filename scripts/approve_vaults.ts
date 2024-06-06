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
  const privateKey = process.env.MAKER_PRIVATE_KEY_MAINNET; // 用你的私钥替换这里
  const wallet = new ethers.Wallet(privateKey, ethers.provider);

  const gas = await ethers.provider.getGasPrice();
  const ERC20 = await ethers.getContractFactory("MockERC20Mintable", wallet);
  const usdt = ERC20.attach(process.env.USDT_ADDRESS);
  const weth = ERC20.attach(process.env.WETH_ADDRESS);
  const wbtc = ERC20.attach(process.env.WBTC_ADDRESS);
  const amount = ethers.constants.MaxUint256;

  // let vaults = process.env.ETH_VAULT_ADDRESSES.split(',');
  let receipt;
  // for (let i = 0; i < vaults.length; i++) {
  //   receipt = await weth.approve(vaults[i], amount, {
  //     gasPrice: gas,
  //   });
  //   console.log('Transaction receipt:', receipt);
  // }
  let vaults = process.env.USDT_VAULT_ADDRESSES.split(',');
  for (let i = 0; i < vaults.length; i++) {
    receipt = await usdt.approve(vaults[i], amount, {
      gasPrice: gas,
    });
    // sleep 10000ms
    console.log('Transaction receipt:', receipt.hash);
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
  // vaults = process.env.BTC_VAULT_ADDRESSES.split(',');
  // for (let i = 0; i < vaults.length; i++) {
  //   receipt = await wbtc.approve(vaults[i], amount, {
  //     gasPrice: gas,
  //   });
  //   console.log('Transaction receipt:', receipt);
  // }

  return;
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => {
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
