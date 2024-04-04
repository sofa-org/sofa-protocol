import * as dotenv from "dotenv";
import { network, ethers } from "hardhat";

async function main() {
  if (network.name === "mainnet") {
    return;
  }
  const ERC20 = await ethers.getContractFactory("MockERC20Mintable");
  const rch = await ERC20.deploy("RCH", "RCH", 18);
  const wbtc = await ERC20.deploy("WBTC", "WBTC", 18);
  const weth = await ERC20.deploy("WETH", "WETH", 18);
  const usdt = await ERC20.deploy("USDT", "USDT", 18);

  await Promise.all([
    rch.deployed(),
    wbtc.deployed(),
    weth.deployed(),
    usdt.deployed(),
  ]);
  console.log(`|RCH|${rch.address}|`);
  console.log(`|WBTC|${wbtc.address}|`);
  console.log(`|WETH|${weth.address}|`);
  console.log(`|USDT|${usdt.address}|`);
  const [signer] = await ethers.getSigners();
  await Promise.all([
    rch.mint(signer.address, ethers.utils.parseEther("10000000")),
    wbtc.mint(signer.address, ethers.utils.parseEther("10000000")),
    weth.mint(signer.address, ethers.utils.parseEther("10000000")),
    usdt.mint(signer.address, ethers.utils.parseEther("10000000")),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
