import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
// import {
const {
  expect,
  constants,
  deployFixture,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack,
  leafComp,
  nodeComp,
  signMintParamsWithCollateralAtRisk,
  signSignatures,
} = require("../helpers/helpers");

describe("Automator", function () {
  let collateral, feeCollector, feeCollectorSimple, oracle, owner, minter, maker, referral, vaultA, vaultB, vaultC,
      eip721DomainA, eip721DomainB, eip721DomainC,aggregator, atoken, aavePool, automatorBase,
      automatorFactory;
  beforeEach(async function () {
    ({
      collateral,
      spotAggregator: aggregator,
      feeCollector,
      feeCollectorSimple,
      spotOracle: oracle,
      owner,
      minter,
      maker,
      referral,
      atoken,
      aavePool,
    } = await loadFixture(deployFixture));
    // Deploy mock strategy contract
    const StrategyA = await ethers.getContractFactory("SmartBull");
    const strategyA = await StrategyA.deploy();
    const StrategyB = await ethers.getContractFactory("SmartBear");
    const strategyB = await StrategyB.deploy();
    // Deploy SmartTrendVault contract
    const VaultA = await ethers.getContractFactory("AAVESmartTrendVault");
    vaultA = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyA.address, // Mock strategy contract
      collateral.address,
      aavePool.address,
      feeCollectorSimple.address,
      oracle.address
    ]);
    const VaultB = await ethers.getContractFactory("AAVESmartTrendVault");
    vaultB = await upgrades.deployProxy(VaultB, [
      "Reliable USDT",
      "rUSDT",
      strategyB.address, // Mock strategy contract
      collateral.address,
      aavePool.address,
      feeCollectorSimple.address,
      oracle.address
    ]);
    const VaultC = await ethers.getContractFactory("LeverageSmartTrendVault");
    vaultC = await upgrades.deployProxy(VaultC, [
      "Reliable USDT",
      "rUSDT",
      strategyA.address, // Mock strategy contract
      collateral.address,
      aavePool.address,
      feeCollectorSimple.address,
      "30000000000000000", //borrow
      0,
      4,
      oracle.address
    ]);
    eip721DomainA = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vaultA.address,
    };
    eip721DomainB = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vaultB.address,
    };
    eip721DomainC = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vaultC.address,
    };
    // Automator contract
    // const Automator = await ethers.getContractFactory("Automator");
    // automatorBase = await upgrades.deployProxy(Automator, [
    //   collateral.address,
    //   referral.address,
    //   feeCollector.address,
    // ]);
    const feeRate = parseEther("0.02");
    const AutomatorFactory = await ethers.getContractFactory("AutomatorFactory");
    automatorFactory = await AutomatorFactory.deploy(referral.address, feeCollector.address);
    await automatorFactory.deployed();
    const tx = await automatorFactory.createAutomator(feeRate, collateral.address);
    const receipt = await tx.wait();
    const automatorAddr = receipt.events[0].args[2];
    const AutomatorBase = await ethers.getContractFactory("AutomatorBase");
    automatorBase = AutomatorBase.attach(automatorAddr).connect(owner);
    await collateral.connect(minter).approve(automatorBase.address, constants.MaxUint256); // approve max
    await collateral.connect(owner).approve(automatorBase.address, constants.MaxUint256);
    await collateral.connect(maker).approve(vaultA.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultB.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultC.address, constants.MaxUint256);
  });
  /*
  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await automatorBase.collateral()).to.equal(collateral.address);
      expect(await automatorBase.name()).to.equal("Automator " + (await collateral.name()));
      expect(await automatorBase.symbol()).to.equal("at" + (await collateral.symbol()));
    });
    it("Should revert if initialize twice", async function () {
      await expect(automatorBase.initialize(collateral.address, "100"))
        .to.be.revertedWith("Automator: forbidden");
    });
  });

  describe("harvest", function () {
    it("Should harvest revert if fee == 0", async function () {
      await expect(automatorBase.connect(minter).harvest())
        .to.be.revertedWith("Automator: zero fee");
    });
  });

 
  describe("decimals", function () {
    it("Should get decimals", async function () {
      expect(await automatorBase.decimals()).to.equal(18);
    });
  });
  
  describe("getRedemption", function () {
    it("Should get redemption", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amountWd);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(amount.sub(1000));
      const ts = await time.latest();
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts)]);
      expect(await automatorBase.getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(0)]);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [amountWd, amountWd.mul(-1)]);
      //after claim
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(ts)]);
    });
  });

  describe("getPricePerShare", function () {
    it("Should get initial price per share", async function () {
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1"));
    });
  });
  
  describe("getUnredeemedCollateral", function () {
    it("Should get initial amount of unredeemed collateral", async function () {
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(0);
    });
    it("Should get amount of unredeemed collateral after deposit and withdraw", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2));
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(amount.div(2));
    });
  });
  
  describe("Deposit/Withdraw", function () {
    it("Should deposit collateral to vault", async function () {
      const amount = parseEther("100");
      await expect(automatorBase.connect(minter).deposit(amount))
        .to.changeTokenBalances(collateral, [minter, automatorBase], [amount.mul(-1), amount]);
      expect(await automatorBase.totalCollateral()).to.equal(amount);
      expect(await automatorBase.totalSupply()).to.equal(amount);
    });
    it("Should 1st deposit - 1000 wei", async function () {
      const amount = parseEther("100");
      const bal = await collateral.balanceOf(minter.address);
      await expect(automatorBase.connect(minter).deposit(amount))
        .to.emit(automatorBase, "Deposited").withArgs(minter.address, amount, amount.sub(1000));
      expect(await automatorBase.balanceOf(minter.address)).to.equal(amount.sub(1000));
    });
    it("Should withdraw applied", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await expect(automatorBase.connect(minter).withdraw(amount.div(2))).to.changeTokenBalance(collateral, minter, 0);
      expect(await automatorBase.totalPendingRedemptions()).to.equal(amount.div(2));
    });
    it("Should withdraw emit log", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await expect(automatorBase.connect(minter).withdraw(amount.div(2)))
        .to.emit(automatorBase, "Withdrawn").withArgs(minter.address, amount.div(2));
    });
    it("Should transfer done if transfer + pending <= balance", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2).sub(1000));
      await expect(automatorBase.connect(minter).transfer(owner.address, amount.div(2)))
        .to.changeTokenBalances(automatorBase, [owner, minter], [amount.div(2), amount.div(2).mul(-1)]);
    });
    it("Should transferFrom done if transfer + pending <= balance", async function () {
      await automatorBase.connect(minter).approve(owner.address, constants.MaxUint256);
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2).sub(1000));
      await expect(automatorBase.connect(owner).transferFrom(minter.address, owner.address, amount.div(2)))
        .to.changeTokenBalances(automatorBase, [owner, minter], [amount.div(2), amount.div(2).mul(-1)]);
    });
    it("Should revert if transferFrom amount + pending > balance", async function () {
      await automatorBase.connect(minter).approve(owner.address, constants.MaxUint256);
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2).sub(1000));
      await expect(automatorBase.connect(owner).transferFrom(minter.address, owner.address, amount.div(2)))
        .to.changeTokenBalances(automatorBase, [owner, minter], [amount.div(2), amount.div(2).mul(-1)]);
      await expect(automatorBase.connect(owner).transferFrom(minter.address, owner.address, 1))
        .to.be.revertedWith("Automator: invalid transfer amount");
    });
    it("Should revert if transfer + pending > balance", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2).sub(1000));
      await expect(automatorBase.connect(minter).transfer(owner.address, amount.div(2)))
        .to.changeTokenBalances(automatorBase, [owner, minter], [amount.div(2), amount.div(2).mul(-1)]);
      await expect(automatorBase.connect(minter).transfer(owner.address, amount.div(2)))
        .to.be.revertedWith("Automator: invalid transfer amount");
    });
    it("Should withdraw if pendingRedemption != 0", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2));
      await ethers.provider.send("evm_setNextBlockTimestamp", [1723507680]);
      await automatorBase.connect(minter).withdraw(amount.sub(1000));
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amount.sub(1000), ethers.BigNumber.from(1723507680)]);
    });
    it("Should withdraw when 10 days after withdraw ", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amount.div(2));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 10]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).withdraw(amount.div(2)))
        .to.emit(automatorBase, "Withdrawn").withArgs(minter.address, amount.div(2));
    });
    it("Should withdraw revert if shares > balance", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await expect(automatorBase.connect(minter).withdraw(amount.mul(2)))
        .to.be.revertedWith("Automator: insufficient shares");
    });
    it("Should claim when 7 days after withdraw", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd).sub(1000);
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amountWd);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(amount.sub(1000));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [amountWd, amountWd.mul(-1)]);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(amountRm);
      expect(await automatorBase.totalPendingRedemptions()).to.equal(0);
      expect(await automatorBase.totalCollateral()).to.equal(amountRm.add(1000));
    });
    it("Should not claim when 10 days after withdraw", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amountWd);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(amount.sub(1000));
      const ts = await time.latest();
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts)]);
      expect(await automatorBase.getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(0)]);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 10]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: invalid redemption");
      //after claim
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts)]);
    });
    it("Should claim emit log", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automatorBase.connect(minter).deposit(amount);
      await automatorBase.connect(minter).withdraw(amountWd);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.emit(automatorBase, "RedemptionsClaimed").withArgs(minter.address, amountWd, amountWd);
    });
    it("Should claim revert if no pending redemption", async function () {
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: no pending redemption");
    });
    it("Should claim revert if less than 7 days after withdraw", async function () {
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      await automatorBase.connect(minter).withdraw(ethers.utils.parseEther("50"));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 6]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: invalid redemption");
    });
    it("Should deposit, withdraw and claim by many people", async function () {
      const amount = parseEther("100");
      await automatorBase.connect(minter).deposit(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 1]);
      await automatorBase.connect(owner).deposit(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 1]);
      await automatorBase.connect(minter).withdraw(amount.sub(1000));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 1]);
      await automatorBase.connect(owner).withdraw(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [amount.sub(1000), amount.sub(1000).mul(-1)]);
      await expect(automatorBase.connect(owner).claimRedemptions())
        .to.changeTokenBalances(collateral, [owner, automatorBase], [amount, amount.mul(-1)]);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(0);
      expect(await automatorBase.totalPendingRedemptions()).to.equal(0);
      expect(await automatorBase.totalCollateral()).to.equal(1000);
    });
  });
  */
  describe("Mint/Burn Products", function () {
    let productMint: any;
    let productMintB: any;
    let productMintC: any;
    let productMintD: any;
    let expiry, anchorPrices, anchorPricesB, anchorPricesC;
    beforeEach(async function () {
      await automatorFactory.enableMakers([maker.address]);
      await automatorFactory.enableVaults([vaultA.address, vaultB.address, vaultC.address]);
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const totalCollateral = parseEther("100");
      await ethers.provider.send("evm_setNextBlockTimestamp", [1723507680]);
      //2onsole.log("before expiry:", await time.latest());
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      //console.log("expiry:", expiry);
      anchorPrices = [parseEther("28000"), parseEther("30000")];
      anchorPricesB = [parseEther("30000"), parseEther("32000")];
      anchorPricesC = [parseEther("40000"), parseEther("42000")];
      const collateralAtRisk = parseEther("20"); //20
      const collateralAtRiskD = parseEther("10");    //adj
      const makerCollateral = parseEther("10");
      const makerCollateralC = parseEther("20");
      const deadline = await time.latest() + 600;
      const signature = await signMintParamsWithCollateralAtRisk(
        totalCollateral,
        expiry,
        anchorPrices,
        collateralAtRisk,
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      const signatureB = await signMintParamsWithCollateralAtRisk(
        totalCollateral,
        expiry,
        anchorPricesB,
        collateralAtRisk,
        makerCollateral,
        deadline,
        vaultB,
        automatorBase,
        maker,
        eip721DomainB
      );
      const signatureC = await signMintParamsWithCollateralAtRisk(
        totalCollateral,
        expiry,
        anchorPricesC,
        collateralAtRisk,
        makerCollateralC,
        deadline,
        vaultC,
        automatorBase,
        maker,
        eip721DomainC
      );
      const signatureD = await signMintParamsWithCollateralAtRisk(
        totalCollateral,
        expiry,
        anchorPricesC, //adj
        collateralAtRiskD, //adj
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      productMint = {
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPrices,
          collateralAtRisk: collateralAtRisk,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signature
        }
      };
      productMintB = {
        vault: vaultB.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPricesB,
          collateralAtRisk: collateralAtRisk,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureB
        }
      };
      productMintC = {
        vault: vaultC.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPricesC,
          collateralAtRisk: collateralAtRisk,
          makerCollateral: makerCollateralC,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureC
        }
      };
      productMintD = {
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPricesC,
          collateralAtRisk: collateralAtRiskD,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureD
        }
      };
    });
    /*
    it("should successfully mint products with valid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA, aavePool], [parseEther("90").mul(-1), 0, parseEther("100")]);
    });
    it("should get unredeemed collateral after mint products", async function () {
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(parseEther("100"));
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA, aavePool], [parseEther("90").mul(-1), 0, parseEther("100")]);
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(parseEther("10"));
    });
    it("should mint emit log", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.emit(automatorBase, "ProductsMinted");
    });
    it("should fail minting products with invalid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], minter);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid maker");
    });
    it("should fail if a vault is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorFactory.disableVaults([vaultA.address]);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid vault");
    });
    it("should fail if a maker is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorFactory.disableMakers([maker.address]);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid maker");
    });
    it("should fail if not enough collateral", async function () {
      const amountWd = parseEther("50");
      await automatorBase.connect(minter).withdraw(amountWd);
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: no enough collateral to redeem");
    });
    it("should withdraw zero", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).withdraw(parseEther("100").sub(1000))).to.changeTokenBalance(collateral, minter, 0);
      expect(await automatorBase.totalPendingRedemptions()).to.equal(parseEther("100").sub(1000));
    });
    it("should claim revert if withdraw amount > Automator's balance", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      await automatorBase.connect(minter).withdraw(parseEther("100").sub(1000));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: insufficient collateral to redeem");
    });
    //burn
    it("should successfully burn products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA, aavePool], [parseEther("100"), 0, parseEther("100").mul(-1)]);
      //automatorBase: +9.7(fee: 0.097)
      expect(await automatorBase.balanceOf(minter.address)).to.equal(parseEther("100").sub(1000));
      expect(await automatorBase.totalFee()).to.equal(parseEther("0.3"));
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1.097"));
      expect(await automatorBase.totalCollateral()).to.equal(parseEther("109.7"));
      expect(await automatorBase.totalSupply()).to.equal(parseEther("100"));
    });
    it("should burn products with loss", async function () {
      const signaturesSignature = await signSignatures([productMintC], maker);
      //console.log("before mint time:", await time.latest());
      const tx = await automatorBase.mintProducts([productMintC], signaturesSignature);
      //console.log("after mint time:", await time.latest());
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultC, receipt);
      const productBurn  = {
        vault: vaultC.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      //console.log("before burn time:", await time.latest());
      const left = parseEther("80");
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultC, aavePool], [left, 0, left.mul(-1)]);
      //vaultC automatorBase: in:80*1e18 out:79.979593304511722679 
      expect(await automatorBase.totalFee()).to.equal(0);
      expect(await automatorBase.getPricePerShare()).to.equal((left.add(parseEther("20")).div(100)));
      expect(await automatorBase.totalCollateral()).to.equal(left.add(parseEther("20")));
      expect(await automatorBase.totalSupply()).to.equal(parseEther("100"));
    });*/
    it("should burn products with no loss and no profit", async function () {
      const signaturesSignature = await signSignatures([productMintD], maker);
      const tx = await automatorBase.mintProducts([productMintD], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("90");
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA, aavePool], [left, 0, left.mul(-1)]);
      //in 90; out 90
      expect(await automatorBase.totalFee()).to.equal(0);
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1"));
      expect(await automatorBase.totalCollateral()).to.equal(parseEther("100"));
      expect(await automatorBase.totalSupply()).to.equal(parseEther("100"));
    });
    it("should successfully mint/burn two products", async function () {
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const signaturesSignature = await signSignatures([productMint, productMintB], maker);
      const tx = await automatorBase.mintProducts([productMint, productMintB], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
        }]
      };
      const productBurnB  = {
        vault: vaultB.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesB,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).burnProducts([productBurn, productBurnB]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA, aavePool], [parseEther("100").mul(2), 0, parseEther("100").mul(-2)]);
      //automatorBase: +9.7*2(fee: 0.097*2)
      expect(await automatorBase.totalFee()).to.equal(parseEther("0.6"));
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1.097"));
      expect(await automatorBase.totalCollateral()).to.equal(parseEther("219.4"));
      expect(await automatorBase.totalSupply()).to.equal(parseEther("200"));
      // console.log("owner:", await automatorBase.owner());
      await expect(automatorBase.harvest())
        .to.changeTokenBalances(collateral, [automatorBase, feeCollector], [parseEther("0.6").mul(-1), parseEther("0.2")]);
      expect(await automatorBase.totalFee()).to.equal(0);
    });
    it("should claim pending redemptions", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).withdraw(parseEther("100").sub(1000))).to.changeTokenBalance(collateral, minter, 0);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.emit(automatorBase, "ProductsBurned");
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [parseEther("109.699999999999998903"), parseEther("109.699999999999998903").mul(-1)]);
    });
    it("should successfully deposit after growth in fund value", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      //console.log(await automatorBase.balanceOf(minter.address));
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA, aavePool], [parseEther("100"), 0, parseEther("100").mul(-1)]);
      //automatorBase: +9.7(fee: 0.097)
      //another deposit
      expect(await automatorBase.totalCollateral()).to.equal(parseEther("109.7"));
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      //100+ 100/1.09603
      const amount = parseEther("191.157702825888787602");
      expect(await automatorBase.balanceOf(minter.address)).to.equal(amount.sub(1000));
      await automatorBase.connect(minter).withdraw(amount.sub(1000));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      //const amountWd = parseEther("209.699999999999999001").sub(1000);
      const amountWd = parseEther("209.700000000000000001").sub(1000);
      //console.log(await automatorBase.getPricePerShare());
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [amountWd.sub(99), amountWd.sub(99).mul(-1)]);
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1.098"));
      expect(await automatorBase.totalSupply()).to.equal(1000);
    });
    it("should claim if burn with loss", async function () {
      const signaturesSignature = await signSignatures([productMintC], maker);
      const tx = await automatorBase.mintProducts([productMintC], signaturesSignature);
      const receipt = await tx.wait();
      await automatorBase.connect(minter).withdraw(parseEther("100").sub(1000));
      const collateralAtRiskPercentage = getCatRP(vaultC, receipt);
      const productBurn  = {
        vault: vaultC.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("80");
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultC, aavePool], [left, 0, left.mul(-1)]);
      const amount = parseEther("100").sub(1000);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [amount, amount.mul(-1)]);
    });
  });
})

function getCatRP(vault: any, receipt: any) {
  let collateralAtRiskPercentage;
  for (const log of receipt.logs) {
    try {
      const event = vault.interface.parseLog(log);
      if (event.name === 'Minted') {
        collateralAtRiskPercentage = event.args.collateralAtRiskPercentage;
        break;
      }
    } catch (error) {
      continue;
    }
  }
  return collateralAtRiskPercentage;
}
