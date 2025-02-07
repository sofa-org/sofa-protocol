// test/SmartTrendVaultTest.ts
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  expect,
  constants,
  deployFixture,
  mintWithCollateralAtRiskWithoutPermit as mint,
  parseEther,
  solidityKeccak256,
} from "../helpers/helpers";

describe("SUSDaSmartTrendVault", function () {
  let collateral:any, feeCollector:any, strategy:any, oracle:any, minter:any, maker:any, referral:any, vault:any, eip721Domain:any, aggregator:any,
      totalCollateral:any, expiry:any, anchorPrices:any, anchorPricesB:any, collateralAtRisk:any, makerCollateral:any, deadline:any;
  beforeEach(async function () {
    ({
      spotAggregator: aggregator,
      feeCollector,
      spotOracle:oracle,
      minter,
      maker,
      referral
    } = await loadFixture(deployFixture));
    //sUSDa forking from mainnet 
    const sUSDaAddr = "0x2B66AAdE1e9C062FF411bd47C44E0Ad696d43BD9"; //mainnet real address
    const contractToken = await ethers.getContractFactory("MockERC20Mintable");
    collateral = contractToken.attach(sUSDaAddr);
    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("SmartBull");
    strategy = await Strategy.deploy();
    // Deploy SUSDaSmartTrendVault contract
    const Vault = await ethers.getContractFactory("SUSDaSmartTrendVault");
    vault = await upgrades.deployProxy(Vault, [
      "Reliable sUSDa",
      "rsUSDa",
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
    //token & approve
    const holder = await ethers.getImpersonatedSigner("0x5f92E233C47C21A9e8402ffc8FF59ccd7d036F99"); //mainnet real eoa
    collateral = collateral.connect(holder);
    await collateral.transfer(minter.address, parseEther("100000"));
    await collateral.transfer(maker.address, parseEther("100000"));
    await collateral.connect(minter).approve(vault.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256);
    //default parameters
    totalCollateral = parseEther("100");
    expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
    anchorPrices = [parseEther("28000"), parseEther("30000")];
    anchorPricesB = [parseEther("31000"), parseEther("33000")];
    collateralAtRisk = parseEther("20");
    makerCollateral = parseEther("10");
    deadline = await time.latest() + 600;
  });
  
  describe ("Initialize", function () {
    it("should revert if initialize twice", async function () {
      await expect(
        vault.initialize("Reliable sUSDa", "rsUSDa", strategy.address, collateral.address, feeCollector.address, oracle.address)
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      const amount = parseEther("99.9"); //0.1 is trading fee
      expect(collateralAtRiskPercentage).to.equal(collateralAtRisk.mul(parseEther("1")).div(amount));
      expect(await vault.totalFee()).to.equal(parseEther("0.1"));
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(amount);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(amount);
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
    });
    it("should revert if deadline is past", async function () {
      const deadline = await time.latest(); //invalid
      await expect(
        mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
             collateral, vault, minter, maker, referral, eip721Domain)
      ).to.be.revertedWith("Vault: deadline");
    });
    it("should revert if expiry is past", async function () {
      const expiry = Math.floor(await time.latest() / 86400) * 86400; //invalid
      await expect(
        mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
             collateral, vault, minter, maker, referral, eip721Domain)
      ).to.be.revertedWith("Vault: expired");
    });
    it("should revert if expiry is invalid", async function () {
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28801 //invalid
      await expect(
        mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
             collateral, vault, minter, maker, referral, eip721Domain)
      ).to.be.revertedWith("Vault: invalid expiry");
    });
    it("should revert if anchorPrices are invalid", async function () {
      const anchorPrices = [parseEther("30000"), parseEther("28000")]; //invalid
      await expect(
        mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
             collateral, vault, minter, maker, referral, eip721Domain)
      ).to.be.revertedWith("Vault: invalid strike prices");
    });
    it("should revert if signature is consumed", async function () {
      await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
                 collateral, vault, minter, maker, referral, eip721Domain);
      await expect(
        mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
             collateral, vault, minter, maker, referral, eip721Domain)
      ).to.be.revertedWith("Vault: signature consumed");
    });
    it("should revert if referral is massage sender", async function () {
      const ref = minter; //invalid
      await expect(
        mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
             collateral, vault, minter, maker, ref, eip721Domain)
      ).to.be.revertedWith("Vault: invalid referral");
    });
    it("should revert if signature is invalid", async function () {
      const makerSignature = "0xcdb04297964494ec823e0d3c1ced98999b20ad4fb8d6eaaa21b35628af36f98329a277ad6f3b4251b0f2c01ed2dfad619959d05ea27d9cc88c7de97b1ce002c71d"; //invalid
      maker = maker.address;
      await expect(
        vault.connect(minter).mint(
          totalCollateral,
          {expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, maker, makerSignature},
          referral.address)
      ).to.be.revertedWith("Vault: invalid maker signature");
    });
    it("should revert if collateralAtRisk is invalid", async function () {
      const collateralAtRisk = parseEther("101"); //invalid
      await expect(
        mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
             collateral, vault, minter, maker, referral, eip721Domain)
      ).to.be.revertedWith("Vault: invalid collateral");
    });
  });
  
  describe("Burn", function () {
    it("should burn tokens if settlePrice is above the anchorPrices", async function () {
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      await time.increaseTo(expiry);
      await oracle.settle();
      const amount = parseEther("99.9");
      const maxpayoff = amount.mul(collateralAtRiskPercentage).div(parseEther("1"));
      const norisk = amount.sub(maxpayoff);
      const settlementFee = maxpayoff.mul(parseEther("0.01")).div(parseEther("1"));
      const payoff = maxpayoff.sub(settlementFee).add(norisk);
      //maker burn
      await expect(
        vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)
      ).to.changeTokenBalances(collateral, [maker, minter, vault], [0, 0, 0]);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(0);
      //minter burn
      await expect(
        vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)
      ).to.changeTokenBalances(collateral, [maker, minter, vault], [0, payoff, payoff.mul(-1)]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(0);
      expect(await vault.totalFee()).to.equal(parseEther("0.1").add(settlementFee));
    });
    it("should burn tokens if settlePrice is between the anchorPrices", async function () {
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("32000"));
      await oracle.settle();
      const amount = parseEther("99.9");
      const maxpayoff = amount.mul(collateralAtRiskPercentage).div(parseEther("1"));
      const norisk = amount.sub(maxpayoff);
      const makerPayoff = maxpayoff.mul(parseEther("33000").sub(parseEther("32000"))).div(parseEther("33000").sub(parseEther("27000")));
      const minterPayoff = maxpayoff.sub(makerPayoff);
      const settlementFee = minterPayoff.mul(parseEther("0.01")).div(parseEther("1"));
      const payoff = minterPayoff.sub(settlementFee).add(norisk);
      //maker burn
      await expect(
        vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)
      ).to.changeTokenBalances(collateral, [maker, minter, vault], [makerPayoff, 0, makerPayoff.mul(-1)]);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(0);
      //minter burn
      await expect(
        vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)
      ).to.changeTokenBalances(collateral, [maker, minter, vault], [0, payoff, payoff.mul(-1)]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(0);
      expect(await vault.totalFee()).to.equal(parseEther("0.1").add(settlementFee));
    });
    it("should burn tokens if settlePrice is below the anchorPrices", async function () {
      anchorPrices = [parseEther("31000"), parseEther("33000")];
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      //console.log(collateralAtRiskPercentage);
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      await time.increaseTo(expiry);
      await oracle.settle();
      const amount = parseEther("99.9");
      const maxpayoff = amount.mul(collateralAtRiskPercentage).div(parseEther("1"));
      const norisk = amount.sub(maxpayoff);
      //maker burn
      await expect(
        vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)
      ).to.changeTokenBalances(collateral, [maker, minter, vault], [maxpayoff, 0, maxpayoff.mul(-1)]);
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(0);
      //minter burn
      await expect(
        vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)
      ).to.changeTokenBalances(collateral, [maker, minter, vault], [0, norisk, norisk.mul(-1)]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(0);
      expect(await vault.totalFee()).to.equal(parseEther("0.1"));
    });
    it("should emit log", async function () {
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentage, 1]);
      const amount = parseEther("99.9");
      await time.increaseTo(expiry);
      await oracle.settle();
      const maxpayoff = amount.mul(collateralAtRiskPercentage).div(parseEther("1"));
      const norisk = amount.sub(maxpayoff);
      const settlementFee = maxpayoff.mul(parseEther("0.01")).div(parseEther("1"));
      const payoff = maxpayoff.sub(settlementFee).add(norisk);
      //maker burn
      await expect(
        vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 1)
      ).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, amount, 0);  
      //minter burn
      await expect(
        vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)
      ).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, amount, payoff);
    });
    it("should revert if expiry is not past", async function () {
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      await expect(vault.burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not expired");
    });
    it("should revert if has zero amount", async function () {
      await time.increaseTo(expiry);
      await expect(vault.connect(minter).burn(expiry, anchorPrices, parseEther("0.1"), 0)).to.be.revertedWith("Vault: zero amount");
    });
    it("should revert if price is not settled", async function () {
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await expect(vault.connect(minter).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: not settled");
    });
    it("should revert if burn others' tokens", async function () {
      const { collateralAtRiskPercentage } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(vault.connect(maker).burn(expiry, anchorPrices, collateralAtRiskPercentage, 0)).to.be.revertedWith("Vault: zero amount");
    });
  });
  
  describe("BurnBatch", function () {
    it("should batch burn tokens", async function () {
      const { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const minterProductIdA = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentageA, 0]);
      const makerProductIdA = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentageA, 1]);
      const minterProductIdB = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPricesB, collateralAtRiskPercentageB, 0]);
      const makerProductIdB = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPricesB, collateralAtRiskPercentageB, 1]);
      await time.increaseTo(expiry);
      await oracle.settle();
      const amount = parseEther("99.9");
      const maxpayoff = amount.mul(collateralAtRiskPercentageA).div(parseEther("1"));
      const norisk = amount.sub(maxpayoff);
      const settlementFee = maxpayoff.mul(parseEther("0.01")).div(parseEther("1"));
      const payoff = maxpayoff.sub(settlementFee).add(norisk);
      //maker burn
      await expect(
        vault.connect(maker).burnBatch([
          { expiry:expiry, anchorPrices:anchorPrices, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
          { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
        ])
      ).to.changeTokenBalances(collateral, [maker, minter, vault], [maxpayoff, 0, maxpayoff.mul(-1)]);
      expect(await vault.balanceOf(maker.address, makerProductIdA)).to.equal(0);
      expect(await vault.balanceOf(maker.address, makerProductIdB)).to.equal(0);
      //minter burn
      await expect(
        vault.connect(minter).burnBatch([
          { expiry:expiry, anchorPrices:anchorPrices, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:0 },
          { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:0 }
        ])
      ).to.changeTokenBalances(collateral, [maker, minter, vault], [0, payoff.add(norisk), payoff.add(norisk).mul(-1)]);
      expect(await vault.balanceOf(minter.address, minterProductIdA)).to.equal(0);
      expect(await vault.balanceOf(minter.address, minterProductIdB)).to.equal(0);
    });
    it("should emit log", async function () {
      const anchorPricesB = [parseEther("29000"), parseEther("30000")];
      const { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const minterProductIdA = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentageA, 0]);
      const makerProductIdA = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPrices, collateralAtRiskPercentageA, 1]);
      const minterProductIdB = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPricesB, collateralAtRiskPercentageB, 0]);
      const makerProductIdB = solidityKeccak256(["uint256", "uint256[2]", "uint256", "uint256"], [expiry, anchorPricesB, collateralAtRiskPercentageB, 1]);
      await time.increaseTo(expiry);
      await oracle.settle();
      const amount = parseEther("99.9");
      const maxpayoff = amount.mul(collateralAtRiskPercentageA).div(parseEther("1"));
      const norisk = amount.sub(maxpayoff);
      const settlementFee = maxpayoff.mul(parseEther("0.01")).div(parseEther("1"));
      const payoff = maxpayoff.sub(settlementFee).add(norisk);
      //maker burn
      await expect(
        vault.connect(maker).burnBatch([
          { expiry:expiry, anchorPrices:anchorPrices, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
          { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
        ])
      ).to.emit(vault, "BatchBurned").withArgs(maker.address, [makerProductIdA, makerProductIdB], [amount, amount], [0, 0]);  
      //minter burn
      await expect(
        vault.connect(minter).burnBatch([
          { expiry:expiry, anchorPrices:anchorPrices, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:0 },
          { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:0 }
        ])
      ).to.emit(vault, "BatchBurned").withArgs(minter.address, [minterProductIdA, minterProductIdB], [amount, amount], [payoff, payoff]);
    });
    it("should revert if expiry is not past", async function () {
      const { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      await expect(
        vault.connect(maker).burnBatch([
          { expiry:expiry, anchorPrices:anchorPrices, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
          { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
        ])
      ).to.be.revertedWith("Vault: not expired");
    });
    it("should revert if has zero amount", async function () {
      await time.increaseTo(expiry);
      await expect(
        vault.connect(maker).burnBatch([
          { expiry:expiry, anchorPrices:anchorPrices, collateralAtRiskPercentage:parseEther("0.1"), isMaker:1 },
          { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:parseEther("0.1"), isMaker:1 }
        ])
      ).to.be.revertedWith("Vault: zero amount");
    });
    it("should revert if price is not settled", async function () {
      const { collateralAtRiskPercentage: collateralAtRiskPercentageA } = await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const { collateralAtRiskPercentage: collateralAtRiskPercentageB } = await mint(totalCollateral, expiry, anchorPricesB, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await expect(
        vault.connect(maker).burnBatch([
          { expiry:expiry, anchorPrices:anchorPrices, collateralAtRiskPercentage:collateralAtRiskPercentageA, isMaker:1 },
          { expiry:expiry, anchorPrices:anchorPricesB, collateralAtRiskPercentage:collateralAtRiskPercentageB, isMaker:1 }
        ])
      ).to.be.revertedWith("Vault: not settled");
    });
  });
  
  describe("Harvest", function () {
    it("should collect fee", async function () {
      await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const feeCollector = await vault.feeCollector();
      await expect(vault.harvest()
      ).to.changeTokenBalance(collateral, vault, parseEther("0.1").mul(-1));
      expect(await collateral.balanceOf(feeCollector)).to.equal(parseEther("0.1"));
      expect(await vault.totalFee()).to.equal(0);
    });
    it("should revert if fee is zero", async function () {
      await expect(vault.harvest()).to.be.revertedWith("Vault: zero fee");
    });
    it("should emit log", async function () {
      await mint(totalCollateral, expiry, anchorPrices, collateralAtRisk, makerCollateral, deadline, 
        collateral, vault, minter, maker, referral, eip721Domain);
      const feeCollector = await vault.feeCollector();
      await expect(vault.connect(minter).harvest()
      ).to.emit(vault, "FeeCollected").withArgs(minter.address, parseEther("0.1"));
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
});
