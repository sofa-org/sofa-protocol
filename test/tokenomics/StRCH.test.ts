import { expect } from "chai";
import { ethers, network } from "hardhat";
import { constants } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const { parseEther } = ethers.utils;

describe("StRCH", function () {
  //fixture
  async function deployFixture() {
    const [owner, vaultA, vaultB, user] = await ethers.getSigners();
    //console.log("owner", owner.address);
    const StRCH = await ethers.getContractFactory("StRCH");
    const strch = await StRCH.deploy();
    //deploy RCH at the specific address
    const rchAddr = await strch.RCH();
    const RCH = await ethers.getContractFactory("RCH");
    const rchTemp = await RCH.deploy(0);
    //deploy RCH at 0x57B96D4aF698605563A4653D882635da59Bf11AF
    const rchData = await ethers.provider.getCode(rchTemp.address);
    await network.provider.send("hardhat_setCode", [
      rchAddr,
      rchData,
    ]);
    const rch = await RCH.attach(rchAddr);
    const rchOwner = await rch.owner();
    const rchSigner = await ethers.getSigner(rchOwner);
    //to make the address controlled
    await hre.network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [rchOwner],
    });
    await owner.sendTransaction({to: rchOwner, value: parseEther("1")});
    //change RCH owner from 0x0 to owner
    await rch.connect(rchSigner).transferOwnership(owner.address);
    //mint and approve for vaultA and vaultB
    await rch.connect(owner).mint(vaultA.address, parseEther("1000"));
    await rch.connect(owner).mint(vaultB.address, parseEther("1000"));
    await rch.connect(vaultA).approve(strch.address, constants.MaxUint256);
    await rch.connect(vaultB).approve(strch.address, constants.MaxUint256);
    return {strch, owner, vaultA, vaultB, user};
  }

  let strch: any, owner: any, vaultA: any, vaultB: any, user: any;
  beforeEach(async function () {
     ({strch, owner, vaultA, vaultB, user} = await loadFixture(deployFixture));
  })
  
  describe("enableVaults", function () {
    it("Should enable vault ", async function () {
      await strch.enableVaults([vaultA.address, vaultB.address]);
      await strch.connect(vaultA).mint(10); //bug1: totalShares == 0
    });
    it("Should fail if not enabled", async function () {
      await expect(strch.connect(vaultA).mint(10)).to.be.revertedWith("StRCH: caller is not a vault");
    });
  });

  describe("updateInterestRate", function () {
    it("Should update interest rate ", async function () {
      const ir = parseEther("1"); //100%
      await strch.updateInterestRate(ir); //1e18
      expect(await strch.interestRate()).to.equal(ir);
    });
    // it("Should emit log", async function () {
    // });
    // it("Should revert if not owner", async function () {
    // });
  })

  describe("mint", function () {
    it("Should show bug", async function () {
      const ir = parseEther("1"); //100% to make it obvious
      await strch.updateInterestRate(ir);
      await strch.enableVaults([vaultA.address, vaultB.address]);
      const amount = parseEther("100"); //100
      const aYear = 60*60*24*365;

      await strch.connect(vaultA).mint(amount);
      await strch.connect(vaultB).mint(amount);
      console.log("balance of A:", await strch.balanceOf(vaultA.address));
      console.log("balance of B:", await strch.balanceOf(vaultB.address));
      console.log("userAccRewards A:", await strch.userAccRewards(vaultA.address));
      console.log("userAccRewards B:", await strch.userAccRewards(vaultB.address));
      console.log("accRewardsPerShare:", await strch.accRewardsPerShare());

      let futureTime = (await time.latest()) + aYear
      await time.increaseTo(futureTime);
      console.log("== After a year ==");
      await strch.connect(vaultA).mint(0);
      console.log("balance of A:", await strch.balanceOf(vaultA.address));
      console.log("balance of B:", await strch.balanceOf(vaultB.address));
      console.log("userAccRewards A:", await strch.userAccRewards(vaultA.address));
      console.log("userAccRewards B:", await strch.userAccRewards(vaultB.address));
      console.log("accRewardsPerShare:", await strch.accRewardsPerShare());
      
      futureTime = (await time.latest()) + aYear;
      await time.increaseTo(futureTime);
      console.log("== After a year ==");
      console.log("balance of A:", await strch.balanceOf(vaultA.address));
      console.log("balance of B:", await strch.balanceOf(vaultB.address));
      console.log("A and B should not have such a big difference");

    });
  })


})