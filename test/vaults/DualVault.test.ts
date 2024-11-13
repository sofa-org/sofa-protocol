// test/DualVaultTest.ts
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { beforeEach } from "mocha";
import {
  expect,
  constants,
  deployFixture,
  dualMint as mint,
  dualMintBatch as mintBatch,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack
} from "../helpers/helpers";

describe("DualTrendVault", function () {
  let weth, collateral, minter, maker, referral, vault, eip721Domain, aggregator;
  beforeEach(async function () {
    ({
      weth,
      collateral,
      minter,
      maker,
      referral
    } = await loadFixture(deployFixture));

    // Deploy SmartTrendVault contract
    const Vault = await ethers.getContractFactory("DualVault");
    vault = await upgrades.deployProxy(Vault, [
      "Reliable USDT",
      "rUSDT",
      collateral.address,
      weth.address
    ]);
    eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    await collateral.connect(minter).approve(vault.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max
    await weth.connect(maker).approve(vault.address, constants.MaxUint256); // approve max
  });

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await expect(mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("100"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
    });
  });

  describe("MintBatch", function () {
    it("should batch mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker }
      ], vault, minter, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      await mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline + 1, maker: maker }
      ], vault, minter, referral, eip721Domain);
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("100").mul(2));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100").mul(2));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("200"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99980"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99820"));
    });
  });

  describe("Quote", function () {
    let expiry, anchorPrice;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
    });
    it("should quote tokens", async function () {
      const amount = parseEther("100");
      await expect(vault.connect(maker).quote(amount, {expiry: expiry, anchorPrice: anchorPrice})).to.emit(vault, "Quoted").withArgs(maker.address, solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]), amount, amount.div(100));
      expect(await collateral.balanceOf(vault.address)).to.equal(0);
      expect(await weth.balanceOf(vault.address)).to.equal(parseEther("1"));
    });
  });
  describe("QuoteBatch", function () {
    let expiry, anchorPriceA, anchorPriceB;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPriceA = parseEther("0.01").div(1e10);
      anchorPriceB = parseEther("0.02").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPriceA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPriceB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
    });
    it("should batch quote tokens", async function () {
      const amount = parseEther("100");
      await vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      );
      expect(await collateral.balanceOf(vault.address)).to.equal(amount.div(2));
      expect(await weth.balanceOf(vault.address)).to.equal(parseEther("2"));
    });
  });

  describe("Burn", function () {
    let expiry, anchorPriceA, anchorPriceB;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPriceA = parseEther("0.01").div(1e10);
      anchorPriceB = parseEther("0.02").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPriceA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPriceB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const amount = totalCollateral;
      await vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      );
    });

    it("should burn tokens", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await expect(vault.connect(minter).burn(expiry, anchorPriceA)).to.emit(vault, "Burned").withArgs(minter.address, solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceA, 0]), parseEther("100"), 0, parseEther("1"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99820"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100001"));
    });
  });

  describe("BurnBatch", function () {
    let expiry, anchorPriceA, anchorPriceB;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPriceA = parseEther("0.01").div(1e10);
      anchorPriceB = parseEther("0.02").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPriceA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPriceB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      const amount = totalCollateral;
      await vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      );
    });

    it("should batch burn tokens", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
      ]);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99870"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100002"));
    });
  });
});
