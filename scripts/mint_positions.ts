import * as dotenv from "dotenv";
import { network, ethers, upgrades } from "hardhat";
import {
    SignatureTransfer,
    PermitTransferFrom,
    PERMIT2_ADDRESS
} from "@uniswap/permit2-sdk";
import {
  mint,
  mintWithCollateralAtRisk
} from "../test/helpers/helpers";



dotenv.config({ path: `.env.${network.name}` });
async function main() {
  // Hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // If this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // We get the contract to deploy
  const privateKey = process.env.PRIVATE_KEY_MAINNET; // 用你的私钥替换这里
  const wallet = new ethers.Wallet(privateKey, ethers.provider);

  const Vault = await ethers.getContractFactory("DNTVault", wallet);
  const vault = Vault.attach("");

  const gas = await ethers.provider.getGasPrice();

  const ERC20 = await ethers.getContractFactory("MockERC20Mintable", wallet);
  const usdt = ERC20.attach(process.env.USDT_ADDRESS);
  const totalCollateral = ethers.utils.parseUnits("0.01", 6);
  const now = new Date();
  const tomorrow = new Date(Date.UTC(
    now.getUTCFullYear() + 20,
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    8, 0, 0, 0
  ));
  console.log(tomorrow);
  const expiry = Math.floor(tomorrow.getTime() / 1000);
  const anchorPrices = [0, 1];
  const makerCollateral = 0;
  const collateralAtRisk = 10;
  const deadline = expiry;
  const minterNonce = parseInt(Date.now()/1000);
  const eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 42161,
      verifyingContract: vault.address,
    };
  await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, minterNonce, usdt, vault, wallet, wallet, ethers.constants.AddressZero, eip721Domain);
  // await mintWithCollateralAtRisk(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, usdt, vault, wallet, wallet, ethers.constants.AddressZero, eip721Domain);

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
