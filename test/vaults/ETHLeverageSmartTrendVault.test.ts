// test/ETHLeverageSmartTrendVaultTest.ts
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PERMIT2_ADDRESS,
  expect,
  constants,
  deployFixture,
  ethMintWithCollateralAtRisk as mint,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack
} from "../helpers/helpers";

describe("ETHLeverageSmartTrendVault", function () {
  let weth, collateral, feeCollector, oracle, minter, maker, referral, vault, eip721Domain, aggregator, atoken, aavePool;
  beforeEach(async function () {
    ({
      weth,
      spotAggregator: aggregator,
      feeCollector,
      spotOracle: oracle,
      minter,
      maker,
      referral,
    } = await loadFixture(deployFixture));
    collateral = weth;
    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("SmartBull");
    const strategy = await Strategy.deploy();

    // Deploy LeverageSmartTrendVault contract
    const Vault = await ethers.getContractFactory("LeverageSmartTrendVault");
    vault = await upgrades.deployProxy(Vault, [
      "Sofa ETH",
      "sfETH",
      PERMIT2_ADDRESS, // Mock permit contract
      strategy.address, // Mock strategy contract
      weth.address, // Mock weth contract
      collateral.address,
      feeCollector.address,
      parseEther("0.01"),
      oracle.address
    ]);

    eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max
  });

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      await time.increaseTo(expiry - 86400 * 3);
      const deadline = await time.latest() + 600;
      const balanceBefore = await minter.getBalance();
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const balanceAfter = await minter.getBalance();
      expect(balanceBefore.sub(balanceAfter)).to.above(parseEther("90"));
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.100665258748851474"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.100665258748851474"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
  });

  describe("Burn", function () {
    it("should burn tokens", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      await time.increaseTo(expiry - 86400 * 3);
      let deadline = await time.latest() + 600;

      let { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

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
      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.100665258748851474"), parseEther("98.980665258748851474"));
      let balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("98.98056"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.100665258748851474"), 0);
      expect(await vault.totalFee()).to.equal(parseEther("1.019334741251148525"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));

      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      await time.increaseTo(expiry - 86400 * 3);
      deadline = await time.latest() + 600;

      // strike case
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      ({ collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain));
      await time.increaseTo(expiry);
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.100665258748851474"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.100665258748851474"));
      balanceBefore = await ethers.provider.getBalance(minter.address);
      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.100665258748851474"), parseEther("93.040665258748851508"));
      balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("89.5"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.100665258748851474"), parseEther("5.999999999999999966"));
      expect(await vault.totalFee()).to.equal(parseEther("1.978669482502297050"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99985.999999999999999966"));

      // withdraw fee
      const feeCollector = await vault.feeCollector();
      await expect(vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("1.978669482502297050"));
    });
  });

  describe("BurnBatch", function () {
    it("should batch burn tokens", async function () {
      // batch burn tokens
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("33000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      await time.increaseTo(expiry - 86400 * 3);
      let deadline = await time.latest() + 600;

      let { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPricesA, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      let { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

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

      expect(await vault.totalFee()).to.equal(parseEther("1.978669485066994472"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99985.999999999999999954"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
  });
});
