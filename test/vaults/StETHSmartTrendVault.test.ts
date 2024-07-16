// test/AAVESmartTrendVaultTest.ts
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  expect,
  constants,
  deployFixture,
  mintWithCollateralAtRiskWithoutPermit as mint,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack
} from "../helpers/helpers";

describe("StETHSmartTrendVault", function () {
  let collateral, feeCollector, oracle, minter, maker, referral, vault, eip721Domain, aggregator;
  beforeEach(async function () {
    ({
      steth: collateral,
      spotAggregator: aggregator,
      feeCollector,
      spotOracle:oracle,
      minter,
      maker,
      referral,
    } = await loadFixture(deployFixture));
    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("SmartBull");
    const strategy = await Strategy.deploy();

    // Deploy SmartTrendVault contract
    const Vault = await ethers.getContractFactory("StETHSmartTrendVault");
    vault = await upgrades.deployProxy(Vault, [
      "Reliable stETH",
      "rstETH",
      strategy.address, // Mock strategy contract
      collateral.address,
      feeCollector.address,
      oracle.address
    ]);
    eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    await collateral.connect(minter).submit(constants.AddressZero, {value:parseEther("1000")});
    await collateral.connect(maker).submit(constants.AddressZero, {value:parseEther("1000")});
    await collateral.connect(minter).approve(vault.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max
  });

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("101");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: invalid collateral");
      collateralAtRisk = parseEther("20");
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99900000000000000000"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99900000000000000000"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("99.999999999999999999"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("989.999999999999999999"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("909.999999999999999999"));
    });

    it("should mint tokens with correct share", async function () {
      let totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("20");
      let makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await collateral.connect(minter).approve(vault.address, parseEther("1000"));
      await collateral.connect(minter).transfer(vault.address, parseEther("900"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("999.999999999999999998"));

      totalCollateral = parseEther("10");
      collateralAtRisk = parseEther("2");
      makerCollateral = parseEther("1");
      await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("100899000000000000000.001998000000000000"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100899000000000000000.001998000000000000"));
    });
  });

  describe("Burn", function () {
    it("should burn tokens", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("20");
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;

      let { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      // Call burn function
      await expect(vault.burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.reverted;

      await expect(vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not expired");
      await time.increaseTo(expiry);
      // Add your assertions here
      // Call burn function
      await oracle.settle();
      await expect(vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99900000000000000000"), parseEther("99.699999999999999999"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99900000000000000000"), 0);
      expect(await vault.totalFee()).to.equal(parseEther("299999999999999999.8"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("1009.699999999999999997"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("989.999999999999999999"));

      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;

      // strike case
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      ({ collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain));
      await time.increaseTo(expiry);
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99899999999999999933.4"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99899999999999999933.4"));
      await expect(vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99899999999999999933.4"), parseEther("89.80000000000000001"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99899999999999999933.4"), parseEther("9.999999999999999990"));
      expect(await vault.totalFee()).to.equal(parseEther("499999999999999999.566666666666666666"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("1009.500000000000000008"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("989.999999999999999988"));

      // withdraw fee
      const feeCollector = await vault.feeCollector();
      await expect(vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("0.499999999999999999"));

      // another strike case
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;
      anchorPrices = [parseEther("31000"), parseEther("33000")];
      ({ collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain));
      await time.increaseTo(expiry);
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      await expect(vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99900000000000000000"), parseEther("79.900000000000000020"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99900000000000000000"), parseEther("19.99999999999999998"));
    });
  });

  describe("BurnBatch", function () {
    it("should batch burn tokens", async function () {
      // batch burn tokens
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("33000")];
      let collateralAtRisk = parseEther("20");
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;

      const { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPricesA, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      const { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      await time.increaseTo(expiry);
      await oracle.settle();
      await vault.connect(minter).burnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:0 },
        { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:0 }
      ]);
      await vault.connect(maker).burnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
        { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
      ]);

      expect(await vault.totalFee()).to.equal(parseEther("499999999999999999.704"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("989.999999999999999989"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("1009.500000000000000006"));
    });
  });

  describe("Settle", function () {
    it("should settle the price", async function () {
      // Call settle function
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      await time.increaseTo(expiry);
      await expect(oracle.settle()).emit(oracle, "Settled");
    });
  });

  describe("Decimals", function () {
    it("should equal collateral decimals", async function () {
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });
  });

  // describe("Upgrade Proxy", function () {
  //   it("should upgrade the proxy", async function () {
  //     const VaultV2 = await ethers.getContractFactory("AAVESmartTrendVault");
  //     await upgrades.upgradeProxy(vault.address, VaultV2);
  //   });
  // });
});
