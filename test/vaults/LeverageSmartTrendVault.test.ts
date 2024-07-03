// test/LeverageSmartTrendVaultTest.ts
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PERMIT2_ADDRESS,
  expect,
  constants,
  deployFixture,
  leverageMint as mint,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack
} from "../helpers/helpers";

describe("LeverageSmartTrendVault", function () {
  let weth, collateral, feeCollector, oracle, minter, maker, referral, vault, eip721Domain, aggregator, atoken, aavePool;
  beforeEach(async function () {
    ({
      weth,
      collateral,
      spotAggregator: aggregator,
      feeCollector,
      spotOracle: oracle,
      minter,
      maker,
      referral,
      atoken,
      aavePool
    } = await loadFixture(deployFixture));
    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("SmartBull");
    const strategy = await Strategy.deploy();

    // Deploy LeverageSmartTrendVault contract
    const Vault = await ethers.getContractFactory("LeverageSmartTrendVault");
    vault = await upgrades.deployProxy(Vault, [
      "Sofa ETH",
      "sfETH",
      strategy.address, // Mock strategy contract
      weth.address, // Mock weth contract
      collateral.address,
      aavePool.address,
      feeCollector.address,
      parseEther("0.2"),
      parseEther("0.1"),
      9,
      oracle.address
    ]);

    eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    await collateral.connect(minter).approve(vault.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max
  });

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 368;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("101");
      const makerCollateral = parseEther("10");
      await time.increaseTo(expiry - 86400 * 365);
      const deadline = await time.latest() + 600;
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: invalid collateral at risk");
      collateralAtRisk = parseEther("12");
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("71.071429226656442701"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("71.071429226656442701"));
      expect(await atoken.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
    });
  });

  describe("Burn", function () {
    it("should burn tokens", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 368;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      await time.increaseTo(expiry - 86400 * 365);
      let deadline = await time.latest() + 600;

      let { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      // Call burn function
      await expect(vault.burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.reverted;

      await expect(vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not expired");
      await time.increaseTo(expiry);
      await oracle.settle();
      // Add your assertions here
      // Call burn function
      await expect(vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("71.071428899042500387"), parseEther("71.071428899042500387"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("71.071428899042500387"), 0);
      expect(await vault.totalFee()).to.equal(parseEther("28.928571100957499613"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99981.071428899042500387"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));

      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 368;
      await time.increaseTo(expiry - 86400 * 365);
      deadline = await time.latest() + 600;

      // strike case
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      ({ collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain));
      await time.increaseTo(expiry);
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("71.071428899042500387"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("71.071428899042500387"));
      await expect(vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("71.071428899042500387"), parseEther("65.071428899042500404"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("71.071428899042500387"), parseEther("5.999999999999999983"));
      expect(await vault.totalFee()).to.equal(parseEther("57.857142201914999226"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99956.142857798085000791"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99985.999999999999999983"));

      // withdraw fee
      const feeCollector = await vault.feeCollector();
      await expect(vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("57.857142201914999226"));
    });
  });

  describe("BurnBatch", function () {
    it("should batch burn tokens", async function () {
      // batch burn tokens
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 368;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("33000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      await time.increaseTo(expiry - 86400 * 365);
      let deadline = await time.latest() + 600;

      let { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPricesA, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      let { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

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

      expect(await vault.totalFee()).to.equal(parseEther("57.857141874301056912"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99985.999999999999999993"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99956.142858125698943095"));
    });
  });

  describe("Decimals", function () {
    it("should equal collateral decimals", async function () {
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });
  });

  describe("BorrowAPR", function () {
    it("should update borrowAPR successfully", async function () {
      await vault.updateBorrowAPR(parseEther("0.1"));
      expect(await vault.borrowAPR()).to.equal(parseEther("0.1"));
    });

    it("should revert if not owner", async function () {
      await expect(vault.connect(minter).updateBorrowAPR(parseEther("0.1"))).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("SpreadAPR", function () {
    it("should update spreadAPR successfully", async function () {
      await vault.updateSpreadAPR(parseEther("0.1"));
      expect(await vault.spreadAPR()).to.equal(parseEther("0.1"));
    });

    it("should revert if not owner", async function () {
      await expect(vault.connect(minter).updateSpreadAPR(parseEther("0.1"))).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // describe("Upgrade Proxy", function () {
  //   it("should upgrade the proxy", async function () {
  //     const VaultV2 = await ethers.getContractFactory("LeverageSmartTrendVault");
  //     await upgrades.upgradeProxy(vault.address, VaultV2);
  //   });
  // });
});
