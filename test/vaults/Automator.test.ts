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
  let collateral, feeCollector, oracle, owner, minter, maker, referral, vaultA, vaultB, eip721DomainA, eip721DomainB, aggregator, airdrop, atoken, aavePool, automator;
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

    // Automator contract
    const Automator = await ethers.getContractFactory("Automator");
    automator = await upgrades.deployProxy(Automator, [
      collateral.address,
      airdrop.address,
      referral.address,
      feeCollector.address,
    ]);

    await collateral.connect(minter).approve(automator.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultA.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vaultB.address, constants.MaxUint256); // approve max
  });

  describe("Initialization", function () {
    it("Should initialize with correct parameters", async function () {
      expect(await automator.collateral()).to.equal(collateral.address);
      expect(await automator.airdrop()).to.equal(airdrop.address);
      expect(await automator.refferal()).to.equal(referral.address);
    });
  });


  describe("Deposit/Withdraw", function () {
    it("Should deposit collateral to vault", async function () {
      const amount = parseEther("100");
      await expect(automator.connect(minter).deposit(amount)).to.emit(automator, "Deposited");
      expect(await collateral.balanceOf(automator.address)).to.be.equal(amount);
      expect(await automator.balanceOf(minter.address)).to.equal(amount);
    });

    it("Can't claim when less than 7 days after withdraw", async function () {
      await automator.connect(minter).deposit(ethers.utils.parseEther("100"));
      await automator.connect(minter).withdraw(ethers.utils.parseEther("50"));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 6]); // Fast forward 7 days
      await expect(automator.connect(minter).claimRedemptions()).to.be.reverted;
    });

    it("Should claim when 7 days after withdraw", async function () {
      await automator.connect(minter).deposit(ethers.utils.parseEther("100"));
      await automator.connect(minter).withdraw(ethers.utils.parseEther("50"));
      expect(await automator.balanceOf(minter.address)).to.equal(ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automator.connect(minter).claimRedemptions()).to.changeTokenBalance(collateral, minter, ethers.utils.parseEther("50"));
      expect(await automator.balanceOf(minter.address)).to.equal(ethers.utils.parseEther("50"));
    });
  });

  describe("Mint/Burn Products", function () {
    let productMint: any;
    let productMintB: any;
    let expiry, anchorPrices, anchorPricesB;
    beforeEach(async function () {
      await automator.enableMakers([maker.address]);
      await automator.enableVaults([vaultA.address, vaultB.address]);
      await automator.connect(minter).deposit(ethers.utils.parseEther("100"));
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
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature)).to.not.be.reverted;
    });

    it("should fail minting products with invalid signature", async function () {
      const signaturesSignature = await signSignatures([productMint], minter);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature)).to.be.revertedWith("Automator: invalid maker");
    });

    it("should fail if a vault is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automator.disableVaults([vaultA.address]);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature)).to.be.revertedWith("Automator: invalid vault");
    });

    it("should fail if a maker is not whitelisted", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      await automator.disableMakers([maker.address]);
      await expect(automator.connect(minter).mintProducts([productMint], signaturesSignature)).to.be.revertedWith("Automator: invalid maker");
    });

    it("should successfully burn products", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automator.connect(minter).mintProducts([productMint], signaturesSignature);
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
      await expect(automator.connect(minter).burnProducts([productBurn])).to.not.be.reverted;
      expect(await automator.totalFee()).to.equal(parseEther("0.097"));
      expect(await automator.accCollateralPerShare()).to.equal(parseEther("1.09603"));
    });

    it("should successfully mint/burn two products", async function () {
      await automator.connect(minter).deposit(ethers.utils.parseEther("100"));
      const signaturesSignature = await signSignatures([productMint, productMintB], maker);
      const tx = await automator.connect(minter).mintProducts([productMint, productMintB], signaturesSignature);
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
      await expect(automator.connect(minter).burnProducts([productBurn, productBurnB])).to.not.be.reverted;
      expect(await automator.totalFee()).to.equal(parseEther("0.194"));
      expect(await automator.accCollateralPerShare()).to.equal(parseEther("1.09603"));

      await expect(automator.harvest()).to.changeTokenBalance(collateral, feeCollector, parseEther("0.194"));
      expect(await automator.totalFee()).to.equal(0);
    });

    it("should withdraw zero", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automator.connect(minter).mintProducts([productMint], signaturesSignature);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
      await expect(automator.connect(minter).withdraw(parseEther("100"))).to.changeTokenBalance(collateral, minter, 0);
      expect(await automator.totalPendingRedemptions()).to.equal(parseEther("100"));
    });

    it("should claim pending redemptions", async function () {
      const signaturesSignature = await signSignatures([productMint], maker);
      const tx = await automator.connect(minter).mintProducts([productMint], signaturesSignature);
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

      await expect(automator.connect(minter).withdraw(parseEther("99"))).to.changeTokenBalance(collateral, minter, 0);
      await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days

      await expect(automator.connect(minter).burnProducts([productBurn])).to.not.be.reverted;
      await expect(automator.connect(minter).claimRedemptions()).to.changeTokenBalance(collateral, minter, parseEther("99"));
    });
  });

  // describe("Claim RCH", function () {
  //   let timestampA, timestampB, amountAirdrop, anotherNode;
  //   beforeEach(async function () {
  //     const addr = automator.address;
  //     amountAirdrop = ethers.utils.parseUnits("1", 18);
  //     const leaf = leafComp(addr, amountAirdrop);
  //     //console.log("leaf:", leaf);
  //     anotherNode = '0x1daab6e461c57679d093fe722a8bf8ba48798a5a9386000d2176d175bc5fae57';
  //     const merkleRoot = nodeComp(leaf, anotherNode);
  //     //console.log("merkleRoot:", merkleRoot);
  //     // yesterday 12am timestamp
  //     let currentDate = new Date();
  //     currentDate.setDate(currentDate.getDate());
  //     currentDate.setUTCHours(0, 0, 0, 0);
  //     timestampA = Math.floor(currentDate.getTime() / 1000);
  //     await airdrop.connect(owner).setMerkleRoot(timestampA, merkleRoot);
  //     let yesterdayDate = new Date();
  //     yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  //     yesterdayDate.setUTCHours(0, 0, 0, 0);
  //     timestampB = Math.floor(yesterdayDate.getTime() / 1000);
  //     await airdrop.connect(owner).setMerkleRoot(timestampB, merkleRoot);
  //   });

  //   it("Should successfully claim airdrop", async function () {
  //     const amount = parseEther("100");
  //     await automator.connect(minter).deposit(amount);
  //     const indexes = [timestampA, timestampB];
  //     const amounts = [amountAirdrop, amountAirdrop];
  //     const merkleProofs = [[anotherNode], [anotherNode]];
  //     await expect(automator.connect(minter).claimRCH(indexes, amounts, merkleProofs))
  //           .to.emit(automator, 'RCHClaimed');
  //   });

  //   it("Should calculate correct RCH per share", async function () {
  //     const amount = parseEther("100");
  //     await automator.connect(minter).deposit(amount);
  //     const indexes = [timestampA, timestampB];
  //     const amounts = [amountAirdrop, amountAirdrop];
  //     const merkleProofs = [[anotherNode], [anotherNode]];
  //     await expect(automator.connect(minter).claimRCH(indexes, amounts, merkleProofs))
  //           .to.emit(automator, 'RCHClaimed');
  //     expect(await rch.balanceOf(automator.address)).to.equal(amountAirdrop.mul(2));
  //     expect(await automator.accRCHPerShare()).to.equal(parseEther("0.02"));
  //     const { pendingRCH } = await automator.connect(minter).getUserInfo();
  //     expect(pendingRCH).to.equal(parseEther("2"));
  //   });

  //   it("Should claim RCH", async function () {
  //     const amount = parseEther("100");
  //     await automator.connect(minter).deposit(amount);
  //     const indexes = [timestampA, timestampB];
  //     const amounts = [amountAirdrop, amountAirdrop];
  //     const merkleProofs = [[anotherNode], [anotherNode]];
  //     await expect(automator.connect(minter).claimRCH(indexes, amounts, merkleProofs))
  //           .to.emit(automator, 'RCHClaimed');
  //     await ethers.provider.send("evm_increaseTime", [60 * 60 * 24 * 7]); // Fast forward 7 days
  //     await automator.connect(minter).withdraw(ethers.utils.parseEther("50"));
  //     expect(await rch.balanceOf(minter.address)).to.equal(parseEther("2"));
  //     const { pendingRCH } = await automator.connect(minter).getUserInfo();
  //     expect(pendingRCH).to.equal(parseEther("0"));
  //   });

  //   it("Should false by default claim interest", async function () {
  //     const indexes = [timestampA, timestampB];
  //     expect(await automator.rchClaimed(indexes))
  //       .to.deep.equal([false, false]);
  //   });

  //   it("Should true after claimInterest", async function () {
  //     const amount = parseEther("100");
  //     await automator.connect(minter).deposit(amount);
  //     const indexes = [timestampA, timestampB];
  //     const amounts = [amountAirdrop, amountAirdrop];
  //     const merkleProofs = [[anotherNode], [anotherNode]];
  //     await automator.claimRCH(indexes, amounts, merkleProofs);
  //     expect(await automator.rchClaimed(indexes))
  //       .to.deep.equal([true, true]);
  //   });
  // });
})
