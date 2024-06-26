// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// When running the script with `npx hardhat run <script>` you'll find the Hardhat
// Runtime Environment's members available in the global scope.
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
  const gas = await ethers.provider.getGasPrice();
  const Vault = await ethers.getContractFactory("AAVEDNTVault");
  const vault = await upgrades.deployProxy(Vault, [
    "Sofa BTC",
    "sfBTC",
    PERMIT2_ADDRESS,
    process.env.DNT_ADDRESS,
    process.env.WETH_ADDRESS,
    process.env.USDT_ADDRESS,
    process.env.AAVE_POOL_ADDRESS,
    process.env.FEE_COLLECTOR_ADDRESS,
    process.env.HL_ORACLE_BTC
  ], {
    gasPrice: gas,
  });

  await vault.deployed();
  console.log(`|AAVEDNTVault(WBTC/USDT)|${vault.address}|`);

  await hre.run("verify:verify", {
    address: vault.address,
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
