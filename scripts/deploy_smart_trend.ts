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
  // const gas = await ethers.provider.getGasPrice();
  // const gas = 5000000000;
  const gas = await ethers.provider.getGasPrice();

  const Vault = await ethers.getContractFactory("SmartTrendVault");
  const AAVEVault = await ethers.getContractFactory("AAVESmartTrendVault");
  let vault;
  let aaveVault;
  // let vault = await upgrades.deployProxy(Vault, [
  //   "Sofa ETH",
  //   "sfETH",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBULL_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.RCH_ADDRESS,
  //   process.env.UNI_ROUTERV2_ADDRESS,
  //   ethers.utils.parseEther("0.01"),
  //   process.env.SPOT_ORACLE_ETH
  // ], {
  //   gasPrice: gas,
  // });

  // await vault.deployed();
  // console.log(`|SmartBullVault|${vault.address}|`);

  // vault = await upgrades.deployProxy(Vault, [
  //   "Sofa USDT",
  //   "sfUSDT",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBULL_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.USDT_ADDRESS,
  //   process.env.FEE_COLLECTOR_ADDRESS,
  //   process.env.SPOT_ORACLE_ETH
  // ], {
  //   gasPrice: gas,
  // });

  // await vault.deployed();
  // console.log(`|SmartBullVault(USDT)|${vault.address}|`);

  // await hre.run("verify:verify", {
  //   address: vault.address,
  // });
  // vault = await upgrades.deployProxy(Vault, [
  //   "Sofa BTC",
  //   "sfBTC",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBULL_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.WBTC_ADDRESS,
  //   process.env.RCH_ADDRESS,
  //   process.env.UNI_ROUTERV2_ADDRESS,
  //   ethers.utils.parseEther("0.01"),
  //   process.env.SPOT_ORACLE_BTC
  // ], {
  //   gasPrice: gas,
  // });

  // await vault.deployed();
  // console.log(`|SmartBullVault(WBTC)|${vault.address}|`);

  // vault = await upgrades.deployProxy(Vault, [
  //   "Sofa USDT",
  //   "sfUSDT",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBULL_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.USDT_ADDRESS,
  //   process.env.FEE_COLLECTOR_ADDRESS,
  //   process.env.SPOT_ORACLE_BTC
  // ], {
  //   gasPrice: gas,
  // });

  // await vault.deployed();
  // console.log(`|SmartBullVault(WBTC/USDT)|${vault.address}|`);

  // await hre.run("verify:verify", {
  //   address: vault.address,
  // });
  // vault = await upgrades.deployProxy(Vault, [
  //   "Sofa ETH",
  //   "sfETH",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBEAR_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.RCH_ADDRESS,
  //   process.env.UNI_ROUTERV2_ADDRESS,
  //   ethers.utils.parseEther("0.01"),
  //   process.env.SPOT_ORACLE_ETH
  // ], {
  //   gasPrice: gas,
  // });

  // await vault.deployed();
  // console.log(`|SmartBearVault|${vault.address}|`);

  vault = await upgrades.deployProxy(Vault, [
    "Sofa USDT",
    "sfUSDT",
    PERMIT2_ADDRESS,
    process.env.SMARTBEAR_ADDRESS,
    process.env.WETH_ADDRESS,
    process.env.USDT_ADDRESS,
    process.env.FEE_COLLECTOR_ADDRESS,
    process.env.SPOT_ORACLE_ETH
  ], {
    gasPrice: gas,
  });

  await vault.deployed();
  console.log(`|SmartBearVault(USDT)|${vault.address}|`);

  await hre.run("verify:verify", {
    address: vault.address,
  });
  // vault = await upgrades.deployProxy(Vault, [
  //   "Sofa BTC",
  //   "sfBTC",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBEAR_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.WBTC_ADDRESS,
  //   process.env.RCH_ADDRESS,
  //   process.env.UNI_ROUTERV2_ADDRESS,
  //
  //   process.env.SPOT_ORACLE_BTC
  // ], {
  //   gasPrice: gas,
  // });

  // await vault.deployed();
  // console.log(`|SmartBearVault(WBTC)|${vault.address}|`);

  vault = await upgrades.deployProxy(Vault, [
    "Sofa USDT",
    "sfUSDT",
    PERMIT2_ADDRESS,
    process.env.SMARTBEAR_ADDRESS,
    process.env.WETH_ADDRESS,
    process.env.USDT_ADDRESS,
    process.env.FEE_COLLECTOR_ADDRESS,
    process.env.SPOT_ORACLE_BTC
  ], {
    gasPrice: gas,
  });

  await vault.deployed();
  console.log(`|SmartBearVault(WBTC/USDT)|${vault.address}|`);

  await hre.run("verify:verify", {
    address: vault.address,
  });
  //   "Sofa ETH",
  //   "sfETH",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBULL_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.RCH_ADDRESS,
  //   process.env.UNI_ROUTERV2_ADDRESS,
  //   process.env.AAVE_POOL_ADDRESS,
  //   ethers.utils.parseEther("0.01"),
  //   process.env.SPOT_ORACLE_ETH
  // ], {
  //   gasPrice: gas,
  // });

  // await principalVault.deployed();
  // console.log(`|SmartBullPrincipalVault|${principalVault.address}|`);

  aaveVault = await upgrades.deployProxy(AAVEVault, [
    "Sofa USDT",
    "sfUSDT",
    PERMIT2_ADDRESS,
    process.env.SMARTBULL_ADDRESS,
    process.env.WETH_ADDRESS,
    process.env.USDT_ADDRESS,
    process.env.AAVE_POOL_ADDRESS,
    process.env.FEE_COLLECTOR_ADDRESS,
    process.env.SPOT_ORACLE_ETH
  ], {
    gasPrice: gas,
  });

  await aaveVault.deployed();
  console.log(`|SmartBullAAVEVault(USDT)|${aaveVault.address}|`);

  await hre.run("verify:verify", {
    address: aaveVault.address,
  });
  // principalVault = await upgrades.deployProxy(PrincipalVault, [
  //   "Sofa BTC",
  //   "sfBTC",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBULL_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.WBTC_ADDRESS,
  //   process.env.RCH_ADDRESS,
  //   process.env.UNI_ROUTERV2_ADDRESS,
  //   process.env.AAVE_POOL_ADDRESS,
  //   ethers.utils.parseEther("0.01"),
  //   process.env.SPOT_ORACLE_BTC
  // ], {
  //   gasPrice: gas,
  // });

  // await principalVault.deployed();
  // console.log(`|SmartBullPrincipalVault(WBTC)|${principalVault.address}|`);

  aaveVault = await upgrades.deployProxy(AAVEVault, [
    "Sofa USDT",
    "sfUSDT",
    PERMIT2_ADDRESS,
    process.env.SMARTBULL_ADDRESS,
    process.env.WETH_ADDRESS,
    process.env.USDT_ADDRESS,
    process.env.AAVE_POOL_ADDRESS,
    process.env.FEE_COLLECTOR_ADDRESS,
    process.env.SPOT_ORACLE_BTC
  ], {
    gasPrice: gas,
  });

  await aaveVault.deployed();
  console.log(`|SmartBullAAVEVault(WBTC/USDT)|${aaveVault.address}|`);

  await hre.run("verify:verify", {
    address: aaveVault.address,
  });
  // principalVault = await upgrades.deployProxy(PrincipalVault, [
  //   "Sofa ETH",
  //   "sfETH",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBEAR_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.RCH_ADDRESS,
  //   process.env.UNI_ROUTERV2_ADDRESS,
  //   process.env.AAVE_POOL_ADDRESS,
  //   ethers.utils.parseEther("0.01"),
  //   process.env.SPOT_ORACLE_ETH
  // ], {
  //   gasPrice: gas,
  // });

  // await principalVault.deployed();
  // console.log(`|SmartBearPrincipalVault|${principalVault.address}|`);

  aaveVault = await upgrades.deployProxy(AAVEVault, [
    "Sofa USDT",
    "sfUSDT",
    PERMIT2_ADDRESS,
    process.env.SMARTBEAR_ADDRESS,
    process.env.WETH_ADDRESS,
    process.env.USDT_ADDRESS,
    process.env.AAVE_POOL_ADDRESS,
    process.env.FEE_COLLECTOR_ADDRESS,
    process.env.SPOT_ORACLE_ETH
  ], {
    gasPrice: gas,
  });

  await aaveVault.deployed();
  console.log(`|SmartBearAAVEVault(USDT)|${aaveVault.address}|`);

  await hre.run("verify:verify", {
    address: aaveVault.address,
  });
  // principalVault = await upgrades.deployProxy(PrincipalVault, [
  //   "Sofa BTC",
  //   "sfBTC",
  //   PERMIT2_ADDRESS,
  //   process.env.SMARTBEAR_ADDRESS,
  //   process.env.WETH_ADDRESS,
  //   process.env.WBTC_ADDRESS,
  //   process.env.RCH_ADDRESS,
  //   process.env.UNI_ROUTERV2_ADDRESS,
  //   process.env.AAVE_POOL_ADDRESS,
  //   ethers.utils.parseEther("0.01"),
  //   process.env.SPOT_ORACLE_BTC
  // ], {
  //   gasPrice: gas,
  // });

  // await principalVault.deployed();
  // console.log(`|SmartBearPrincipalVault(WBTC)|${principalVault.address}|`);

  aaveVault = await upgrades.deployProxy(AAVEVault, [
    "Sofa USDT",
    "sfUSDT",
    PERMIT2_ADDRESS,
    process.env.SMARTBEAR_ADDRESS,
    process.env.WETH_ADDRESS,
    process.env.USDT_ADDRESS,
    process.env.AAVE_POOL_ADDRESS,
    process.env.FEE_COLLECTOR_ADDRESS,
    process.env.SPOT_ORACLE_BTC
  ], {
    gasPrice: gas,
  });

  await aaveVault.deployed();
  console.log(`|SmartBearAAVEVault(WBTC/USDT)|${aaveVault.address}|`);

  await hre.run("verify:verify", {
    address: aaveVault.address,
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
