// test/PrincipalSmartTrendVaultTest.ts

import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { constants } from "ethers";
import {
    SignatureTransfer,
    PermitTransferFrom,
    PERMIT2_ADDRESS
} from "@uniswap/permit2-sdk";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
const { parseEther, keccak256, solidityKeccak256, solidityPack, toUtf8Bytes } = ethers.utils;

describe("ETHLeverageSmartTrendVault", function () {
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
    weth.deposit({ value: parseEther("1000") }); // more weth for testing
    // mock collateral contract
    const collateral = weth;

    // mock governance contract
    const Governance = await ethers.getContractFactory("MockERC20Mintable");
    const governance = await Governance.deploy(
      "Governance",
      "GOV",
      18
    );

    await uniFactory.createPair(weth.address, governance.address);

    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("SmartBull");
    const strategy = await Strategy.deploy();

    // Deploy mock chainlink contract
    const Aggregator = await ethers.getContractFactory("MockChainlinkAggregator");
    const aggregator = await Aggregator.deploy();
    await aggregator.setLatestAnswer(parseEther("30000"));

    // Deploy LeverageSmartTrendVault contract
    const Vault = await ethers.getContractFactory("LeverageSmartTrendVault");

    const [owner, minter, maker, referral, lp] = await ethers.getSigners();
    collateral.mint(owner.address, parseEther("100000"));
    collateral.mint(minter.address, parseEther("100000"));
    collateral.mint(maker.address, parseEther("100000"));
    collateral.mint(lp.address, parseEther("100000"));

    await collateral.connect(minter).approve(PERMIT2_ADDRESS, constants.MaxUint256); // approve max
    await collateral.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max

    weth.mint(lp.address, parseEther("100000"));
    await weth.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max

    governance.mint(lp.address, parseEther("100000"));
    await governance.connect(lp).approve(UNI_ROUTERV2_ADDR, constants.MaxUint256); // approve max

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
    const Oracle = await ethers.getContractFactory("SpotOracle");
    const oracle = await Oracle.deploy(
      aggregator.address,
    );
    const FeeCollector = await ethers.getContractFactory("FeeCollector");
    const feeCollector = await FeeCollector.deploy(
      governance.address,
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
      parseEther("0.01"), // Mock fee rate 1%
      oracle.address
    ]);

    const eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max
    return { permit2, collateral, strategy, aggregator, oracle, vault, owner, minter, maker, referral, eip721Domain };
  }

  async function mint(
    totalCollateral: string,
    expiry: number,
    anchorPrices: Array<string>,
    collateralAtRisk: string,
    makerCollateral: string,
    makerBalanceThreshold: string,
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
      { name: 'makerBalanceThreshold', type: 'uint256' },
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
      makerBalanceThreshold: makerBalanceThreshold,
      deadline: deadline,
      vault: vault.address,
    };
    const makerSignature = await maker._signTypedData(eip721Domain, makerSignatureTypes, makerSignatureValues);

    // Call mint function
    const tx = await vault
        .connect(minter)
        ['mint((uint256,uint256[2],uint256,uint256,uint256,uint256,address,bytes),address)'](
          {
            expiry: expiry,
            anchorPrices: anchorPrices,
            collateralAtRisk: collateralAtRisk,
            makerCollateral: makerCollateral,
            makerBalanceThreshold: makerBalanceThreshold,
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

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const { collateral, vault, minter, maker, referral, eip721Domain } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      const makerBalanceThreshold = parseEther("100000");
      await time.increaseTo(expiry - 86400 * 3);
      const deadline = await time.latest() + 600;
      const balanceBefore = await minter.getBalance();
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const balanceAfter = await minter.getBalance();
      expect(balanceBefore.sub(balanceAfter)).to.above(parseEther("90"));
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: invalid balance threshold");
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.999334741251148527"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.999334741251148527"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
  });

  describe("Burn", function () {
    it("should burn tokens", async function () {
      const { collateral, oracle, vault, minter, maker, referral, eip721Domain, aggregator, owner } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      let makerBalanceThreshold = parseEther("100000");
      await time.increaseTo(expiry - 86400 * 3);
      let deadline = await time.latest() + 600;

      let { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      // Call burn function
      await expect(vault.burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.reverted;

      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not expired");
      await time.increaseTo(expiry);
      await oracle.settle();
      // Add your assertions here
      // Call burn function
      let balanceBefore = await ethers.provider.getBalance(minter.address);
      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.999334741251148527"), parseEther("99.879334741251148527"));
      let balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("99.5"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.999334741251148527"), 0);
      expect(await vault.totalFee()).to.equal(parseEther("0.120665258748851472"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));

      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      await time.increaseTo(expiry - 86400 * 3);
      deadline = await time.latest() + 600;

      // strike case
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      makerBalanceThreshold = parseEther("99990");
      ({ collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain));
      await time.increaseTo(expiry);
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.999334741251148527"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.999334741251148527"));
      balanceBefore = await ethers.provider.getBalance(minter.address);
      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.999334741251148527"), parseEther("93.939334741251148554"));
      balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("89.5"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.999334741251148527"), parseEther("5.939999999999999974"));
      expect(await vault.totalFee()).to.equal(parseEther("0.241330517497702943"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99985.939999999999999974"));

      // withdraw fee
      expect(await vault.harvest()).to.changeTokenBalance(collateral, owner, parseEther("2"));
    });
  });

  describe("BurnBatch", function () {
    it("should batch burn tokens", async function () {
      // batch burn tokens
      const { collateral, vault, oracle, minter, maker, referral, eip721Domain } = await loadFixture(deployFixture);
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("33000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      let makerBalanceThreshold = parseEther("100000");
      await time.increaseTo(expiry - 86400 * 3);
      let deadline = await time.latest() + 600;

      let { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPricesA, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      makerBalanceThreshold = parseEther("99990");
      let { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      await time.increaseTo(expiry);
      await oracle.settle();
      const balanceBefore = await ethers.provider.getBalance(minter.address);
      await vault.connect(minter).ethBurnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:0 },
        { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:0 }
      ]);
      const balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("9.5"));
      await vault.connect(maker).burnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
        { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
      ]);

      expect(await vault.totalFee()).to.equal(parseEther("0.241330514933005521"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99985.939999999999999967"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
  });
});
