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

describe("AutoManager", function () {
  let collateral, feeCollector, oracle, owner, minter, maker, referral, vaultA, vaultB, eip721DomainA, eip721DomainB, aggregator, rch, airdrop, atoken, aavePool, autoManager;
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
      rch,
      airdrop,
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
    vaultB = await upgrades.deployProxy(VaultA, [
      "Reliable USDT",
      "rUSDT",
      strategyB.address, // Mock strategy contract
      collateral.address,
      aavePool.address,
      feeCollector.address,
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

    // AUtoManager contract
    const AutoManager = await ethers.getContractFactory("AutoManager");
    autoManager = await upgrades.deployProxy(AutoManager, [
      rch.address,
      collateral.address,
      airdrop.address,
      referral.address
    ]);

    await collateral.connect(minter).approve(autoManager.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultA.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultB.address, constants.MaxUint256); // approve max
  });

  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await autoManager.rch()).to.equal(rch.address);
      expect(await autoManager.collateral()).to.equal(collateral.address);
      expect(await autoManager.airdrop()).to.equal(airdrop.address);
      expect(await autoManager.refferal()).to.equal(referral.address);
    });
  });


  describe("Deposit/Withdraw", function () {
    it("Should deposit collateral to vault", async function () {
      const amount = parseEther("100");
      await expect(autoManager.connect(minter).deposit(amount)).to.emit(autoManager, "Deposit");
      expect(await collateral.balanceOf(autoManager.address)).to.be.equal(amount);
      const { shares }  = await autoManager.connect(minter).getUserInfo()
      expect(shares).to.equal(amount);
    });

    it("Should not allow withdraw within 7 days of deposit", async function () {
      await autoManager.connect(minter).deposit(ethers.utils.parseEther("100"));
      await expect(autoManager.connect(minter).withdraw(ethers.utils.parseEther("50"))).to.be.revertedWith("AutoManager: can't withdraw within 7 days of deposit");
    });

    it("Should allow withdraw after 7 days", async function () {
      await autoManager.connect(minter).deposit(ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 8]); // Fast forward 8 days
      await autoManager.connect(minter).withdraw(ethers.utils.parseEther("50"));
      const { shares }  = await autoManager.connect(minter).getUserInfo()
      expect(shares).to.equal(ethers.utils.parseEther("50"));
    });
  });

  describe("Mint/Burn Products", function () {
    let productMint: any;
    let productMintB: any;
    let expiry, anchorPrices, anchorPricesB;
    beforeEach(async function () {
      await autoManager.enableMakers([maker.address]);
      await autoManager.enableVaults([vaultA.address, vaultB.address]);
      await autoManager.connect(minter).deposit(ethers.utils.parseEther("100"));
      const totalCollateral = parseEther("100");
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      anchorPrices = [parseEther("28000"), parseEther("30000")];
      anchorPricesB = [parseEther("30000"), parseEther("32000")];
      const collateralAtRisk = parseEther("20");
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      const signature = await signMintParamsWithCollateralAtRisk(
        totalCollateral,
        expiry,
        anchorPrices,
        collateralAtRisk,
        makerCollateral,
        deadline,
        vaultA,
        autoManager,
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
        autoManager,
        maker,
        eip721DomainB
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
    });

    it("should successfully mint products with valid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await expect(autoManager.connect(minter).mintProducts([productMint], signaturesSignature)).to.not.be.reverted;
    });

    it("should fail minting products with invalid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], minter);
      await expect(autoManager.connect(minter).mintProducts([productMint], signaturesSignature)).to.be.revertedWith("AutoManager: invalid maker");
    });

    it("should fail if a vault is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await autoManager.disableVaults([vaultA.address]);
      await expect(autoManager.connect(minter).mintProducts([productMint], signaturesSignature)).to.be.revertedWith("AutoManager: invalid vault");
    });

    it("should fail if a maker is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await autoManager.disableMakers([maker.address]);
      await expect(autoManager.connect(minter).mintProducts([productMint], signaturesSignature)).to.be.revertedWith("AutoManager: invalid maker");
    });

    it("should successfully burn products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await autoManager.connect(minter).mintProducts([productMint], signaturesSignature);
      let receipt = await tx.wait();
      let collateralAtRiskPercentage;

      for (const log of receipt.logs) {
        try {
          const event = vaultA.interface.parseLog(log);
          if (event.name === 'Minted') {
            collateralAtRiskPercentage = event.args.collateralAtRiskPercentage;
            break;
          }
        } catch (error) {
          continue;
        }
      }

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
      await expect(autoManager.connect(minter).burnProducts([productBurn])).to.not.be.reverted;
      expect(await autoManager.accCollateralPerShare()).to.equal(parseEther("0.097"));
    });

    it("should successfully mint/burn two products", async function () {
      await autoManager.connect(minter).deposit(ethers.utils.parseEther("100"));
      const signaturesSignature = await signSignatures([productMint, productMintB], maker);
      const tx = await autoManager.connect(minter).mintProducts([productMint, productMintB], signaturesSignature);
      let receipt = await tx.wait();
      let collateralAtRiskPercentage;

      for (const log of receipt.logs) {
        try {
          const event = vaultA.interface.parseLog(log);
          if (event.name === 'Minted') {
            collateralAtRiskPercentage = event.args.collateralAtRiskPercentage;
            break;
          }
        } catch (error) {
          continue;
        }
      }

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
      await expect(autoManager.connect(minter).burnProducts([productBurn, productBurnB])).to.not.be.reverted;
      expect(await autoManager.accCollateralPerShare()).to.equal(parseEther("0.097"));
    });

    it("should withdraw zero", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await autoManager.connect(minter).mintProducts([productMint], signaturesSignature);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 8]); // Fast forward 8 days
      await expect(autoManager.connect(minter).withdraw(parseEther("100"))).to.changeTokenBalance(collateral, minter, 0);
      expect(await autoManager.totalPendingRedemptions()).to.equal(parseEther("100"));
    });

    it("should claim pending redemptions", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await autoManager.connect(minter).mintProducts([productMint], signaturesSignature);
      let receipt = await tx.wait();
      let collateralAtRiskPercentage;

      for (const log of receipt.logs) {
        try {
          const event = vaultA.interface.parseLog(log);
          if (event.name === 'Minted') {
            collateralAtRiskPercentage = event.args.collateralAtRiskPercentage;
            break;
          }
        } catch (error) {
          continue;
        }
      }

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

      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 8]); // Fast forward 8 days
      await expect(autoManager.connect(minter).withdraw(parseEther("99"))).to.changeTokenBalance(collateral, minter, 0);

      await expect(autoManager.connect(minter).burnProducts([productBurn])).to.not.be.reverted;
      await expect(autoManager.connect(minter).claimRedemptions()).to.changeTokenBalance(collateral, minter, parseEther("99"));
    });
  });

  describe("Claim RCH", function () {
    let timestampA, timestampB, amountAirdrop, anotherNode;
    beforeEach(async function () {
      const addr = autoManager.address;
      amountAirdrop = ethers.utils.parseUnits("1", 18);
      const leaf = leafComp(addr, amountAirdrop);
      //console.log("leaf:", leaf);
      anotherNode = '0x1daab6e461c57679d093fe722a8bf8ba48798a5a9386000d2176d175bc5fae57';
      const merkleRoot = nodeComp(leaf, anotherNode);
      //console.log("merkleRoot:", merkleRoot);
      // yesterday 12am timestamp
      let currentDate = new Date();
      currentDate.setDate(currentDate.getDate());
      currentDate.setUTCHours(0, 0, 0, 0);
      timestampA = Math.floor(currentDate.getTime() / 1000);
      await airdrop.connect(owner).setMerkleRoot(timestampA, merkleRoot);
      let yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      yesterdayDate.setUTCHours(0, 0, 0, 0);
      timestampB = Math.floor(yesterdayDate.getTime() / 1000);
      await airdrop.connect(owner).setMerkleRoot(timestampB, merkleRoot);
    });

    it("Should successfully claim airdrop", async function () {
      const amount = parseEther("100");
      await autoManager.connect(minter).deposit(amount);
      const indexes = [timestampA, timestampB];
      const amounts = [amountAirdrop, amountAirdrop];
      const merkleProofs = [[anotherNode], [anotherNode]];
      await expect(autoManager.connect(minter).claimRCH(indexes, amounts, merkleProofs))
            .to.emit(autoManager, 'RCHClaimed');
    });

    it("Should calculate correct RCH per share", async function () {
      const amount = parseEther("100");
      await autoManager.connect(minter).deposit(amount);
      const indexes = [timestampA, timestampB];
      const amounts = [amountAirdrop, amountAirdrop];
      const merkleProofs = [[anotherNode], [anotherNode]];
      await expect(autoManager.connect(minter).claimRCH(indexes, amounts, merkleProofs))
            .to.emit(autoManager, 'RCHClaimed');
      expect(await rch.balanceOf(autoManager.address)).to.equal(amountAirdrop.mul(2));
      expect(await autoManager.accRCHPerShare()).to.equal(parseEther("0.02"));
      const { pendingRCH } = await autoManager.connect(minter).getUserInfo();
      expect(pendingRCH).to.equal(parseEther("2"));
    });

    it("Should claim RCH", async function () {
      const amount = parseEther("100");
      await autoManager.connect(minter).deposit(amount);
      const indexes = [timestampA, timestampB];
      const amounts = [amountAirdrop, amountAirdrop];
      const merkleProofs = [[anotherNode], [anotherNode]];
      await expect(autoManager.connect(minter).claimRCH(indexes, amounts, merkleProofs))
            .to.emit(autoManager, 'RCHClaimed');
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 8]); // Fast forward 8 days
      await autoManager.connect(minter).withdraw(ethers.utils.parseEther("50"));
      expect(await rch.balanceOf(minter.address)).to.equal(parseEther("2"));
      const { pendingRCH } = await autoManager.connect(minter).getUserInfo();
      expect(pendingRCH).to.equal(parseEther("0"));
    });

    it("Should false by default claim interest", async function () {
      const indexes = [timestampA, timestampB];
      expect(await autoManager.rchClaimed(indexes))
        .to.deep.equal([false, false]);
    });

    it("Should true after claimInterest", async function () {
      const amount = parseEther("100");
      await autoManager.connect(minter).deposit(amount);
      const indexes = [timestampA, timestampB];
      const amounts = [amountAirdrop, amountAirdrop];
      const merkleProofs = [[anotherNode], [anotherNode]];
      await autoManager.claimRCH(indexes, amounts, merkleProofs);
      expect(await autoManager.rchClaimed(indexes))
        .to.deep.equal([true, true]);
    });
  });
})
