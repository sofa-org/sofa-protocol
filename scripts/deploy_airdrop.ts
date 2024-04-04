import * as dotenv from "dotenv";
import { network, ethers } from "hardhat";

dotenv.config({ path: `.env.${network.name}` });
async function main() {
  const gas = await ethers.provider.getGasPrice();
  const Airdrop = await ethers.getContractFactory("MerkleAirdrop");
  const airdrop = await Airdrop.deploy(process.env.RCH_ADDRESS, { gasPrice: gas });

  await airdrop.deployed();
  console.log(`|Airdrop|${airdrop.address}|`);
  const RCH = await ethers.getContractFactory("RCH");
  const rch = RCH.attach(process.env.RCH_ADDRESS);
  const tx = await rch.updateMinterRole(airdrop.address, true, { gasPrice: gas });
  console.log('Transaction receipt:', tx.hash);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
