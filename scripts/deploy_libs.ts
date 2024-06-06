import * as dotenv from "dotenv";
import { ethers } from "hardhat";

async function main() {
  const DNT = await ethers.getContractFactory("DNT");
  const dnt = await DNT.deploy();
  const SmartBull = await ethers.getContractFactory("SmartBull");
  const smartBull = await SmartBull.deploy();
  const SmartBear = await ethers.getContractFactory("SmartBear");
  const smartBear = await SmartBear.deploy();

  await Promise.all([
    dnt.deployed(),
    smartBull.deployed(),
    smartBear.deployed(),
  ]);

  console.log(`|DNT|${dnt.address}|`);
  console.log(`|SmartBull|${smartBull.address}|`);
  console.log(`|SmartBear|${smartBear.address}|`);

  await hre.run("verify:verify", {
    address: dnt.address,
  });
  await hre.run("verify:verify", {
    address: smartBull.address,
  });
  await hre.run("verify:verify", {
    address: smartBear.address,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
