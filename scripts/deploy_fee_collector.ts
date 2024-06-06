import * as dotenv from "dotenv";
import { network, ethers } from "hardhat";

dotenv.config({ path: `.env.${network.name}` });
async function main() {
  const gas = await ethers.provider.getGasPrice();
  const FeeCollector = await ethers.getContractFactory("FeeCollector");
  const feeCollector = await FeeCollector.deploy(
    process.env.RCH_ADDRESS,
    ethers.utils.parseEther("0.15"),
    ethers.utils.parseEther("0.05"),
    process.env.UNI_ROUTERV2_ADDRESS,
    process.env.UNI_ROUTERV3_ADDRESS,
    { gasPrice: gas }
  );

  await feeCollector.deployed();
  console.log(`|FeeCollector|${feeCollector.address}|`);

  await hre.run("verify:verify", {
    address: feeCollector.address,
    constructorArguments: [
      process.env.RCH_ADDRESS,
      ethers.utils.parseEther("0.15"),
      ethers.utils.parseEther("0.05"),
      process.env.UNI_ROUTERV2_ADDRESS,
      process.env.UNI_ROUTERV3_ADDRESS,
    ]
  });
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
