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
  let weth, collateral, feeCollector, minter, maker, referral, vault, eip721Domain, aggregator;
  beforeEach(async function () {
    ({
      weth,
      collateral,
      feeCollector,
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
      weth.address,
      feeCollector.address
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
  
  describe ("Initialize", function () {
    it("should revert if initialize twice", async function () {
      await expect(vault.initialize("Reliable USDT", "rUSDT", collateral.address, weth.address, feeCollector.address))
        .to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe ("Decimals", function () {
    it("should get deciamls", async function () {
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });
  });
  
  describe("Mint", function () {
    it("should mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await expect(mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain))
        .to.be.revertedWith("Vault: signature consumed");
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], 
        [expiry, anchorPrice, makerCollateral.mul(parseEther("1")).div(totalCollateral)]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]);
      const productId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 0]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("100"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
      expect(await vault.totalPositions(productId)).to.equal(parseEther("100"));
    });
    it("should revert if past deadline", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest(); //change
      await expect(mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain))
        .to.be.revertedWith("Vault: deadline");
    });
    it("should revert if past expiry", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.floor(await time.latest() / 86400) * 86400; //change
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await expect(mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain))
        .to.be.revertedWith("Vault: expired");
    });
    it("should revert if referral is the msg sender", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const ref = minter;  //change
      await expect(mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, minter, maker, ref, eip721Domain))
        .to.be.revertedWith("Vault: invalid referral");
    });
    it("should revert if signature is not correct", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const makerSignature = "0xcdb04297964494ec823e0d3c1ced98999b20ad4fb8d6eaaa21b35628af36f98329a277ad6f3b4251b0f2c01ed2dfad619959d05ea27d9cc88c7de97b1ce002c71d";
      maker = maker.address;
      await expect(vault.connect(minter).mint(
        totalCollateral, 
        {expiry, anchorPrice, makerCollateral, deadline, maker, makerSignature},
        referral.address))
        .to.be.revertedWith("Vault: invalid maker signature");
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
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], 
        [expiry, anchorPrice, makerCollateral.mul(parseEther("1")).div(totalCollateral)]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("100").mul(2));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100").mul(2));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("200"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99980"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99820"));
    });
    it("should revert if input arrays length mismatch", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      maker = maker.address;
      const makerSignature = "0xcdb04297964494ec823e0d3c1ced98999b20ad4fb8d6eaaa21b35628af36f98329a277ad6f3b4251b0f2c01ed2dfad619959d05ea27d9cc88c7de97b1ce002c71c";
      const paramsArray = [{expiry, anchorPrice, makerCollateral, deadline, maker, makerSignature}];
      await expect(vault.mintBatch(
        [totalCollateral, totalCollateral],
        paramsArray,
        referral.address)).to.be.revertedWith("Vault: invalid params length");
    });
    it("should revert if past deadline", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest(); //change
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline + 1, maker: maker }
      ], vault, minter, referral, eip721Domain)).to.be.revertedWith("Vault: deadline");
    });
    it("should revert if past expiry", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.floor(await time.latest() / 86400) * 86400 ; //change
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline + 1, maker: maker }
      ], vault, minter, referral, eip721Domain)).to.be.revertedWith("Vault: expired");
    });
    it("should revert if referral is the msg sender", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await expect(mintBatch([
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline, maker: maker },
        { totalCollateral: totalCollateral, expiry: expiry, anchorPrice: anchorPrice, makerCollateral: makerCollateral, deadline: deadline + 1, maker: maker }
      ], vault, minter, minter, eip721Domain)).to.be.revertedWith("Vault: invalid referral");
    });
    it("should revert if signature is not correct", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.floor(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const makerSignature = "0xcdb04297964494ec823e0d3c1ced98999b20ad4fb8d6eaaa21b35628af36f98329a277ad6f3b4251b0f2c01ed2dfad619959d05ea27d9cc88c7de97b1ce002c71d";
      maker = maker.address;
      await expect(vault.connect(minter).mintBatch([totalCollateral], 
        [{expiry, anchorPrice, makerCollateral, deadline, maker, makerSignature}], referral.address))
        .to.be.revertedWith("Vault: invalid maker signature");
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
      expect(await vault.quotePositions(solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]))).to.equal(amount);
    });
    it("should revert if past expiry + 2 hours", async function () {
      const amount = parseEther("100");
      await time.increaseTo(expiry + 2 * 3600);
      await expect(vault.connect(maker).quote(amount, {expiry: expiry, anchorPrice: anchorPrice}))
        .to.be.revertedWith("Vault: expired");
    });
    it("should revert if maker balance insufficient", async function () {
      const amount = parseEther("100").add(1);
      await expect(vault.connect(maker).quote(amount, {expiry: expiry, anchorPrice: anchorPrice}))
        .to.be.revertedWith("Vault: insufficient balance");
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
    it("should revert if input arrays length mismatch", async function () {
      const amount = parseEther("100");
      await expect(vault.connect(maker).quoteBatch(
        [amount],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      )).to.be.revertedWith("Vault: invalid length");
    });
    it("should revert if past expiry + 2 hours", async function () {
      const amount = parseEther("100");
      await time.increaseTo(expiry + 2 * 3600);
      await expect(vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      )).to.be.revertedWith("Vault: expired");
    });
    it("should revert if maker balance insufficient", async function () {
      const amount = parseEther("100").add(1);
      await expect(vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      )).to.be.revertedWith("Vault: insufficient balance");
    });
  });
  
  describe("Burn", function () {
    let expiry, anchorPriceA, anchorPriceB, anchorPriceC, premiumPercentage;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPriceA = parseEther("0.01").div(1e10);
      anchorPriceB = parseEther("0.02").div(1e10);
      anchorPriceC = parseEther("0.03").div(1e10);
      const makerCollateral = parseEther("10");
      premiumPercentage = makerCollateral.mul(parseEther("1")).div(totalCollateral);
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPriceA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);//quote all
      await mint(totalCollateral, expiry, anchorPriceB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);//quote half
      await mint(totalCollateral, expiry, anchorPriceC, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);//quote 0
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
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceA, premiumPercentage]);
      const quoteFee = parseEther("1").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      await expect(vault.connect(minter).burn(expiry, anchorPriceA, premiumPercentage)).to.emit(vault, "Burned")
        .withArgs(minter.address, minterProductId, parseEther("100"), 0, parseEther("1").sub(quoteFee), 0, quoteFee);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99730"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100001").sub(quoteFee));
    });
    it("should burn tokens if not quote all", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, premiumPercentage]);
      const fee = parseEther("50").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      const quoteFee = parseEther("1").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      await expect(vault.connect(minter).burn(expiry, anchorPriceB, premiumPercentage)).to.emit(vault, "Burned")
        .withArgs(minter.address, minterProductId, parseEther("100"), parseEther("50").sub(fee), parseEther("1").sub(quoteFee), fee, quoteFee);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99780").sub(fee));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100001").sub(quoteFee));
    });
    it("should burn tokens if no quote", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceC, premiumPercentage]);
      const fee = parseEther("100").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      await expect(vault.connect(minter).burn(expiry, anchorPriceC, premiumPercentage)).to.emit(vault, "Burned")
        .withArgs(minter.address, minterProductId, parseEther("100"), parseEther("100").sub(fee), 0, fee, 0);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99830").sub(fee));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
    it("should revert if not past expiry + 2 hours", async function () {
      //await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, premiumPercentage]);
      await expect(vault.connect(minter).burn(expiry, anchorPriceA, premiumPercentage))
        .to.be.revertedWith("Vault: not expired");
    });
    it("should revert if balance == 0", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, premiumPercentage]);
      await expect(vault.connect(maker).burn(expiry, anchorPriceA, premiumPercentage))
        .to.be.revertedWith("Vault: zero amount");
    });
  });

  describe("BurnBatch", function () {
    let expiry, anchorPriceA, anchorPriceB, anchorPriceC, premiumPercentage;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPriceA = parseEther("0.01").div(1e10);
      anchorPriceB = parseEther("0.02").div(1e10);
      anchorPriceC = parseEther("0.03").div(1e10);
      const makerCollateral = parseEther("10");
      premiumPercentage = makerCollateral.mul(parseEther("1")).div(totalCollateral);
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPriceA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPriceB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPriceC, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
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
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceB, premiumPercentage: premiumPercentage}
      ]);
      const fee = parseEther("50").div(10).div(100); //premiumPercentage 10%, feerate: 1%
      const quoteFee = parseEther("1").mul(2).div(10).div(100);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99780").sub(fee));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100002").sub(quoteFee));
    });
    it("should batch burn tokens if quote all", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage}
      ]);
      const quoteFee = parseEther("1").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99730"));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100001").sub(quoteFee));
    });
    it("should batch burn tokens if no quote", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceC, premiumPercentage: premiumPercentage}
      ]);
      const fee = parseEther("100").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99830").sub(fee));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100000"));
    });
    it("should batch burn tokens with different quotes", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceB, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceC, premiumPercentage: premiumPercentage}
      ]);
      const fee = parseEther("150").div(10).div(100); //premiumPercentage 10%, feerate: 1%
      const quoteFee = parseEther("1").mul(2).div(10).div(100);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99880").sub(fee));
      expect(await weth.balanceOf(minter.address)).to.equal(parseEther("100002").sub(quoteFee));
    });
    it("should revert if balance == 0", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await expect (vault.connect(maker).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceB, premiumPercentage: premiumPercentage}
      ])).to.be.revertedWith("Vault: zero amount");
    });
    it("should revert if not past expiry + 2 hours", async function () {
      //await time.increaseTo(expiry + 2 * 3600);
      await expect (vault.connect(minter).burnBatch([
          {expiry: expiry, anchorPrice: anchorPriceA, premiumPercentage: premiumPercentage},
          {expiry: expiry, anchorPrice: anchorPriceB, premiumPercentage: premiumPercentage}
      ])).to.be.revertedWith("Vault: not expired");
    });
  });

  describe("Harvest", function () {
    let expiry, anchorPriceA, anchorPriceB, anchorPriceC, premiumPercentage;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPriceA = parseEther("0.01").div(1e10);
      anchorPriceB = parseEther("0.02").div(1e10);
      anchorPriceC = parseEther("0.03").div(1e10);
      const makerCollateral = parseEther("10");
      premiumPercentage = makerCollateral.mul(parseEther("1")).div(totalCollateral);
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPriceA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);//quote all
      await mint(totalCollateral, expiry, anchorPriceB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);//quote half
      await mint(totalCollateral, expiry, anchorPriceC, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);//quote 0
      const amount = totalCollateral;
      await vault.connect(maker).quoteBatch(
        [amount, amount.div(2)],
        [
          {expiry: expiry, anchorPrice: anchorPriceA},
          {expiry: expiry, anchorPrice: anchorPriceB}
        ]
      );
    });

    it("should collect quote fee", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceA, premiumPercentage]);
      const quoteFee = parseEther("1").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      await vault.connect(minter).burn(expiry, anchorPriceA, premiumPercentage);
      expect(await vault.totalQuoteFee()).to.equal(quoteFee);
      await expect(vault.connect(minter).harvest())
        .to.changeTokenBalances(weth, [feeCollector, vault], [quoteFee, quoteFee.mul(-1)]);
      expect(await vault.totalQuoteFee()).to.equal(0);
    });
    it("should collect fee", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceC, premiumPercentage]);
      const fee = parseEther("100").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      await vault.connect(minter).burn(expiry, anchorPriceC, premiumPercentage);
      expect(await vault.totalFee()).to.equal(fee);
      await expect(vault.connect(minter).harvest())
        .to.changeTokenBalances(collateral, [feeCollector, vault], [fee, fee.mul(-1)]);
      expect(await vault.totalFee()).to.equal(0);
    });
    it("should collect both quote fee and fee", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, premiumPercentage]);
      const fee = parseEther("50").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      const quoteFee = parseEther("1").div(10).div(100);  //premiumPercentage 10%, feerate: 1%
      await vault.connect(minter).burn(expiry, anchorPriceB, premiumPercentage);
      expect(await vault.totalQuoteFee()).to.equal(quoteFee);
      expect(await vault.totalFee()).to.equal(fee);
      await expect(vault.connect(minter).harvest())
        .to.changeTokenBalances(collateral, [feeCollector, vault], [fee, fee.mul(-1)]);
      expect(await weth.balanceOf(feeCollector.address)).to.equal(quoteFee);
      expect(await vault.totalQuoteFee()).to.equal(0);
      expect(await vault.totalFee()).to.equal(0);
    });
    it("should revert if both fees are 0", async function () {
      //await time.increaseTo(expiry + 2 * 3600);
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPriceB, premiumPercentage]);
      await expect(vault.connect(minter).harvest())
        .to.be.revertedWith("Vault: zero fee");
    });
  });

  describe("Application", function () {
    let expiry, anchorPrice, userA, userB, premiumPercentage;
    beforeEach(async function () {
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      premiumPercentage = makerCollateral.mul(parseEther("1")).div(totalCollateral);
      const deadline = await time.latest() + 600;
      userA = minter;
      userB = maker;
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, userA, maker, referral, eip721Domain);
      await mint(totalCollateral, expiry, anchorPrice, makerCollateral, deadline, collateral, vault, userB, maker, referral, eip721Domain);
      const amount = totalCollateral;
      await vault.connect(maker).quoteBatch(
        [amount], //half of the totalPositions
        [
          {expiry: expiry, anchorPrice: anchorPrice}
        ]
      );
    });

    it("two users with the same product ID", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      const fee = parseEther("100").div(10).div(100).div(2);  //premiumPercentage 10%, feerate: 1%
      const quoteFee = parseEther("1").div(10).div(100).div(2);
      await expect(vault.connect(userA).burn(expiry, anchorPrice, premiumPercentage))
        .to.changeTokenBalances(collateral, [userA, vault], [parseEther("50").sub(fee), parseEther("50").sub(fee).mul(-1)]);
      expect(await weth.balanceOf(userA.address)).to.equal(parseEther("100000.5").sub(quoteFee));
      await expect(vault.connect(userB).burn(expiry, anchorPrice, premiumPercentage))
        .to.changeTokenBalances(collateral, [userB, vault], [parseEther("50").sub(fee), parseEther("50").sub(fee).mul(-1)]);
      expect(await weth.balanceOf(userB.address)).to.equal(parseEther("99999.5").sub(quoteFee));
    });
    it("balances after burn", async function () {
      await time.increaseTo(expiry + 2 * 3600);
      await vault.connect(userA).burn(expiry, anchorPrice, premiumPercentage);
      await vault.connect(userB).burn(expiry, anchorPrice, premiumPercentage);
      //1155
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, premiumPercentage]);
      const makerProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 1]);
      const productId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiry, anchorPrice, 0]);
      expect(await vault.balanceOf(userA.address, minterProductId)).to.equal(0);
      expect(await vault.balanceOf(userB.address, minterProductId)).to.equal(0);
      expect(await vault.balanceOf(userA.address, makerProductId)).to.equal(0);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100"));
      //status variables
      expect(await vault.totalPositions(productId)).to.equal(parseEther("200"));
      expect(await vault.quotePositions(makerProductId)).to.equal(parseEther("100"));
    });
  });

  describe("Issue", function () {
    let expiry, expiryB, anchorPrice, userA, userB, premiumPercentageB;
    beforeEach(async function () {
      const totalCollateralB = parseEther("99");
      expiryB = Math.ceil(await time.latest() / 86400) * 86400 * 2 + 28800;
      anchorPrice = parseEther("0.01").div(1e10);
      const makerCollateral = parseEther("10");
      premiumPercentageB = makerCollateral.mul(parseEther("1")).div(totalCollateralB);
      const deadline = await time.latest() + 600;
      userA = minter;
      userB = maker;
      await mint(totalCollateralB, expiryB, anchorPrice, makerCollateral, deadline, collateral, vault, userA, maker, referral, eip721Domain);
    });

    it("decimals precision", async function () {
      const quoteAmount = parseEther("20");
      const transferAmount = parseEther("10");
      const check1 = parseEther("70.948464442403836344");
      const check2 = parseEther("7.971737577798183858");
      const fee = parseEther("0.079797979797979797");
      const minterProductId = solidityKeccak256(["uint256", "uint256", "uint256"], [expiryB, anchorPrice, premiumPercentageB]);
      await vault.connect(maker).quote(quoteAmount, {expiry: expiryB, anchorPrice: anchorPrice});
      await vault.connect(userA).safeTransferFrom(userA.address, userB.address, minterProductId, transferAmount, '0x01');
      await time.increaseTo(expiryB + 2 * 3600);
      await expect(vault.connect(userA).burn(expiryB, anchorPrice, premiumPercentageB))
        .to.changeTokenBalances(collateral, [userA, vault], [check1, check1.mul(-1)]);
      await expect(vault.connect(userB).burn(expiryB, anchorPrice, premiumPercentageB))
        .to.changeTokenBalances(collateral, [userB, vault], [check2, check2.mul(-1)]);
      console.log("vault balance:", await collateral.balanceOf(vault.address));
      console.log("totalFee:", await vault.totalFee());
      //await expect(vault.connect(minter).harvest())
      //  .to.changeTokenBalances(collateral, [feeCollector, vault], [fee, fee.mul(-1)]);
    });
  });

});
