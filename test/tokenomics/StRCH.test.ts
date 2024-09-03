import { expect } from "chai";
import { ethers, network } from "hardhat";
import { constants } from "ethers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const { parseEther } = ethers.utils;

describe("StRCH", function () {
  //fixture
  async function deployFixture() {
    const [owner, vaultA, vaultB, user] = await ethers.getSigners();
    //deploy RCH token
    const RCH = await ethers.getContractFactory("RCH");
    const rch = await RCH.deploy(0);
    //deploy MerkleAirdrop
    const Airdrop = await ethers.getContractFactory("MerkleAirdrop");
    const airdrop = await Airdrop.deploy(rch.address);
    //deploy StRCH
    const interestRate = parseEther("0.03");
    const StRCH = await ethers.getContractFactory("StRCH");
    const strch = await StRCH.deploy(rch.address, airdrop.address, interestRate);
    //mint and approve for vaultA and vaultB
    await rch.mint(vaultA.address, parseEther("1000"));
    await rch.mint(vaultB.address, parseEther("1000"));
    await rch.connect(vaultA).approve(strch.address, constants.MaxUint256);
    await rch.connect(vaultB).approve(strch.address, constants.MaxUint256);
    //MerkleAirdrop
    await rch.transferOwnership(airdrop.address);
    const addr = strch.address //"0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const amountAirdrop = ethers.utils.parseUnits("1", 18);
    const leaf = leafComp(addr, amountAirdrop);
    //console.log("leaf:", leaf);
    const anotherNode = '0x1daab6e461c57679d093fe722a8bf8ba48798a5a9386000d2176d175bc5fae57';
    const merkleRoot = nodeComp(leaf, anotherNode);
    //console.log("merkleRoot:", merkleRoot);
    // yesterday 12am timestamp
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate());
    currentDate.setUTCHours(0, 0, 0, 0);
    const timestampA = Math.floor(currentDate.getTime() / 1000); 
    await airdrop.connect(owner).setMerkleRoot(timestampA, merkleRoot);
    let yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    yesterdayDate.setUTCHours(0, 0, 0, 0);
    const timestampB = Math.floor(yesterdayDate.getTime() / 1000);
    await airdrop.connect(owner).setMerkleRoot(timestampB, merkleRoot);
    return {rch, airdrop, strch, vaultA, vaultB, user, 
            timestampA, timestampB, amountAirdrop, anotherNode}; //for merkleAirdrop
  }

  let rch: any, airdrop: any, strch: any, vaultA: any, vaultB: any, user: any;
  let timestampA: any, timestampB: any, amountAirdrop: any, anotherNode: any;
  beforeEach(async function () {
     ({rch, airdrop, strch, vaultA, vaultB, user, 
       timestampA, timestampB, amountAirdrop, anotherNode} = await loadFixture(deployFixture));
  });
  
  describe("enableVaults", function () {
    it("Should enable vault ", async function () {
      await strch.enableVaults([vaultA.address, vaultB.address]);
      await strch.connect(vaultA).mint(10);
      await strch.connect(vaultA).withdraw(user.address, 10);
      await strch.connect(vaultB).mint(10);
    });
    it("Should revert if mint not enabled", async function () {
      await expect(strch.connect(vaultA).mint(10)).
        to.be.revertedWith("StRCH: caller is not a vault");
    });
    it("Should revert if burn not enabled", async function () {
      await expect(strch.connect(vaultA).withdraw(user.address, 10)).
        to.be.revertedWith("StRCH: caller is not a vault");
    });
    it("Should revert if not called by owner", async function () {
      await expect(strch.connect(user).enableVaults([vaultA.address, vaultB.address]))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("disableVaults", function () {
    it("Should disable many vaults ", async function () {
      await strch.enableVaults([vaultA.address, vaultB.address]);
      await strch.disableVaults([vaultA.address, vaultB.address]);
      await expect(strch.connect(vaultA).mint(10)).
        to.be.revertedWith("StRCH: caller is not a vault");
      await expect(strch.connect(vaultB).mint(10)).
        to.be.revertedWith("StRCH: caller is not a vault");
    });
    it("Should disable one vault", async function () {
      await strch.enableVaults([vaultA.address, vaultB.address]);
      await strch.disableVaults([vaultA.address]);
      await expect(strch.connect(vaultA).mint(10)).
        to.be.revertedWith("StRCH: caller is not a vault");
      await strch.connect(vaultB).mint(10);
    });
    it("Should revert if not called by owner", async function () {
      await expect(strch.connect(user).disableVaults([vaultA.address, vaultB.address]))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("updateInterestRate", function () {
    it("Should update interest rate ", async function () {
      const ir = parseEther("1"); //100%
      await strch.updateInterestRate(ir); //1e18
      expect(await strch.interestRate()).to.equal(ir);
    });
    it("Should emit log", async function () {
      const old = await strch.interestRate();
      const ir = parseEther("1");
      await expect(strch.updateInterestRate(ir))
        .to.emit(strch, "InterestRateUpdated")
        .withArgs(old, ir);
    });
    it("Should revert if not owner", async function () {
      const ir = parseEther("1");
      await expect(strch.connect(user).updateInterestRate(ir))
        .to.be.revertedWith("Ownable: caller is not the owner");
    });
  });
  
  describe("mint", function () {
    let amount: any = parseEther("100");
    beforeEach(async function () {
      await strch.enableVaults([vaultA.address]);
    });
    it("Should transfer RCH", async function () {
      //await strch.enableVaults([vaultA.address]);
      //const amount = parseEther("100");
      await expect(strch.connect(vaultA).mint(amount))
        .to.changeTokenBalances(rch, [vaultA, strch], [amount.mul(-1), amount]);
    });
    it("Should change userAccRewards", async function () {
      await strch.connect(vaultA).mint(amount);
      expect(await strch.userAccRewards(vaultA.address)).to.equal(amount);
    });
    it("Should change totalShares", async function () {
      await strch.connect(vaultA).mint(amount);
      expect(await strch.totalShares()).to.equal(amount);
    });
    it("Should change lastRewardsUpdateTimestamp", async function () {
      const beforeTime = await time.latest();
      //console.log("beforeTime", beforeTime);
      await strch.connect(vaultA).mint(amount);
      expect((await strch.lastRewardsUpdateTimestamp()) > beforeTime).to.equal(true);
    });
    it("Should change accRewardsPerShare", async function () {
      await strch.connect(vaultA).mint(amount);
      expect(await strch.accRewardsPerShare()).to.equal(parseEther("1")); //1e18
      await strch.connect(vaultA).mint(amount);
      expect(await strch.accRewardsPerShare()).to.equal("1000000000951293759");
    });
    it("Should emit log", async function () {
      await expect(strch.connect(vaultA).mint(amount))
        .to.emit(strch, "Mint")
        .withArgs(vaultA.address, amount, 0);
    });
    it("Should have pending rewards", async function () {
      await strch.connect(vaultA).mint(amount);
      const aYear = 60*60*24*365;
      const futureTime = (await time.latest()) + aYear;
      await time.increaseTo(futureTime);
      await expect(strch.connect(vaultA).mint(amount))
        .to.emit(strch, "Mint")
        .withArgs(vaultA.address, amount, "3000000095129375900");
    });
    it("Should not change lastRewardsUpdateTimestamp if block.timestamp == lastRewardsUpdateTimestamp", async function () {
      await network.provider.send("evm_setAutomine", [false]);
      const beforeTime = await time.latest();
      console.log("beforeTime", beforeTime);
      await strch.connect(vaultA).mint(amount);
      await strch.connect(vaultA).mint(amount);
      await network.provider.send("evm_mine");
      await network.provider.send("evm_setAutomine", [true]);
      expect(await strch.lastRewardsUpdateTimestamp())
        .to.equal(beforeTime+1);
    });
  });

  describe("withdraw", function () {
    let amount: any = parseEther("100");
    beforeEach(async function () {
      await strch.enableVaults([vaultA.address]);
      await strch.connect(vaultA).mint(amount);
    });

    it("Should transfer RCH", async function () {
      await expect(strch.connect(vaultA).withdraw(user.address, amount))
        .to.changeTokenBalances(rch, [vaultA, strch, user], [0, amount.mul(-1), amount]);
    });
    it("Should change userAccRewards", async function () {
      await strch.connect(vaultA).withdraw(user.address, amount);
      expect(await strch.userAccRewards(vaultA.address)).to.equal(95129375990);
    });
    it("Should change totalShares", async function () {
      await strch.connect(vaultA).withdraw(user.address, amount);
      expect(await strch.totalShares()).to.equal(95129375900);
    });
    it("Should change lastRewardsUpdateTimestamp", async function () {
      const beforeTime = await time.latest();
      //console.log("beforeTime", beforeTime);
      await strch.connect(vaultA).withdraw(user.address, amount);
      expect((await strch.lastRewardsUpdateTimestamp()) > beforeTime).to.equal(true);
    });
    it("Should change accRewardsPerShare", async function () {
      await strch.connect(vaultA).withdraw(user.address, amount.div(2));
      expect(await strch.accRewardsPerShare()).to.equal("1000000000951293759");
      await strch.connect(vaultA).mint(amount.div(2));
      expect(await strch.accRewardsPerShare()).to.equal("1000000001902587518");
    });
    it("Should not change shares when withdraw pendingRewards", async function () {
      const pendingRewards = "95129375900";
      await strch.connect(vaultA).withdraw(user.address, pendingRewards);
      expect(await strch.userAccRewards(vaultA.address)).to.equal(amount.add(pendingRewards));
    });
    it("Should emit log", async function () {
      await expect(strch.connect(vaultA).withdraw(user.address, amount))
        .to.emit(strch, "Burn")
        .withArgs(vaultA.address, user.address, amount, "95129375900");
    });
    it("Should revert if amount is greater than contract balance", async function () {
      await expect(strch.connect(vaultA).withdraw(user.address, amount.mul(2)))
        .to.be.revertedWith("StRCH: insufficient rewards");
    });
    it("Should revert if amount is greater than user balance", async function () {
      await strch.enableVaults([vaultB.address]);
      await strch.connect(vaultB).mint(amount);
      await expect(strch.connect(vaultA).withdraw(user.address, amount.mul(2)))
        .to.be.revertedWith("StRCH: insufficient balance");
    });
    it("Should user's shares be correct", async function () {
      const rewardPerBlock = 95129375900; //rewards per second 3%
      //withdraw amount == pendingRewards
      console.log("before withdraw:", await time.latest());
      await strch.connect(vaultA).withdraw(user.address, rewardPerBlock);
      console.log("after withdraw:", await time.latest());
      expect(await strch.userAccRewards(vaultA.address)).to.equal(amount.add(rewardPerBlock));
      console.log("after call userAccRewards:", await time.latest());
      expect(await strch.balanceOf(vaultA.address)).to.equal(amount);
      expect(await strch.totalShares()).to.equal(amount);
      console.log("after call balanceOf:", await time.latest());
      //withdraw amount > pendingRewards
      await strch.connect(vaultA).withdraw(user.address, amount.div(2));
      const bal0 = amount.div(2).add(rewardPerBlock);
      expect(await strch.balanceOf(vaultA.address)).to.equal(bal0);
      expect(await strch.totalShares()).to.equal(bal0);
      //withdraw amount < pendingRewards
      const rewardPerBlock1 = 47564688041;
      const bal1 = bal0.add(rewardPerBlock1).sub(100);
      await strch.connect(vaultA).withdraw(user.address, 100);
      expect(await strch.balanceOf(vaultA.address)).to.equal(bal1);
      expect(await strch.totalShares()).to.equal(bal1);
      await rch.connect(vaultA).approve(strch.address, constants.MaxUint256); //make time go
      expect(await strch.balanceOf(vaultA.address)).to.gt(await strch.totalShares());
    });
  });
  
  describe("immutable", function () {
    it("Should get RCH token address", async function () {
      expect(await strch.rch()).to.equal(rch.address);
    });
    it("Should get RCH token address", async function () {
      expect(await strch.airdrop()).to.equal(airdrop.address);
    });
  });

  describe("claimInterest", function () {
    it("Should successfully claim interest", async function () {
      const indexes = [timestampA, timestampB];
      const amounts = [amountAirdrop, amountAirdrop];
      const merkleProofs = [[anotherNode], [anotherNode]];
      await expect(strch.connect(user).claimInterest(indexes, amounts, merkleProofs))
        .to.changeTokenBalances(rch, [strch], [amountAirdrop.mul(2)]);
    });
  });
  
  describe("interestIsClaimed", function () {
    it("Should false by default claim interest", async function () {
      const indexes = [timestampA, timestampB];
      expect(await strch.connect(user).interestIsClaimed(indexes))
        .to.deep.equal([false, false]);
    });
    it("Should true after claimInterest", async function () {
      const indexes = [timestampA, timestampB];
      const amounts = [amountAirdrop, amountAirdrop];
      const merkleProofs = [[anotherNode], [anotherNode]];
      strch.connect(user).claimInterest(indexes, amounts, merkleProofs);
      expect(await strch.connect(user).interestIsClaimed(indexes))
        .to.deep.equal([true, true]);
    });
  });

  //application from vaults
  describe("Simple Interest", function () {
    it("Should be different for vaultA and vaultB", async function () {
      const ir = parseEther("1"); //100% to make it obvious
      await strch.updateInterestRate(ir);
      await strch.enableVaults([vaultA.address, vaultB.address]);
      const amount = 100; //parseEther("100")
      const aYear = 60*60*24*365;
      await strch.connect(vaultA).mint(amount);
      await strch.connect(vaultB).mint(amount);
      // console.log("balance of A:", await strch.balanceOf(vaultA.address));
      // console.log("balance of B:", await strch.balanceOf(vaultB.address));
      // console.log("userAccRewards A:", await strch.userAccRewards(vaultA.address));
      // console.log("userAccRewards B:", await strch.userAccRewards(vaultB.address));
      // console.log("accRewardsPerShare:", await strch.accRewardsPerShare());
      let futureTime = (await time.latest()) + aYear
      await time.increaseTo(futureTime);
      //await strch.connect(vaultA).mint(0);

      await strch.connect(vaultA).withdraw(user.address, 0);

      // console.log("balance of A:", await strch.balanceOf(vaultA.address));
      // console.log("balance of B:", await strch.balanceOf(vaultB.address));
      // console.log("userAccRewards A:", await strch.userAccRewards(vaultA.address));
      // console.log("userAccRewards B:", await strch.userAccRewards(vaultB.address));
      // console.log("accRewardsPerShare:", await strch.accRewardsPerShare());
      futureTime = (await time.latest()) + aYear;
      await time.increaseTo(futureTime);
      // console.log("balance of A:", await strch.balanceOf(vaultA.address));
      // console.log("balance of B:", await strch.balanceOf(vaultB.address));
      // console.log("A and B should not have such a big difference");
      expect(await strch.balanceOf(vaultA.address)).to.equal(400);
      expect(await strch.balanceOf(vaultB.address)).to.equal(300);
    });
  })
})

function leafComp(address: any, amount: any) {
  const encoded = ethers.utils.solidityPack(
    ["address", "uint256"],
    [address, amount]
  );
  return ethers.utils.keccak256(encoded);
}

function nodeComp(hash1: any, hash2: any) {
  const [a, b] = hash1 < hash2 ? [hash1, hash2] : [hash2, hash1];
  const encoded = ethers.utils.solidityPack(
    ["bytes32", "bytes32"],
    [a, b]
  );
  return ethers.utils.keccak256(encoded);
}
