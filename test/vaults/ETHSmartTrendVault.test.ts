// test/ETHSmartTrendVaultTest.ts
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PERMIT2_ADDRESS,
  expect,
  constants,
  deployFixture,
  ethMint as mint,
  ethMintBatch as mintBatch,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack
} from "../helpers/helpers";

describe("ETHSmartTrendVault", function () {
  let weth, collateral, feeCollector, oracle, minter, maker, referral, vault, eip721Domain, aggregator;
  beforeEach(async function () {
    ({
      weth,
      spotAggregator: aggregator,
      feeCollector,
      spotOracle:oracle,
      minter,
      maker,
      referral
    } = await loadFixture(deployFixture));
    collateral = weth;
    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("SmartBear");
    const strategy = await Strategy.deploy();

    // Deploy SmartTrendVault contract
    const Vault = await ethers.getContractFactory("SmartTrendVault");
    vault = await upgrades.deployProxy(Vault, [
      "Sofa ETH",
      "sfETH",
      PERMIT2_ADDRESS, // Mock permit contract
      strategy.address, // Mock strategy contract
      weth.address, // Mock weth contract
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
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max
  });

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const makerBalanceThreshold = parseEther("100000");
      const deadline = await time.latest() + 600;
      const balanceBefore = await ethers.provider.getBalance(minter.address);
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceBefore.sub(balanceAfter)).to.above(parseEther("90"));
      await expect(mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: invalid balance threshold");
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.1"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.1"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
  });

  describe("MintBatch", function () {
    it("should batch mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const balanceBefore = await ethers.provider.getBalance(minter.address);
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, makerBalanceThreshold: parseEther("100000"), deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, makerBalanceThreshold: parseEther("100000"), deadline: deadline, maker: maker }
      ], vault, minter, referral, eip721Domain)).to.be.revertedWith("Vault: invalid balance threshold");

      await mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, makerBalanceThreshold: parseEther("100000"), deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrices: anchorPrices, makerCollateral: makerCollateral, makerBalanceThreshold: parseEther("99990"), deadline: deadline, maker: maker }
      ], vault, minter, referral, eip721Domain);
      const balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceBefore.sub(balanceAfter)).to.above(parseEther("180"));
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.1").mul(2));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.1").mul(2));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("200"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99980"));
    });
  });

  describe("Burn", function () {
    it("should burn tokens", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      let makerBalanceThreshold = parseEther("100000");
      let deadline = await time.latest() + 600;

      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      // Call burn function
      await expect(vault.ethBurn(expiry, anchorPrices, 0)).to.be.reverted;

      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, 0)).to.be.revertedWith("Vault: not expired");
      await time.increaseTo(expiry);
      await oracle.settle();
      // Add your assertions here
      // Call burn function
      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.1"), 0);
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.1"), parseEther("99.1"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("0.9"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100089.1"));

      // invalid nonce
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;

      // strike case
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      makerBalanceThreshold = parseEther("99990");
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("32000"));
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.1"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.1"));
      const balanceBefore = await ethers.provider.getBalance(minter.address);
      await expect(vault.connect(minter).ethBurn(expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.1"), parseEther("16.351500000000000001"));
      const balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("16"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.1"), parseEther("82.583333333333333333"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1.965166666666666666"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100161.683333333333333333"));

      // withdraw fee
      const feeCollector = await vault.feeCollector();
      await expect(vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("1.965166666666666666"));
    });
  });

  describe("BurnBatch", function () {
    it("should batch burn tokens", async function () {
      // batch burn tokens
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("33000")];
      const makerCollateral = parseEther("10");
      let makerBalanceThreshold = parseEther("100000");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      await mint(totalCollateral, expiry, anchorPricesA, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      makerBalanceThreshold = parseEther("99990")
      await mint(totalCollateral, expiry, anchorPricesB, makerCollateral, makerBalanceThreshold, deadline, collateral, vault, minter, maker, referral, eip721Domain)

      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("32000"));
      await oracle.settle();
      const balanceBefore = await ethers.provider.getBalance(minter.address);
      await vault.connect(minter).ethBurnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, isMaker:0 },
        { expiry:expiry, anchorPrices:anchorPricesB, isMaker:0 }
      ]);
      const balanceAfter = await ethers.provider.getBalance(minter.address);
      expect(balanceAfter.sub(balanceBefore)).to.above(parseEther("16"));
      await vault.connect(maker).burnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, isMaker:1 },
        { expiry:expiry, anchorPrices:anchorPricesB, isMaker:1 }
      ]);

      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("1.965166666666666666"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100161.683333333333333333"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
  });
});
