// test/SmartTrendVaultTest.ts
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PERMIT2_ADDRESS,
  expect,
  constants,
  deployFixture,
  mintWithoutPermit as mint,
  mintBatchWithoutPermit as mintBatch,
  parseEther,
  keccak256,
  solidityKeccak256,
  solidityPack
} from "../helpers/helpers";

describe("SimpleSmartTrendVault", function () {
  let collateral, oracle, minter, maker, referral, vault, eip721Domain, aggregator;
  beforeEach(async function () {
    ({
      collateral,
      spotAggregator: aggregator,
      spotOracle:oracle,
      minter,
      maker,
      referral
    } = await loadFixture(deployFixture));
    // Deploy mock strategy contract
    const Strategy = await ethers.getContractFactory("SmartBear");
    const strategy = await Strategy.deploy();

    // Deploy SmartTrendVault contract
    const Vault = await ethers.getContractFactory("contracts/vaults/SimpleSmartTrendVault.sol:SimpleSmartTrendVault");
    vault = await upgrades.deployProxy(Vault, [
      "Sofa ETH",
      "sfETH",
      strategy.address, // Mock strategy contract
      collateral.address,
      oracle.address
    ]);
    eip721Domain = {
      name: 'Vault',
      version:  '1.0',
      chainId: 1,
      verifyingContract: vault.address,
    };
    await collateral.connect(minter).approve(vault.address, constants.MaxUint256); // approve max
    await collateral.connect(maker).approve(vault.address, constants.MaxUint256); // approve max
  });

  describe("Mint", function () {
    it("should mint tokens", async function () {
      const totalCollateral = parseEther("100");
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      const anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      const deadline = await time.latest() + 600;
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await expect(mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain)).to.be.revertedWith("Vault: signature consumed");
      // Perform assertions
      const minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      const makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("100"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("100"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("99990"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
    });
  });

  describe("Burn", function () {
    it("should burn tokens", async function () {
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      let anchorPrices = [parseEther("28000"), parseEther("30000")];
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;

      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      // Test variables
      let minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      let makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      // Call burn function
      await expect(vault.burn(expiry, anchorPrices, 0)).to.be.reverted;

      await expect(vault.connect(minter).burn(expiry, anchorPrices, 0)).to.be.revertedWith("Vault: not expired");
      await time.increaseTo(expiry);
      await oracle.settle();
      // Add your assertions here
      // Call burn function
      await expect(vault.connect(minter).burn(expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("100"), 0);
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("100"), parseEther("100"));
      expect(await collateral.balanceOf(vault.address)).to.equal(parseEther("0"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99910"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100090"));

      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;

      // strike case
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("32000"));
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      expect(await vault.balanceOf(minter.address, minterProductId)).to.equal(parseEther("100"));
      expect(await vault.balanceOf(maker.address, makerProductId)).to.equal(parseEther("100"));
      await expect(vault.connect(minter).burn(expiry, anchorPrices, 0)).to.emit(vault, "Burned")
        .withArgs(minter.address, minterProductId, parseEther("100"), parseEther("16.666666666666666667"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned")
        .withArgs(maker.address, makerProductId, parseEther("100"), parseEther("100").sub(parseEther("16.666666666666666667")));
      expect(await collateral.balanceOf(vault.address)).to.equal(0);
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99836.666666666666666667"));
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100163.333333333333333333"));

      // another case
      expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      deadline = await time.latest() + 600;
      anchorPrices = [parseEther("27000"), parseEther("33000")];
      await mint(totalCollateral, expiry, anchorPrices, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);
      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("26000"));
      await oracle.settle();
      minterProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 0]);
      makerProductId = solidityKeccak256(["uint256", "uint256[2]", "uint256"], [expiry, anchorPrices, 1]);
      await expect(vault.connect(minter).burn(expiry, anchorPrices, 0)).to.emit(vault, "Burned").withArgs(minter.address, minterProductId, parseEther("100"), parseEther("100"));
      await expect(vault.connect(maker).burn(expiry, anchorPrices, 1)).to.emit(vault, "Burned").withArgs(maker.address, makerProductId, parseEther("100"), parseEther("0"));
    });
  });

  describe("BurnBatch", function () {
    it("should batch burn tokens", async function () {
      // batch burn tokens
      const totalCollateral = parseEther("100");
      let expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800 + 86400;
      let anchorPricesA = [parseEther("28000"), parseEther("30000")];
      let anchorPricesB = [parseEther("27000"), parseEther("33000")];
      const makerCollateral = parseEther("10");
      let deadline = await time.latest() + 600;

      await mint(totalCollateral, expiry, anchorPricesA, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain);

      await mint(totalCollateral, expiry, anchorPricesB, makerCollateral, deadline, collateral, vault, minter, maker, referral, eip721Domain)

      await time.increaseTo(expiry);
      await aggregator.setLatestAnswer(parseEther("32000"));
      await oracle.settle();
      await vault.connect(minter).burnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, isMaker:0 },
        { expiry:expiry, anchorPrices:anchorPricesB, isMaker:0 }
      ]);
      await vault.connect(maker).burnBatch([
        { expiry:expiry, anchorPrices:anchorPricesA, isMaker:1 },
        { expiry:expiry, anchorPrices:anchorPricesB, isMaker:1 }
      ]);

      expect(await collateral.balanceOf(vault.address)).to.equal(0);
      expect(await collateral.balanceOf(maker.address)).to.equal(parseEther("100163.333333333333333333"));
      expect(await collateral.balanceOf(minter.address)).to.equal(parseEther("99836.666666666666666667"));
    });
  });

  describe("Settle", function () {
    it("should settle the price", async function () {
      // Call settle function
      const expiry = Math.ceil(await time.latest() / 86400) * 86400 + 28800;
      await time.increaseTo(expiry);
      await expect(oracle.settle()).emit(oracle, "Settled");
    });
  });


  // describe("Upgrade Proxy", function () {
  //   it("should upgrade the proxy", async function () {
  //     const VaultV2 = await ethers.getContractFactory("SmartTrendVault");
  //     await upgrades.upgradeProxy(vault.address, VaultV2);
  //   });
  // });

  describe("Decimals", function () {
    it("should equal collateral decimals", async function () {
      expect(await vault.decimals()).to.equal(await collateral.decimals());
    });
  });
});
