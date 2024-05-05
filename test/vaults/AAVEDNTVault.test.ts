// test/AAVEDNTVaultTest.ts
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PERMIT2_ADDRESS,
  expect,
  constants,
  deployFixture,
  mintWithCollateralAtRisk as mint,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack
} from "../helpers/helpers";

describe("AAVEDNTVault", function () {
  let weth, collateral, feeCollector, oracle, minter, maker, referral, vault, eip721Domain, aggregator, atoken, aavePool;
  beforeEach(async function () {
    ({
      weth,
      collateral,
      hlAggregator: aggregator,
      feeCollector,
      hlOracle: oracle,
      minter,
      maker,
      referral,
      atoken,
      aavePool,
    } = await loadFixture(deployFixture));
    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("DNT");
    const strategy = await Strategy.deploy();
    const Vault = await ethers.getContractFactory("AAVEDNTVault");
    vault = await upgrades.deployProxy(Vault, [
      "Sofa ETH",
      "sfETH",
      PERMIT2_ADDRESS, // Mock permit contract
      strategy.address, // Mock strategy contract
      weth.address, // Mock weth contract
      collateral.address,
      aavePool.address,
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
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("101");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      let minterNonce = 0;
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: invalid collateral");
      collateralAtRisk = parseEther("20");
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      minterNonce = 1;
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      // Perform assertions
      const term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.9"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.9"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("0"));
      expect(await collateral.balanceOf(aavePool.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
    });

    it("should mint tokens with correct share", async function () {
      let totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("20");
      let makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      let minterNonce = 0;
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      await collateral.connect(minter).approve(aavePool.address, parseEther("10000"));
      await aavePool.connect(minter).supply(collateral.address, parseEther("10000"), vault.address, 0);
      expect(await atoken.balanceOf(vault.address)).to.equal(parseEther("10100"));

      totalCollateral = parseEther("10");
      collateralAtRisk = parseEther("2");
      makerCollateral = parseEther("1");
      minterNonce = 1;
      await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      // Perform assertions
      const term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.998910891089108910"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.998910891089108910"));
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
      let minterNonce = 0;

      let { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      // Call burn function
      await expect(vault.burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.reverted;

      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not burnable");
      await time.increaseTo(expiry);
      // Add your assertions here
      // Call burn function
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not settled");
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.9"), parseEther("79.90000000000000002"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.9"), parseEther("19.99999999999999998"));
      expect(await vault.totalFee()).to.equal(parseEther("0.1"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99989.90000000000000002"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100009.99999999999999998"));

      // invalid nonce
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.reverted;

      // strike case
      minterNonce = 1;
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      ({ collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain));
      await time.increaseTo(expiry);
      await expect(oracle.settle()).to.be.revertedWith("Oracle: not updated");
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("99.9"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("99.9"));
      await oracle.settle();
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.9"), parseEther("99.700000000000000001"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.9"), 0);
      expect(await vault.totalFee()).to.equal(parseEther("0.399999999999999999"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99999.600000000000000021"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99999.99999999999999998"));

      // withdraw fee
      const feeCollector = await vault.feeCollector();
      await expect(vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("0.399999999999999999"));
    });

    it("should burn tokens if knock-out", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 2;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("20");
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);

      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not burnable");
      await time.increaseTo(expiry - 86400 * 1);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("99.9"), parseEther("79.90000000000000002"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("99.9"), parseEther("19.99999999999999998"));
      expect(await vault.totalFee()).to.equal(parseEther("0.1"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99989.90000000000000002"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100009.99999999999999998"));
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
      let minterNonce = 0;

      const { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPricesA, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      minterNonce = 1;
      const { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await time.increaseTo(expiry);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await vault.connect(minter).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:0 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:0 }
      ]);
      await vault.connect(maker).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
      ]);
      expect(await vault.totalFee()).to.equal(parseEther("0.399999999999999999"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99999.600000000000000021"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99999.99999999999999998"));
    });

    it("should batch burn tokens if knock-out", async function () {
      // batch burn tokens
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("32000")];
      let collateralAtRisk = parseEther("20");
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      const { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPricesA, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      minterNonce = 1;
      const { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      await time.increaseTo(expiry);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await vault.connect(minter).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:0 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:0 }
      ]);
      await vault.connect(maker).burnBatch([
        { term:term, expiry:expiry, anchorPrices:anchorPricesA, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
        { term:term, expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
      ]);
      expect(await vault.totalFee()).to.equal(parseEther("0.2"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99979.80000000000000004"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100019.99999999999999996"));
    });
  });

  describe("Settle", function () {
    it("should settle the price", async function () {
      // Call settle function
      await expect(oracle.settle()).emit(oracle, "Settled");
    });
  });

  describe("Decimals", function () {
    it("should equal collateral decimals", async function () {
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });
  });

  describe("Upgrade Proxy", function () {
    it("should upgrade the proxy", async function () {
      const VaultV2 = await ethers.getContractFactory("AAVEDNTVault");
      await upgrades.upgradeProxy(vault.address, VaultV2);
    });
  });
});
