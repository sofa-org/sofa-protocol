import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { constants, BigNumber, BigNumberish } from "ethers";
import {
    SignatureTransfer,
    PermitTransferFrom,
    PERMIT2_ADDRESS
} from "@uniswap/permit2-sdk";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import bn from 'bignumber.js';
const { parseEther, keccak256, solidityKeccak256, solidityPack, toUtf8Bytes } = ethers.utils;

bn.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 })

// returns the sqrt price as a 64x96
export function encodePriceSqrt(reserve1: BigNumberish, reserve0: BigNumberish): BigNumber {
  return BigNumber.from(
    new bn(reserve1.toString())
      .div(reserve0.toString())
      .sqrt()
      .multipliedBy(new bn(2).pow(96))
      .integerValue(3)
      .toString()
  )
}
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

describe("FeeCollector", function () {
  async function deployFixture() {
    const UNI_ROUTERV2_ADDR = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
    const UNI_ROUTERV3_ADDR = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
    const uniRouterV2 = await ethers.getContractAt("IUniswapV2Router", UNI_ROUTERV2_ADDR);
    const uniRouterV3 = await ethers.getContractAt("ISwapRouter", UNI_ROUTERV3_ADDR);

    const UNI_FACTORYV2_ADDR = await uniRouterV2.factory();
    const uniFactoryV2 = await ethers.getContractAt("IUniswapV2Factory", UNI_FACTORYV2_ADDR);
    const UNI_V3_NFT_ADDR = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";
    const nft = await ethers.getContractAt("INonfungiblePositionManager", UNI_V3_NFT_ADDR);

    // Permit2
    const permit2 = await ethers.getContractAt("IPermit2", PERMIT2_ADDRESS);

    // mock weth
    const WETH = await ethers.getContractFactory("MockWETH9");
    const weth = await WETH.deploy();

    // mock collateral contract
    const Collateral = await ethers.getContractFactory("MockERC20Mintable");
    const collateral = await Collateral.deploy(
      "COLLATERAL",
      "COL",
      18
    );

    // tomorrow timestmap
    const tradingStartTime = Math.floor(new Date().getTime() / 1000 + 60 * 60 * 24); // 1 day later
    // rch contract
    const RCH = await ethers.getContractFactory("RCH");
    const rch = await RCH.deploy(tradingStartTime);


    await uniFactoryV2.createPair(weth.address, collateral.address);
    await uniFactoryV2.createPair(weth.address, rch.address);

    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("DNT");
    const strategy = await Strategy.deploy();

    // Deploy mock chainlink contract
    const Aggregator = await ethers.getContractFactory("MockAutomatedFunctionsConsumer");
    const aggregator = await Aggregator.deploy();
    await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");

    // Deploy DNTVault contract
    const Vault = await ethers.getContractFactory("DNTVault");

    const [owner, minter, maker, referral, lp] = await ethers.getSigners();
    collateral.mint(minter.address, parseEther("100000"));
    collateral.mint(maker.address, parseEther("100000"));
    collateral.mint(lp.address, parseEther("100000"));
    collateral.mint(owner.address, parseEther("100000"));

    await collateral.connect(minter).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
    await collateral.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max
    await collateral.connect(lp).approve(UNI_V3_NFT_ADDR, constants.MaxUint256); // approve max
    await collateral.connect(owner).approve(UNI_V3_NFT_ADDR, constants.MaxUint256); // approve max

    weth.mint(lp.address, parseEther("100000"));
    await weth.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max
    await weth.connect(lp).approve(UNI_V3_NFT_ADDR, constants.MaxUint256); // approve max

    rch.mint(owner.address, parseEther("100000"));
    weth.mint(owner.address, parseEther("100000"));
    await rch.connect(owner).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max
    await weth.connect(owner).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max
    await rch.connect(owner).approve(UNI_V3_NFT_ADDR, constants.MaxUint256); // approve max
    await weth.connect(owner).approve(UNI_V3_NFT_ADDR, constants.MaxUint256); // approve max

    await uniRouterV2.connect(lp).addLiquidity(
      weth.address,
      collateral.address,
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      lp.address,
      constants.MaxUint256
    );
    await uniRouterV2.connect(owner).addLiquidity(
      weth.address,
      rch.address,
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      parseEther("10000"),
      owner.address,
      constants.MaxUint256
    );


    await createPool(collateral.address, weth.address, nft, owner);
    await createPool(weth.address, rch.address, nft, owner);
    // view
    const Oracle = await ethers.getContractFactory("HlOracle");
    const oracle = await Oracle.deploy(
      aggregator.address,
    );
    const FeeCollector = await ethers.getContractFactory("FeeCollector");
    const feeCollector = await FeeCollector.deploy(
      rch.address,
      parseEther("0.01"), // Mock fee rate 1%
      UNI_ROUTERV2_ADDR,
      UNI_ROUTERV3_ADDR
    );

    const vault = await upgrades.deployProxy(Vault, [
      "Sofa ETH",
      "sfETH",
      PERMIT2_ADDRESS, // Mock permit contract
      strategy.address, // Mock strategy contract
      weth.address, // Mock weth contract
      collateral.address,
      feeCollector.address,
      oracle.address
    ]);
    const eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max

    return { vault, collateral, feeCollector, weth, rch, uniRouterV2, aggregator, oracle, referral, maker, minter, eip721Domain, nft, uniRouterV3 };
  }

  async function createPool(tokenAddressA: string, tokenAddressB: string, nft: any, wallet: any) {
    if (tokenAddressA.toLowerCase() > tokenAddressB.toLowerCase())
      [tokenAddressA, tokenAddressB] = [tokenAddressB, tokenAddressA]

    await nft.createAndInitializePoolIfNecessary(
      tokenAddressA,
      tokenAddressB,
      FeeAmount.MEDIUM,
      encodePriceSqrt(1, 1)
    )

    const liquidityParams = {
      token0: tokenAddressA,
      token1: tokenAddressB,
      fee: FeeAmount.MEDIUM,
      tickLower: getMinTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      tickUpper: getMaxTick(TICK_SPACINGS[FeeAmount.MEDIUM]),
      recipient: wallet.address,
      amount0Desired: parseEther("10000"),
      amount1Desired: parseEther("10000"),
      amount0Min: 0,
      amount1Min: 0,
      deadline: constants.MaxUint256
    }

    return nft.mint(liquidityParams)
  }


  async function mint(
    totalCollateral: string,
    expiry: number,
    anchorPrices: Array<string>,
    makerCollateral: string,
    makerBalanceThreshold: string,
    deadline: number,
    minterNonce: number,
    collateral: any,
    vault: any,
    minter: any,
    maker: any,
    referral: any,
    eip721Domain: any
  ) {
    // console.log(keccak256(toUtf8Bytes("Mint(address minter,uint256 totalCollateral,uint256 expiry,uint256 strikePrice,uint256 makerCollateral,uint256 deadline,uint256 nonce,address vault)")));
    // Test variables
    const minterPermit: PermitTransferFrom = {
      permitted: {
        token: collateral.address,
        amount: (totalCollateral - makerCollateral).toString()
      },
      spender: vault.address,
      nonce: minterNonce,
      deadline: deadline
    };
    const { domain, types, values } = SignatureTransfer.getPermitData(minterPermit, PERMIT2_ADDRESS, eip721Domain.chainId);
    const minterPermitSignature = await minter._signTypedData(domain, types, values);

    const makerSignatureTypes = { Mint: [
      { name: 'minter', type: 'address' },
      { name: 'totalCollateral', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'anchorPrices', type: 'uint256[2]' },
      { name: 'makerCollateral', type: 'uint256' },
      { name: 'makerBalanceThreshold', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'vault', type: 'address' },
    ] };
    const makerSignatureValues = {
      minter: minter.address,
      totalCollateral: totalCollateral,
      expiry: expiry,
      anchorPrices: anchorPrices,
      makerCollateral: makerCollateral,
      makerBalanceThreshold: makerBalanceThreshold,
      deadline: deadline,
      vault: vault.address,
    };
    const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);

    // Call mint function
    await vault
        .connect(minter)
        ["mint(uint256,(uint256,uint256[2],uint256,uint256,uint256,address,bytes),bytes,uint256,address)"](
          totalCollateral,
          {
            expiry: expiry,
            anchorPrices: anchorPrices,
            makerCollateral: makerCollateral,
            makerBalanceThreshold: makerBalanceThreshold,
            deadline: deadline,
            maker: maker.address,
            makerSignature: makerSignature
          },
          minterPermitSignature,
          minterNonce,
          referral.address
        );

    return { vault, collateral, maker, minter };
  }


  it("should burn utility token", async function () {
    const { vault, feeCollector, collateral, weth, rch, aggregator, oracle, minter, maker, referral, eip721Domain, uniRouterV2 } = await loadFixture(deployFixture);
    const totalCollateral = parseEther("100");
    let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
    let anchorPrices = [parseEther("28000"), parseEther("30000")];
    const makerCollateral = parseEther("10");
    let makerBalanceThreshold = parseEther("100000");
    let deadline = await time.latest() + 600;
    let minterNonce = await time.latest();

    await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

    // Test variables
    let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
    let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
    let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);

    await time.increaseTo(expiry);
    await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
    await oracle.settle();
    await vault.connect(minter).burn(term, expiry, anchorPrices, 0);
    await vault.connect(maker).burn(term, expiry, anchorPrices, 1);

    expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
    deadline = await time.latest() + 600;

    // withdraw fee
    expect(await vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("2"));

    await expect(feeCollector["swapRCH(address,uint256,address[])"](collateral.address, 0, [collateral.address, weth.address, rch.address])).to.be.reverted;
    await feeCollector.approve(collateral.address, uniRouterV2.address);
    await expect(feeCollector["swapRCH(address,uint256,address[])"](collateral.address, 0, [collateral.address, weth.address])).to.be.revertedWith("Collector: invalid path");
    await expect(feeCollector["swapRCH(address,uint256,address[])"](collateral.address, 0, [collateral.address, weth.address, rch.address])).to.changeTokenBalance(rch, feeCollector, parseEther("0.993811131309326294"));
    expect(await collateral.balanceOf(feeCollector.address)).to.equal(parseEther("0"));
    await expect(feeCollector.burnRCH()).to.changeTokenBalance(rch, feeCollector, parseEther("-0.993811131309326294"));
  });

  it("should burn utility token in uniV3", async function () {
    const { vault, feeCollector, collateral, weth, rch, aggregator, oracle, minter, maker, referral, eip721Domain, uniRouterV3 } = await loadFixture(deployFixture);
    const totalCollateral = parseEther("100");
    let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
    let anchorPrices = [parseEther("28000"), parseEther("30000")];
    const makerCollateral = parseEther("10");
    let makerBalanceThreshold = parseEther("100000");
    let deadline = await time.latest() + 600;
    let minterNonce = await time.latest();

    await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

    // Test variables
    let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
    let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 0]);
    let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256"], [term, expiry, anchorPrices, 1]);

    await time.increaseTo(expiry);
    await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
    await oracle.settle();
    await vault.connect(minter).burn(term, expiry, anchorPrices, 0);
    await vault.connect(maker).burn(term, expiry, anchorPrices, 1);

    expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
    deadline = await time.latest() + 600;

    // withdraw fee
    expect(await vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("2"));

    let tokens = [collateral.address, weth.address];
    let path = encodePath(tokens, new Array(tokens.length - 1).fill(FeeAmount.MEDIUM));
    await expect(feeCollector["swapRCH(address,uint256,bytes)"](collateral.address, 0, path)).to.be.reverted;
    await feeCollector.approve(collateral.address, uniRouterV3.address);
    await expect(feeCollector["swapRCH(address,uint256,bytes)"](collateral.address, 0, path)).to.be.revertedWith("Collector: invalid path");
    tokens = [collateral.address, weth.address, rch.address];
    path = encodePath(tokens, new Array(tokens.length - 1).fill(FeeAmount.MEDIUM));
    await expect(feeCollector["swapRCH(address,uint256,bytes)"](collateral.address, 0, path)).to.changeTokenBalance(rch, feeCollector, parseEther("0.993811131309326293"));
    expect(await collateral.balanceOf(feeCollector.address)).to.equal(parseEther("0"));
    await expect(feeCollector.burnRCH()).to.changeTokenBalance(rch, feeCollector, parseEther("-0.993811131309326293"));
  });

  it("should set fee rate", async function () {
    const { feeCollector, minter } = await loadFixture(deployFixture);

    await expect(feeCollector.connect(minter).setFeeRate(parseEther("0.01"))).to.be.revertedWith("Ownable: caller is not the owner");
    await feeCollector.setFeeRate(parseEther("0.1"));
    expect(await feeCollector.feeRate()).to.equal(parseEther("0.1"));
  });
});
