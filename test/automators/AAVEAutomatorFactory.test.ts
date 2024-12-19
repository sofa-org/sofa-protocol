import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
//import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
//import { anyValue } from "@nomicfoundation/hardhat-chai-matchers";
import {
  deployFixture,
} from "../helpers/helpers";


describe("AutomatorFactory", function () {
  let automatorFactory: Contract;
  let owner: any;
  let addr1: any;
  let addr2: any;
  let collateral: any;
  let aavePool: any;

  beforeEach(async function () {
    [owner, addr1, addr2] = await ethers.getSigners();
    ({
      collateral,
      aavePool,
    } = await loadFixture(deployFixture));
    const AutomatorFactory = await ethers.getContractFactory("AAVEAutomatorFactory");
    automatorFactory = await AutomatorFactory.deploy(addr1.address, addr2.address, aavePool.address);
    await automatorFactory.deployed();
  });

  describe("Initialization", function () {
    it("should set the referral and fee collector addresses", async function () {
      expect(await automatorFactory.referral()).to.equal(addr1.address);
      expect(await automatorFactory.feeCollector()).to.equal(addr2.address);
      expect(await automatorFactory.automator()).to.not.equal(ethers.constants.AddressZero);
    });
  });

  describe("Setters", function () {
    it("should set a new referral address", async function () {
      await automatorFactory.setReferral(owner.address);
      expect(await automatorFactory.referral()).to.equal(owner.address);
    });

    it("should emit an event on setting a new referral address", async function () {
      await expect(automatorFactory.setReferral(owner.address))
        .to.emit(automatorFactory, "ReferralSet")
        .withArgs(addr1.address, owner.address);
    });

    it("should revert if referral not set by the owner", async function () {
      await expect(automatorFactory.connect(addr1).setReferral(owner.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if new referral is zero address", async function () {
      await expect(automatorFactory.setReferral(ethers.constants.AddressZero))
        .to.be.revertedWith("AutomatorFactory: referral is the zero address");
    });

    it("should set a new fee collector address", async function () {
      await automatorFactory.setFeeCollector(owner.address);
      expect(await automatorFactory.feeCollector()).to.equal(owner.address);
    });

    it("should emit an event on setting a new fee collector", async function () {
      await expect(automatorFactory.setFeeCollector(owner.address))
        .to.emit(automatorFactory, "FeeCollectorSet")
        .withArgs(addr2.address, owner.address);
    });

    it("should revert if fee collector not set by the owner", async function () {
      await expect(automatorFactory.connect(addr1).setFeeCollector(owner.address))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should revert if new fee collecotr is zero address", async function () {
      await expect(automatorFactory.setFeeCollector(ethers.constants.AddressZero))
        .to.be.revertedWith("AutomatorFactory: feeCollector is the zero address");
    });

    it("should add user credits", async function () {
      const num = 2;
      await automatorFactory.topUp(addr1.address, num);
      expect(await automatorFactory.credits(addr1.address)).to.equal(num);
    });

    it("should emit an event on adding user credits", async function () {
      const num = 2;
      await expect(automatorFactory.topUp(addr1.address, num))
        .to.emit(automatorFactory, "CreditsTopUp")
        .withArgs(addr1.address, num);
    });

    it("should revert if user credits not set by the owner", async function () {
      await expect(automatorFactory.connect(addr1).topUp(addr1.address, 1))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

  });

  describe("Automator Creation", function () {
    it("should create a new automator", async function () {
      const feeRate = 1000;
      const maxPeriod = 5
      await automatorFactory.topUp(addr1.address, 1);
      const tx = await automatorFactory.connect(addr1).createAutomator(feeRate, maxPeriod, collateral.address);
      const receipt = await tx.wait();
      const args = receipt.events[1].args;
      //console.log("args:", args);
      expect(args[0]).to.equal(addr1.address);
      expect(args[1]).to.equal(collateral.address);
      expect(args[2]).to.equal(await automatorFactory.getAutomator(addr1.address, collateral.address));
      expect(args[3]).to.equal(feeRate);
      expect(args[4]).to.equal(maxPeriod);
      expect(await automatorFactory.credits(addr1.address)).to.equal(0);
    });
    
    it("should revert if credits == 0", async function () {
      const feeRate = 1000;
      const maxPeriod = 5
      await expect(automatorFactory.connect(addr1).createAutomator(feeRate, maxPeriod, collateral.address))
        .to.be.revertedWith("AutomatorFactory: insufficient credits");
    });

    it("should revert if recreate the same automator", async function () {
      const feeRate = 1000;
      const maxPeriod = 5
      await automatorFactory.topUp(addr1.address, 2);
      await automatorFactory.connect(addr1).createAutomator(feeRate, maxPeriod, collateral.address);
      await expect(automatorFactory.connect(addr1).createAutomator(feeRate, maxPeriod, collateral.address))
        .to.be.revertedWith("ERC1167: create2 failed");
    });

    it("should return the correct number of automators", async function () {
      const maxPeriod = 5;
      await automatorFactory.topUp(owner.address, 1);
      await automatorFactory.topUp(addr1.address, 1);
      await automatorFactory.createAutomator(1000, maxPeriod, collateral.address);
      await automatorFactory.connect(addr1).createAutomator(2000, maxPeriod, collateral.address);
      expect(await automatorFactory.automatorsLength()).to.equal(2);
    });
  });

  describe("Vault Management", function () {
    it("should enable vaults", async function () {
      const vaults = [addr1.address, addr2.address];
      await automatorFactory.enableVaults(vaults);

      for (const vault of vaults) {
        expect(await automatorFactory.vaults(vault)).to.be.true;
      }
    });

    it("should revert if enable vaults not by the owner", async function () {
      const vaults = [addr1.address, addr2.address];
      await expect(automatorFactory.connect(addr1).enableVaults(vaults))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should disable vaults", async function () {
      const vaults = [addr1.address, addr2.address];
      await automatorFactory.enableVaults(vaults);
      await automatorFactory.disableVaults(vaults);

      for (const vault of vaults) {
        expect(await automatorFactory.vaults(vault)).to.be.false;
      }
    });

    it("should revert if disable vaults not by the owner", async function () {
      const vaults = [addr1.address, addr2.address];
      await expect(automatorFactory.connect(addr1).disableVaults(vaults))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("Maker Management", function () {
    it("should enable makers", async function () {
      const makers = [addr1.address, addr2.address];
      await automatorFactory.enableMakers(makers);

      for (const maker of makers) {
        expect(await automatorFactory.makers(maker)).to.be.true;
      }
    });

    it("should revert if enable makers not by the owner", async function () {
      const makers = [addr1.address, addr2.address];
      await expect(automatorFactory.connect(addr1).enableMakers(makers))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should disable makers", async function () {
      const makers = [addr1.address, addr2.address];
      await automatorFactory.enableMakers(makers);
      await automatorFactory.disableMakers(makers);

      for (const maker of makers) {
        expect(await automatorFactory.makers(maker)).to.be.false;
      }
    });

    it("should revert if disable makers not by the owner", async function () {
      const makers = [addr1.address, addr2.address];
      await expect(automatorFactory.connect(addr1).disableMakers(makers))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
});
