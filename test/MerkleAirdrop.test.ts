import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("MerkleAirdrop Contract", function () {
  let token: Contract;
  let merkleAirdrop: Contract;
  let owner: SignerWithAddress;
  let addr1: SignerWithAddress;
  let timestampA: number;
  let timestampB: number;

  beforeEach(async function () {
    // Get contract factories
    const Token = await ethers.getContractFactory("RCH");
    const MerkleAirdrop = await ethers.getContractFactory("MerkleAirdrop");

    [owner, addr1] = await ethers.getSigners();

    // Deploy a mock ERC20 token
    const tradingStartTime = Math.floor(new Date().getTime() / 1000 + 60 * 60 * 24); // 1 day later
    token = await Token.deploy(tradingStartTime);

    // Deploy the MerkleAirdrop contract
    merkleAirdrop = await MerkleAirdrop.deploy(token.address);
    await token.transferOwnership(merkleAirdrop.address);

    // Prepare and set a Merkle root
    const merkleRoot = '0x49e1b86aff6a7c1613dd42addb7f788612c0405c47da0753884a6040273c4d48'; // Replace with actual merkle root
    // yesterday 12am timestamp
    let currentDate = new Date();
    currentDate.setDate(currentDate.getDate());
    currentDate.setUTCHours(0, 0, 0, 0);
    timestampA = Math.floor(currentDate.getTime() / 1000); // 将毫秒转换为秒
    await merkleAirdrop.connect(owner).setMerkleRoot(timestampA, merkleRoot);

    let yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    yesterdayDate.setUTCHours(0, 0, 0, 0);
    timestampB = Math.floor(yesterdayDate.getTime() / 1000); // 将毫秒转换为秒
    await merkleAirdrop.connect(owner).setMerkleRoot(timestampB, merkleRoot);
  });

  describe("Claiming Airdrop", function () {
    it("Should successfully claim airdrop", async function () {
      const index = timestampA;
      const amount = ethers.utils.parseUnits("1", 18);
      const merkleProof = ['0x1daab6e461c57679d093fe722a8bf8ba48798a5a9386000d2176d175bc5fae57']; // Replace with actual merkle proof

      await expect(merkleAirdrop.connect(addr1).claim(index, amount, merkleProof))
        .to.emit(merkleAirdrop, 'Claimed')
        .withArgs(index, addr1.address, amount);

      // Verify that tokens were minted to addr1
      const actualBalance = await token.balanceOf(addr1.address);
      expect(actualBalance).to.equal(amount);
    });

    it("Should fail for already claimed airdrop", async function () {
      const index = timestampA;
      const amount = ethers.utils.parseUnits("1", 18);
      const merkleProof = ['0x1daab6e461c57679d093fe722a8bf8ba48798a5a9386000d2176d175bc5fae57']; // Replace with actual merkle proof

      // First claim should succeed
      await merkleAirdrop.connect(addr1).claim(index, amount, merkleProof);

      // Second claim should fail
      await expect(merkleAirdrop.connect(addr1).claim(index, amount, merkleProof))
        .to.be.revertedWith("MerkleAirdrop: Drop already claimed.");
    });

    it("Should successfully claimMultiple airdrop", async function () {
      const indexes = [timestampA, timestampB];
      const amounts = [ethers.utils.parseUnits("1", 18), ethers.utils.parseUnits("1", 18)];
      const merkleProofs = [['0x1daab6e461c57679d093fe722a8bf8ba48798a5a9386000d2176d175bc5fae57'], ['0x1daab6e461c57679d093fe722a8bf8ba48798a5a9386000d2176d175bc5fae57']]; // Replace with actual merkle proof

      await expect(merkleAirdrop.connect(addr1).claimMultiple(indexes, amounts, merkleProofs))
        .to.emit(merkleAirdrop, 'Claimed');
      expect(await merkleAirdrop.connect(addr1)["isClaimed(uint256[])"](indexes)).to.deep.equal([true, true]);

      // Verify that tokens were minted to addr1
      const actualBalance = await token.balanceOf(addr1.address);
      expect(actualBalance).to.equal(ethers.utils.parseUnits("2", 18));
    });
  });

  // Other tests...
});
