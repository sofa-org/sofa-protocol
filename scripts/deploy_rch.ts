import * as dotenv from "dotenv";
import { network, ethers } from "hardhat";

async function main() {
  if (network.name === "mainnet") {
    return;
  }
  const gas = await ethers.provider.getGasPrice();
  const RCH = await ethers.getContractFactory("RCH");
  const rch = await RCH.deploy({ gasPrice: gas });
  await rch.deployed();
  console.log(`|RCH|${rch.address}|`);

  const [signer] = await ethers.getSigners();
  await Promise.all([
    rch.mint(signer.address, ethers.utils.parseEther("25000000")),
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
