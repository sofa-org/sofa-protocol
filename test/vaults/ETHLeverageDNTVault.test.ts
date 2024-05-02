// test/ETHLeverageDNTVaultTest.ts
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

describe("ETHLeverageDNTVault", function () {
  let weth, collateral, feeCollector, oracle, minter, maker, referral, vault, eip721Domain, aggregator;
  beforeEach(async function () {
    ({
      weth,
      hlAggregator: aggregator,
      feeCollector,
      hlOracle: oracle,
      minter,
      maker,
      referral
    } = await loadFixture(deployFixture));
    collateral = weth;

    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("DNT");
    const strategy = await Strategy.deploy();

    // Deploy DNTVault contract
    const Vault = await ethers.getContractFactory("LeverageDNTVault");
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
      const makerBalanceThreshold = parseEther("100000");
      await time.increaseTo(expiry - 86400 * 3);
      const deadline = await time.latest() + 600;
      const balanceBefore = await minter.getBalance();
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const balanceAfter = await minter.getBalance();
      expect(balanceBefore.sub(balanceAfter)).to.above(parseEther("90"));
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: invalid balance threshold");
      // Perform assertions
      const term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);
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
      let makerBalanceThreshold = parseEther("100000");
      await time.increaseTo(expiry - 86400 * 3);
      let deadline = await time.latest() + 600;

      let { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      // Call burn function
      await expect(vault.ethBurn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.reverted;

      await expect(vault.connect(minter).ethBurn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not burnable");
      await time.increaseTo(expiry);
      // Add your assertions here
      // Call burn function
      await expect(vault.connect(minter).ethBurn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not settled");
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      let balanceBefore = await minter.getBalance();
      await expect(vault.connect(minter).ethBurn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.100665258748851474"), parseEther("87.100665258748851541"));
      let balanceAfter = await minter.getBalance();
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("79"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.100665258748851474"), parseEther("11.999999999999999933"));
      expect(await vault.totalFee()).to.equal(parseEther("0.899334741251148526"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100001.999999999999999933"));

      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      await time.increaseTo(expiry - 86400 * 3 + 1); // plus 1 seconds for right term
      deadline = await time.latest() + 600;

      // strike case
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      ({ collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain));
      await time.increaseTo(expiry);
      await expect(oracle.settle()).to.be.revertedWith("Oracle: not updated");
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.100665256184154052"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.100665256184154052"));
      balanceBefore = await minter.getBalance();
      await expect(vault.connect(minter).ethBurn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.100665256184154052"), parseEther("98.980665256184154053"));
      balanceAfter = await minter.getBalance();
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("98"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.100665256184154052"), 0);
      expect(await vault.totalFee()).to.equal(parseEther("1.918669485066994473"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99991.999999999999999933"));

      // withdraw fee
      const feeCollector = await vault.feeCollector();
      await expect(vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("1.918669485066994473"));
    });

    it("should burn tokens if knock-out", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      const makerBalanceThreshold = parseEther("100000");
      await time.increaseTo(expiry - 86400 * 3);
      let deadline = await time.latest() + 600;

      let { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);

      await expect(vault.connect(minter).ethBurn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not burnable");
      await time.increaseTo(expiry - 86400 * 1);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      let balanceBefore = await minter.getBalance();
      await expect(vault.connect(minter).ethBurn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.100665258748851474"), parseEther("87.100665258748851541"));
      let balanceAfter = await minter.getBalance();
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("79"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.100665258748851474"), parseEther("11.999999999999999933"));
      expect(await vault.totalFee()).to.equal(parseEther("0.899334741251148526"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100001.999999999999999933"));
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
      let makerBalanceThreshold = parseEther("100000");
      await time.increaseTo(expiry - 86400 * 3);
      let deadline = await time.latest() + 600;

      const { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPricesA, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      makerBalanceThreshold = parseEther("99990");
      const { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain)

      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await time.increaseTo(expiry);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      let balanceBefore = await minter.getBalance();
      await vault.connect(minter).ethBurnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:0 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:0 }
      ]);
      await vault.connect(maker).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
      ]);
      let balanceAfter = await minter.getBalance();
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("179.6"));
      expect(await vault.totalFee()).to.equal(parseEther("1.918669485066994473"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99991.999999999999999933"));
    });

    it("should batch burn tokens if knock-out", async function () {
      // batch burn tokens
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 7;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("30000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      let makerBalanceThreshold = parseEther("100000");
      await time.increaseTo(expiry - 86400 * 3);
      let deadline = await time.latest() + 600;

      const { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPricesA, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      makerBalanceThreshold = parseEther("99990");
      const { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain)

      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await time.increaseTo(expiry - 86400 * 1);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      let balanceBefore = await minter.getBalance();
      await vault.connect(minter).ethBurnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:0 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:0 }
      ]);
      await vault.connect(maker).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
      ]);
      let balanceAfter = await minter.getBalance();
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("159"));
      expect(await vault.totalFee()).to.equal(parseEther("1.798669485066994474"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100003.999999999999999842"));
    });
  });
});
