// test/LeverageDNTVaultTest.ts
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

describe("LeverageDNTVault", function () {
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
      parseEther("0.2"),
      parseEther("0.1"),
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
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 368;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("101");
      const makerCollateral = parseEther("10");
      await time.increaseTo(expiry - 86400 * 365);
      const deadline = await time.latest() + 600;
      let minterNonce = 0;
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: invalid collateral at risk");
      collateralAtRisk = parseEther("12");
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);
      minterNonce = 1;
      await expect(mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      // Perform assertions
      const term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("71.051429226656442701"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("71.051429226656442701"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
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
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("71.051428899042500387"), parseEther("59.051428899042500418"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("71.051428899042500387"), parseEther("11.999999999999999969"));
      expect(await vault.totalFee()).to.equal(parseEther("28.948571100957499613"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99969.051428899042500418"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100001.999999999999999969"));

      // invalid nonce
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 368;
      await time.increaseTo(expiry - 86400 * 365);
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
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("71.051429226656442701"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("71.051429226656442701"));
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("71.051429226656442701"), parseEther("70.931429226656442702"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("71.051429226656442701"), 0);
      expect(await vault.totalFee()).to.equal(parseEther("58.017141874301056911"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99949.982858125698943120"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99991.999999999999999969"));

      // withdraw fee
      const feeCollector = await vault.feeCollector();
      await expect(vault.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("58.017141874301056911"));
    });

    it("should burn tokens if knock-out", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 368;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      await time.increaseTo(expiry - 86400 * 365);
      let deadline = await time.latest() + 600;
      let minterNonce = 0;

      let { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let term = (expiry - (Math.ceil((await time.latest() - 28800) / 86400) * 86400 + 28800)) / 86400;
      let minterProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256", "uint256[2]", "uint256", "uint256"], [term, expiry, anchorPrices, collateralAtRiskPercentage, 1]);

      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not burnable");
      await time.increaseTo(expiry - 86400 * 1);
      await aggregator.setLatestResponse("0x00000000000000000000000000000000000000000000065a4da25d3016c000000000000000000000000000000000000000000000000006c6b935b8bbd4000000");
      await oracle.settle();
      await expect(vault.connect(minter).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("71.051428899042500387"), parseEther("59.051428899042500418"));
      await expect(vault.connect(maker).burn(term, expiry, anchorPrices, collateralAtRiskPercentage, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("71.051428899042500387"), parseEther("11.999999999999999969"));
      expect(await vault.totalFee()).to.equal(parseEther("28.948571100957499613"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99969.051428899042500418"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100001.999999999999999969"));
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
      let minterNonce = 0;

      let { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPricesA, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

      minterNonce = 1;
      let { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, minterNonce, collateral, vault, minter, maker, referral, eip721Domain);

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
      expect(await vault.totalFee()).to.equal(parseEther("58.017141874301056911"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99949.982858125698943120"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99991.999999999999999969"));
    });

    it("should batch burn tokens if knock-out", async function () {
      // batch burn tokens
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400 * 368;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("32000")];
      let collateralAtRisk = parseEther("12");
      const makerCollateral = parseEther("10");
      await time.increaseTo(expiry - 86400 * 365);
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
      expect(await vault.totalFee()).to.equal(parseEther("57.897141874301056912"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99938.102858125698943150"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100003.999999999999999938"));
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

  describe("Upgrade Proxy", function () {
    it("should upgrade the proxy", async function () {
      const VaultV2 = await ethers.getContractFactory("LeverageDNTVault");
      await upgrades.upgradeProxy(vault.address, VaultV2);
    });
  });
});
