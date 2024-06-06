import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { constants, BigNumber } from "ethers";
import {
    SignatureTransfer,
    PermitTransferFrom,
    PERMIT2_ADDRESS
} from "@uniswap/permit2-sdk";
const { parseEther, keccak256, solidityKeccak256, solidityPack, toUtf8Bytes } = ethers.utils;

async function deployFixture() {
  const UNI_ROUTERV2_ADDR = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
  const UNI_ROUTERV3_ADDR = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
  const uniRouterV2 = await ethers.getContractAt("IUniswapV2Router", UNI_ROUTERV2_ADDR);

  const UNI_FACTORY_ADDR = await uniRouterV2.factory();
  const uniFactory = await ethers.getContractAt("IUniswapV2Factory", UNI_FACTORY_ADDR);

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
  // mock governance contract
  const Governance = await ethers.getContractFactory("MockERC20Mintable");
  const governance = await Governance.deploy(
    "Governance",
    "GOV",
    18
  );

  await uniFactory.createPair(weth.address, collateral.address);
  await uniFactory.createPair(weth.address, governance.address);

  // Deploy mock chainlink contract
  const HlAggregator = await ethers.getContractFactory("MockAutomatedFunctionsConsumer");
  const hlAggregator = await HlAggregator.deploy();
  await hlAggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
  const SpotAggregator = await ethers.getContractFactory("MockChainlinkAggregator");
  const spotAggregator = await SpotAggregator.deploy();
  await spotAggregator.setLatestAnswer(parseEther("30000"));


  const [owner, minter, maker, referral, lp] = await ethers.getSigners();
  collateral.mint(owner.address, parseEther("100000"));
  collateral.mint(minter.address, parseEther("100000"));
  collateral.mint(maker.address, parseEther("100000"));
  collateral.mint(lp.address, parseEther("100000"));

  await collateral.connect(minter).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
  await collateral.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max

  weth.mint(lp.address, parseEther("100000"));
  weth.mint(minter.address, parseEther("100000"));
  weth.mint(maker.address, parseEther("100000"));
  await weth.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max
  await weth.connect(minter).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
  await weth.deposit({ value: parseEther("1000") }); // more weth for testing

  governance.mint(lp.address, parseEther("100000"));
  await governance.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max

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
  await uniRouterV2.connect(lp).addLiquidity(
    weth.address,
    governance.address,
    parseEther("10000"),
    parseEther("10000"),
    parseEther("10000"),
    parseEther("10000"),
    lp.address,
    constants.MaxUint256
  );
  // view
  const HlOracle = await ethers.getContractFactory("HlOracle");
  const hlOracle = await HlOracle.deploy(
    hlAggregator.address,
  );
  const SpotOracle = await ethers.getContractFactory("SpotOracle");
  const spotOracle = await SpotOracle.deploy(
    spotAggregator.address,
  );
  const FeeCollector = await ethers.getContractFactory("FeeCollector");
  const feeCollector = await FeeCollector.deploy(
    parseEther("0.01"), // Mock fee rate 1%
    parseEther("0.01"), // Mock fee rate 1%
  );
  // mock atoken contract
  const AToken = await ethers.getContractFactory("MockATokenMintable");
  const atoken = await AToken.deploy(
    collateral.address,
    'Aave interest bearing COLLATERAL',
    'aCOL',
    18
  );

  // mock aave pool contract
  const AavePool = await ethers.getContractFactory("MockAavePool");
  const aavePool = await AavePool.deploy(
    collateral.address,
    atoken.address
  );

  return { permit2, collateral, hlAggregator, spotAggregator, feeCollector, hlOracle, spotOracle, owner, minter, maker, referral, weth, atoken, aavePool };
}

async function mint(
  totalCollateral: string,
  expiry: number,
  anchorPrices: Array<string>,
  makerCollateral: string,
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
    { name: 'deadline', type: 'uint256' },
    { name: 'vault', type: 'address' },
  ] };
  const makerSignatureValues = {
    minter: minter.address,
    totalCollateral: totalCollateral,
    expiry: expiry,
    anchorPrices: anchorPrices,
    makerCollateral: makerCollateral,
    deadline: deadline,
    vault: vault.address,
  };
  const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);

  // Call mint function
  await vault
    .connect(minter)
  ["mint(uint256,(uint256,uint256[2],uint256,uint256,address,bytes),bytes,uint256,address)"](
    totalCollateral,
    {
      expiry: expiry,
      anchorPrices: anchorPrices,
      makerCollateral: makerCollateral,
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

async function mintBatch(
  params: Array<any>,
  deadline: number,
  minterNonce: number,
  collateral: any,
  vault: any,
  minter: any,
  referral: any,
  eip721Domain: any
) {
  let totalCollaterals = [];
  let paramsArray = [];
  let minterCollateral = BigNumber.from(0);
  for (let i = 0; i < params.length; i++) {
    const { totalCollateral, expiry, anchorPrices, makerCollateral, deadline, maker } = params[i];
    const makerSignatureTypes = { Mint: [
      { name: 'minter', type: 'address' },
      { name: 'totalCollateral', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'anchorPrices', type: 'uint256[2]' },
      { name: 'makerCollateral', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'vault', type: 'address' },
    ] };
    const makerSignatureValues = {
      minter: minter.address,
      totalCollateral: totalCollateral,
      expiry: expiry,
      anchorPrices: anchorPrices,
      makerCollateral: makerCollateral,
      deadline: deadline,
      vault: vault.address,
    };
    const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);
    totalCollaterals[i] = totalCollateral;
    paramsArray[i] = {
      expiry: expiry,
      anchorPrices: anchorPrices,
      makerCollateral: makerCollateral,
      deadline: deadline,
      maker: maker.address,
      makerSignature: makerSignature
    };
    minterCollateral = minterCollateral.add(totalCollateral).sub(makerCollateral);
  }
  const minterPermit: PermitTransferFrom = {
    permitted: {
      token: collateral.address,
      amount: minterCollateral.toString()
    },
    spender: vault.address,
    nonce: minterNonce,
    deadline: deadline
  };
  const { domain, types, values } = SignatureTransfer.getPermitData(minterPermit, PERMIT2_ADDRESS, eip721Domain.chainId);
  const minterPermitSignature = await minter._signTypedData(domain, types, values);

  // Call mint function
  await vault
    .connect(minter)
  ["mintBatch(uint256[],(uint256,uint256[2],uint256,uint256,address,bytes)[],bytes,uint256,uint256,address)"](
    totalCollaterals,
    paramsArray,
    minterPermitSignature,
    minterNonce,
    deadline,
    referral.address,
  );
}

async function ethMint(
  totalCollateral: any,
  expiry: number,
  anchorPrices: Array<string>,
  makerCollateral: string,
  deadline: number,
  collateral: any,
  vault: any,
  minter: any,
  maker: any,
  referral: any,
  eip721Domain: any
) {
  const makerSignatureTypes = { Mint: [
    { name: 'minter', type: 'address' },
    { name: 'totalCollateral', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'anchorPrices', type: 'uint256[2]' },
    { name: 'makerCollateral', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'vault', type: 'address' },
  ] };
  const makerSignatureValues = {
    minter: minter.address,
    totalCollateral: totalCollateral,
    expiry: expiry,
    anchorPrices: anchorPrices,
    makerCollateral: makerCollateral,
    deadline: deadline,
    vault: vault.address,
  };
  const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);

  // Call mint function
  await vault
    .connect(minter)
  ["mint((uint256,uint256[2],uint256,uint256,address,bytes),address)"](
    {
      expiry: expiry,
      anchorPrices: anchorPrices,
      makerCollateral: makerCollateral,
      deadline: deadline,
      maker: maker.address,
      makerSignature: makerSignature
    },
    referral.address,
    { value: (totalCollateral - makerCollateral).toString() }
  );

  return { vault, collateral, maker, minter };
}

async function ethMintBatch(
  params: Array<any>,
  vault: any,
  minter: any,
  referral: any,
  eip721Domain: any
) {
  let totalCollaterals = [];
  let paramsArray = [];
  let collateral = BigNumber.from(0);
  for (let i = 0; i < params.length; i++) {
    const { totalCollateral, expiry, anchorPrices, makerCollateral, deadline, maker } = params[i];
    const makerSignatureTypes = { Mint: [
      { name: 'minter', type: 'address' },
      { name: 'totalCollateral', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
      { name: 'anchorPrices', type: 'uint256[2]' },
      { name: 'makerCollateral', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'vault', type: 'address' },
    ] };
    const makerSignatureValues = {
      minter: minter.address,
      totalCollateral: totalCollateral,
      expiry: expiry,
      anchorPrices: anchorPrices,
      makerCollateral: makerCollateral,
      deadline: deadline,
      vault: vault.address,
    };
    const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);
    totalCollaterals[i] = totalCollateral;
    paramsArray[i] = {
      expiry: expiry,
      anchorPrices: anchorPrices,
      makerCollateral: makerCollateral,
      deadline: deadline,
      maker: maker.address,
      makerSignature: makerSignature
    };
    collateral = collateral.add(totalCollateral).sub(makerCollateral);
  }
  // Call mint function
  await vault
    .connect(minter)
  ["mintBatch(uint256[],(uint256,uint256[2],uint256,uint256,address,bytes)[],address)"](
    totalCollaterals,
    paramsArray,
    referral.address,
    { value: collateral.toString() }
  );
}

async function mintWithCollateralAtRisk(
  totalCollateral: string,
  expiry: number,
  anchorPrices: Array<string>,
  collateralAtRisk: string,
  makerCollateral: string,
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
    { name: 'collateralAtRisk', type: 'uint256' },
    { name: 'makerCollateral', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'vault', type: 'address' },
  ] };
  const makerSignatureValues = {
    minter: minter.address,
    totalCollateral: totalCollateral,
    expiry: expiry,
    anchorPrices: anchorPrices,
    collateralAtRisk: collateralAtRisk,
    makerCollateral: makerCollateral,
    deadline: deadline,
    vault: vault.address,
  };
  const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);

  // Call mint function
  const tx = await vault
    .connect(minter)
  ['mint(uint256,(uint256,uint256[2],uint256,uint256,uint256,address,bytes),bytes,uint256,address)'](
    totalCollateral,
    {
      expiry: expiry,
      anchorPrices: anchorPrices,
      collateralAtRisk: collateralAtRisk,
      makerCollateral: makerCollateral,
      deadline: deadline,
      maker: maker.address,
      makerSignature: makerSignature
    },
    minterPermitSignature,
    minterNonce,
    referral.address
  );
  let receipt = await tx.wait();
  let collateralAtRiskPercentage;

  for (const event of receipt.events) {
    if (event.event === 'Minted') {
      collateralAtRiskPercentage = event.args.collateralAtRiskPercentage;
      break;
    }
  }

  return { vault, collateral, maker, minter, collateralAtRiskPercentage };
}

async function ethMintWithCollateralAtRisk(
  totalCollateral: string,
  expiry: number,
  anchorPrices: Array<string>,
  collateralAtRisk: string,
  makerCollateral: string,
  deadline: number,
  collateral: any,
  vault: any,
  minter: any,
  maker: any,
  referral: any,
  eip721Domain: any
) {
  const makerSignatureTypes = { Mint: [
    { name: 'minter', type: 'address' },
    { name: 'totalCollateral', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'anchorPrices', type: 'uint256[2]' },
    { name: 'collateralAtRisk', type: 'uint256' },
    { name: 'makerCollateral', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'vault', type: 'address' },
  ] };
  const makerSignatureValues = {
    minter: minter.address,
    totalCollateral: totalCollateral,
    expiry: expiry,
    anchorPrices: anchorPrices,
    collateralAtRisk: collateralAtRisk,
    makerCollateral: makerCollateral,
    deadline: deadline,
    vault: vault.address,
  };
  const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);

  // Call mint function
  const tx = await vault
    .connect(minter)
  ['mint((uint256,uint256[2],uint256,uint256,uint256,address,bytes),address)'](
    {
      expiry: expiry,
      anchorPrices: anchorPrices,
      collateralAtRisk: collateralAtRisk,
      makerCollateral: makerCollateral,
      deadline: deadline,
      maker: maker.address,
      makerSignature: makerSignature
    },
    referral.address,
    { value: (totalCollateral - makerCollateral).toString() }
  );
  let receipt = await tx.wait();
  let collateralAtRiskPercentage;

  for (const event of receipt.events) {
    if (event.event === 'Minted') {
      collateralAtRiskPercentage = event.args.collateralAtRiskPercentage;
      break;
    }
  }

  return { vault, collateral, maker, minter, collateralAtRiskPercentage };
}

module.exports = {
  PERMIT2_ADDRESS,
  expect,
  constants,
  BigNumber,
  deployFixture,
  mint,
  mintBatch,
  ethMint,
  ethMintBatch,
  mintWithCollateralAtRisk,
  ethMintWithCollateralAtRisk,
  parseEther,
  keccak256, solidityKeccak256, solidityPack, toUtf8Bytes
};
