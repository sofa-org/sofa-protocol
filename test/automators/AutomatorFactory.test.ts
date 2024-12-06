import { ethers } from "hardhat";
import { expect } from "chai";
import { Contract } from "ethers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
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
    const AutomatorFactory = await ethers.getContractFactory("AutomatorFactory");
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

    it("should set a new fee collector address", async function () {
      await automatorFactory.setFeeCollector(owner.address);
      expect(await automatorFactory.feeCollector()).to.equal(owner.address);
    });

    it("should emit an event on setting a new fee collector", async function () {
      await expect(automatorFactory.setFeeCollector(owner.address))
        .to.emit(automatorFactory, "FeeCollectorSet")
        .withArgs(addr2.address, owner.address);
    });
  });

  describe("Automator Creation", function () {
    it("should create a new automator", async function () {
      const feeRate = 1000;

      await expect(automatorFactory.createAutomator(feeRate, collateral.address))
        .to.emit(automatorFactory, "AutomatorCreated")
        .withArgs(owner.address, collateral.address, await automatorFactory.getAutomator(owner.address, collateral.address), feeRate);
    });

    it("should return the correct number of automators", async function () {
      await automatorFactory.createAutomator(1000, collateral.address);
      await automatorFactory.connect(addr1).createAutomator(2000, collateral.address);

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

    it("should disable vaults", async function () {
      const vaults = [addr1.address, addr2.address];
      await automatorFactory.enableVaults(vaults);
      await automatorFactory.disableVaults(vaults);

      for (const vault of vaults) {
        expect(await automatorFactory.vaults(vault)).to.be.false;
      }
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

    it("should disable makers", async function () {
      const makers = [addr1.address, addr2.address];
      await automatorFactory.enableMakers(makers);
      await automatorFactory.disableMakers(makers);

      for (const maker of makers) {
        expect(await automatorFactory.makers(maker)).to.be.false;
      }
    });
  });
});
