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
  signMintParams,
  signSignatures,
} = require("../helpers/helpers");

describe("StETHAutomatorBase", function () {
  let collateral, feeCollector, feeCollectorSimple, oracle, owner, minter, maker, referral, vaultA, vaultB,
      eip721DomainA, eip721DomainB, eip721DomainC,aggregator, automatorBase,
      automatorFactory;
  beforeEach(async function () {
    ({
      steth: collateral,
      spotAggregator: aggregator,
      feeCollector,
      feeCollectorSimple,
      spotOracle: oracle,
      owner,
      minter,
      maker,
      referral,
    } = await loadFixture(deployFixture));
    // Deploy mock strategy contract
    const StrategyA = await ethers.getContractFactory("SmartBull");
    const strategyA = await StrategyA.deploy();
    const StrategyB = await ethers.getContractFactory("SmartBear");
    const strategyB = await StrategyB.deploy();
    // Deploy SmartTrendVault contract
    const VaultA = await ethers.getContractFactory("RebaseSmartTrendVault");
    vaultA = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyA.address, // Mock strategy contract
      collateral.address,
      oracle.address
    ]);
    vaultB = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyB.address, // Mock strategy contract
      collateral.address,
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
    const feeRate = parseEther("0.02");
    const AutomatorFactory = await ethers.getContractFactory("StETHAutomatorFactory");
    automatorFactory = await AutomatorFactory.deploy(referral.address, feeCollector.address);
    await automatorFactory.deployed();
    //const automator = await automatorFactory.automator();
    //const AutomatorBase0 = await ethers.getContractFactory("AutomatorBase");
    //const Automator = AutomatorBase0.attach(automator).connect(owner);
    await automatorFactory.topUp(owner.address, 1);
    const maxPeriod = 3600 * 24 * 7;
    const tx = await automatorFactory.createAutomator(feeRate, maxPeriod, collateral.address);
    const receipt = await tx.wait();
    const automatorAddr = receipt.events[0].args[2];
    //console.log("receipt:", automatorAddr);
    const AutomatorBase = await ethers.getContractFactory("StETHAutomatorBase");
    automatorBase = AutomatorBase.attach(automatorAddr).connect(owner);
    await collateral.connect(minter).submit(constants.AddressZero, {value:parseEther("1000")});
    await collateral.connect(maker).submit(constants.AddressZero, {value:parseEther("1000")});
    await collateral.connect(owner).submit(constants.AddressZero, {value:parseEther("1000")});
    await collateral.connect(minter).approve(automatorBase.address, constants.MaxUint256); // approve max
    await collateral.connect(owner).approve(automatorBase.address, constants.MaxUint256);
    await collateral.connect(maker).approve(vaultA.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultB.address, constants.MaxUint256); // approve max
  });
  
  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await automatorBase.collateral()).to.equal(collateral.address);
      expect(await automatorBase.name()).to.equal("Automator " + (await collateral.name()));
      expect(await automatorBase.symbol()).to.equal("at" + (await collateral.symbol()) + "_" + ethers.BigNumber.from(automatorBase.address).mod(65536).toString());
    });
    it("Should revert if not initialized by factory", async function () {
      await expect(automatorBase.initialize(owner.address, collateral.address, "100", 7))
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
    it("Should get redemption before and after claim", async function () {
      const amount = parseEther("100");
      const amountIn = amount.sub(ethers.BigNumber.from(1)); //special
      //const amountIn = amount;
      const amountWdShare = amount.div(3);
      //const amountWd = parseEther("33.333333333333333299");
      await automatorBase.connect(minter).deposit(amount);
      //console.log(await collateral.balanceOf(automatorBase.address));
      await automatorBase.connect(minter).withdraw(amountWdShare);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(amount.sub(1000));
      
      const ts = await time.latest();
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amountWdShare, ethers.BigNumber.from(ts)]);
      expect(await automatorBase.getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(0)]);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      //console.log("totalCollateral:", await automatorBase.totalCollateral());
      const amountWd = amountIn.mul(amountWdShare).div(amount);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [amountWd, amountWd.mul(-1)]);
      const amountRm = amountIn.sub(amountWd);
      const shareRm = amount.sub(ethers.BigNumber.from(1000)).sub(amountWdShare);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(shareRm);
      expect(await automatorBase.totalCollateral()).to.equal(amountRm);
      expect(await automatorBase.totalPendingRedemptions()).to.equal(0);
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
      const amountIn = amount.sub(ethers.BigNumber.from(1)); //special
      await automatorBase.connect(minter).deposit(amount);
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(amountIn);
      await automatorBase.connect(minter).withdraw(amount.div(2));
      const pps = amountIn.mul(ethers.constants.WeiPerEther).div(amount);
      const amountCom = amountIn.sub((amount.div(2)).mul(pps).div(ethers.constants.WeiPerEther));
      //console.log("pps:", await automatorBase.getPricePerShare());
      //console.log("pending:",await automatorBase.totalPendingRedemptions());
      //console.log("bal:", await collateral.balanceOf(automatorBase.address));
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(amountCom);
    });
  });
  
  describe("transferOwnership", function () {
    it("Should transfer ownership", async function () {
      await automatorBase.transferOwnership(minter.address);
      expect(await automatorBase.owner()).to.equal(minter.address);
    });
    it("Should revert if transfer ownership to zero address", async function () {
      await expect(automatorBase.transferOwnership(ethers.constants.AddressZero))
        .to.be.revertedWith("Ownable: new owner is the zero address");
    });
    it("Should revert if not the owner transfer ownership", async function () {
      await expect(automatorBase.connect(minter).transferOwnership(minter.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
  
  describe("Deposit/Withdraw", function () {
    it("Should deposit collateral to vault", async function () {
      const amount = parseEther("100");
      const amountRm = amount.sub(ethers.BigNumber.from(1))
      await expect(automatorBase.connect(minter).deposit(amount))
        .to.changeTokenBalances(collateral, [minter, automatorBase], [amountRm.mul(-1), amountRm]);
      expect(await automatorBase.totalCollateral()).to.equal(amountRm);
      expect(await automatorBase.totalSupply()).to.equal(amount);
    });
    it("Should 1st deposit - 1000 wei", async function () {
      const amount = parseEther("100");
      const bal = await collateral.balanceOf(minter.address);
      await expect(automatorBase.connect(minter).deposit(amount))
        .to.emit(automatorBase, "Deposited").withArgs(minter.address, amount, amount, amount.sub(1000));
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
      //await ethers.provider.send("evm_setNextBlockTimestamp", [1723507680]);
      const ts = await time.latest();
      await automatorBase.connect(minter).withdraw(amount.sub(1000));
      expect(await automatorBase.connect(minter).getRedemption()).to.deep.equal([amount.sub(1000), ethers.BigNumber.from(ts+1)]);
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
      const amountCheck = amount.sub(ethers.BigNumber.from(1)).mul(amountWd).div(amount);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.emit(automatorBase, "RedemptionsClaimed").withArgs(minter.address, amountCheck, amountCheck, amountWd);
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
      const amountIn = amount.mul(2).sub(ethers.BigNumber.from(2));
      const amountWd1 = amountIn.mul(amount.sub(1000)).div(amount.mul(2).add(ethers.BigNumber.from(2)));
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], [amountWd1, amountWd1.mul(-1)]);
      //console.log("totalCollateral:", await automatorBase.totalCollateral());
      //console.log("totalSupply:", await automatorBase.totalSupply());
      //console.log("left:", amountIn.sub(amountWd1));
      //console.log("pending:", await automatorBase.totalPendingRedemptions());
      const amountWd2 = amountIn.sub(amountWd1).mul(amount).div(amount.add(ethers.BigNumber.from(1002))).sub(ethers.BigNumber.from(1));
      await expect(automatorBase.connect(owner).claimRedemptions())
        .to.changeTokenBalances(collateral, [owner, automatorBase], [amountWd2, amountWd2.sub(ethers.BigNumber.from(1)).mul(-1)]);
      expect(await automatorBase.balanceOf(minter.address)).to.equal(0);
      expect(await automatorBase.balanceOf(owner.address)).to.equal(2);
      expect(await automatorBase.totalPendingRedemptions()).to.equal(0);
      const amountRm = amountIn.sub(amountWd1).sub(amountWd2).add(ethers.BigNumber.from(1));
      expect(await automatorBase.totalCollateral()).to.equal(amountRm);
    });
  });
  
  describe("Mint/Burn Products", function () {
    let productMint: any;
    let productMintB: any;
    let productMintC: any;
    let productMintD: any;
    let productMintE: any;
    let expiry, anchorPrices, anchorPricesC;
    beforeEach(async function () {
      await automatorFactory.enableMakers([maker.address]);
      await automatorFactory.enableVaults([vaultA.address, vaultB.address]);
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const totalCollateral = parseEther("100");
      const totalCollateralE = parseEther("110");
      //await ethers.provider.send("evm_setNextBlockTimestamp", [1723507680]);
      //console.log("before expiry:", await time.latest());
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      const expiryC = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400*8;
      //console.log("expiry:", expiry);
      anchorPrices = [parseEther("28000"), parseEther("30000")];
      anchorPricesC = [parseEther("40000"), parseEther("42000")];
      const makerCollateral = parseEther("10");
      const makerCollateralB = parseEther("100");//20
      const deadline = await time.latest() + 600;
      const deadlineC = await time.latest() + 60000000;
      const signature = await signMintParams(
        totalCollateral,
        expiry,
        anchorPrices,
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      const signatureB = await signMintParams(
        totalCollateral,
        expiry,
        anchorPrices,
        makerCollateralB,
        deadline,
        vaultB,
        automatorBase,
        maker,
        eip721DomainB
      );
      const signatureC = await signMintParams(
        totalCollateral,
        expiryC,
        anchorPrices,
        makerCollateral,
        deadlineC,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      const signatureD = await signMintParams(
        totalCollateral,
        expiry,
        anchorPricesC, //adj
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      const signatureE = await signMintParams(
        totalCollateralE,
        expiry,
        anchorPricesC, //adj
        makerCollateral,
        deadline,
        vaultA,
        automatorBase,
        maker,
        eip721DomainA
      );
      productMint = { //win
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPrices,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signature
        }
      };
      productMintB = { //even
        vault: vaultB.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPrices,
          makerCollateral: makerCollateralB,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureB
        }
      };
      productMintC = { //maxPeriod fail 
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiryC,
          anchorPrices: anchorPrices,
          makerCollateral: makerCollateral,
          deadline: deadlineC,
          maker: maker.address,
          makerSignature: signatureC
        }
      };
      productMintD = { //lose
        vault: vaultA.address,
        totalCollateral: totalCollateral,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPricesC,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureD
        }
      };
      productMintE = { //lose all
        vault: vaultA.address,
        totalCollateral: totalCollateralE,
        mintParams: {
          expiry: expiry,
          anchorPrices: anchorPricesC,
          makerCollateral: makerCollateral,
          deadline: deadline,
          maker: maker.address,
          makerSignature: signatureE
        }
      };
    });
    
    it("should successfully mint products with valid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const amount = parseEther("90").sub(ethers.BigNumber.from(1));
      const amountA = amount.add(parseEther("10")).sub(ethers.BigNumber.from(1));
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [amount.mul(-1), amountA]);
    });
    it("should successfully mint products with two vaults", async function () {
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const amount = parseEther("180").sub(ethers.BigNumber.from(2));
      const amountA = amount.add(parseEther("20")).sub(ethers.BigNumber.from(2));
      const signaturesSignature = await signSignatures([productMintD, productMint], maker);
      await expect(automatorBase.mintProducts([productMintD, productMint], signaturesSignature))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [amount.mul(-1), amountA]);
    });
    it("should get unredeemed collateral after mint products", async function () {
      const amount = parseEther("100").sub(ethers.BigNumber.from(1));
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(amount);
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorBase.mintProducts([productMint], signaturesSignature);
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(parseEther("10"));
      await automatorBase.connect(minter).withdraw(parseEther("100").div(2));
      expect(await automatorBase.getUnredeemedCollateral()).to.equal(0);
    });
    it("should mint emit log", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.emit(automatorBase, "ProductsMinted");
    });
    it("Should revert if not the owner mint products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automatorBase.connect(minter).mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
    it("Should revert if period > maxPeriod", async function () {
      const signaturesSignature = await signSignatures([productMintC], maker);
      await expect(automatorBase.mintProducts([productMintC], signaturesSignature))
        .to.be.revertedWith("Automator: exceed maxPeriod");
    });
    it("should fail minting products with invalid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], minter);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid maker");
    });
    it("should revert if a vault is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorFactory.disableVaults([vaultA.address]);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid vault");
    });
    it("should revert if a maker is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automatorFactory.disableMakers([maker.address]);
      await expect(automatorBase.mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid maker");
    });
    it("should revert if not enough collateral", async function () {
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
      const amount = parseEther("100").sub(ethers.BigNumber.from(3));
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [amount, amount.mul(-1)]);
      //automatorBase: +9.7(fee: 0.097)
      expect(await automatorBase.balanceOf(minter.address)).to.equal(parseEther("100").sub(1000));
      expect(await automatorBase.totalFee()).to.equal(parseEther("0.2").sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.totalProtocolFee()).to.equal(parseEther("0.1").sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1.097").sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.totalCollateral()).to.equal(parseEther("109.7").sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.totalSupply()).to.equal(parseEther("100"));
    });
    it("should successfully burn products and mint products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], 
        [parseEther("100").sub(ethers.BigNumber.from(3)), parseEther("100").sub(ethers.BigNumber.from(3)).mul(-1)]);
      const signaturesSignatureC = await signSignatures([productMintC], maker);
      await automatorBase.mintProducts([productMintC], signaturesSignatureC);
    });
    it("should revert mint products if not enough collateral after burn products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], 
        [parseEther("100").sub(ethers.BigNumber.from(3)), parseEther("100").sub(ethers.BigNumber.from(3)).mul(-1)]);
      const amountWd = parseEther("50");
      await automatorBase.connect(minter).withdraw(amountWd);
      const signaturesSignatureC = await signSignatures([productMintC], maker);
      await expect(automatorBase.mintProducts([productMintC], signaturesSignatureC))
        .to.be.revertedWith("Automator: no enough collateral to redeem");
    });
    it("should burn products with loss", async function () {
      const signaturesSignature = await signSignatures([productMintD], maker);
      const tx = await automatorBase.mintProducts([productMintD], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("0"); //loss
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [left, left.mul(-1)]);
      const fee = parseEther("1.8");
      expect(await automatorBase.totalFee()).to.equal(fee.mul(-1));
      expect(await automatorBase.totalProtocolFee()).to.equal(0);
      expect(await automatorBase.getPricePerShare()).to.equal((left.add(parseEther("10")).div(100)));
      expect(await automatorBase.totalCollateral()).to.equal(left.add(parseEther("10")));
      expect(await automatorBase.totalSupply()).to.equal(parseEther("100"));
    });
    it("should burn products with no loss and no profit", async function () {
      const signaturesSignature = await signSignatures([productMintB], maker);
      const tx = await automatorBase.mintProducts([productMintB], signaturesSignature);
      const productBurn  = {
        vault: vaultB.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("0");
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultB], [left, left.mul(-1)]);
      //in 90; out 90
      expect(await automatorBase.totalFee()).to.equal(0);
      expect(await automatorBase.totalProtocolFee()).to.equal(0);
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1").sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.totalCollateral()).to.equal(parseEther("100").sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.totalSupply()).to.equal(parseEther("100"));
    });
    it("should burn products with all loss", async function () {
      const signaturesSignature = await signSignatures([productMintE], maker);
      const tx = await automatorBase.mintProducts([productMintE], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [0, 0]);
      const fee = parseEther("2");
      expect(await automatorBase.totalFee()).to.equal(fee.mul(-1));
      expect(await automatorBase.totalProtocolFee()).to.equal(0);
      expect(await automatorBase.getPricePerShare()).to.equal(0);
      expect(await automatorBase.totalCollateral()).to.equal(0);
      //withdraw
      await expect(automatorBase.connect(minter).withdraw(parseEther("100").sub(1000))).to.changeTokenBalance(collateral, minter, 0);
      expect(await automatorBase.totalSupply()).to.equal(parseEther("100"));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      await automatorBase.connect(minter).claimRedemptions();
    });
    it("should successfully mint/burn two products and collect fees", async function () {
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const signaturesSignature = await signSignatures([productMint, productMintB], maker);
      const tx = await automatorBase.mintProducts([productMint, productMintB], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      const productBurnB  = {
        vault: vaultB.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).burnProducts([productBurn, productBurnB]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], 
        [parseEther("100").sub(ethers.BigNumber.from(3)), parseEther("100").sub(ethers.BigNumber.from(3)).mul(-1)]);
      expect(await automatorBase.totalFee()).to.equal(parseEther("0.2").sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.totalProtocolFee()).to.equal(parseEther("0.1").sub(ethers.BigNumber.from(1)));
      const left = 200 + 10 - 0.3;
      const pps = left / 200;
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther(pps.toString()).sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.totalCollateral()).to.equal(parseEther(left.toString()).sub(ethers.BigNumber.from(2)));
      expect(await automatorBase.totalSupply()).to.equal(parseEther("200").add(ethers.BigNumber.from(2)));
      await expect(automatorBase.harvest())
        .to.changeTokenBalances(collateral, [feeCollector, owner], 
        [parseEther("0.1").sub(ethers.BigNumber.from(2)), parseEther("0.2").sub(ethers.BigNumber.from(1))]);
      expect(await automatorBase.totalFee()).to.equal(0);
      expect(await automatorBase.totalProtocolFee()).to.equal(0);
    });
    it("should successfully mint/burn two products with gain&loss and collect fees", async function () {
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      const signaturesSignature = await signSignatures([productMintD, productMint], maker);
      const tx = await automatorBase.mintProducts([productMintD, productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      const productBurnD  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).burnProducts([productBurn, productBurnD]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], 
        [parseEther("100").sub(ethers.BigNumber.from(2)), parseEther("100").sub(ethers.BigNumber.from(2)).mul(-1)]);
      expect(await automatorBase.totalFee()).to.equal(parseEther("1.6").add(ethers.BigNumber.from(1)).mul(-1));
      expect(await automatorBase.totalProtocolFee()).to.equal(parseEther("0.1").sub(ethers.BigNumber.from(1)));
      const left = 200 + 10 -90 - 0.1;
      const pps = left / 200;
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther(pps.toString()).sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.totalCollateral()).to.equal(parseEther(left.toString()).sub(ethers.BigNumber.from(1)));
      expect(await automatorBase.totalSupply()).to.equal(parseEther("200").add(ethers.BigNumber.from(2)));
      await expect(automatorBase.harvest())
        .to.changeTokenBalances(collateral, [feeCollector, owner], [parseEther("0.1").sub(ethers.BigNumber.from(2)), 0]);
      expect(await automatorBase.totalFee()).to.equal(parseEther("1.6").add(ethers.BigNumber.from(1)).mul(-1));
      expect(await automatorBase.totalProtocolFee()).to.equal(0);
    });
    it("should claim pending redemptions", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automatorBase.connect(minter).withdraw(parseEther("100").sub(1000)))
        .to.changeTokenBalance(collateral, minter, 0);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.emit(automatorBase, "ProductsBurned");
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1.097").sub(ethers.BigNumber.from(1)));

      const pps = await automatorBase.getPricePerShare();
      //(100 + 10 - 0.3)/100*(100-10^(-15)) = 109.699999999999998903
      const totalCollateral = parseEther("109.7").sub(ethers.BigNumber.from(1));
      const amount = totalCollateral.mul(parseEther("100").sub(1000)).div(parseEther("100"));
      //console.log("totalCollateral:", await automatorBase.totalCollateral());
      //console.log("totalSupply:", await automatorBase. totalSupply());
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], 
        [amount, amount.mul(-1)]);
    });
    it("should successfully deposit after growth in fund value", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automatorBase.mintProducts([productMint], signaturesSignature);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      //console.log(await automatorBase.balanceOf(minter.address));
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], 
        [parseEther("100").sub(ethers.BigNumber.from(3)), parseEther("100").sub(ethers.BigNumber.from(3)).mul(-1)]);
      expect(await automatorBase.totalCollateral()).to.equal(parseEther("109.7").sub(ethers.BigNumber.from(1)));
      //automatorBase: +9.7(fee: 0.097)
      //another deposit
      await automatorBase.connect(minter).deposit(ethers.utils.parseEther("100"));
      //100+ 100/1.09603
      //console.log("shares:", await automatorBase.balanceOf(minter.address));
      const amount = parseEther("191.157702825888787602");
      const share = amount.sub(1000).add(ethers.BigNumber.from(2))
      expect(await automatorBase.balanceOf(minter.address)).to.equal(share);
      await automatorBase.connect(minter).withdraw(share);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      //const amountWd = parseEther("209.699999999999999001").sub(1000);
      //const amountWd = parseEther("209.700000000000000001").sub(1000);
      //console.log("pps:", await automatorBase.getPricePerShare());
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1.097").sub(ethers.BigNumber.from(1))); //pps
      //console.log("totalCollateral:", await automatorBase.totalCollateral());
      //console.log("totalSupply:", await automatorBase.totalSupply());
      const totalShares = amount.add(ethers.BigNumber.from(2));
      const totalCol = parseEther("209.7").sub(ethers.BigNumber.from(2));
      const amountCheck = totalCol.mul(share).div(totalShares);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], 
        [amountCheck, amountCheck.mul(-1)]);
      //console.log("totalCollateral:", await automatorBase.totalCollateral()); //1288
      expect(await automatorBase.totalSupply()).to.equal(1000);
      expect(await automatorBase.getPricePerShare()).to.equal(parseEther("1.097")); // 1.285
    });
    it("should claim if burn with loss", async function () {
      const signaturesSignature = await signSignatures([productMintD], maker);
      const tx = await automatorBase.mintProducts([productMintD], signaturesSignature);
      await automatorBase.connect(minter).withdraw(parseEther("100").sub(1000));
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("0");
      await expect(automatorBase.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automatorBase, vaultA], [left, left.mul(-1)]);
      //(100 - 90) / 100 * (100 - 10^(-15))
      const amount = parseEther("9.9999999999999999");
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      await expect(automatorBase.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automatorBase], 
        [amount.sub(ethers.BigNumber.from(1)), amount.sub(ethers.BigNumber.from(1)).mul(-1)]);
    });

  });
})
