import * as dotenv from "dotenv";
import { ethers } from "hardhat";

dotenv.config();
async function main() {
  const SellHigh = await ethers.getContractFactory("SellHigh");
  const sellHigh = await SellHigh.deploy();
  const BuyLow = await ethers.getContractFactory("BuyLow");
  const buyLow = await BuyLow.deploy();
  const DNT = await ethers.getContractFactory("DNT");
  const dnt = await DNT.deploy();
  const SmartBull = await ethers.getContractFactory("SmartBull");
  const smartBull = await SmartBull.deploy();
  const SmartBear = await ethers.getContractFactory("SmartBear");
  const smartBear = await SmartBear.deploy();

  await Promise.all([
    signatureDecoding.deployed(),
    sellHigh.deployed(),
    buyLow.deployed(),
    dnt.deployed(),
    smartBull.deployed(),
    smartBear.deployed(),
  ]);

  console.log(`|SellHigh|${sellHigh.address}|`);
  console.log(`|BuyLow|${buyLow.address}|`);
  console.log(`|DNT|${dnt.address}|`);
  console.log(`|SmartBull|${smartBull.address}|`);
  console.log(`|SmartBear|${smartBear.address}|`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
