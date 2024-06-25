import * as dotenv from "dotenv";
import { network, ethers, upgrades } from "hardhat";

dotenv.config({ path: `.env.${network.name}` });

export enum FeeAmount {
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

export const TICK_SPACINGS: { [amount in FeeAmount]: number } = {
  [FeeAmount.LOW]: 10,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 200,
}
export const getMinTick = (tickSpacing: number) => Math.ceil(-887272 / tickSpacing) * tickSpacing
export const getMaxTick = (tickSpacing: number) => Math.floor(887272 / tickSpacing) * tickSpacing

const ADDR_SIZE = 20
const FEE_SIZE = 3
const OFFSET = ADDR_SIZE + FEE_SIZE
const DATA_SIZE = OFFSET + ADDR_SIZE

export function encodePath(path: string[], fees: FeeAmount[]): string {
  if (path.length != fees.length + 1) {
    throw new Error('path/fee lengths do not match')
  }

  let encoded = '0x'
  for (let i = 0; i < fees.length; i++) {
    // 20 byte encoding of the address
    encoded += path[i].slice(2)
    // 3 byte encoding of the fee
    encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, '0')
  }
  // encode the final token
  encoded += path[path.length - 1].slice(2)

  return encoded.toLowerCase()
}

async function main() {
  // hardhat always runs the compile task when running scripts with its command
  // line interface.
  //
  // if this script is run directly using `node` you may want to call compile
  // manually to make sure everything is compiled
  // await hre.run('compile');

  // we get the contract to deploy
  // const gas = await ethers.provider.getgasprice();
  // const gas = 5000000000;
  const FeeCollector = await ethers.getContractFactory("FeeCollector");
  const feeCollector = await FeeCollector.attach("0x4140AB4AFc36B93270a9659BD8387660cC6509b5");

  const gas = await ethers.provider.getGasPrice();

  // execute once
  // const approveTx = await feeCollector.approve(process.env.USDT_ADDRESS, process.env.UNI_ROUTERV3_ADDRESS, {
  //   gasPrice: gas,
  //   nonce: 83
  // });
  // console.log(approveTx.hash);

  const tokens = [process.env.USDT_ADDRESS, process.env.WETH_ADDRESS, process.env.RCH_ADDRESS];
  const path = encodePath(tokens, new Array(tokens.length - 1).fill(FeeAmount.LOW));
  const deadline = Math.floor(Date.now() / 1000) + 60 * 10;
  const minPrice = ethers.utils.parseUnits("7500", 36).div(ethers.utils.parseUnits("6235.451237", 6));
  console.log(process.env.USDT_ADDRESS)
  console.log(path);
  console.log(deadline);
  console.log(minPrice.toString());
  const tx = await feeCollector["swapRCH(address,uint256,uint256,bytes)"](process.env.USDT_ADDRESS, minPrice.toString(), deadline, path, {
    gasPrice: gas,
  });
  console.log(tx.hash);
};

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
