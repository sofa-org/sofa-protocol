import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { isMainThread } from "worker_threads";
import {
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
} from "../helpers/helpers";

describe("Automator", function () {
  let collateral, feeCollector, oracle, owner, minter, maker, referral, vaultA, vaultB, vaultC, 
      eip721DomainA, eip721DomainB, eip721DomainC,aggregator, atoken, aavePool, automator;
  beforeEach(async function () {
    ({
      collateral,
      spotAggregator: aggregator,
      feeCollector,
      spotOracle:oracle,
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
      feeCollector.address,
      oracle.address
    ]);
    const VaultB = await ethers.getContractFactory("AAVESmartTrendVault");
    vaultB = await upgrades.deployProxy(VaultB, [
      "Reliable USDT",
      "rUSDT",
      strategyB.address, // Mock strategy contract
      collateral.address,
      aavePool.address,
      feeCollector.address,
      oracle.address
    ]);
    const VaultC = await ethers.getContractFactory("LeverageSmartTrendVault");
    vaultC = await upgrades.deployProxy(VaultC, [
      "Reliable USDT",
      "rUSDT",
      strategyA.address, // Mock strategy contract
      collateral.address,
      aavePool.address,
      feeCollector.address,
      "30000000000000000", //borrow
      "10000000000000000",
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
    const Automator = await ethers.getContractFactory("Automator");
    automator = await upgrades.deployProxy(Automator, [
      collateral.address,
      referral.address,
      feeCollector.address,
    ]);
    await collateral.connect(minter).approve(automator.address, constants.MaxUint256); // approve max
    await collateral.connect(owner).approve(automator.address, constants.MaxUint256);
    await collateral.connect(maker).approve(vaultA.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultB.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultC.address, constants.MaxUint256);
  });

  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await automator.collateral()).to.equal(collateral.address);
      expect(await automator.referral()).to.equal(referral.address);
      expect(await automator.feeCollector()).to.equal(feeCollector.address);
      expect(await automator.name()).to.equal("Automator " + (await collateral.name()));
      expect(await automator.symbol()).to.equal("at" + (await collateral.symbol()));
    });
    it("Should revert if initialize twice", async function () {
      await expect(automator.initialize(collateral.address, referral.address, feeCollector.address))
        .to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("harvest", function () {
    it("Should harvest revert if fee == 0", async function () {
      await expect(automator.connect(minter).harvest())
        .to.be.revertedWith("Automator: zero fee");
    });
  });

  describe("updateReferral", function () {
    it("Should update Refferal", async function () {
      await expect(automator.updateReferral(minter.address))
        .to.emit(automator, "ReferralUpdated").withArgs(minter.address);
      expect(await automator.referral()).to.equal(minter.address);
    });
    it("Should revert if not called by owner", async function () {
      await expect(automator.connect(minter).updateReferral(minter.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("enableVaults", function () {
    it("Should enable vaults", async function () {
      const vaults = [vaultA.address, vaultB.address];
      await expect(automator.enableVaults(vaults))
        .to.emit(automator, "VaultsEnabled").withArgs(vaults);
    });
    it("Should revert if not called by owner", async function () {
      await expect(automator.connect(minter).enableVaults([vaultA.address]))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("disableVaults", function () {
    it("Should disable vaults", async function () {
      const vaults = [vaultA.address, vaultB.address];
      await expect(automator.disableVaults(vaults))
        .to.emit(automator, "VaultsDisabled").withArgs(vaults);
    });
    it("Should revert if not called by owner", async function () {
      await expect(automator.connect(minter).disableVaults([vaultA.address]))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("enableMakers", function () {
    it("Should enable makers", async function () {
      const makers = [vaultA.address, vaultB.address];
      await expect(automator.enableMakers(makers))
        .to.emit(automator, "MakersEnabled").withArgs(makers);
    });
    it("Should revert if not called by owner", async function () {
      await expect(automator.connect(minter).enableMakers([vaultA.address]))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("disableMakers", function () {
    it("Should disable makers", async function () {
      const makers = [vaultA.address, vaultB.address];
      await expect(automator.disableMakers(makers))
        .to.emit(automator, "MakersDisabled").withArgs(makers);
    });
    it("Should revert if not called by owner", async function () {
      await expect(automator.connect(minter).disableMakers([vaultA.address]))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("decimals", function () {
    it("Should get decimals", async function () {
      expect(await automator.decimals()).to.equal(18);
    });
  });

  describe("getRedemption", function () {
    it("Should get redemption", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amountWd);
      expect(await automator.balanceOf(minter.address)).to.equal(amount);
      const ts = await time.latest();
      expect(await automator.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts)]);
      expect(await automator.getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(0)]);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automator.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automator], [amountWd, amountWd.mul(-1)]);
      //after claim
      expect(await automator.connect(minter).getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(ts)]);
    });
  });

  describe("getPricePerShare", function () {
    it("Should get initial price per share", async function () {
      expect(await automator.getPricePerShare()).to.equal(parseEther("1"));
    });
  });

  describe("getUnredeemedCollateral", function () {
    it("Should get initial amount of unredeemed collateral", async function () {
      expect(await automator.getUnredeemedCollateral()).to.equal(0);
    });
    it("Should get amount of unredeemed collateral after deposit and withdraw", async function () {
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      expect(await automator.getUnredeemedCollateral()).to.equal(amount);
      await automator.connect(minter).withdraw(amount.div(2));
      expect(await automator.getUnredeemedCollateral()).to.equal(amount.div(2));
    });
  });
  
  describe("Deposit/Withdraw", function () {
    it("Should deposit collateral to vault", async function () {
      const amount = parseEther("100");
      await expect(automator.connect(minter).deposit(amount))
        .to.changeTokenBalances(collateral, [minter, automator], [amount.mul(-1), amount]);
      expect(await automator.balanceOf(minter.address)).to.equal(amount);
      expect(await automator.totalCollateral()).to.equal(amount);
      expect(await automator.totalSupply()).to.equal(amount);
    });
    it("Should deposit emit log", async function () {
      const amount = parseEther("100");
      const bal = await collateral.balanceOf(minter.address);
      await expect(automator.connect(minter).deposit(amount))
        .to.emit(automator, "Deposited").withArgs(minter.address, amount, amount);
    });
    it("Should withdraw applied", async function () {
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await expect(automator.connect(minter).withdraw(amount.div(2))).to.changeTokenBalance(collateral, minter, 0);
      expect(await automator.totalPendingRedemptions()).to.equal(amount.div(2));
    });
    it("Should withdraw emit log", async function () {
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await expect(automator.connect(minter).withdraw(amount.div(2)))
        .to.emit(automator, "Withdrawn").withArgs(minter.address, amount.div(2));
    });
    it("Should transfer done if transfer + pending <= balance", async function () {
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amount.div(2));
      await expect(automator.connect(minter).transfer(owner.address, amount.div(2)))
        .to.changeTokenBalances(automator, [owner, minter], [amount.div(2), amount.div(2).mul(-1)]);
    });
    it("Should transferFrom done if transfer + pending <= balance", async function () {
      await automator.connect(minter).approve(owner.address, constants.MaxUint256); 
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amount.div(2));
      await expect(automator.connect(owner).transferFrom(minter.address, owner.address, amount.div(2)))
        .to.changeTokenBalances(automator, [owner, minter], [amount.div(2), amount.div(2).mul(-1)]);
    });
    it("Should revert if transferFrom amount + pending > balance", async function () {
      await automator.connect(minter).approve(owner.address, constants.MaxUint256); 
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amount.div(2));
      await expect(automator.connect(owner).transferFrom(minter.address, owner.address, amount.div(2)))
        .to.changeTokenBalances(automator, [owner, minter], [amount.div(2), amount.div(2).mul(-1)]);
      await expect(automator.connect(owner).transferFrom(minter.address, owner.address, 1))
        .to.be.revertedWith("Automator: invalid transfer amount");  
    });
    it("Should revert if transfer + pending > balance", async function () {
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amount.div(2));
      await expect(automator.connect(minter).transfer(owner.address, amount.div(2)))
        .to.changeTokenBalances(automator, [owner, minter], [amount.div(2), amount.div(2).mul(-1)]);
      await expect(automator.connect(minter).transfer(owner.address, amount.div(2)))
        .to.be.revertedWith("Automator: invalid transfer amount");
    });
    it("Should withdraw revert if pendingRedemption != 0", async function () {
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amount.div(2));
      await expect(automator.connect(minter).withdraw(amount.div(2)))
        .to.be.revertedWith("Automator: pending redemption");
    });
    it("Should withdraw when 10 days after withdraw ", async function () {
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amount.div(2));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 10]); // Fast forward 7 days
      await expect(automator.connect(minter).withdraw(amount.div(2)))
        .to.emit(automator, "Withdrawn").withArgs(minter.address, amount.div(2));
    });
    it("Should withdraw revert if shares > balance", async function () {
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await expect(automator.connect(minter).withdraw(amount.mul(2)))
        .to.be.revertedWith("Automator: insufficient shares");
    });
    it("Should claim when 7 days after withdraw", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amountWd);
      expect(await automator.balanceOf(minter.address)).to.equal(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automator.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automator], [amountWd, amountWd.mul(-1)]);
      expect(await automator.balanceOf(minter.address)).to.equal(amountRm);
      expect(await automator.totalPendingRedemptions()).to.equal(0);
      expect(await automator.totalCollateral()).to.equal(amountRm);
    });
    it("Should not claim when 10 days after withdraw", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amountWd);
      expect(await automator.balanceOf(minter.address)).to.equal(amount);
      const ts = await time.latest();
      expect(await automator.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts)]);
      expect(await automator.getRedemption()).to.deep.equal([ethers.BigNumber.from(0), ethers.BigNumber.from(0)]);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 10]); // Fast forward 7 days
      await expect(automator.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: invalid redemption");
      //after claim
      expect(await automator.connect(minter).getRedemption()).to.deep.equal([amountWd, ethers.BigNumber.from(ts)]);
    });
    it("Should claim emit log", async function () {
      const amount = parseEther("100");
      const amountWd = amount.div(3);
      const amountRm = amount.sub(amountWd);
      await automator.connect(minter).deposit(amount);
      await automator.connect(minter).withdraw(amountWd);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      await expect(automator.connect(minter).claimRedemptions())
        .to.emit(automator, "RedemptionsClaimed").withArgs(minter.address, amountWd, amountWd);
    });
    it("Should claim revert if no pending redemption", async function () {
      await automator.connect(minter).deposit(ethers.utils.parseEther("100"));
      await expect(automator.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: no pending redemption");
    });
    it("Should claim revert if less than 7 days after withdraw", async function () {
      await automator.connect(minter).deposit(ethers.utils.parseEther("100"));
      await automator.connect(minter).withdraw(ethers.utils.parseEther("50"));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 6]); // Fast forward 7 days
      await expect(automator.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: invalid redemption");
    });
    it("Should deposit, withdraw and claim by many people", async function () {
      const amount = parseEther("100");
      await automator.connect(minter).deposit(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 1]);
      await automator.connect(owner).deposit(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 1]);
      await automator.connect(minter).withdraw(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 1]);
      await automator.connect(owner).withdraw(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward
      await expect(automator.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automator], [amount, amount.mul(-1)]);
      await expect(automator.connect(owner).claimRedemptions())
        .to.changeTokenBalances(collateral, [owner, automator], [amount, amount.mul(-1)]);
      expect(await automator.balanceOf(minter.address)).to.equal(0);
      expect(await automator.totalPendingRedemptions()).to.equal(0);
      expect(await automator.totalCollateral()).to.equal(0);
    });
  });
  
  describe("Mint/Burn Products", function () {
    let productMint: any;
    let productMintB: any;
    let productMintC: any;
    let productMintD: any;
    let expiry, anchorPrices, anchorPricesB, anchorPricesC;
    beforeEach(async function () {
      await automator.enableMakers([maker.address]);
      await automator.enableVaults([vaultA.address, vaultB.address, vaultC.address]);
      await automator.connect(minter).deposit(ethers.utils.parseEther("100"));
      const totalCollateral = parseEther("100");
      await ethers.provider.send("evm_setNextBlockTimestamp", [1723507680]);
      //console.log("before expiry:", await time.latest());
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
        automator,
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
        automator,
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
        automator,
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
        automator,
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

    it("should successfully mint products with valid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature))
        .to.changeTokenBalances(collateral, [automator, vaultA, aavePool], [parseEther("90").mul(-1), 0, parseEther("100")]);
    });
    it("should get unredeemed collateral after mint products", async function () {
      expect(await automator.getUnredeemedCollateral()).to.equal(parseEther("100"));
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature))
        .to.changeTokenBalances(collateral, [automator, vaultA, aavePool], [parseEther("90").mul(-1), 0, parseEther("100")]);
      expect(await automator.getUnredeemedCollateral()).to.equal(parseEther("10"));
    });
    it("should mint emit log", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature))
        .to.emit(automator, "ProductsMinted");
    });  
    it("should fail minting products with invalid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], minter);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid maker");
    });
    it("should fail if a vault is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automator.disableVaults([vaultA.address]);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid vault");
    });
    it("should fail if a maker is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automator.disableMakers([maker.address]);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: invalid maker");
    });
    it("should fail if not enough collateral", async function () {
      const amountWd = parseEther("50");
      await automator.connect(minter).withdraw(amountWd);
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature))
        .to.be.revertedWith("Automator: no enough collateral to redeem");
    });
    it("should withdraw zero", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automator.connect(minter).mintProducts([productMint], signaturesSignature);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automator.connect(minter).withdraw(parseEther("100"))).to.changeTokenBalance(collateral, minter, 0);
      expect(await automator.totalPendingRedemptions()).to.equal(parseEther("100"));
    });
    it("should claim revert if withdraw amount > Automator's balance", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automator.connect(minter).mintProducts([productMint], signaturesSignature);
      await automator.connect(minter).withdraw(parseEther("100"));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automator.connect(minter).claimRedemptions())
        .to.be.revertedWith("Automator: insufficient collateral to redeem");
    });
    //burn
    it("should successfully burn products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automator.connect(minter).mintProducts([productMint], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
          isMaker: 0
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automator.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automator, vaultA, aavePool], [parseEther("99.7"), 0, parseEther("99.7").mul(-1)]);
      //automator: +9.7(fee: 0.097)
      expect(await automator.balanceOf(minter.address)).to.equal(parseEther("100"));
      expect(await automator.totalFee()).to.equal(parseEther("0.097"));
      expect(await automator.getPricePerShare()).to.equal(parseEther("1.09603"));
      expect(await automator.totalCollateral()).to.equal(parseEther("109.603"));
      expect(await automator.totalSupply()).to.equal(parseEther("100"));
    });
    it("should burn products with loss", async function () {
      const signaturesSignature = await signSignatures([productMintC], maker);
      //console.log("before mint time:", await time.latest());
      const tx = await automator.connect(minter).mintProducts([productMintC], signaturesSignature);
      //console.log("after mint time:", await time.latest());
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultC, receipt);
      const productBurn  = {
        vault: vaultC.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
          isMaker: 0
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      //console.log("before burn time:", await time.latest());
      const left = parseEther("79.979607691404508172");
      await expect(automator.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automator, vaultC, aavePool], [left, 0, left.mul(-1)]);
      //vaultC automator: in:80*1e18 out:79.979593304511722679 
      expect(await automator.totalFee()).to.equal(0);
      expect(await automator.getPricePerShare()).to.equal((left.add(parseEther("20")).div(100)));
      expect(await automator.totalCollateral()).to.equal(left.add(parseEther("20")));
      expect(await automator.totalSupply()).to.equal(parseEther("100"));
    });
    it("should burn products with no loss and no profit", async function () {
      const signaturesSignature = await signSignatures([productMintD], maker);
      const tx = await automator.connect(minter).mintProducts([productMintD], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
          isMaker: 0
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("90");
      await expect(automator.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automator, vaultA, aavePool], [left, 0, left.mul(-1)]);
      //in 90; out 90
      expect(await automator.totalFee()).to.equal(0);
      expect(await automator.getPricePerShare()).to.equal(parseEther("1"));
      expect(await automator.totalCollateral()).to.equal(parseEther("100"));
      expect(await automator.totalSupply()).to.equal(parseEther("100"));
    });
    it("should successfully mint/burn two products", async function () {
      await automator.connect(minter).deposit(ethers.utils.parseEther("100"));
      const signaturesSignature = await signSignatures([productMint, productMintB], maker);
      const tx = await automator.connect(minter).mintProducts([productMint, productMintB], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
          isMaker: 0
        }]
      };
      const productBurnB  = {
        vault: vaultB.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesB,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
          isMaker: 0
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automator.connect(minter).burnProducts([productBurn, productBurnB]))
        .to.changeTokenBalances(collateral, [automator, vaultA, aavePool], [parseEther("99.7").mul(2), 0, parseEther("99.7").mul(-2)]);
      //automator: +9.7*2(fee: 0.097*2)
      expect(await automator.totalFee()).to.equal(parseEther("0.194"));
      expect(await automator.getPricePerShare()).to.equal(parseEther("1.09603"));
      expect(await automator.totalCollateral()).to.equal(parseEther("219.206"));
      expect(await automator.totalSupply()).to.equal(parseEther("200"));
      await expect(automator.harvest())
        .to.changeTokenBalances(collateral, [automator, feeCollector], [parseEther("0.194").mul(-1), parseEther("0.194")]);
      expect(await automator.totalFee()).to.equal(0);
    });
    it("should claim pending redemptions", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automator.connect(minter).mintProducts([productMint], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
          isMaker: 0
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      await expect(automator.connect(minter).withdraw(parseEther("100"))).to.changeTokenBalance(collateral, minter, 0);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automator.connect(minter).burnProducts([productBurn]))
        .to.emit(automator, "ProductsBurned");
      await expect(automator.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automator], [parseEther("109.603"), parseEther("109.603").mul(-1)]);
    });
    it("should successfully deposit after growth in fund value", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automator.connect(minter).mintProducts([productMint], signaturesSignature);
      const receipt = await tx.wait();
      const collateralAtRiskPercentage = getCatRP(vaultA, receipt);
      const productBurn  = {
        vault: vaultA.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPrices,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
          isMaker: 0
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      //console.log(await automator.balanceOf(minter.address));
      await expect(automator.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automator, vaultA, aavePool], [parseEther("99.7"), 0, parseEther("99.7").mul(-1)]);
      //automator: +9.7(fee: 0.097)
      //another deposit
      expect(await automator.totalCollateral()).to.equal(parseEther("109.603"));
      await automator.connect(minter).deposit(ethers.utils.parseEther("100"));
      //100+ 100/1.09603
      const amount = parseEther("191.238378511537092962");
      expect(await automator.balanceOf(minter.address)).to.equal(amount);
      await automator.connect(minter).withdraw(amount);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      const amountWd = parseEther("209.602999999999999999");
      //console.log(await automator.getPricePerShare());
      await expect(automator.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automator], [amountWd, amountWd.mul(-1)]);
      expect(await automator.getPricePerShare()).to.equal(parseEther("1"));
      expect(await automator.totalSupply()).to.equal(0);
    });
    it("should claim if burn with loss", async function () {
      const signaturesSignature = await signSignatures([productMintC], maker);
      const tx = await automator.connect(minter).mintProducts([productMintC], signaturesSignature);
      const receipt = await tx.wait();
      await automator.connect(minter).withdraw(parseEther("100"));
      const collateralAtRiskPercentage = getCatRP(vaultC, receipt);
      const productBurn  = {
        vault: vaultC.address,
        products: [{
          expiry: expiry,
          anchorPrices: anchorPricesC,
          collateralAtRiskPercentage: collateralAtRiskPercentage,
          isMaker: 0
        }]
      };
      await time.increaseTo(expiry);
      await oracle.settle();
      const left = parseEther("79.979607691404508172");
      await expect(automator.connect(minter).burnProducts([productBurn]))
        .to.changeTokenBalances(collateral, [automator, vaultC, aavePool], [left, 0, left.mul(-1)]);
      const amount = parseEther("99.979607691404508100");
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]);
      await expect(automator.connect(minter).claimRedemptions())
        .to.changeTokenBalances(collateral, [minter, automator], [amount, amount.mul(-1)]);
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
